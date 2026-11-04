import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { launchBrowser } from './cdp.mjs';

export async function runCustomerBrowserFlow({ appURL, gatewayURL, fixture, artifactDirectory, env = process.env }) {
  const browser = await launchBrowser({ artifactDirectory, env });
  const { page } = browser;
  const authenticationResponses = [];
  page.onEvent((event) => {
    if (event.method === 'Network.responseReceived' && event.params.response.url.includes('/api/v1/auth/')) {
      authenticationResponses.push({ route: new URL(event.params.response.url).pathname, status: event.params.response.status });
    }
  });
  const account = fixture.account('Browser');
  const api = async (path, { method = 'GET', body } = {}) => page.evaluate(`(async () => {
    const response = await fetch(${JSON.stringify(`${gatewayURL}/api/v1${path}`)}, {method:${JSON.stringify(method)},credentials:'include',headers:{'Content-Type':'application/json'},${body === undefined ? '' : `body:JSON.stringify(${JSON.stringify(body)}),`}});
    return {status:response.status,body:response.status === 204 ? null : await response.json()};
  })()`);
  try {
    await page.goto(`${appURL}/dang-ky`);
    await page.fill('Họ và tên', account.name);
    await page.evaluate(`(() => {localStorage.setItem('cleanhome-demo-state-customer','legacy-customer-sentinel');localStorage.setItem('cleanhome-demo-state-staff','legacy-staff-sentinel');localStorage.setItem('cleanhome-demo-state-admin','legacy-admin-sentinel');return true})()`);
    await page.fill('Số điện thoại', account.phone);
    await page.fill('Email (không bắt buộc)', account.email);
    await page.fill('Mật khẩu', account.password);
    await page.fill('Nhập lại mật khẩu', account.password);
    await page.click('Tạo tài khoản');
    await page.waitFor('!location.pathname.includes("dang-ky")', 'Registration did not navigate after API success.');
    const session = await api('/auth/session');
    assert.equal(session.status, 200);
    const userId = session.body.data.id;
    await fixture.record('users', userId);
    const cookies = await page.send('Network.getCookies', { urls: [gatewayURL] });
    const cookie = cookies.cookies.find((item) => item.name === 'cleanhome_customer_session');
    assert.ok(cookie?.httpOnly, 'Session cookie must be HttpOnly.');
    assert.ok(!await page.evaluate('document.cookie.includes("cleanhome_customer_session")'), 'JavaScript must not be able to read the session token.');
    process.stdout.write('Browser PASS: registration and HttpOnly session\n');

    await page.goto(`${appURL}/ho-so`);
    await page.click('Chỉnh sửa thông tin');
    const updatedName = `${fixture.marker} Updated Browser`;
    await page.fill('Họ và tên', updatedName);
    await page.click('Lưu hồ sơ');
    await page.text(updatedName);
    await page.send('Page.reload');
    await page.text(updatedName);
    assert.equal((await api('/users/me')).body.data.name, updatedName);
    process.stdout.write('Browser PASS: profile update persists through API and reload\n');

    await page.goto(`${appURL}/dich-vu`);
    await page.text(`${fixture.marker} Service`);
    await page.goto(`${appURL}/dich-vu/${fixture.serviceId}`);
    await page.text(`${fixture.marker} Service`);
    await page.goto(`${appURL}/dat-dich-vu/${fixture.serviceId}`);
    await page.click('Tiếp theo');
    await page.fill('Địa chỉ thực hiện', `${fixture.marker} browser test address`);
    await page.click('Tiếp theo');
    const at = new Date(Date.now() + 3 * 86400000);
    const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    await page.fill('Ngày mong muốn', date);
    await page.fill('Giờ mong muốn', '09:00');
    await page.fill('Ghi chú thêm', `${fixture.marker} browser note`);
    await page.click('Tiếp theo');
    await page.click('Lưu yêu cầu');
    const orderId = await page.waitFor('location.pathname.match(/^\\/don\\/(\\d+)$/)?.[1]', 'Booking did not navigate to the persisted API order.');
    await fixture.recordOrder(orderId);
    const order = await api(`/orders/${orderId}`);
    assert.equal(order.status, 200);
    assert.equal(order.body.data.customerId, userId);
    assert.equal(order.body.data.price, 125000);
    process.stdout.write('Browser PASS: catalog detail and multi-step booking\n');

    await page.click('Chọn / cập nhật thanh toán');
    await page.fill('Phương thức thanh toán', 'transfer');
    await page.click('Lưu lựa chọn thanh toán');
    await page.text('Chưa xác nhận thanh toán');
    const payments = await api('/payments');
    assert.equal(payments.status, 200);
    assert.ok(payments.body.data.items.some((payment) => payment.orderId === orderId && payment.status === 'pending'));
    await page.click('Yêu cầu hủy');
    await page.fill('Lý do hủy', `${fixture.marker} browser cancellation`);
    await page.click('Lưu yêu cầu hủy');
    await page.text('Chờ xét duyệt');
    const cancelled = await api(`/orders/${orderId}`);
    assert.equal(cancelled.body.data.status, 'pending');
    assert.equal(cancelled.body.data.cancelRequest.status, 'pending');
    await fixture.recordOrder(orderId);
    await page.goto(`${appURL}/don-cua-toi`);
    await page.text(order.body.data.code);
    process.stdout.write('Browser PASS: order list/detail, pending cancellation and simulated transfer\n');

    // Admin/Staff APIs are outside this task. A fixture-only DB update models a
    // legitimately completed assignment so the Customer review screen can run.
    const completedAt = new Date(Date.now() + 4 * 86400000);
    const created = await api('/orders', { method: 'POST', body: { serviceId: fixture.serviceId, quantity: 1, contact: { name: account.name, phone: account.phone, address: `${fixture.marker} completed fixture address`, houseType: 'can-ho', area: 60, rooms: 2, floors: 1, hasPets: false }, scheduledAt: completedAt.toISOString(), specialRequest: `${fixture.marker} review fixture` } });
    assert.equal(created.status, 201);
    const completedId = created.body.data.id;
    await fixture.recordOrder(completedId);
    await fixture.completeOrder(completedId, userId);
    await page.goto(`${appURL}/lich-su`);
    await page.text(created.body.data.code);
    await page.goto(`${appURL}/don/${completedId}`);
    await page.click('Viết đánh giá');
    await page.fill('Điểm đánh giá', '4');
    await page.fill('Nhận xét', `${fixture.marker} browser review`);
    await page.click('Lưu đánh giá');
    await page.text(`${fixture.marker} browser review`);
    assert.ok((await api('/reviews')).body.data.items.some((review) => review.orderId === completedId && review.rating === 4));
    await fixture.recordOrder(completedId);
    await page.goto(`${appURL}/dat-dich-vu/${completedId}`);
    await page.click('Tiếp theo');
    assert.equal(await page.evaluate('document.querySelector("textarea")?.value'), `${fixture.marker} completed fixture address`);
    process.stdout.write('Browser PASS: completed history, single-score review and reorder prefill\n');

    for (const identifier of [account.email.toUpperCase(), account.phone]) {
      await page.click('Đăng xuất', { aria: true });
      await page.waitFor('location.pathname === "/dang-nhap"', 'Logout did not navigate to sign-in.');
      await page.fill('Số điện thoại hoặc email', identifier);
      await page.fill('Mật khẩu', account.password);
      await page.click('Đăng nhập');
      try {
        await page.waitFor('location.pathname !== "/dang-nhap"', 'Identifier login did not succeed.', 15000);
      } catch (error) {
        const diagnostics = await page.evaluate('({path:location.pathname,alerts:[...document.querySelectorAll("[role=alert]")].map(item=>item.textContent),identifierLength:document.querySelector("input[name=identifier]")?.value.length,passwordLength:document.querySelector("input[name=password]")?.value.length})');
        process.stderr.write(`Identifier login diagnostic: ${JSON.stringify({ ...diagnostics, responses: authenticationResponses })}\n`);
        throw error;
      }
      assert.equal((await api('/auth/session')).body.data.id, userId);
    }
    await page.send('Network.deleteCookies', { name: 'cleanhome_customer_session', url: gatewayURL });
    await page.goto(`${appURL}/don-cua-toi`);
    await page.text('Đăng nhập để tiếp tục');
    assert.equal((await api('/auth/session')).status, 401);
    process.stdout.write('Browser PASS: phone/email login, logout and expired-session handling\n');

    const stopIntercept = page.onEvent((event) => {
      if (event.method === 'Fetch.requestPaused') void page.send('Fetch.failRequest', { requestId: event.params.requestId, errorReason: 'Failed' }).catch(() => {});
    });
    await page.send('Fetch.enable', { patterns: [{ urlPattern: `${gatewayURL}/api/v1/*`, requestStage: 'Request' }] });
    await page.goto(`${appURL}/dich-vu`);
    await page.text('Chưa thể tải dữ liệu Customer');
    await page.text('Không kết nối được API');
    await page.send('Fetch.disable');
    stopIntercept();
    await page.click('Thử lại');
    await page.text(`${fixture.marker} Service`);
    const storage = await page.evaluate('({local: Object.fromEntries(Object.entries(localStorage)), session:Object.fromEntries(Object.entries(sessionStorage))})');
    assert.equal(storage.local['cleanhome-demo-state-customer'], 'legacy-customer-sentinel');
    assert.equal(storage.local['cleanhome-demo-state-staff'], 'legacy-staff-sentinel');
    assert.equal(storage.local['cleanhome-demo-state-admin'], 'legacy-admin-sentinel');
    const serialized = JSON.stringify(storage);
    assert.ok(!serialized.includes(account.password), 'Customer must not store passwords.');
    assert.ok(!serialized.includes('cleanhome_customer_session'), 'Customer must not store authentication tokens.');
    process.stdout.write('Browser PASS: explicit API failure/retry and legacy storage preservation\n');
  } finally { await browser.close(); }
}
