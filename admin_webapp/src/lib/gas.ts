import { getGasUrl } from './gasUrl';

/** Gọi cổng doPost của Google Apps Script (chỉ chạy phía server, URL không lộ ra trình duyệt). */
export async function gasCall<T>(action: string, args: unknown[] = [], client = 'WEB_APP'): Promise<T> {
  const url = await getGasUrl();
  if (!url) throw new Error('Chưa lấy được địa chỉ Apps Script (public/index.html hoặc GAS_WEB_APP_URL).');
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      // text/plain để không bị coi là yêu cầu cần preflight; Apps Script vẫn đọc được thân JSON
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, args, client }),
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(110_000)
    });
  } catch {
    throw new Error('Không kết nối được máy chủ Apps Script. Thử lại sau.');
  }
  const text = await res.text();
  let json: { ok?: boolean; data?: T; error?: string };
  try { json = JSON.parse(text); } catch {
    throw new Error('Apps Script trả về dữ liệu không hợp lệ. Kiểm tra link APP_URL trong public/index.html, quyền truy cập "Anyone" và đã deploy bản có doPost.');
  }
  if (!json.ok) throw new Error(json.error || 'Lỗi không xác định từ Apps Script.');
  return json.data as T;
}
