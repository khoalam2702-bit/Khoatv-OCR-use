// Thông báo hết hạn mức Gemini: backend gắn cuối lỗi "[[RETRY_AFTER:<giây>]]"; giao diện tách ra để đếm ngược.
const MARK = /\s*\[\[RETRY_AFTER:(\d+)\]\]\s*$/;

/** Tách dấu hiệu chờ khỏi thông báo lỗi. seconds = null nếu không phải lỗi hết hạn mức. */
export function splitRetry(message) {
  const s = String(message == null ? '' : message);
  const m = MARK.exec(s);
  return { text: m ? s.replace(MARK, '') : s, seconds: m ? Number(m[1]) : null };
}

/** 95 -> "01:35"; 27000 -> "7 giờ 30 phút 00 giây" khi từ 1 giờ trở lên. */
export function formatWait(sec) {
  const t = Math.max(0, Math.ceil(sec));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? h + ' giờ ' + p(m) + ' phút ' + p(s) + ' giây' : p(m) + ':' + p(s);
}

/** Giờ trên máy ứng với 0 giờ giờ Thái Bình Dương (lúc Google đặt lại hạn mức ngày): giờ Việt Nam là "14:00" hoặc "15:00" tùy mùa. */
export function dailyResetTime(now = new Date(), timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const passed = get('hour') * 3600 + get('minute') * 60 + get('second');
  const reset = new Date(Math.round((now.getTime() + (86400 - passed) * 1000) / 60000) * 60000);
  return new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(reset);
}
