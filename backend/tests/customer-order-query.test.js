import test from 'node:test';
import assert from 'node:assert/strict';
import { customerOrderQuery } from '../order-service/src/customer-order-query.js';
import { createRepository } from '../order-service/src/repository.js';

const parse = (query) => customerOrderQuery(new URL('http://synthetic.invalid/orders?' + query));

test('Order filter calendar bounds include the whole Vietnam day and reject invalid dates, ranges and enums', () => {
  const result = parse('from=2026-11-08&to=2026-11-08&serviceId=7&status=completed&sort=schedule-asc&page=2&limit=8');
  assert.equal(result.fromUtc, '2026-11-07 17:00:00');
  assert.equal(result.toUtc, '2026-11-08 17:00:00');
  assert.equal(result.page, 2); assert.equal(result.limit, 8);
  assert.equal(result.serviceId, '7'); assert.equal(result.status, 'completed');
  for (const query of ['from=2026-02-31', 'to=2026-13-01', 'from=2026-11-09&to=2026-11-08', 'from=wrong', 'status=ADMIN', 'sort=id%3BDROP', 'serviceId=1%20OR%201%3D1', 'page=0', 'q=' + 'a'.repeat(121)]) {
    assert.throws(() => parse(query), (error) => error.status === 400);
  }
  assert.equal(parse('').sort, 'newest');
  assert.equal(parse('from=2024-02-29').fromUtc, '2024-02-28 17:00:00');
});

test('Order repository filters count and page consistently, bind ownership and snapshots, and whitelist sort SQL', async () => {
  const calls = [];
  const repository = createRepository({
    async execute(sql, values) { calls.push({ sql, values }); return [[{ total: 0 }]]; },
    async query(sql, values) { calls.push({ sql, values }); return [[]]; },
  });

  test('service order report aggregates current status by first recorded booking timestamp without exposing PII', async () => {
    const calls = [];
    const repository = createRepository({
      async execute(sql, values) {
        calls.push({ sql, values });
        return [[
          { status: 'PENDING', total: '2' },
          { status: 'COMPLETED', total: '3' },
        ]];
      },
    });
    const result = await repository.serviceOrderReport({
      from: '2026-11-08', to: '2026-11-08', status: undefined,
      fromUtc: '2026-11-07T17:00:00.000Z', toUtc: '2026-11-08T17:00:00.000Z',
    });
    assert.equal(result.total, 5);
    assert.equal(result.statusCounts.pending, 2);
    assert.equal(result.statusCounts.completed, 3);
    assert.deepEqual(calls[0].values, ['2026-11-07T17:00:00.000Z', '2026-11-08T17:00:00.000Z']);
    assert.match(calls[0].sql, /MIN\(created_at\)/);
    assert.match(calls[0].sql, /GROUP BY bookings\.status/);
    assert.doesNotMatch(calls[0].sql, /phone|full_name|address_snapshot/i);
  });
  const injection = "x%' OR 1=1 --!";
  const criteria = { ...parse('from=2026-11-08&to=2026-11-08&serviceId=7&status=completed&sort=schedule-asc&page=2&limit=8'), q: injection };
  const result = await repository.list('9', criteria);
  assert.equal(result.total, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].values[0], '9');
  assert.equal(calls[0].values[1], "%x!%' OR 1=1 --!!%");
  assert.match(calls[0].sql, /customer_id = \?/);
  assert.match(calls[0].sql, /EXISTS.*booking_items/s);
  assert.ok(calls.every((call) => !call.sql.includes(injection) && !call.sql.includes('FROM services')));
  assert.deepEqual(calls[1].values.slice(0, -2), calls[0].values);
  assert.deepEqual(calls[1].values.slice(-2), [8, 8]);
  assert.match(calls[1].sql, /ORDER BY scheduled_start ASC, id ASC LIMIT \? OFFSET \?/);
  await assert.rejects(repository.list('9', { page: 1, limit: 8, sort: 'id; DROP' }), (error) => error.status === 400);
});
