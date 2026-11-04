import { HttpError } from '../../shared/http.js';
import { userDto } from '../../shared/user-dto.js';
export function createRepository(pool) {
  return {
    async get(id) {
      const [rows] = await pool.execute('SELECT id, full_name, phone, email, role, status, created_at FROM users WHERE id = ? AND role = ? AND status = ?', [id, 'CUSTOMER', 'ACTIVE']);
      if (!rows[0]) return null;
      const [addresses] = await pool.execute('SELECT address_text FROM addresses WHERE user_id = ? ORDER BY id DESC LIMIT 1', [id]);
      return userDto(rows[0], addresses[0]?.address_text || '');
    },
    async update(id, patch) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute('SELECT email FROM users WHERE id = ? AND role = ? AND status = ? FOR UPDATE', [id, 'CUSTOMER', 'ACTIVE']);
        if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Không tìm thấy tài khoản.');
        await connection.execute('UPDATE users SET full_name = ?, phone = ?, email = ? WHERE id = ?', [patch.name, patch.phone, patch.email === undefined ? rows[0].email : patch.email, id]);
        await connection.commit();
        return this.get(id);
      } catch (error) {
        await connection.rollback();
        if (error.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'ACCOUNT_EXISTS', 'Số điện thoại hoặc email đã được sử dụng.');
        throw error;
      } finally { connection.release(); }
    },
  };
}
