import { HttpError } from '../../shared/http.js';

const columns = 'id, full_name, phone, email, password_hash, role, status, created_at';
export function createRepository(pool) {
  return {
    async findByIdentifier(identifier) {
      const [rows] = await pool.execute('SELECT ' + columns + ' FROM users WHERE phone = ? OR email = ? LIMIT 1', [identifier, identifier]);
      return rows[0] || null;
    },
    async findById(id) {
      const [rows] = await pool.execute('SELECT ' + columns + ' FROM users WHERE id = ? LIMIT 1', [id]);
      return rows[0] || null;
    },
    async create({ name, phone, email, passwordHash }) {
      try {
        const [result] = await pool.execute('INSERT INTO users (full_name, phone, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)', [name, phone, email, passwordHash, 'CUSTOMER', 'ACTIVE']);
        return this.findById(String(result.insertId));
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'ACCOUNT_EXISTS', 'Số điện thoại hoặc email đã được sử dụng.');
        throw error;
      }
    },
  };
}
