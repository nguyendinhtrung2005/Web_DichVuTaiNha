// Read-only readiness check. Migrations are always applied separately by an owner.
export async function checkProductPaymentSchema(pool) {
  const [columns] = await pool.execute('SELECT DATA_TYPE AS dataType,IS_NULLABLE AS nullable,CHARACTER_MAXIMUM_LENGTH AS maxLength FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?', ['product_orders', 'payment_method']);
  const [checks] = await pool.execute('SELECT cc.CHECK_CLAUSE AS clause FROM information_schema.check_constraints cc JOIN information_schema.table_constraints tc ON tc.constraint_schema=cc.constraint_schema AND tc.constraint_name=cc.constraint_name WHERE tc.constraint_schema=DATABASE() AND tc.table_name=? AND tc.constraint_name=?', ['product_orders', 'chk_product_order_payment_method']);
  const clause = checks[0]?.clause?.toLowerCase().replace(/_utf8mb4|[`()\\\s]/g, '');
  return columns[0]?.dataType === 'varchar' && columns[0]?.nullable === 'YES' && Number(columns[0]?.maxLength) === 16
    && checks.length === 1 && clause === "payment_methodisnullorpayment_methodin'cash','transfer'";
}
