import { createInterface } from 'node:readline';
import { email, phone, text } from '../shared/validation.js';
import { hashPassword, validatePassword } from '../shared/passwords.js';
import { pool } from '../auth-service/src/db.js';

function hiddenInput(prompt) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('Cần chạy trực tiếp trong terminal tương tác để nhập mật khẩu an toàn.');
  }
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
    };
    const onData = (chunk) => {
      for (const character of chunk.toString()) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Đã hủy thao tác.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else if (character >= ' ') {
          value += character;
        }
      }
    };
    input.on('data', onData);
    input.setRawMode(true);
    input.resume();
  });
}

async function main() {
  if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST)) {
    throw new Error('Script chỉ chạy với MySQL local (localhost/127.0.0.1) và không chạy trong production.');
  }
  const [databaseRows] = await pool.query('SELECT DATABASE() AS databaseName');
  const databaseName = databaseRows[0]?.databaseName;
  if (!databaseName || databaseName !== process.env.DB_NAME) throw new Error('Không xác nhận được database đích trong backend/.env.');

  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (label) => new Promise((resolve) => terminal.question(label, resolve));
  try {
    const confirmation = await ask(`Để xác nhận database "${databaseName}", nhập lại chính xác tên database: `);
    if (confirmation !== databaseName) throw new Error('Tên database xác nhận không khớp; không tạo tài khoản.');
    const [existing] = await pool.execute("SELECT COUNT(*) AS total FROM users WHERE role='ADMIN' AND status='ACTIVE'");
    if (Number(existing[0]?.total) > 0) throw new Error('Đã có tài khoản ADMIN ACTIVE; không tạo thêm tài khoản.');
    const name = text(await ask('Họ tên quản trị viên: '), 'name', 2, 100);
    const normalizedPhone = phone(await ask('Số điện thoại: '));
    const normalizedEmail = email(await ask('Email: '));
    terminal.close();
    const password = validatePassword(await hiddenInput('Mật khẩu mới (không hiển thị): '));
    const repeatedPassword = await hiddenInput('Nhập lại mật khẩu: ');
    if (password !== repeatedPassword) throw new Error('Hai lần nhập mật khẩu không khớp.');
    const passwordHash = await hashPassword(password);
    const [result] = await pool.execute(
      'INSERT INTO users (full_name, phone, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)',
      [name, normalizedPhone, normalizedEmail, passwordHash, 'ADMIN', 'ACTIVE'],
    );
    process.stdout.write(`Đã tạo tài khoản ADMIN id=${result.insertId} trong ${databaseName}. Mật khẩu không được lưu/hiển thị bởi script.\n`);
  } finally {
    terminal.close();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`Không tạo được tài khoản ADMIN: ${error instanceof Error ? error.message : 'Lỗi không xác định.'}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
