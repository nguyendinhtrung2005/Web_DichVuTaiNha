export const groupNames = { 've-sinh': 'Vệ sinh', 'cham-soc': 'Chăm sóc', 'bao-duong': 'Bảo dưỡng' };
export const groups = new Set(Object.keys(groupNames));
export function normalized(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[\s_-]+/g, ' ');
}
export function legacyGroup(categoryName, name) {
  const source = normalized(categoryName + ' ' + name);
  if (source.includes('cham soc')) return 'cham-soc';
  if (source.includes('bao duong') || source.includes('thiet bi')) return 'bao-duong';
  return 've-sinh';
}
export function legacyCleaningType(categoryName, name, group) {
  if (group !== 've-sinh') return undefined;
  const source = normalized(categoryName + ' ' + name);
  if (source.includes('phong tro')) return 'phong-tro';
  if (source.includes('nha o gia dinh') || source.includes('nha gia dinh')) return 'nha-gia-dinh';
  return undefined;
}
// Match the same source, punctuation and Vietnamese accents as the JS DTO.
// This is static application SQL, never interpolated caller input.
const sourceSql = "REGEXP_REPLACE(REPLACE(LOWER(CONCAT_WS(' ', c.name, s.name)), 'đ', 'd'), '[[:space:]_-]+', ' ') COLLATE utf8mb4_unicode_ci";
export const legacyGroupSql = "CASE WHEN " + sourceSql + " LIKE '%cham soc%' THEN 'cham-soc' WHEN "
  + sourceSql + " LIKE '%bao duong%' OR " + sourceSql + " LIKE '%thiet bi%' THEN 'bao-duong' ELSE 've-sinh' END";
export const legacyCleaningTypeSql = "CASE WHEN " + sourceSql + " LIKE '%phong tro%' THEN 'phong-tro' WHEN "
  + sourceSql + " LIKE '%nha o gia dinh%' OR " + sourceSql + " LIKE '%nha gia dinh%' THEN 'nha-gia-dinh' ELSE NULL END";
