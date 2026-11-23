export class GasError extends Error {
  constructor(message, code) { super(message); this.name = 'GasError'; this.code = code || ''; }
}

const CODES = ['SESSION_EXPIRED', 'MUST_CHANGE_PASSWORD'];

/**
 * Client gọi cổng doPost của Apps Script.
 * POST Content-Type: text/plain để không bị preflight CORS; Apps Script trả 302 và fetch tự theo.
 * getUrl: hàm trả URL /exec (lưu ở trang Cài đặt). fetchImpl để test.
 */
export function createGasClient({ getUrl, fetchImpl, client = 'EXTENSION', timeoutMs = 110000 } = {}) {
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  return async function call(action, args = []) {
    const url = await getUrl();
    if (!url) throw new GasError('Chưa cấu hình địa chỉ Apps Script. Mở Cài đặt của extension để nhập.', 'NO_URL');
    let res;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, args, client }),
        redirect: 'follow',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch {
      throw new GasError('Không kết nối được máy chủ Apps Script. Kiểm tra mạng rồi thử lại.', 'NETWORK');
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
