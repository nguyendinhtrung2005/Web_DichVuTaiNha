const bookingRequestCheckClause = 'customer_request_keyisnullandcustomer_request_hashisnullorcustomer_request_keyisnotnullandcustomer_request_hashisnotnull';

function normalizeCheckClause(clause) {
  return typeof clause === 'string' ? clause.toLowerCase().replace(/[`()\s]/g, '') : '';
}

export async function checkCustomerEmailSchema(pool) {
  const [columns] = await pool.execute(
    'SELECT IS_NULLABLE AS nullable FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?',
    ['users', 'email'],
  );
  const [indexes] = await pool.execute(
    'SELECT NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=?',
    ['users', 'uq_users_email'],
  );
  return columns[0]?.nullable === 'YES' && indexes.length === 1 && indexes[0].columnName === 'email' && Number(indexes[0].nonUnique) === 0;
}

export async function checkCustomerBookingIdempotencySchema(pool) {
  const [columns] = await pool.execute(
    `SELECT COUNT(DISTINCT column_name) AS present FROM information_schema.columns
     WHERE table_schema=DATABASE() AND table_name=? AND column_name IN (?,?)`,
    ['bookings', 'customer_request_key', 'customer_request_hash'],
  );
  const [indexes] = await pool.execute(
    `SELECT index_name AS indexName, non_unique AS nonUnique, GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS columnsInOrder
     FROM information_schema.statistics
     WHERE table_schema=DATABASE() AND table_name=? AND index_name=?
     GROUP BY index_name, non_unique`,
    ['bookings', 'uq_booking_customer_request'],
  );
  const [constraints] = await pool.execute(
    `SELECT checks.check_clause AS checkClause
     FROM information_schema.check_constraints AS checks
     JOIN information_schema.table_constraints AS constraints
       ON constraints.constraint_schema=checks.constraint_schema AND constraints.constraint_name=checks.constraint_name
     WHERE constraints.constraint_schema=DATABASE() AND constraints.table_name=?
       AND constraints.constraint_name=? AND constraints.constraint_type='CHECK'`,
    ['bookings', 'chk_booking_request_pair'],
  );
  return Number(columns[0]?.present) === 2
    && indexes.length === 1
    && Number(indexes[0].nonUnique) === 0
    && indexes[0].columnsInOrder === 'customer_id,customer_request_key'
    && constraints.length === 1
    && normalizeCheckClause(constraints[0].checkClause) === bookingRequestCheckClause;
}
