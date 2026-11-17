import assert from 'node:assert/strict';
import { launchBrowser } from './cdp.mjs';

export async function runProductsBrowserFlow({ appURL, gatewayURL, fixture, artifactDirectory, env = process.env }) {
  const browser = await launchBrowser({ artifactDirectory, env });
  const { page } = browser;
  const account = fixture.account('ProductBrowser');
  const productName = fixture.marker + ' Nước lau nhà';
  const postBodies = [];
  const bookingBodies = [];
  const productResponses = [];
  page.onEvent((event) => {
    if (event.method === 'Network.responseReceived' && event.params.response.url.includes('/api/v1/catalog/products')) productResponses.push({ path: new URL(event.params.response.url).pathname + new URL(event.params.response.url).search, status: event.params.response.status });
    if (event.method === 'Network.requestWillBeSent' && event.params.request.method === 'POST' && event.params.request.url === gatewayURL + '/api/v1/product-orders') {
      try { postBodies.push(JSON.parse(event.params.request.postData)); } catch { /* Assertions below require an actual JSON checkout. */ }
    }
    if (event.method === 'Network.requestWillBeSent' && event.params.request.method === 'POST' && event.params.request.url === gatewayURL + '/api/v1/orders') {
      try { bookingBodies.push(JSON.parse(event.params.request.postData)); } catch { /* Checked after recovery. */ }
    }
  });
  const clickHref = async (href) => {
    await page.waitFor('(() => {const link=[...document.querySelectorAll("a")].find(item=>item.getAttribute("href")===' + JSON.stringify(href) + '&&item.getClientRects().length);if(!link)return false;link.click();return true})()', 'Navigation link missing: ' + href);
    await page.waitFor('location.pathname===' + JSON.stringify(href.split('?')[0]), 'Client navigation did not reach ' + href);
  };
  const api = async (path, { method = 'GET', body } = {}) => page.evaluate('(async()=>{const response=await fetch(' + JSON.stringify(gatewayURL + '/api/v1' + path) + ',{method:' + JSON.stringify(method) + ',credentials:"include",headers:{"Content-Type":"application/json"}' + (body === undefined ? '' : ',body:JSON.stringify(' + JSON.stringify(body) + ')') + '});return{status:response.status,body:await response.json()}})()');
  const continueCheckout = () => page.waitFor('(()=>{const link=[...document.querySelectorAll("main a,main button")].find(item=>item.textContent.trim()==="Tiếp tục đặt mua");if(!link||link.disabled||link.hasAttribute("disabled")||link.hasAttribute("data-disabled")||link.getAttribute("aria-disabled")==="true")return false;link.click();return true})()', 'Cart did not become available for checkout.');
  const nativeDate = (at) => at.getFullYear() + '-' + String(at.getMonth() + 1).padStart(2, '0') + '-' + String(at.getDate()).padStart(2, '0');
  const firstCartQuantityLabel = 'Số lượng ' + productName;
  let userId;
  try {
    await page.goto(appURL + '/dich-vu');
    await page.text(fixture.marker + ' Service');
    await page.evaluate('(()=>{localStorage.setItem("cleanhome-demo-state-customer","products-legacy-customer");localStorage.setItem("cleanhome-demo-state-staff","products-legacy-staff");localStorage.setItem("cleanhome-demo-state-admin","products-legacy-admin");return true})()');
    const groupLabels = await page.evaluate('(()=>{const label=[...document.querySelectorAll("label")].find(item=>item.textContent.trim()==="Nhóm dịch vụ");return [...label.control.options].map(option=>option.textContent)})()');
    assert.deepEqual(groupLabels.slice(1), ['Vệ sinh', 'Chăm sóc', 'Bảo dưỡng']);
    await page.fill('Nhóm dịch vụ', 'cham-soc');
    await page.text(fixture.marker + ' Chăm sóc không gian sống');
    assert.equal(await page.evaluate('document.querySelector("main").innerText.includes(' + JSON.stringify(fixture.marker + ' Bảo dưỡng thiết bị') + ')'), false);
    await page.fill('Nhóm dịch vụ', 've-sinh');
    await page.fill('Loại vệ sinh', 'phong-tro');
    await page.text(fixture.marker + ' Service');
    assert.equal(await page.evaluate('document.querySelector("main").innerText.includes(' + JSON.stringify(fixture.marker + ' Vệ sinh nhà ở gia đình') + ')'), false);
    await page.goto(appURL + '/dich-vu/' + fixture.roomServiceId);
    await page.text('Phạm vi fixture đã xác nhận');
    await page.text('Làm sạch bề mặt');
    await page.text('Hạng mục ngoài phạm vi');
    await page.waitFor('document.body.textContent.includes("Mua thêm tùy chọn")', 'Optional product suggestions did not appear.', 15000);
    await page.text(productName);
    await clickHref('/gio-hang');
    await page.text('Giỏ sản phẩm đang trống');
    assert.equal((await api('/catalog/products/' + fixture.productId)).body.data.stock, 8);
    process.stdout.write('Browser products PASS: three service groups, room subtype, rich detail and optional-only suggestions\n');

    await page.goto(appURL + '/san-pham');
    await page.text(productName);
    await page.fill('Nhóm sản phẩm', fixture.productCategoryId);
    await page.fill('Dịch vụ liên quan', fixture.roomServiceId);
    await page.text(productName);
    await page.waitFor('!document.querySelector("main").innerText.includes(' + JSON.stringify(fixture.marker + ' Mặt hàng cuối cùng') + ')', 'Related-service product filter did not apply.');
    await page.fill('Dịch vụ liên quan', '');
    await page.fill('Tìm sản phẩm', 'Nước lau nhà');
    await page.click('Tìm sản phẩm');
    await page.text(productName);
    await page.goto(appURL + '/san-pham/' + fixture.inactiveProductId);
    await page.text('Sản phẩm đã ngừng kinh doanh.');
    assert.ok(await page.evaluate('[...document.querySelectorAll("button")].find(item=>item.textContent.trim()==="Thêm vào giỏ")?.disabled'));
    await page.goto(appURL + '/san-pham/' + fixture.outOfStockProductId);
    await page.text('Sản phẩm hiện hết hàng.');
    assert.ok(await page.evaluate('[...document.querySelectorAll("button")].find(item=>item.textContent.trim()==="Thêm vào giỏ")?.disabled'));
    await page.goto(appURL + '/san-pham/' + fixture.productId);
    await page.text(productName);
    await page.click('Thêm vào giỏ');
    await clickHref('/gio-hang');
    await page.text(productName);
    await page.fill(firstCartQuantityLabel, '');
    assert.ok(await page.evaluate('document.querySelector("main").innerText.includes(' + JSON.stringify(productName) + ')'), 'Temporarily empty quantity input must not remove a cart line.');
    await page.fill(firstCartQuantityLabel, '2');
    await page.evaluate('(()=>{const input=document.querySelector("main input[type=number]");input?.focus();input?.blur();return true})()');
    await page.waitFor('document.querySelector("main input[type=number]")?.value==="2"', 'Quantity update did not remain in the cart.');
    await page.waitFor('[...document.querySelectorAll("a")].some(item=>item.getAttribute("aria-label")==="Giỏ hàng, 2 sản phẩm")', 'Committed quantity did not update the cart total.');
    await page.click('Xóa ' + productName + ' khỏi giỏ', { aria: true });
    await page.text('Giỏ sản phẩm đang trống');
    await clickHref('/san-pham');
    await clickHref('/san-pham/' + fixture.productId);
    await page.click('Thêm vào giỏ');
    await clickHref('/gio-hang');
    await continueCheckout();
    await page.text('Đăng nhập để tiếp tục');
    const loginHref = await page.evaluate('[...document.querySelectorAll("main a")].find(item=>item.getAttribute("href")?.startsWith("/dang-nhap"))?.getAttribute("href")');
    assert.ok(loginHref?.includes('thanh-toan-san-pham'), 'Guest checkout must preserve its return destination.');
    await clickHref(loginHref);
    await page.waitFor('(()=>{const link=[...document.querySelectorAll("a")].find(item=>item.getAttribute("href")?.startsWith("/dang-ky")&&item.getClientRects().length);if(!link)return false;link.click();return true})()', 'Register link missing.');
    await page.waitFor('location.pathname==="/dang-ky"', 'Registration route missing.');
    await page.fill('Họ và tên', account.name);
    await page.fill('Số điện thoại', account.phone);
    await page.fill('Email (không bắt buộc)', account.email);
    await page.fill('Mật khẩu', account.password);
    await page.fill('Nhập lại mật khẩu', account.password);
    const stopSignupCatalogFailure = page.onEvent((event) => {
      if (event.method === 'Fetch.requestPaused') void page.send('Fetch.fulfillRequest', {
        requestId: event.params.requestId, responseCode: 503,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: appURL }, { name: 'Access-Control-Allow-Credentials', value: 'true' }],
        body: Buffer.from(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic catalog outage after registration' } })).toString('base64'),
      }).catch(() => {});
    });
    await page.send('Fetch.enable', { patterns: [{ urlPattern: gatewayURL + '/api/v1/catalog/services*', requestStage: 'Request' }] });
    await page.click('Tạo tài khoản');
    await page.waitFor('location.pathname==="/thanh-toan-san-pham"', 'Registration did not resume product checkout.');
    const session = await api('/auth/session');
    assert.equal(session.status, 200); userId = session.body.data.id;
    await fixture.record('users', userId);
    await page.text('Synthetic catalog outage after registration');
    assert.equal(await page.evaluate('document.querySelectorAll("main input[type=password]").length'), 0, 'Acknowledged signup must not invite another registration.');
    await page.send('Fetch.disable'); stopSignupCatalogFailure();
    await page.evaluate('window.dispatchEvent(new Event("focus"))');
    await page.waitFor('![...document.querySelectorAll("[role=alert]")].some(item=>item.textContent.includes("Synthetic catalog outage after registration"))', 'Customer data did not recover after signup outage.');
    assert.equal((await api('/orders')).body.data.total, 0, 'A product shopper must not need any service booking.');
    await page.text('Xác nhận mua sản phẩm');
    assert.equal(await page.evaluate('document.querySelectorAll("main input[type=date],main input[type=time]").length'), 0);
    await page.fill('Phương thức thanh toán', 'transfer');
    await page.click('Xác nhận tạo đơn sản phẩm');
    await page.text('Đã ghi nhận đơn sản phẩm');
    const purchases = await api('/product-orders');
    assert.equal(purchases.status, 200);
    assert.equal(purchases.body.data.total, 1);
    const productOrder = purchases.body.data.items[0];
    await fixture.recordProductOrder(productOrder.id);
    assert.equal(productOrder.status, 'pending'); assert.equal(productOrder.total, 42000);
    assert.deepEqual(productOrder.payment, { method: 'transfer', status: 'pending', simulated: true });
    assert.equal(productOrder.items[0].productId, fixture.productId);
    assert.ok(postBodies.length >= 1);
    for (const body of postBodies) {
      assert.deepEqual(Object.keys(body).sort(), ['contact', 'items', 'paymentMethod', 'requestKey']);
      assert.equal(body.paymentMethod, 'transfer');
      assert.equal('scheduledAt' in body, false);
      assert.equal('total' in body, false);
      assert.deepEqual(Object.keys(body.items[0]).sort(), ['expectedUnitPrice', 'productId', 'quantity']);
      assert.equal(body.items[0].expectedUnitPrice, 42000);
    }
    await page.click('Xem đơn hàng');
    await page.text(productOrder.code);
    await page.text('Đã ghi nhận, chờ xử lý');
    const stopOrderListFailure = page.onEvent((event) => {
      if (event.method === 'Fetch.requestPaused') void page.send('Fetch.fulfillRequest', {
        requestId: event.params.requestId, responseCode: 503,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: appURL }, { name: 'Access-Control-Allow-Credentials', value: 'true' }],
        body: Buffer.from(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic order list unavailable' } })).toString('base64'),
      }).catch(() => {});
    });
    await page.send('Fetch.enable', { patterns: [{ urlPattern: gatewayURL + '/api/v1/product-orders*', requestStage: 'Request' }] });
    await clickHref('/don-san-pham');
    await page.text('Synthetic order list unavailable');
    assert.equal(await page.evaluate('document.querySelector("main").textContent.includes("Chưa có đơn mua sản phẩm")'), false);
    await page.send('Fetch.disable'); stopOrderListFailure();
    await page.click('Thử lại');
    await page.text(productOrder.code);
    await page.goto(appURL + '/don-san-pham/999999999');
    await page.text('Không tìm thấy đơn sản phẩm');
    assert.equal(await page.evaluate('document.querySelector("main").textContent.includes("Chưa có đơn mua sản phẩm")'), false);
    await clickHref('/gio-hang');
    await page.text('Giỏ sản phẩm đang trống');
    process.stdout.write('Browser products PASS: standalone browse/cart/edit/remove, guest auth return, checkout without schedule, owned order and server price\n');
    process.stdout.write('Browser logic PASS: acknowledged registration survives Catalog outage; failed/404 order loads never claim an empty order list\n');

    await clickHref('/san-pham');
    await clickHref('/san-pham/' + fixture.productId);
    await page.click('Thêm vào giỏ');
    await clickHref('/gio-hang');
    await continueCheckout();
    await page.text('Xác nhận mua sản phẩm');
    let loseResponse = true;
    const stopLostResponse = page.onEvent((event) => {
      if (event.method !== 'Fetch.requestPaused') return;
      if (loseResponse && event.params.request.method === 'POST') {
        loseResponse = false;
        void page.send('Fetch.failRequest', { requestId: event.params.requestId, errorReason: 'Failed' }).catch(() => {});
      } else void page.send('Fetch.continueRequest', { requestId: event.params.requestId }).catch(() => {});
    });
    await page.send('Fetch.enable', { patterns: [{ urlPattern: gatewayURL + '/api/v1/product-orders', requestStage: 'Response' }] });
    await page.click('Xác nhận tạo đơn sản phẩm');
    await page.text('Không kết nối được API');
    await page.text('Có yêu cầu sản phẩm chưa xác nhận');
    await page.send('Fetch.disable'); stopLostResponse();
    await page.fill('Họ tên', fixture.marker + ' changed after response loss');
    // Add a new, independently selected line while the previous request is unresolved.
    await clickHref('/san-pham');
    await clickHref('/san-pham/' + fixture.lastStockProductId);
    await page.text(fixture.marker + ' Mặt hàng cuối cùng');
    await page.click('Thêm vào giỏ');
    await clickHref('/gio-hang');
    await page.click('Kiểm tra yêu cầu đã gửi');
    const recoveredId = await page.waitFor('location.pathname.match(/^\\/don-san-pham\\/(\\d+)$/)?.[1]', 'Recovery did not open the known product order.');
    await fixture.recordProductOrder(recoveredId);
    const recovered = await api('/product-orders/' + recoveredId);
    assert.equal(recovered.body.data.status, 'pending');
    assert.equal(recovered.body.data.contact.name, account.name, 'Recovery must use the original contact snapshot.');
    const lostBody = postBodies[postBodies.length - 2], retryBody = postBodies[postBodies.length - 1];
    assert.equal(lostBody.requestKey, retryBody.requestKey);
    assert.deepEqual(lostBody.items, retryBody.items);
    assert.deepEqual(lostBody.contact, retryBody.contact);
    assert.equal((await api('/product-orders')).body.data.total, 2, 'Retry must not create another product order.');
    await clickHref('/gio-hang');
    await page.text(fixture.marker + ' Mặt hàng cuối cùng');
    assert.equal(await page.evaluate('[...document.querySelectorAll("main h2")].some(item=>item.textContent===' + JSON.stringify(productName) + ')'), false);
    await page.click('Xóa ' + fixture.marker + ' Mặt hàng cuối cùng khỏi giỏ', { aria: true });
    await page.text('Giỏ sản phẩm đang trống');
    process.stdout.write('Browser products PASS: lost response recovery reuses its request and preserves newly added cart lines\n');

    await page.goto(appURL + '/san-pham/' + fixture.lastStockProductId);
    await page.text(fixture.marker + ' Mặt hàng cuối cùng');
    await page.click('Thêm vào giỏ');
    await fixture.setAvailableStock(fixture.lastStockProductId, 0);
    await clickHref('/gio-hang');
    await page.text(fixture.marker + ' Mặt hàng cuối cùng');
    await page.text('Sản phẩm hết hàng hoặc số lượng vượt tồn kho');
    const blocked = await page.evaluate('(()=>{const item=[...document.querySelectorAll("main a,main button")].find(item=>item.textContent.trim()==="Tiếp tục đặt mua");return item?.getAttribute("aria-disabled")==="true"||item?.hasAttribute("disabled")||item?.hasAttribute("data-disabled")||item?.disabled})()');
    assert.ok(blocked, 'Current out-of-stock cart cannot continue checkout.');
    await page.click('Xóa ' + fixture.marker + ' Mặt hàng cuối cùng khỏi giỏ', { aria: true });
    await page.text('Giỏ sản phẩm đang trống');
    process.stdout.write('Browser products PASS: unavailable inventory refresh blocks checkout and preserves removable cart lines\n');

    const stopIntercept = page.onEvent((event) => {
      if (event.method === 'Fetch.requestPaused') void page.send('Fetch.failRequest', { requestId: event.params.requestId, errorReason: 'Failed' }).catch(() => {});
    });
    await page.send('Fetch.enable', { patterns: [{ urlPattern: gatewayURL + '/api/v1/catalog/products*', requestStage: 'Request' }] });
    await page.goto(appURL + '/san-pham');
    await page.text('Không kết nối được API');
    assert.equal(await page.evaluate('document.querySelector("main").innerText.includes(' + JSON.stringify(productName) + ')'), false, 'An API failure must not show demo-success product rows.');
    await page.send('Fetch.disable'); stopIntercept();
    await page.click('Thử tải lại');
    await page.text(productName);
    process.stdout.write('Browser products PASS: product API errors are explicit and retry restores real rows\n');

    // Reach the service booking only after the independent product purchase finished.
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.goto(appURL + '/dat-dich-vu/' + fixture.roomServiceId);
    await page.click('Tiếp theo');
    const houseType = await page.evaluate('[...document.querySelectorAll("select")].find(item=>[...item.options].some(option=>option.value==="phong-tro"))?.value');
    assert.equal(houseType, 'phong-tro', 'Room-cleaning booking should use its room contact type.');
    await page.fill('Địa chỉ thực hiện', fixture.marker + ' browser room address');
    // Returning through client navigation must preserve form data without storage.
    await clickHref('/dich-vu');
    await clickHref('/dich-vu/' + fixture.roomServiceId);
    await clickHref('/dat-dich-vu/' + fixture.roomServiceId);
    await page.text('Đã khôi phục thông tin bạn đang nhập trong tab này.');
    assert.equal(await page.evaluate('document.querySelector("main textarea")?.value'), fixture.marker + ' browser room address');
    await page.send('Network.deleteCookies', { name: 'cleanhome_customer_session', url: gatewayURL });
    await page.evaluate('window.dispatchEvent(new Event("focus"))');
    await page.text('Đăng nhập để tiếp tục');
    const bookingLogin = await page.evaluate('[...document.querySelectorAll("main a")].find(item=>item.getAttribute("href")?.startsWith("/dang-nhap"))?.getAttribute("href")');
    assert.ok(bookingLogin.includes(encodeURIComponent('/dat-dich-vu/' + fixture.roomServiceId)));
    await clickHref(bookingLogin);
    await page.fill('Số điện thoại hoặc email', account.phone);
    await page.fill('Mật khẩu', account.password);
    await page.click('Đăng nhập');
    await page.text('Đã khôi phục thông tin bạn đang nhập trong tab này.');
    assert.equal(await page.evaluate('document.querySelector("main textarea")?.value'), fixture.marker + ' browser room address');
    await page.click('Tiếp theo');
    await page.fill('Ngày mong muốn', nativeDate(new Date(Date.now() + 3 * 86400000)));
    await page.fill('Giờ mong muốn', '09:00');
    await page.click('Tiếp theo');
    assert.equal(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true, 'Booking review must fit a phone viewport.');
    let droppedBooking = false;
    const stopBookingLoss = page.onEvent((event) => {
      if (event.method !== 'Fetch.requestPaused') return;
      if (!droppedBooking && event.params.responseStatusCode === 201) {
        droppedBooking = true;
        void page.send('Fetch.failRequest', { requestId: event.params.requestId, errorReason: 'Failed' }).catch(() => {});
      } else void page.send('Fetch.continueRequest', { requestId: event.params.requestId }).catch(() => {});
    });
    await page.send('Fetch.enable', { patterns: [{ urlPattern: gatewayURL + '/api/v1/orders', requestStage: 'Response' }] });
    await page.click('Lưu yêu cầu');
    await page.text('Gửi lại để xác nhận');
    await page.send('Fetch.disable'); stopBookingLoss();
    assert.equal(droppedBooking, true);
    const savedBookings = (await api('/orders')).body.data;
    assert.equal(savedBookings.total, 1);
    await fixture.recordOrder(savedBookings.items[0].id);
    let droppedPayment = false;
    const stopPaymentLoss = page.onEvent((event) => {
      if (event.method !== 'Fetch.requestPaused') return;
      if (!droppedPayment && event.params.responseStatusCode === 200) {
        droppedPayment = true;
        void page.send('Fetch.failRequest', { requestId: event.params.requestId, errorReason: 'Failed' }).catch(() => {});
      } else void page.send('Fetch.continueRequest', { requestId: event.params.requestId }).catch(() => {});
    });
    await page.send('Fetch.enable', { patterns: [{ urlPattern: gatewayURL + '/api/v1/orders/*/payment-simulation', requestStage: 'Response' }] });
    await page.click('Gửi lại để xác nhận');
    await page.text('Bước lưu phương thức thanh toán chưa được xác nhận');
    await page.send('Fetch.disable'); stopPaymentLoss();
    assert.equal(droppedPayment, true);
    assert.equal((await api('/orders')).body.data.total, 1);
    const pendingPayments = (await api('/payments')).body.data.items.filter(payment => payment.orderId === savedBookings.items[0].id);
    assert.equal(pendingPayments.length, 1);
    assert.equal(pendingPayments[0].status, 'unpaid');
    await page.click('Gửi lại để xác nhận');
    const bookingId = await page.waitFor('location.pathname.match(/^\\/don\\/(\\d+)$/)?.[1]', 'Service booking did not complete.');
    await fixture.recordOrder(bookingId);
    assert.equal((await api('/orders')).body.data.total, 1, 'Lost-response recovery must not create a second booking.');
    assert.equal(bookingBodies.length, 3);
    assert.deepEqual(bookingBodies[0], bookingBodies[1]);
    assert.deepEqual(bookingBodies[1], bookingBodies[2]);
    assert.equal((await api('/payments')).body.data.items.filter(payment => payment.orderId === bookingId).length, 1);
    process.stdout.write('Browser checkout payment PASS: product transfer at checkout; service cash and lost payment ACK recover without duplicate booking/payment\n');
    await page.text('Tiến độ lịch dịch vụ');
    await page.click('Yêu cầu hủy');
    await page.fill('Lý do hủy', fixture.marker + ' browser cancellation');
    await page.click('Lưu yêu cầu hủy');
    await page.text('Yêu cầu hủy đang chờ duyệt.');
    assert.equal((await api('/orders/' + bookingId)).body.data.status, 'pending');
    await clickHref('/don-san-pham');
    await page.text('Đơn sản phẩm của tôi');
    assert.equal(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true, 'Product orders must fit a phone viewport.');
    await clickHref('/don-cua-toi');
    await page.text('Lịch dịch vụ');
    assert.equal(await page.evaluate('document.querySelector("main nav[aria-label=\"Loại đơn hàng\"]") === null'), true);
    assert.equal((await api('/orders/' + bookingId)).body.data.contact.houseType, 'phong-tro');
    assert.equal((await api('/product-orders')).body.data.total, 2, 'Booking a related service cannot silently create a product purchase.');
    const storage = await page.evaluate('({local:Object.fromEntries(Object.entries(localStorage)),session:Object.fromEntries(Object.entries(sessionStorage))})');
    assert.equal(storage.local['cleanhome-demo-state-customer'], 'products-legacy-customer');
    assert.equal(storage.local['cleanhome-demo-state-staff'], 'products-legacy-staff');
    assert.equal(storage.local['cleanhome-demo-state-admin'], 'products-legacy-admin');
    assert.ok(!JSON.stringify(storage).includes(account.password));
    assert.ok(!JSON.stringify(storage).includes('cleanhome_customer_session'));
    assert.ok(!JSON.stringify(storage).includes(fixture.marker + ' browser room address'), 'Booking contact data must not be persisted to browser storage.');
    process.stdout.write('Browser customer PASS: phone layout, form/session recovery, same-key booking retry and pending cancellation; two order types stay separate\n');
    process.stdout.write('Browser products PASS: room service booking remains separate; legacy storage and secure session preserved\n');
    // Change only marked fixture prices after the real confirmation UI has loaded.
    await page.goto(appURL + '/san-pham');
    await clickHref('/san-pham/' + fixture.productId);
    await page.click('Thêm vào giỏ');
    await clickHref('/gio-hang');
    await continueCheckout();
    await page.text('Xác nhận mua sản phẩm');
    await page.waitFor('!document.querySelector("main button[type=submit]")?.disabled', 'Checkout price did not load.');
    const beforePurchase = postBodies.length;
    await fixture.setProductPrice(fixture.productId, 84000);
    try {
      await page.click('Xác nhận tạo đơn sản phẩm');
      await page.text('Đơn giá đã thay đổi.');
      assert.equal(await page.evaluate('location.pathname'), '/thanh-toan-san-pham');
      await page.waitFor('!document.querySelector("main button[type=submit]")?.disabled', 'New product price did not load.');
      assert.equal(postBodies.length, beforePurchase + 1, 'Price refresh must not submit automatically.');
      assert.equal(postBodies.at(-1).items[0].expectedUnitPrice, 42000);
      await page.click('Xác nhận tạo đơn sản phẩm');
      await page.text('Đã ghi nhận đơn sản phẩm');
      assert.equal(postBodies.at(-1).items[0].expectedUnitPrice, 84000);
      assert.notEqual(postBodies.at(-1).requestKey, postBodies.at(-2).requestKey);
      const orders = (await api('/product-orders')).body.data.items;
      for (const order of orders) await fixture.recordProductOrder(order.id);
      assert.equal(orders[0].total, 84000);
      assert.equal(orders[1].errorCode, 'PRICE_CHANGED');
    } finally { await fixture.setProductPrice(fixture.productId, 42000); }

    await page.goto(appURL + '/dich-vu/' + fixture.roomServiceId);
    await clickHref('/dat-dich-vu/' + fixture.roomServiceId);
    await page.click('Tiếp theo');
    await page.fill('Địa chỉ thực hiện', fixture.marker + ' changed price address');
    await page.click('Tiếp theo');
    await page.fill('Ngày mong muốn', nativeDate(new Date(Date.now() + 5 * 86400000)));
    await page.fill('Giờ mong muốn', '09:00');
    await page.click('Tiếp theo');
    const beforeBooking = bookingBodies.length;
    await fixture.setServicePrice(fixture.roomServiceId, 250000);
    try {
      await page.click('Lưu yêu cầu');
      await page.text('Đơn giá đã thay đổi.');
      assert.equal(await page.evaluate('location.pathname'), '/dat-dich-vu/' + fixture.roomServiceId);
      assert.equal(bookingBodies.length, beforeBooking + 1);
      assert.equal((await api('/orders')).body.data.total, 1, 'Price conflict cannot create a booking.');
      await page.click('Lưu yêu cầu');
      const confirmedId = await page.waitFor('location.pathname.match(/^\\/don\\/(\\d+)$/)?.[1]', 'Changed service price was not explicitly confirmed.');
      await fixture.recordOrder(confirmedId);
      assert.equal((await api('/orders/' + confirmedId)).body.data.price, 250000);
      assert.equal(bookingBodies.at(-1).expectedUnitPrice, 250000);
      assert.notEqual(bookingBodies.at(-1).requestKey, bookingBodies.at(-2).requestKey);
    } finally { await fixture.setServicePrice(fixture.roomServiceId, 125000); }
    process.stdout.write('Browser price confirmation PASS: real Catalog changes preserve cart/form, block automatic orders and require a new explicit confirmation\n');
  } catch (error) {
    const diagnostics = await page.evaluate('({path:location.pathname,alerts:[...document.querySelectorAll("[role=alert]")].map(item=>item.textContent),headings:[...document.querySelectorAll("h1,h2")].map(item=>item.textContent),quantities:[...document.querySelectorAll("main input[type=number]")].map(item=>({value:item.value,disabled:item.disabled})),cart:document.querySelector("a[title^=Giỏ]")?.getAttribute("aria-label")})').catch(() => null);
    process.stderr.write('Product browser diagnostics: ' + JSON.stringify({ ...diagnostics, productResponses }) + '\n');
    throw error;
  } finally { await browser.close(); }
}
