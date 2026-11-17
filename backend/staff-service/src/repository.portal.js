import { createHash } from 'node:crypto';
import { HttpError } from '../../shared/http.js';

const transitions = {
  accepted: { from: 'ASSIGNED', to: 'ACCEPTED' },
  in_progress: { from: 'ACCEPTED', to: 'IN_PROGRESS' },
  done: { from: 'IN_PROGRESS', to: 'COMPLETED' },
};

function jobStatus(status) {
  return ({ ASSIGNED: 'waiting', ACCEPTED: 'accepted', IN_PROGRESS: 'in_progress', COMPLETED: 'done', DONE: 'done' })[status];
}

function transitionUnavailable() {
  return new HttpError(503, 'STAFF_TRANSITION_SCHEMA_NOT_READY', 'Chưa áp dụng migration 005; không thể cập nhật trạng thái công việc.');
}

function operationHash(userId, bookingId, nextStatus) {
  return createHash('sha256').update(JSON.stringify({ userId: String(userId), bookingId: String(bookingId), nextStatus })).digest('hex');
}

export function createRepository(pool) {
  async function requireTransitionSchema() {
    const [columns] = await pool.execute(
      `SELECT COUNT(DISTINCT column_name) AS present
       FROM information_schema.columns
       WHERE table_schema=DATABASE() AND table_name=?
         AND column_name IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['staff_assignment_transition_operations', 'id', 'operation_id', 'assignment_id', 'employee_id',
        'booking_id', 'request_hash', 'from_status', 'to_status', 'phase', 'result_snapshot', 'created_at', 'updated_at'],
    );
    const [indexes] = await pool.execute(
      `SELECT non_unique AS nonUnique, column_name AS columnName
       FROM information_schema.statistics
       WHERE table_schema=DATABASE() AND table_name=? AND index_name=?`,
      ['staff_assignment_transition_operations', 'uq_staff_transition_operation'],
    );
    if (Number(columns[0]?.present) !== 12 || indexes.length !== 1
      || Number(indexes[0].nonUnique) !== 0 || indexes[0].columnName !== 'operation_id') {
      throw transitionUnavailable();
    }
  }

  return {
    async branch(id) {
      const [rows] = await pool.execute('SELECT id, status FROM branches WHERE id = ? LIMIT 1', [id]);
      return rows[0] ? { id: String(rows[0].id), status: rows[0].status } : null;
    },
    async assignment(bookingId) {
      const [rows] = await pool.execute("SELECT employee_id, status FROM assignments WHERE booking_id = ? AND status NOT IN (?, ?) ORDER BY CASE WHEN status = 'IN_PROGRESS' THEN 0 WHEN status IN ('COMPLETED', 'DONE') THEN 1 ELSE 2 END, assigned_at DESC, id DESC LIMIT 1", [bookingId, 'CANCELLED', 'REJECTED']);
      return rows[0] ? { employeeId: String(rows[0].employee_id), status: rows[0].status } : null;
    },
    async employee(userId) {
      const [rows] = await pool.execute(
        "SELECT id FROM employees WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1",
        [userId],
      );
      return rows[0] ? { employeeId: String(rows[0].id) } : null;
    },
    async assignmentForUser(userId, bookingId) {
      const [rows] = await pool.execute(
        `SELECT a.id, a.booking_id AS bookingId, a.employee_id AS employeeId, a.status,
                e.user_id AS userId
         FROM assignments a
         JOIN employees e ON e.id = a.employee_id
         WHERE e.user_id = ? AND e.status = 'ACTIVE' AND a.booking_id = ?
           AND a.status NOT IN ('CANCELLED', 'REJECTED')
         ORDER BY a.assigned_at DESC, a.id DESC LIMIT 1`,
        [userId, bookingId],
      );
      const row = rows[0];
      return row ? {
        id: String(row.id), bookingId: String(row.bookingId), employeeId: String(row.employeeId),
        userId: String(row.userId), status: row.status, jobStatus: jobStatus(row.status),
      } : null;
    },
    async prepareTransition(userId, bookingId, operationId, nextStatus) {
      await requireTransitionSchema();
      const transition = transitions[nextStatus];
      if (!transition) throw new HttpError(400, 'INVALID_INPUT', 'Trạng thái công việc không hợp lệ.');
      const requestHash = operationHash(userId, bookingId, nextStatus);
      const connection = await pool.getConnection();
      let transaction = false;
      try {
        await connection.beginTransaction();
        transaction = true;
        const [employees] = await connection.execute(
          "SELECT id FROM employees WHERE user_id = ? AND status = 'ACTIVE' FOR UPDATE",
          [userId],
        );
        if (!employees[0]) throw new HttpError(404, 'STAFF_ASSIGNMENT_NOT_FOUND', 'Không tìm thấy công việc được phân công.');
        const employeeId = String(employees[0].id);
        const [operations] = await connection.execute(
          `SELECT assignment_id AS assignmentId, employee_id AS employeeId, booking_id AS bookingId,
                  request_hash AS requestHash, from_status AS fromStatus, to_status AS toStatus,
                  phase, result_snapshot AS resultSnapshot
           FROM staff_assignment_transition_operations WHERE operation_id = ? FOR UPDATE`,
          [operationId],
        );
        if (operations[0]) {
          const operation = operations[0];
          if (String(operation.employeeId) !== employeeId || String(operation.bookingId) !== String(bookingId)
            || operation.requestHash !== requestHash || operation.toStatus !== transition.to) {
            throw new HttpError(409, 'OPERATION_ID_REUSED', 'Mã thao tác đã được dùng cho yêu cầu khác.');
          }
          if (operation.phase === 'FAILED') throw new HttpError(409, 'TRANSITION_FAILED', 'Thao tác trước đó đã thất bại; hãy tạo yêu cầu mới.');
          await connection.commit();
          transaction = false;
          return {
            assignmentId: String(operation.assignmentId), employeeId, bookingId: String(bookingId),
            fromStatus: operation.fromStatus, toStatus: operation.toStatus, phase: operation.phase,
            resultSnapshot: operation.resultSnapshot,
          };
        }
        const [assignments] = await connection.execute(
          `SELECT id, status FROM assignments
           WHERE booking_id = ? AND employee_id = ? AND status NOT IN ('CANCELLED', 'REJECTED')
           ORDER BY assigned_at DESC, id DESC LIMIT 1 FOR UPDATE`,
          [bookingId, employeeId],
        );
        const assignment = assignments[0];
        if (!assignment) throw new HttpError(404, 'STAFF_ASSIGNMENT_NOT_FOUND', 'Không tìm thấy công việc được phân công.');
        const assignmentId = String(assignment.id);
        const [pending] = await connection.execute(
          `SELECT operation_id FROM staff_assignment_transition_operations
           WHERE assignment_id = ? AND phase = 'PENDING' LIMIT 1 FOR UPDATE`,
          [assignmentId],
        );
        if (pending.length) throw new HttpError(409, 'STAFF_TRANSITION_BUSY', 'Công việc đang có thao tác chuyển trạng thái cần được thử lại.');
        if (assignment.status !== transition.from) {
          throw new HttpError(409, 'INVALID_JOB_TRANSITION', 'Trạng thái công việc đã thay đổi; hãy tải lại công việc.');
        }
        await connection.execute(
          `INSERT INTO staff_assignment_transition_operations
             (operation_id, assignment_id, employee_id, booking_id, request_hash, from_status, to_status, phase)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
          [operationId, assignmentId, employeeId, bookingId, requestHash, transition.from, transition.to],
        );
        await connection.commit();
        transaction = false;
        return { assignmentId, employeeId, bookingId: String(bookingId), ...transition, phase: 'PENDING' };
      } catch (error) {
        if (transaction) await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    },
    async completeTransition(operationId) {
      await requireTransitionSchema();
      const connection = await pool.getConnection();
      let transaction = false;
      try {
        await connection.beginTransaction();
        transaction = true;
        const [operations] = await connection.execute(
          `SELECT assignment_id AS assignmentId, employee_id AS employeeId, booking_id AS bookingId,
                  to_status AS toStatus, phase, result_snapshot AS resultSnapshot
           FROM staff_assignment_transition_operations WHERE operation_id = ? FOR UPDATE`,
          [operationId],
        );
        const operation = operations[0];
        if (!operation || operation.phase !== 'COMPLETED') {
          throw new HttpError(409, 'TRANSITION_NOT_CONFIRMED', 'Order chưa xác nhận thao tác; trạng thái công việc chưa được cập nhật.');
        }
        const [assignments] = await connection.execute(
          `SELECT status FROM assignments
           WHERE id = ? AND employee_id = ? AND booking_id = ? FOR UPDATE`,
          [operation.assignmentId, operation.employeeId, operation.bookingId],
        );
        const assignment = assignments[0];
        if (!assignment) throw new HttpError(404, 'STAFF_ASSIGNMENT_NOT_FOUND', 'Không tìm thấy công việc được phân công.');
        const currentStatus = assignment.status;
        if (currentStatus !== operation.toStatus) {
          if (currentStatus !== ({ ACCEPTED: 'ASSIGNED', IN_PROGRESS: 'ACCEPTED', COMPLETED: 'IN_PROGRESS' })[operation.toStatus]) {
            throw new HttpError(409, 'INVALID_JOB_TRANSITION', 'Trạng thái công việc đã thay đổi; cần đối soát với quản trị viên.');
          }
          const setCheckIn = operation.toStatus === 'IN_PROGRESS' ? ', check_in_at = COALESCE(check_in_at, CURRENT_TIMESTAMP)' : '';
          const setCheckOut = operation.toStatus === 'COMPLETED' ? ', check_out_at = CURRENT_TIMESTAMP' : '';
          await connection.execute(
            `UPDATE assignments SET status = ?${setCheckIn}${setCheckOut} WHERE id = ? AND status = ?`,
            [operation.toStatus, operation.assignmentId, currentStatus],
          );
        }
        const snapshot = typeof operation.resultSnapshot === 'string'
          ? JSON.parse(operation.resultSnapshot) : operation.resultSnapshot;
        if (!snapshot || typeof snapshot.orderStatus !== 'string') {
          throw new HttpError(503, 'INVALID_TRANSITION_RESULT', 'Kết quả chuyển trạng thái chưa hợp lệ.');
        }
        await connection.commit();
        transaction = false;
        return {
          bookingId: String(operation.bookingId), jobStatus: jobStatus(operation.toStatus),
          orderStatus: snapshot.orderStatus,
        };
      } catch (error) {
        if (transaction) await connection.rollback().catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    },
    async failTransition(operationId) {
      await requireTransitionSchema();
      await pool.execute(
        `UPDATE staff_assignment_transition_operations SET phase = 'FAILED'
         WHERE operation_id = ? AND phase = 'PENDING'`,
        [operationId],
      );
    },
  };
}
