import assert from 'node:assert/strict';
import { launchBrowser } from './cdp.mjs';

export async function runProductsBrowserFlow({ appURL, gatewayURL, fixture, artifactDirectory, env = process.env }) {
  const browser = await launchBrowser({ artifactDirectory, env });
  const { page } = browser;
  const account = fixture.account('ProductBrowser');
  const productName = fixture.marker + ' Nước lau nhà';
  const postBodies = [];
  const productResponses = [];
  page.onEvent((event) => {
    if (event.method === 'Network.responseReceived' && event.params.response.url.includes('/api/v1/catalog/products')) productResponses.push({ path: new URL(event.params.response.url).pathname + new URL(event.params.response.url).search, status: event.params.response.status });
    if (event.method === 'Network.requestWillBeSent' && event.params.request.method === 'POST' && event.params.request.url === gatewayURL + '/api/v1/product-orders') {
      try { postBodies.push(JSON.parse(event.params.request.postData)); } catch { /* Assertions below require an actual JSON checkout. */ }
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
    await page.click('Tạo tài khoản');
    await page.waitFor('location.pathname==="/thanh-toan-san-pham"', 'Registration did not resume product checkout.');
    const session = await api('/auth/session');
    assert.equal(session.status, 200); userId = session.body.data.id;
    await fixture.record('users', userId);
    assert.equal((await api('/orders')).body.data.total, 0, 'A product shopper must not need any service booking.');
    await page.text('Xác nhận mua sản phẩm');
    assert.equal(await page.evaluate('document.querySelectorAll("main input[type=date],main input[type=time]").length'), 0);
    await page.click('Xác nhận tạo đơn sản phẩm');
    await page.text('Đã ghi nhận đơn sản phẩm');
    const purchases = await api('/product-orders');
    assert.equal(purchases.status, 200);
    assert.equal(purchases.body.data.total, 1);
    const productOrder = purchases.body.data.items[0];
    await fixture.recordProductOrder(productOrder.id);
    assert.equal(productOrder.status, 'pending'); assert.equal(productOrder.total, 42000);
    assert.equal(productOrder.items[0].productId, fixture.productId);
    assert.ok(postBodies.length >= 1);
    for (const body of postBodies) {
      assert.deepEqual(Object.keys(body).sort(), ['contact', 'items', 'requestKey']);
      assert.equal('scheduledAt' in body, false);
      assert.equal('total' in body, false);
      assert.deepEqual(Object.keys(body.items[0]).sort(), ['productId', 'quantity']);
    }
    await page.click('Xem đơn hàng');
    await page.text(productOrder.code);
    await page.text('Đã ghi nhận, chờ xử lý');
    await clickHref('/gio-hang');
    await page.text('Giỏ sản phẩm đang trống');
    process.stdout.write('Browser products PASS: standalone browse/cart/edit/remove, guest auth return, checkout without schedule, owned order and server price\n');

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
    await page.goto(appURL + '/dat-dich-vu/' + fixture.roomServiceId);
    await page.click('Tiếp theo');
    const houseType = await page.evaluate('[...document.querySelectorAll("select")].find(item=>[...item.options].some(option=>option.value==="phong-tro"))?.value');
    assert.equal(houseType, 'phong-tro', 'Room-cleaning booking should use its room contact type.');
    await page.fill('Địa chỉ thực hiện', fixture.marker + ' browser room address');
    await page.click('Tiếp theo');
    await page.fill('Ngày mong muốn', nativeDate(new Date(Date.now() + 3 * 86400000)));
    await page.fill('Giờ mong muốn', '09:00');
    await page.click('Tiếp theo');
    await page.click('Lưu yêu cầu');
    const bookingId = await page.waitFor('location.pathname.match(/^\\/don\\/(\\d+)$/)?.[1]', 'Service booking did not complete.');
    await fixture.recordOrder(bookingId);
    assert.equal((await api('/orders/' + bookingId)).body.data.contact.houseType, 'phong-tro');
    assert.equal((await api('/product-orders')).body.data.total, 2, 'Booking a related service cannot silently create a product purchase.');
    const storage = await page.evaluate('({local:Object.fromEntries(Object.entries(localStorage)),session:Object.fromEntries(Object.entries(sessionStorage))})');
    assert.equal(storage.local['cleanhome-demo-state-customer'], 'products-legacy-customer');
    assert.equal(storage.local['cleanhome-demo-state-staff'], 'products-legacy-staff');
    assert.equal(storage.local['cleanhome-demo-state-admin'], 'products-legacy-admin');
    assert.ok(!JSON.stringify(storage).includes(account.password));
    assert.ok(!JSON.stringify(storage).includes('cleanhome_customer_session'));
    process.stdout.write('Browser products PASS: room service booking remains separate; legacy storage and secure session preserved\n');
  } catch (error) {
    const diagnostics = await page.evaluate('({path:location.pathname,alerts:[...document.querySelectorAll("[role=alert]")].map(item=>item.textContent),headings:[...document.querySelectorAll("h1,h2")].map(item=>item.textContent)})').catch(() => null);
    process.stderr.write('Product browser diagnostics: ' + JSON.stringify({ ...diagnostics, productResponses }) + '\n');
    throw error;
  } finally { await browser.close(); }
}
