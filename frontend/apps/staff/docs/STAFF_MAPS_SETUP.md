# Leaflet + OpenStreetMap cho Staff `/khu-vuc`

Leaflet chỉ khởi tạo trong trình duyệt; bản đồ không cần Google API Key hoặc Google Cloud Billing. Chi nhánh, địa chỉ, tọa độ và GeoJSON lấy từ Staff BFF `GET /api/staff/branch`. Không geocode địa chỉ booking, không gửi thông tin khách, không yêu cầu vị trí thiết bị.

## Local/QA

Trong development/test, `STAFF_MAPS_ENABLED` mặc định bật và URL mặc định là `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. Chỉ tải tile cho vùng nhìn thấy sau khi người dùng mở bản đồ. Giữ cache và HTTP Referer mặc định; không tải hàng loạt, prefetch hay cung cấp chế độ offline. Attribution `© OpenStreetMap contributors` phải luôn hiển thị, có liên kết tới trang bản quyền.

Dữ liệu trong database QA độc lập là dữ liệu tổng hợp để kiểm thử, không đại diện dữ liệu chi nhánh production. Thiếu tọa độ hợp lệ thì không đặt marker; thiếu GeoJSON Polygon/MultiPolygon hợp lệ thì không vẽ vùng thay thế.

## Production

Public OSM tile có dung lượng giới hạn và **không có SLA**. Production không tự mặc định dùng dịch vụ này. Chọn nhà cung cấp phù hợp lưu lượng hoặc self-hosted, kiểm tra điều khoản/cách ghi công rồi cấu hình trong môi trường Staff Frontend:

```dotenv
STAFF_MAPS_ENABLED=true
STAFF_MAP_TILE_URL=https://tiles.example.org/{z}/{x}/{y}.png
STAFF_MAP_TILE_MAX_ZOOM=19
STAFF_MAP_TILE_PROVIDER_NAME=Ten nha cung cap
STAFF_MAP_TILE_PROVIDER_URL=https://tiles.example.org/
```

URL trên chỉ là mẫu cấu hình; phải thay bằng dịch vụ thực tế. Chấp nhận HTTPS; HTTP chỉ dành cho tile server loopback local. URL cần đúng một `{z}`, `{x}`, `{y}`. Không truyền HTML trong tên provider. Các giá trị được gửi tới trình duyệt; không đưa credential server vào cấu hình. Luôn giữ attribution OpenStreetMap và bổ sung attribution provider đúng điều khoản. Nếu provider cần thêm cách ghi công ngoài tên/liên kết, phải bổ sung trước khi dùng production. Nếu chủ động cấu hình URL OSM công cộng cho production, phải tự đánh giá lưu lượng và tuân thủ chính sách dịch vụ; cấu hình này không cung cấp SLA.

Khởi động lại Staff sau khi đổi biến môi trường. `STAFF_MAPS_ENABLED=false` tắt bản đồ. Production thiếu URL hoặc cấu hình không hợp lệ sẽ hiện thông báo cấu hình; chi nhánh và lịch khả dụng vẫn đọc bình thường. Các biến `STAFF_GOOGLE_MAPS_*` cũ không còn tác dụng.

Chính sách chính thức: [OSMF Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/), [OpenStreetMap copyright/attribution](https://www.openstreetmap.org/copyright).
