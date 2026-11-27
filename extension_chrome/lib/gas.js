export class GasError extends Error {
  constructor(message, code) { super(message); this.name = 'GasError'; this.code = code || ''; }
}

const CODES = ['SESSION_EXPIRED', 'MUST_CHANGE_PASSWORD'];
// Quét: chờ tối đa 120 giây rồi dừng (người dùng cũng có thể bấm Dừng sớm hơn).
const SLOW_ACTIONS = ['scanDocument', 'scanAnonymous'];
// Chỉ đọc, gọi lại không tạo dữ liệu hay tốn lượt quét: rớt kết nối thì tự thử lại một lần.
const SAFE_RETRY_ACTIONS = ['getAppConfig', 'checkSession', 'myCredit', 'anonCredit', 'chargeScan', 'anonCharge', 'bindDevice']; // trừ lượt theo phiếu nên gửi lại không trừ hai lần

/**
 * Client gọi cổng doPost của Apps Script.
 * POST Content-Type: text/plain để không bị preflight CORS; Apps Script trả 302 và fetch tự theo.
 * getUrl: hàm trả URL /exec (lưu ở trang Cài đặt). fetchImpl để test.
 */
export function createGasClient({ getUrl, fetchImpl, client = 'EXTENSION', timeoutMs = 110000, scanTimeoutMs = 120000, retryWaitMs = 1500 } = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  return async function call(action, args = [], { signal } = {}) {
    const url = await getUrl();
    if (!url) throw new GasError('Chưa có địa chỉ Apps Script. Liên hệ quản trị viên để cấu hình ở Web Admin.', 'NO_URL');
    const limit = SLOW_ACTIONS.includes(action) ? scanTimeoutMs : timeoutMs;
    // Gộp tín hiệu hết giờ và tín hiệu người dùng bấm Dừng (không dùng AbortSignal.any để chạy được Chrome 114).
    const withStop = (timeout) => {
      if (!signal) return timeout;
      const c = new AbortController();
      for (const s of [timeout, signal]) {
        if (s.aborted) c.abort(s.reason);
        else s.addEventListener('abort', () => c.abort(s.reason), { once: true });
      }
      return c.signal;
    };
    const send = () => doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, args, client }),
      redirect: 'follow',
      cache: 'no-store',
      signal: withStop(AbortSignal.timeout(limit))
    });
    const fail = (e) => {
      if (signal && signal.aborted) return new GasError('Đã dừng.', 'CANCELLED');
      if (e && e.name === 'TimeoutError') return new GasError('Quá ' + Math.round(limit / 1000) + ' giây nên đã dừng (timeout), không phải lỗi mạng của bạn. Hãy thử lại; nên dùng tệp ảnh hoặc tách PDF ít trang hơn.', 'TIMEOUT');
      return new GasError('Không kết nối được máy chủ Apps Script. Kiểm tra mạng rồi thử lại.', 'NETWORK');
    };
    let res;
    try {
      res = await send();
    } catch (e) {
      if (!SAFE_RETRY_ACTIONS.includes(action) || fail(e).code !== 'NETWORK') throw fail(e);
      await new Promise((r) => setTimeout(r, retryWaitMs));
      try { res = await send(); } catch (e2) { throw fail(e2); }
    }
    let text;
    try { text = await res.text(); } catch (e) { throw fail(e); }
    let json;
    try { json = JSON.parse(text); } catch {
      throw new GasError('Apps Script trả về dữ liệu không hợp lệ. Kiểm tra địa chỉ /exec và quyền truy cập "Anyone".', 'BAD_RESPONSE');
    }
    if (!json.ok) {
      const msg = String(json.error || 'Lỗi không xác định từ Apps Script.');
      throw new GasError(msg, CODES.includes(msg) ? msg : '');
    }
    return json.data;
  };
}
