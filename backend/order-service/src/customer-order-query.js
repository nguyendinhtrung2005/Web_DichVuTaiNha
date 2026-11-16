import { enumValue, id, invalid, pagination, text } from '../../shared/validation.js';

const statusValues = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled'];
const sortValues = ['newest', 'oldest', 'schedule-asc', 'schedule-desc'];
const dayMs = 86400000;

function calendarDay(raw, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number(raw.slice(0, 4)) < 1000) throw invalid(field, 'Ngày lọc phải có dạng YYYY-MM-DD hợp lệ.');
  const date = new Date(`${raw}T00:00:00+07:00`);
  if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10) !== raw) {
    throw invalid(field, 'Ngày lọc không hợp lệ.');
  }
  return date;
}

export function customerOrderQuery(url) {
  const params = url.searchParams;
  const read = (name) => params.has(name) ? params.get(name) : undefined;
  const from = read('from'), to = read('to');
  const start = from === undefined ? undefined : calendarDay(from, 'from');
  const end = to === undefined ? undefined : calendarDay(to, 'to');
  if (from !== undefined && to !== undefined && from > to) throw invalid('to', 'Ngày kết thúc phải từ ngày bắt đầu trở đi.');
  // MySQL stores UTC; include the complete Vietnamese calendar day with an
  // exclusive upper bound. Parameters remain SQL datetime strings, not SQL code.
  const sqlDate = (date) => date.toISOString().slice(0, 19).replace('T', ' ');
  return {
    ...pagination(url), q: params.has('q') ? text(params.get('q'), 'q', 0, 120) : '',
    ...(params.has('serviceId') ? { serviceId: id(params.get('serviceId'), 'serviceId') } : {}),
    ...(params.has('status') ? { status: enumValue(params.get('status'), 'status', statusValues) } : {}),
    ...(start ? { fromUtc: sqlDate(start) < '1000-01-01 00:00:00' ? '1000-01-01 00:00:00' : sqlDate(start) } : {}),
    ...(end ? { toUtc: sqlDate(new Date(end.getTime() + dayMs)) } : {}),
    sort: params.has('sort') ? enumValue(params.get('sort'), 'sort', sortValues) : 'newest',
  };
}
