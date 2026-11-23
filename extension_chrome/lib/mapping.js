/** Kiểm tra ánh xạ: object { loại: { trường: selector | {selector,...} } }. Trả chuỗi lỗi hoặc ''.
 *  isValidSelector để test; mặc định dùng querySelector của trang hiện tại. */
export function validateMapping(obj, isValidSelector) {
  const ok = isValidSelector || ((sel) => { try { document.createDocumentFragment().querySelector(sel); return true; } catch { return false; } });
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 'Ánh xạ phải là một đối tượng JSON.';
  for (const [type, fields] of Object.entries(obj)) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return 'Loại ' + type + ' phải là đối tượng { trường: selector }.';
    for (const [k, entry] of Object.entries(fields)) {
      for (const spec of Array.isArray(entry) ? entry : [entry]) {
        const sel = typeof spec === 'string' ? spec : spec && spec.selector;
        if (!sel || typeof sel !== 'string') return type + '.' + k + ': thiếu selector.';
        if (!ok(sel)) return type + '.' + k + ': selector không hợp lệ.';
      }
    }
  }
  return '';
}
