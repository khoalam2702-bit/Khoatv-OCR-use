// Lượt quét: CV tính 2 lượt, loại khác 1; chỉ đọc QR CCCD không tính. Chỉ trừ khi đã điền được lên FBO.
const KEY = 'creditPending'; // phiếu đã điền xong nhưng chưa báo được cho máy chủ

export function scanCost(type, qrOnly) {
  if (type === 'CCCD' && qrOnly) return 0;
  return type === 'CV_UNGVIEN' || type === 'CV_NHANVIEN' ? 2 : 1;
}

const two = (n) => String(n).padStart(2, '0');
export function formatTime(ms) {
  const d = new Date(ms);
  return two(d.getHours()) + ':' + two(d.getMinutes()) + ' ngày ' + two(d.getDate()) + '/' + two(d.getMonth() + 1);
}

/**
 * view: dữ liệu lượt của máy chủ (myCredit / anonCredit); need: số lượt loại đang chọn cần (0 = không tính).
 * Trả { line, warn, blocked, short } để giao diện hiển thị; view = null (máy chủ bản cũ) hoặc ADMIN thì không hiện, không chặn.
 */
export function creditStatus(view, need = 1) {
  const off = { line: '', warn: false, blocked: false, short: false };
  if (!view || view.unlimited) return off;
  const n = view.remaining, device = view.resetAt !== undefined;
  const short = n < Math.max(1, need);
  const blocked = need > 0 && n < need;
  let line = 'Còn ' + n + ' lượt';
  if (n <= 0) line = device ? 'Đã hết lượt dùng thử.' : 'Đã hết lượt, liên hệ quản trị viên.';
  else if (n < need) line = 'Còn ' + n + ' lượt, tài liệu này cần ' + need + ' lượt.' + (device ? '' : ' Liên hệ quản trị viên.');
  else if (!device && n <= (view.low || 0)) line += ', sắp hết. Liên hệ quản trị viên để gia hạn.';
  return { line, warn: blocked || n <= 0 || (!device && n <= (view.low || 0)), blocked, short };
}

/**
 * Báo máy chủ trừ lượt sau khi điền được. Phiếu được nhớ lại trước khi gửi, gửi lỗi thì lần sau gửi tiếp
 * (máy chủ chỉ trừ một lần cho mỗi phiếu). send(owner, ticket) trả số lượt mới.
 */
export function createCharger({ load, save, send, onUpdate }) {
  let chain = Promise.resolve();
  async function flush(owner) {
    for (const p of await load()) {
      if (p.owner !== owner) continue;
      try { onUpdate(owner, await send(owner, p.ticket)); }
      catch (e) {
        if (!/Phiếu trừ lượt không hợp lệ/.test(e && e.message)) { console.warn('Chưa báo được lượt đã dùng:', e && e.message); return; }
      }
      await save((await load()).filter((x) => x.ticket !== p.ticket));
    }
  }
  const run = (fn) => (chain = chain.then(fn).catch((e) => console.warn(e && e.message)));
  return {
    charge: (owner, ticket) => run(async () => {
      const list = await load();
      if (!list.some((x) => x.ticket === ticket)) await save([...list, { owner, ticket }].slice(-50));
      await flush(owner);
    }),
    flush: (owner) => run(() => flush(owner))
  };
}

export const chargeStorage = {
  load: async () => (await chrome.storage.local.get(KEY))[KEY] || [],
  save: async (list) => chrome.storage.local.set({ [KEY]: list })
};
