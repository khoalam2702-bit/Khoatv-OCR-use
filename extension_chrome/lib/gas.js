export class GasError extends Error {
  constructor(message, code) { super(message); this.name = 'GasError'; this.code = code || ''; }
}

const CODES = ['SESSION_EXPIRED', 'MUST_CHANGE_PASSWORD'];
// Quét AI có lúc mất vài phút (Apps Script cho chạy tối đa 6 phút): phải chờ lâu hơn các thao tác thường.
const SLOW_ACTIONS = ['scanDocument', 'scanAnonymous'];
// Chỉ đọc, gọi lại không tạo dữ liệu hay tốn lượt quét: rớt kết nối thì tự thử lại một lần.
const SAFE_RETRY_ACTIONS = ['getAppConfig', 'checkSession'];

/**
 * Client gọi cổng doPost của Apps Script.
 * POST Content-Type: text/plain để không bị preflight CORS; Apps Script trả 302 và fetch tự theo.
 * getUrl: hàm trả URL /exec (lưu ở trang Cài đặt). fetchImpl để test.
 */
export function createGasClient({ getUrl, fetchImpl, client = 'EXTENSION', timeoutMs = 110000, scanTimeoutMs = 295000, retryWaitMs = 1500 } = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  return async function call(action, args = []) {
    const url = await getUrl();
    if (!url) throw new GasError('Chưa có địa chỉ Apps Script. Liên hệ quản trị viên để cấu hình ở Web Admin.', 'NO_URL');
    const limit = SLOW_ACTIONS.includes(action) ? scanTimeoutMs : timeoutMs;
    const send = () => doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, args, client }),
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(limit)
    });
    const fail = (e) => (e && e.name === 'TimeoutError'
      ? new GasError('Máy chủ xử lý quá ' + Math.round(limit / 1000) + ' giây nên đã ngừng chờ (không phải lỗi mạng của bạn). Hãy thử lại; nếu lặp lại, tách PDF ít trang hơn.', 'TIMEOUT')
      : new GasError('Không kết nối được máy chủ Apps Script. Kiểm tra mạng rồi thử lại.', 'NETWORK'));
    let res;
    try {
      res = await send();
    } catch (e) {
      if (!SAFE_RETRY_ACTIONS.includes(action) || fail(e).code !== 'NETWORK') throw fail(e);
      await new Promise((r) => setTimeout(r, retryWaitMs));
      try { res = await send(); } catch (e2) { throw fail(e2); }
    }
    const text = await res.text();
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
