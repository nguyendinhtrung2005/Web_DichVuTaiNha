export function canonicalRegionKey(region) {
  if (typeof region !== 'string' || !region.trim()) return null;
  return region.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ');
}

export function bookingDecision({
  regionKey, branchMatches, serviceActive = true, serviceEnabled, skillsConfigured, durationMinutes,
  scheduledStart, qualifiedEmployees, availabilityConfigured, availableEmployees,
}) {
  if (!regionKey) return { state: 'NEEDS_ADMIN', reason: 'Chưa có phường/xã hoặc khu vực; cần admin xác minh địa chỉ.' };
  if (!branchMatches.length) return { state: 'NEEDS_ADMIN', reason: 'Chưa có vùng phục vụ được xác nhận cho khu vực này; cần admin kiểm tra.' };
  if (branchMatches.length > 1) return {
    state: 'NEEDS_ADMIN',
    reason: `Khu vực khớp ${branchMatches.length} chi nhánh; cần chọn chi nhánh phụ trách.`,
  };
  if (branchMatches[0].status !== 'ACTIVE') return { state: 'NEEDS_ADMIN', reason: 'Chi nhánh xác định được hiện không hoạt động; cần admin xử lý.' };
  if (!serviceActive) return { state: 'NEEDS_ADMIN', reason: 'Dịch vụ đã ngừng hoạt động; cần admin kiểm tra trước khi xác nhận.' };
  if (!serviceEnabled) return { state: 'NEEDS_ADMIN', reason: 'Chưa xác nhận chi nhánh này nhận dịch vụ; cần admin kiểm tra.' };
  if (!skillsConfigured) return { state: 'NEEDS_ADMIN', reason: 'Chưa xác minh cấu hình kỹ năng bắt buộc cho dịch vụ; cần admin cập nhật.' };
  if (!Number.isSafeInteger(durationMinutes) || durationMinutes < 1) return { state: 'NEEDS_ADMIN', reason: 'Chưa xác định được thời lượng thực hiện; cần admin xác minh.' };
  if (!(scheduledStart instanceof Date) || !Number.isFinite(scheduledStart.getTime())) return { state: 'NEEDS_ADMIN', reason: 'Lịch thực hiện chưa hợp lệ; cần admin kiểm tra.' };
  if (!qualifiedEmployees.length) return { state: 'NEEDS_DISPATCH', reason: 'Chưa tìm được nhân viên active, đã xác minh và có kỹ năng phù hợp.' };
  if (!availabilityConfigured) return { state: 'NEEDS_ADMIN', reason: 'Chưa có dữ liệu availability đã xác nhận cho nhân viên đủ điều kiện; cần admin kiểm tra lịch làm.' };
  if (!availableEmployees.length) return { state: 'NEEDS_DISPATCH', reason: 'Chưa tìm được nhân viên có kỹ năng phù hợp rảnh suốt khung giờ này.' };
  return { state: 'AUTO_CONFIRMED', reason: 'Đã xác minh dịch vụ, chi nhánh, thời lượng, kỹ năng và availability; hệ thống tự xác nhận và phân công.' };
}
