export function createRepository(pool) {
  return {
    async branch(id) {
      const [rows] = await pool.execute('SELECT id, status FROM branches WHERE id = ? LIMIT 1', [id]);
      return rows[0] ? { id: String(rows[0].id), status: rows[0].status } : null;
    },
    async assignment(bookingId) {
      // A later waiting assignment must never hide another employee's started work.
      const [rows] = await pool.execute("SELECT employee_id, status FROM assignments WHERE booking_id = ? AND status NOT IN (?, ?) ORDER BY CASE WHEN status = 'IN_PROGRESS' THEN 0 WHEN status IN ('COMPLETED', 'DONE') THEN 1 ELSE 2 END, assigned_at DESC, id DESC LIMIT 1", [bookingId, 'CANCELLED', 'REJECTED']);
      return rows[0] ? { employeeId: String(rows[0].employee_id), status: rows[0].status } : null;
    },
  };
}
