import { createHttpApp, HttpError, reply } from '../../shared/http.js';
import { id, enumValue, object, text } from '../../shared/validation.js';
import { createAuthenticator, createInternalClient } from '../../shared/service-client.js';

const nextStatuses = ['accepted', 'in_progress', 'done'];
const operationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createApp({ repository, config }) {
  const authenticate = createAuthenticator(config, 'staff');
  const request = createInternalClient(config, 'staff');
  return createHttpApp({ name: 'staff', config, authenticate, routes: [
    { method: 'GET', path: '/api/v1/staff/jobs', auth: 'staff', handler: ({ principal, url }) =>
      request('order', `/internal/v1/staff/users/${id(principal.sub)}/jobs${url.search}`) },
    { method: 'GET', path: '/api/v1/staff/jobs/:id', auth: 'staff', handler: ({ principal, params }) =>
      request('order', `/internal/v1/staff/users/${id(principal.sub)}/jobs/${id(params.id)}`) },
    { method: 'POST', path: '/api/v1/staff/jobs/:id/transitions', auth: 'staff', handler: async ({ principal, params, body }) => {
      object(body, ['operationId', 'nextStatus']);
      const bookingId = id(params.id);
      const operationId = text(body.operationId, 'operationId', 36, 36).toLowerCase();
      if (!operationIdPattern.test(operationId)) throw new HttpError(400, 'INVALID_INPUT', 'Mã thao tác không hợp lệ.');
      const nextStatus = enumValue(body.nextStatus, 'nextStatus', nextStatuses);
      const operation = await repository.prepareTransition(principal.sub, bookingId, operationId, nextStatus);
      if (operation.phase === 'COMPLETED') return reply(await repository.completeTransition(operationId));
      try {
        await request('order', `/internal/v1/staff/users/${id(principal.sub)}/jobs/${bookingId}/transitions`, {
          method: 'POST',
          body: {
            operationId, assignmentId: operation.assignmentId, employeeId: operation.employeeId,
            nextStatus,
          },
        });
        return reply(await repository.completeTransition(operationId));
      } catch (error) {
        if (error instanceof HttpError && error.status < 500) await repository.failTransition(operationId);
        throw error;
      }
    } },
    { method: 'GET', path: '/internal/v1/branches/:id', auth: 'internal', callers: ['order'], handler: async ({ params }) => {
      const branch = await repository.branch(id(params.id));
      if (!branch) throw new HttpError(404, 'BRANCH_NOT_FOUND', 'Chi nhánh chưa được cấu hình.');
      return branch;
    } },
    { method: 'GET', path: '/internal/v1/bookings/:id/assignment', auth: 'internal', callers: ['order'], handler: ({ params }) => repository.assignment(id(params.id)) },
    { method: 'GET', path: '/internal/v1/users/:id/employee', auth: 'internal', callers: ['order'], handler: async ({ params }) => {
      const employee = await repository.employee(id(params.id));
      if (!employee) throw new HttpError(404, 'STAFF_ACCOUNT_NOT_FOUND', 'Không tìm thấy hồ sơ nhân viên đang hoạt động.');
      return employee;
    } },
    { method: 'GET', path: '/internal/v1/users/:userId/bookings/:bookingId/assignment', auth: 'internal', callers: ['order'], handler: async ({ params }) => {
      const assignment = await repository.assignmentForUser(id(params.userId), id(params.bookingId));
      if (!assignment) throw new HttpError(404, 'STAFF_ASSIGNMENT_NOT_FOUND', 'Không tìm thấy công việc được phân công.');
      return assignment;
    } },
  ] });
}
