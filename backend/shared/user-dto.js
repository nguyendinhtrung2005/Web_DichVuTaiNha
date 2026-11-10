export function userDto(row, address = '') {
  const roles = { CUSTOMER: 'customer', EMPLOYEE: 'staff', ADMIN: 'admin' };
  const role = roles[row.role];
  if (!role) throw new TypeError('Unsupported user role.');
  return {
    id: String(row.id), code: (role === 'customer' ? 'KH' : role === 'staff' ? 'NV' : 'AD') + String(row.id).padStart(6, '0'),
    role, name: row.full_name, phone: row.phone, email: row.email || '', address,
    status: row.status === 'ACTIVE' ? 'active' : 'locked',
    createdAt: new Date(row.created_at).toISOString(),
  };
}
