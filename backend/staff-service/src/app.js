import { createHttpApp, HttpError } from '../../shared/http.js';
import { id } from '../../shared/validation.js';
export function createApp({ repository, config }) {
  return createHttpApp({ name: 'staff', config, routes: [
    { method: 'GET', path: '/internal/v1/branches/:id', auth: 'internal', callers: ['order'], handler: async ({ params }) => {
      const branch = await repository.branch(id(params.id));
      if (!branch) throw new HttpError(404, 'BRANCH_NOT_FOUND', 'Chi nhánh chưa được cấu hình.');
      return branch;
    } },
    { method: 'GET', path: '/internal/v1/bookings/:id/assignment', auth: 'internal', callers: ['order'], handler: ({ params }) => repository.assignment(id(params.id)) },
  ] });
}
