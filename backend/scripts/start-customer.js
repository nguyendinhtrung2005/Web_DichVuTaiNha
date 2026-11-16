import { startCustomerStack } from './customer-runtime.js';
try {
  const runtime = await startCustomerStack();
  process.stdout.write('Customer API Gateway: ' + runtime.urls.gateway + '/api/v1\n');
  process.stdout.write('Không chạy migration/seed khi khởi động. Auth restart sẽ hết phiên local.\n');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await runtime.close(); process.exit(0); });
} catch (error) {
  const allowed = error?.code === 'EADDRINUSE' ? 'Cổng đang được sử dụng.' : 'Kiểm tra cấu hình DB, migration email và các cổng service.';
  process.stderr.write('Customer startup FAIL. ' + allowed + '\n');
  process.exitCode = 1;
}
