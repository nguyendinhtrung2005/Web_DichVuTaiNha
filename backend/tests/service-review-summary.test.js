import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceReviewSummary } from '../review-service/src/service-summary.js';
import { createRepository as createReviewRepository } from '../review-service/src/repository.js';
import { createRepository as createOrderRepository } from '../order-service/src/repository.js';

test('public review summary weights database scores across pages and exposes no private fields', async () => {
  const ids = [];
  const result = await serviceReviewSummary(async (target, path) => {
    assert.equal(target, 'order');
    const page = Number(new URL(path, 'http://synthetic.invalid').searchParams.get('page'));
    return { items: Array.from({ length: page === 1 ? 100 : 1 }, (_, index) => ({ id: String((page - 1) * 100 + index + 1) })), total: 101, page, limit: 100 };
  }, { async summarizeBookings(batch) { ids.push(...batch); return batch.length === 100 ? { count: 2, ratingSum: 7 } : { count: 1, ratingSum: 5 }; } }, '7');
  assert.deepEqual(result, { serviceId: '7', count: 3, averageRating: 4 });
  assert.equal(ids.length, 101);
});

test('review summary distinguishes true emptiness from unavailable, inconsistent and excessively large dependencies', async () => {
  const repository = { async summarizeBookings() { return { count: 0, ratingSum: 0 }; } };
  assert.deepEqual(await serviceReviewSummary(async () => ({ items: [], total: 0, page: 1, limit: 100 }), repository, '7'), { serviceId: '7', count: 0, averageRating: null });
  for (const result of [null, { items: [], total: 10001, page: 1, limit: 100 }, { items: [], total: 1, page: 1, limit: 100 }, { items: [{ id: '1' }, { id: '1' }], total: 2, page: 1, limit: 100 }]) {
    await assert.rejects(serviceReviewSummary(async () => result, repository, '7'), (error) => error.status === 503);
  }
  await assert.rejects(serviceReviewSummary(async () => { throw new Error('synthetic internal failure'); }, repository, '7'), (error) => error.status === 503 && !error.message.includes('internal'));
});

test('Order completed-booking provider uses EXISTS and only returns IDs without joining Review or Catalog', async () => {
  const calls = [];
  const repository = createOrderRepository({
    async execute(sql, values) { calls.push({ sql, values }); return [[{ total: 1 }]]; },
    async query(sql, values) { calls.push({ sql, values }); return [[{ id: 5, customer_id: 'private-ignored' }]]; },
  });
  const result = await repository.completedServiceBookings('7', { page: 1, limit: 100 });
  assert.deepEqual(result, { items: [{ id: '5' }], total: 1, page: 1, limit: 100 });
  assert.match(calls[0].sql, /status = 'COMPLETED'.*EXISTS/s);
  assert.ok(calls.every((call) => !/\b(reviews|services|users|employees)\b/.test(call.sql)));
  assert.deepEqual(calls[0].values, ['7']);
});

test('Review aggregate reads only owned review rows and rejects invalid stored scores', async () => {
  let valid = true;
  const repository = createReviewRepository({ async execute(sql, values) {
    assert.match(sql, /FROM reviews WHERE booking_id IN \(\?,\?\)/);
    assert.deepEqual(values, ['5', '6']);
    return [[valid ? { count: '2', ratingSum: '9', minRating: 4, maxRating: 5 } : { count: '2', ratingSum: '9', minRating: 0, maxRating: 9 }]];
  } });
  assert.deepEqual(await repository.summarizeBookings(['5', '6']), { count: 2, ratingSum: 9 });
  valid = false;
  await assert.rejects(repository.summarizeBookings(['5', '6']), (error) => error.status === 503);
});
