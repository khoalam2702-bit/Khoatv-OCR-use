// Sinh extension_chrome/presets/dm/dia-chi-cu.json: bảng quy đổi địa chỉ CŨ (tỉnh > huyện > xã/phường/thị trấn, trước 01/7/2025) -> MÃ tỉnh/xã MỚI của danh mục FBO.
// Nguồn: Dorabot (dorabot.io/dia-chi/sap-nhap), chép từ nghị quyết của Ủy ban Thường vụ Quốc hội, giấy phép CC BY 4.0.
// Dùng:  node tools/build-dia-chi-cu.mjs <thư mục data của dorabot-io/sap-nhap-2025>   (đọc tat-ca.json)
import fs from 'node:fs';
import { oldKeys } from '../extension_chrome/lib/dm.js';

const src = process.argv[2];
if (!src) { console.error('Thiếu đường dẫn thư mục data (chứa tat-ca.json)'); process.exit(1); }
const rd = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const root = new URL('../extension_chrome/presets/dm/', import.meta.url);
const tinh = rd(new URL('tinh.json', root)), xa = rd(new URL('xa.json', root));
const data = rd(src.replace(/\/$/, '') + '/tat-ca.json');
const nfc = (s) => String(s).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
const plain = (s) => oldKeys.norm(s);

const provByName = new Map(tinh.map(([ma, ten]) => [nfc(ten), ma]));
const wardExact = new Map(), wardPlain = new Map();
for (const [mt, ma, ten] of xa) {
  wardExact.set(mt + '|' + nfc(ten), ma);
  const k = mt + '|' + plain(ten);
  wardPlain.set(k, wardPlain.has(k) ? null : ma); // null = trùng tên không dấu trong tỉnh
}
const P = {}; const miss = new Map(); let rows = 0, ok = 0;
for (const r of data.dong) {
  rows++;
  const mt = provByName.get(nfc(r.tinh_moi));
  if (!mt) throw new Error('Tỉnh mới không có trong danh mục: ' + r.tinh_moi);
  const pk = oldKeys.prov(r.tinh_cu), dk = oldKeys.dist(r.huyen_cu), ck = oldKeys.ward(r.xa_cu);
  const p = (P[pk] = P[pk] || { t: mt, d: {} });
  if (p.t !== mt) throw new Error('Tỉnh cũ ' + r.tinh_cu + ' thuộc nhiều tỉnh mới');
  const d = (p.d[dk] = p.d[dk] || {});
  let code = wardExact.get(mt + '|' + nfc(r.xa_moi));
  if (!code) code = wardPlain.get(mt + '|' + plain(r.xa_moi)) || '';
  if (code) ok++; else miss.set(mt + ' ' + r.xa_moi, (miss.get(mt + ' ' + r.xa_moi) || 0) + 1);
  const cur = d[ck] || [];
  if (!cur.includes(code)) cur.push(code); // '' = xã mới chưa có trong danh mục FBO -> coi là không chắc
  d[ck] = cur;
}
// Gọn: 1 mã duy nhất -> chuỗi; nhiều mã (xã cũ bị chia) hoặc có '' -> mảng.
let single = 0, split = 0;
for (const p of Object.values(P)) for (const d of Object.values(p.d)) for (const [k, v] of Object.entries(d)) {
  if (v.length === 1 && v[0]) { d[k] = v[0]; single++; } else { d[k] = v; split++; }
}
const out = { v: 1, nguon: data.giay_phep.ghi_nguon, giay_phep: data.giay_phep.ten + ' ' + data.giay_phep.url, phien_ban: data.phien_ban, p: P };
const file = new URL('dia-chi-cu.json', root);
fs.writeFileSync(file, JSON.stringify(out));
console.log({ rows, ok, single, split, khongCoTrongFBO: [...miss], bytes: fs.statSync(file).size });
