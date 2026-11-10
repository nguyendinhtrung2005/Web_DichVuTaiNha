import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingDecision, canonicalRegionKey } from '../order-service/src/booking-auto-assignment.js';

const start = new Date('2030-01-02T02:00:00.000Z');
const valid = {
  regionKey: 'phuong 1',
  branchMatches: [{ id: '1', status: 'ACTIVE' }],
  serviceActive: true,
  serviceEnabled: true,
  skillsConfigured: true,
  durationMinutes: 60,
  scheduledStart: start,
  qualifiedEmployees: ['9'],
  availabilityConfigured: true,
  availableEmployees: ['9'],
};

test('region matching uses canonical Vietnamese keys without guessing from address text', () => {
  assert.equal(canonicalRegionKey('  Phường Đa Kao  '), 'phuong da kao');
  assert.equal(canonicalRegionKey(''), null);
  assert.equal(bookingDecision({ ...valid, regionKey: null }).state, 'NEEDS_ADMIN');
});

test('booking decision auto-confirms only when the complete server-verified inputs are present', () => {
  assert.deepEqual(bookingDecision(valid), {
    state: 'AUTO_CONFIRMED',
    reason: 'Đã xác minh dịch vụ, chi nhánh, thời lượng, kỹ năng và availability; hệ thống tự xác nhận và phân công.',
  });
});

test('an otherwise eligible booking without a qualified worker enters dispatch queue', () => {
  assert.equal(bookingDecision({ ...valid, qualifiedEmployees: [] }).state, 'NEEDS_DISPATCH');
  assert.equal(bookingDecision({ ...valid, availableEmployees: [] }).state, 'NEEDS_DISPATCH');
});

test('missing or ambiguous routing/configuration never auto-confirms', () => {
  const cases = [
    [{ branchMatches: [] }, 'NEEDS_ADMIN', 'Chưa có vùng phục vụ được xác nhận'],
    [{ branchMatches: [{ id: '1', status: 'ACTIVE' }, { id: '2', status: 'ACTIVE' }] }, 'NEEDS_ADMIN', 'khớp 2 chi nhánh'],
    [{ branchMatches: [{ id: '1', status: 'INACTIVE' }] }, 'NEEDS_ADMIN', 'không hoạt động'],
    [{ serviceActive: false }, 'NEEDS_ADMIN', 'đã ngừng hoạt động'],
    [{ serviceEnabled: false }, 'NEEDS_ADMIN', 'chưa xác nhận chi nhánh'],
    [{ skillsConfigured: false }, 'NEEDS_ADMIN', 'kỹ năng bắt buộc'],
    [{ durationMinutes: null }, 'NEEDS_ADMIN', 'thời lượng'],
    [{ scheduledStart: new Date(Number.NaN) }, 'NEEDS_ADMIN', 'Lịch thực hiện'],
    [{ availabilityConfigured: false }, 'NEEDS_ADMIN', 'availability'],
  ];
  for (const [changes, state, reason] of cases) {
    const result = bookingDecision({ ...valid, ...changes });
    assert.equal(result.state, state);
    assert.match(result.reason, new RegExp(reason, 'i'));
  }
});
