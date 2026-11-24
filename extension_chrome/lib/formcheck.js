// Chờ form FBO, kiểm tra đúng form và giới hạn thời gian cho bước "Điền vào FBO". Không dùng API của Chrome nên kiểm thử được bằng Node.
export const FORM_WAIT_MS = 10000;   // chờ form xuất hiện / tải xong
export const POLL_MS = 500;          // chu kỳ dò form
export const STEP_TIMEOUT_MS = 15000; // tối đa cho MỖI lần gọi vào tab (kiểm tra đăng nhập, dò, tính thử, điền); không tính lúc người dùng đọc hộp xác nhận
export const STABLE_POLLS = 2;       // số lần dò liên tiếp không thấy thêm ô nào (≈1 giây) thì thôi chờ
export const MIN_MATCH = 0.5;        // form đúng loại khi thấy ít nhất 50% số ô của ánh xạ

/** Danh sách selector (không trùng) của một ánh xạ. */
export function mappingSelectors(mapping) {
  const set = new Set();
  Object.values(mapping || {}).forEach((spec) => {
    (Array.isArray(spec) ? spec : [spec]).forEach((sp) => {
      const sel = typeof sp === 'string' ? sp : sp && sp.selector;
      if (sel) set.add(sel);
    });
  });
  return [...set];
}

/** READY: đủ ô để điền. Chưa đủ thì NO_FORM (không thấy ô nào) hoặc WRONG_FORM (thấy một phần: form khác loại). */
export function classifyForm(found, total) {
  if (!total) return 'READY';
  if (found / total >= MIN_MATCH) return 'READY';
  return found === 0 ? 'NO_FORM' : 'WRONG_FORM';
}

export function withTimeout(promise, ms, message) {
  let timer;
  const t = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(message)), ms); });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

/** Chỉ giữ ô bị ghi đè thuộc trường bắt buộc (số giấy tờ, họ tên...): ô mặc định của FBO không làm phiền người dùng. */
export function importantOverwrites(list, required) {
  const req = new Set(required || []);
  return (list || []).filter((o) => req.has(o.k));
}

/** Người dùng bấm Dừng. */
export class FillStopped extends Error { constructor() { super('Đã dừng theo yêu cầu.'); this.name = 'FillStopped'; } }

/** Hủy ngay khi signal bị abort (không chờ promise xong). Không có signal thì trả nguyên promise. */
export function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new FillStopped());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new FillStopped());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then((v) => { signal.removeEventListener('abort', onAbort); resolve(v); }, (e) => { signal.removeEventListener('abort', onAbort); reject(e); });
  });
}
