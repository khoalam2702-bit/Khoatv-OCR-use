// Tiến trình quét: máy chủ chỉ trả kết quả một lần khi xong, nên % là ƯỚC LƯỢNG theo thời gian quét trước đó của chính máy này.
export const DEFAULT_EXPECTED_MS = 20000; // chưa có lịch sử: giả định ~20 giây
export const HISTORY = 5;                 // nhớ 5 lần quét gần nhất
export const CLIENT_TIMEOUT_MS = 110000;  // trùng timeout của lib/gas.js

export function pushDuration(list, ms) {
  const a = (Array.isArray(list) ? list : []).filter((x) => Number.isFinite(x) && x > 0);
  if (Number.isFinite(ms) && ms > 0) a.push(Math.round(ms));
  return a.slice(-HISTORY);
}

export function expectedMs(list) {
  const a = (Array.isArray(list) ? list : []).filter((x) => Number.isFinite(x) && x > 0);
  return a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : DEFAULT_EXPECTED_MS;
}

/** % ước lượng, tối đa 95 cho tới khi có kết quả thật. */
export function estimatePercent(elapsedMs, expected) {
  if (!(expected > 0)) return 0;
  return Math.max(0, Math.min(95, Math.round((elapsedMs / expected) * 100)));
}

/** Dòng mô tả giai đoạn. stage: 'qr' | 'ai' | 'save' (chế độ chỉ QR: máy chủ chỉ lưu ảnh, không gọi AI). */
export function stageText(stage, elapsedMs, expected, nFiles) {
  const s = Math.floor(elapsedMs / 1000), exp = Math.max(1, Math.round(expected / 1000));
  const files = nFiles > 1 ? nFiles + ' tệp' : '1 tệp';
  if (stage === 'qr') return 'Bước 1/2: đọc mã QR trên CCCD... ' + s + ' giây';
  if (stage === 'save') return 'Bước 2/2: lưu ảnh gốc lên Drive (không dùng AI)... ' + s + ' giây';
  let t = 'Bước ' + (stage === 'ai' ? '2/2' : '1/1') + ': gửi ' + files + ' lên máy chủ, AI đang đọc... ' + s + ' giây (thường mất khoảng ' + exp + ' giây)';
  if (elapsedMs > expected * 1.5 && elapsedMs <= CLIENT_TIMEOUT_MS) t += '. Lâu hơn thường lệ, vẫn đang xử lý';
  return t;
}
