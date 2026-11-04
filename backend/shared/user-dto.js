export function userDto(row, address = '') {
  return {
    id: String(row.id), code: 'KH' + String(row.id).padStart(6, '0'),
    role: 'customer', name: row.full_name, phone: row.phone, email: row.email || '', address,
    status: row.status === 'ACTIVE' ? 'active' : 'locked',
    createdAt: new Date(row.created_at).toISOString(),
  };
}
