import { normalizeJobs, jobFields } from './jobs.js';

// Tra cứu danh mục FBO (tỉnh/thành, phường/xã, quốc tịch) từ presets/dm/*.json: đổi tên trong dữ liệu OCR thành MÃ để điền ô tra cứu.
// Không khớp thì trả rỗng (không đoán). Địa chỉ theo 2 cấp (tỉnh + phường/xã) của danh mục hiện hành.

export function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
const PROV_PREFIX = /^(thanh pho|tinh|tp)\s+/;
const WARD_PREFIX = /^(phuong|xa|thi tran|dac khu|p|x|tt)\s+/;
const strip = (n, re) => n.replace(re, '');

const DIST_PREFIX = /^(huyen|quan|thi xa|thanh pho|tp|tx|q|h)\s+/;
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20 };
// "phuong 05" == "phuong 5" == "phuong v"; "hai chau i" == "hai chau 1" (số La Mã ở cuối tên)
const zero = (n) => n.replace(/\b0+(\d)/g, '$1').replace(/(^|\s)([ivx]+)$/, (m, sp, r) => (ROMAN[r] ? sp + ROMAN[r] : m));
/** Khóa chuẩn hóa tên đơn vị CŨ (bỏ tiền tố, bỏ số 0 đầu) — dùng chung với tools/build-dia-chi-cu.mjs để chỉ mục và tra cứu luôn khớp nhau. */
export const oldKeys = {
  norm,
  prov: (s) => strip(norm(s), PROV_PREFIX),
  dist: (s) => zero(strip(norm(s), DIST_PREFIX)),
  ward: (s) => zero(strip(norm(s), WARD_PREFIX))
};

/** Dựng chỉ mục tra cứu từ dữ liệu thô: tinh [[ma, ten]], xa [[ma_tinh, ma_xa, ten]], quocTich [[ma, ten]], diaChiCu (presets/dm/dia-chi-cu.json: tỉnh/huyện/xã cũ -> mã mới). */
export function buildDm({ tinh = [], xa = [], quocTich = [], diaChiCu = null, chuyenNganh = [] } = {}) {
  const provinces = tinh.map(([ma, ten]) => ({ ma, ten, key: strip(norm(ten), PROV_PREFIX) }))
    .sort((a, b) => b.key.length - a.key.length);
  const wardsBy = {};
  for (const [mt, ma, ten] of xa) (wardsBy[mt] = wardsBy[mt] || []).push({ ma, ten, full: norm(ten), key: strip(norm(ten), WARD_PREFIX) });
  const nat = quocTich.map(([ma, ten]) => ({ ma, ten, key: norm(ten) }));
  const old = diaChiCu && diaChiCu.p ? diaChiCu : null;
  const majors = chuyenNganh.map(([ma, ten]) => ({ ma, ten, key: major(ten), tokens: new Set(major(ten).split(' ').filter(Boolean)) }));
  return { provinces, wardsBy, nat, old, majors };
}

// Chuyên ngành: bỏ chữ "chuyên ngành/ngành/cử nhân/kỹ sư..." đứng đầu rồi so khớp không dấu
const major = (t) => norm(t).replace(/^(chuyen nganh|nganh|cu nhan|ky su|thac si|tien si)\s+/, '').trim();
const KHAC = '99'; // mã "KHÁC" trong danh mục chuyên ngành

/**
 * Tìm mã chuyên ngành trong danh mục FBO: trùng tên > tên danh mục nằm trọn trong chuyên ngành ghi trên CV (lấy tên dài nhất)
 * > chuyên ngành nằm trong tên danh mục (lấy tên ngắn nhất) > giống từ (>= 70%). Không có gì khớp thì dùng mã KHÁC nếu danh mục có.
 * Trả { ma, ten, how } hoặc null (không có chuyên ngành, hoặc danh mục trống).
 */
export function lookupMajor(text, dm) {
  const key = major(text);
  const list = (dm && dm.majors) || [];
  if (!key || !list.length) return null;
  const pad = (x) => ' ' + x + ' ';
  const hit = (m, how) => ({ ma: m.ma, ten: m.ten, how });
  const exact = list.find((m) => m.key === key); if (exact) return hit(exact, 'exact');
  const inside = list.filter((m) => m.key.length >= 3 && pad(key).includes(pad(m.key))).sort((a, b) => b.key.length - a.key.length)[0]; if (inside) return hit(inside, 'contain');
  const wider = list.filter((m) => key.length >= 4 && pad(m.key).includes(pad(key))).sort((a, b) => a.key.length - b.key.length)[0]; if (wider) return hit(wider, 'contain');
  const kt = new Set(key.split(' ').filter(Boolean));
  let best = null, bs = 0;
  for (const m of list) {
    if (!m.tokens.size) continue;
    let c = 0; m.tokens.forEach((t) => { if (kt.has(t)) c++; });
    const sc = c / Math.max(m.tokens.size, kt.size);
    if (sc > bs) { bs = sc; best = m; }
  }
  if (best && bs >= 0.7) return hit(best, 'fuzzy');
  const other = list.find((m) => m.ma === KHAC); return other ? hit(other, 'other') : null;
}

// Dự phòng khi KHÔNG có bảng dia-chi-cu.json: tỉnh cũ đã nhập vào tỉnh khác từ 01/7/2025 (Nghị quyết 202/2025/QH15, 63 -> 34 tỉnh) -> mã tỉnh mới. Chỉ quy đổi cấp tỉnh.
const OLD_PROVINCE = {
  'ha giang': '08', 'yen bai': '15', 'bac kan': '19', 'vinh phuc': '25', 'hoa binh': '25', 'bac giang': '24',
  'thai binh': '33', 'hai duong': '31', 'ha nam': '37', 'nam dinh': '37',
  'quang binh': '44', 'thua thien hue': '46', 'quang nam': '48', 'kon tum': '51', 'binh dinh': '52',
  'ninh thuan': '56', 'phu yen': '66', 'dak nong': '68', 'binh thuan': '68',
  'binh phuoc': '75', 'ba ria vung tau': '79', 'binh duong': '79',
  'long an': '80', 'tien giang': '82', 'ben tre': '86', 'tra vinh': '86', 'soc trang': '92', 'hau giang': '92', 'kien giang': '91', 'bac lieu': '96'
};

// Tách địa chỉ thành các đoạn; "Bà Rịa - Vũng Tàu" có dấu gạch ngang trong tên nên không được cắt đôi.
const splitAddr = (t) => String(t || '').replace(/(r[ịi]a)\s*-\s*(v[ũu]ng)/gi, '$1 $2').split(/[,;]|\s-\s/);
const hasWord = (hay, needle) => needle && (' ' + hay + ' ').includes(' ' + needle + ' ');
const wardOf = (dm, tinhMa, ma) => (dm.wardsBy[tinhMa] || []).find((w) => w.ma === ma);

// Đối chiếu địa chỉ theo đơn vị CŨ (xã/phường > huyện/quận > tỉnh) với bảng quy đổi. Trả null nếu không khớp xã cũ nào.
// Xã cũ nhập trọn vào 1 xã mới -> mã đó; xã cũ bị chia cho nhiều xã mới (hoặc xã mới chưa có trong danh mục FBO) -> không chọn (candidates liệt kê các xã có thể).
function matchOld(dm, parts, provKey, provIdx) {
  const P = dm.old && dm.old.p[provKey];
  if (!P) return null;
  const cands = parts.map((x, i) => ({ i, n: x.n })).filter((x) => x.i !== provIdx);
  const res = (dKey, wKey, i, di) => {
    const v = P.d[dKey][wKey];
    const codes = [].concat(v).filter(Boolean);
    return { prov: P.t, i, di, codes, sure: typeof v === 'string' };
  };
  let best = null;
  for (const d of cands) {
    if (WARD_PREFIX.test(d.n)) continue;
    const dKey = oldKeys.dist(d.n);
    if (!P.d[dKey]) continue;
    const dScore = DIST_PREFIX.test(d.n) ? 1 : 0;
    for (const w of cands) {
      if (w.i === d.i || DIST_PREFIX.test(w.n) && !WARD_PREFIX.test(w.n)) continue;
      const wKey = oldKeys.ward(w.n);
      if (P.d[dKey][wKey] === undefined) continue;
      const score = dScore + (WARD_PREFIX.test(w.n) ? 1 : 0);
      if (!best || score > best.score) best = { score, ...res(dKey, wKey, w.i, d.i) };
    }
  }
  if (best) return best;
  // Thiếu huyện/quận: chấp nhận khi xã có ghi loại (Xã/Phường/Thị trấn) và tên chỉ xuất hiện ở đúng 1 huyện của tỉnh cũ.
  for (const w of cands) {
    if (!WARD_PREFIX.test(w.n)) continue;
    const wKey = oldKeys.ward(w.n);
    const hit = Object.keys(P.d).filter((dk) => P.d[dk][wKey] !== undefined);
    if (hit.length === 1) return res(hit[0], wKey, w.i, -1);
  }
  return null;
}

/** Tách địa chỉ chữ thành { tinh: {ma, ten}|null, xa: {ma, ten}|null, cu, provKey, used, candidates }.
 *  cu = true: địa chỉ theo đơn vị hành chính cũ (trước 01/7/2025) đã được quy đổi sang tỉnh/xã mới. used = chỉ số các đoạn đã dùng cho tỉnh/xã (để cắt phần còn lại). */
export function lookupAddress(dm, text) {
  const out = { tinh: null, xa: null, cu: false, provKey: '', used: [], candidates: [] };
  const parts = splitAddr(text).map((x) => ({ n: norm(x) }));
  if (!parts.some((x) => x.n)) return out;
  const newProv = (k) => dm.provinces.find((x) => x.key === k);
  const oldProv = (k) => (dm.old && dm.old.p[k]) || OLD_PROVINCE[k];
  const mkTinh = (ma) => { const p = dm.provinces.find((x) => x.ma === ma); return p ? { ma: p.ma, ten: p.ten } : null; };
  let provIdx = -1;
  for (let i = parts.length - 1; i >= 0 && provIdx < 0; i--) {
    if (!parts[i].n) continue;
    const k = strip(parts[i].n, PROV_PREFIX);
    if (newProv(k) || oldProv(k)) { provIdx = i; out.provKey = k; }
  }
  if (provIdx < 0) { // không có dấu phẩy: tìm tên tỉnh (hiện hành) ngay trong chuỗi
    const all = parts.map((x) => x.n).join(' ');
    const p = dm.provinces.find((x) => hasWord(all, x.key));
    if (p) { out.provKey = p.key; out.tinh = { ma: p.ma, ten: p.ten }; }
    return out;
  }
  const useOld = () => { // quy đổi theo đơn vị cũ; chỉ ghi vào out khi khớp
    const m = dm.old ? matchOld(dm, parts, out.provKey, provIdx) : null;
    const tinh = m && mkTinh(m.prov);
    if (!tinh) return false;
    out.tinh = tinh; out.cu = true; out.used = [provIdx, m.i, ...(m.di >= 0 ? [m.di] : [])];
    if (m.sure && m.codes.length === 1) { const w = wardOf(dm, m.prov, m.codes[0]); out.xa = w ? { ma: w.ma, ten: w.ten } : null; }
    else out.candidates = m.codes.map((c) => wardOf(dm, m.prov, c)).filter(Boolean).map((w) => ({ ma: w.ma, ten: w.ten }));
    return true;
  };
  const np = newProv(out.provKey);
  if (np) {
    const hasDistrict = parts.some((x, i) => i !== provIdx && DIST_PREFIX.test(x.n) && !WARD_PREFIX.test(x.n));
    if (hasDistrict && useOld()) return out; // có ghi huyện/quận: địa chỉ 3 cấp theo đơn vị cũ (tên tỉnh có thể trùng tên tỉnh mới)
    const wards = dm.wardsBy[np.ma] || [];
    for (let i = 0; i < parts.length && !out.xa; i++) { // địa chỉ 2 cấp theo danh mục hiện hành
      if (i === provIdx || !parts[i].n) continue;
      const p = parts[i].n, typed = WARD_PREFIX.test(p);
      let hit = wards.filter((w) => w.full === p);
      if (!hit.length && !typed) hit = wards.filter((w) => w.key === p); // không ghi loại: chỉ nhận khi duy nhất
      if (hit.length === 1) { out.xa = { ma: hit[0].ma, ten: hit[0].ten }; out.used = [provIdx, i]; }
    }
    if (out.xa) { out.tinh = { ma: np.ma, ten: np.ten }; return out; }
    if (useOld()) return out;
    out.tinh = { ma: np.ma, ten: np.ten }; out.used = [provIdx];
    return out;
  }
  if (useOld()) return out; // tên tỉnh chỉ có ở danh sách cũ
  const ma = (dm.old && dm.old.p[out.provKey] && dm.old.p[out.provKey].t) || OLD_PROVINCE[out.provKey];
  out.tinh = mkTinh(ma); out.cu = !!out.tinh; out.used = [provIdx];
  return out;
}

/** Phần địa chỉ còn lại sau khi bỏ tỉnh/thành và phường/xã (cùng huyện/quận cũ) đã tra được (số nhà, tổ, đường, thôn...). Không tra được gì thì giữ nguyên chuỗi. */
export function addressDetail(dm, text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const r = lookupAddress(dm, raw);
  if (!r.tinh) return raw;
  const keep = splitAddr(raw).filter((x, i) => norm(x) && !r.used.includes(i)).map((x) => x.trim());
  return keep.join(', ');
}

// Cách gọi khác của các nước có trong danh mục, và mã ISO 3 chữ (vùng MRZ của hộ chiếu).
const NAT_ALIAS = {
  'hoa ky': 'USA', 'my': 'USA', 'united states': 'USA', 'united states of america': 'USA', usa: 'USA',
  'nhat ban': 'JAP', japan: 'JAP', jpn: 'JAP',
  'anh quoc': 'ENG', 'vuong quoc anh': 'ENG', 'united kingdom': 'ENG', gbr: 'ENG', england: 'ENG',
  'lien bang nga': 'RUS', russia: 'RUS', 'russian federation': 'RUS', rus: 'RUS',
  'cong hoa phap': 'FRA', france: 'FRA', fra: 'FRA',
  'tay ban nha': 'SPA', spain: 'SPA', esp: 'SPA',
  'cong hoa dan chu nhan dan lao': 'LAO', laos: 'LAO', lao: 'LAO',
  'viet nam': 'VN', vietnam: 'VN', 'viet nam socialist republic of': 'VN', 'cong hoa xa hoi chu nghia viet nam': 'VN', vnm: 'VN'
};
/** Tên nước (hoặc mã ISO) -> mã quốc tịch của FBO. Tên trùng nhiều mã (vd Pháp: FRA, QFRA) lấy mã không có tiền tố Q. Không khớp thì ''. */
export function lookupNationality(dm, text) {
  const n = norm(text);
  if (!n) return '';
  const byCode = (c) => (dm.nat.find((x) => x.ma === c) || {}).ma || '';
  if (NAT_ALIAS[n]) return byCode(NAT_ALIAS[n]);
  const hits = dm.nat.filter((x) => x.key === n && x.ma !== 'NN');
  if (!hits.length) return '';
  return (hits.find((x) => !/^Q/.test(x.ma)) || hits[0]).ma;
}

// Địa chỉ trên FBO gồm 3 ô riêng: số nhà/tổ (chữ) + tỉnh/thành (mã) + phường/xã (mã). Mỗi loại tài liệu khai báo các địa chỉ cần tách.
// Riêng Nơi sinh chỉ có một ô chữ gom cả 3 nên không tách.
const ADDR = {
  CCCD: { thuong_tru: 'noi_thuong_tru', que_quan: 'que_quan' },
  CV_UNGVIEN: { dia_chi: 'dia_chi' },
  CV_NHANVIEN: { hien_tai: 'dia_chi' } // Địa chỉ hiện tại trên form Thông tin nhân viên
};
export const DERIVED_LABELS = {
  thuong_tru_tinh_ma: 'Thường trú - Tỉnh/thành', thuong_tru_xa_ma: 'Thường trú - Phường/xã',
  thuong_tru_xa_goi_y: 'Thường trú - Gợi ý xã/phường (xã cũ bị chia, chọn tay)', que_quan_xa_goi_y: 'Quê quán - Gợi ý xã/phường (xã cũ bị chia, chọn tay)', dia_chi_xa_goi_y: 'Địa chỉ - Gợi ý xã/phường (xã cũ bị chia, chọn tay)',
  thuong_tru_chi_tiet: 'Thường trú - Số nhà, tổ', que_quan_chi_tiet: 'Quê quán - Số nhà, tổ',
  hien_tai_tinh_ma: 'Hiện tại - Tỉnh/thành', hien_tai_xa_ma: 'Hiện tại - Phường/xã', hien_tai_chi_tiet: 'Hiện tại - Số nhà, tổ', hien_tai_xa_goi_y: 'Hiện tại - Gợi ý xã/phường (xã cũ bị chia, chọn tay)',
  dia_chi_tinh_ma: 'Địa chỉ - Tỉnh/thành', dia_chi_xa_ma: 'Địa chỉ - Phường/xã', dia_chi_chi_tiet: 'Địa chỉ - Số nhà, tổ',
  thoi_gian_hoc: 'Thời gian học (năm)', chuyen_nganh_ma: 'Chuyên ngành (mã danh mục)', ngay_tot_nghiep: 'Ngày tốt nghiệp',
  ct_don_vi: 'Đơn vị', ct_vi_tri: 'Vị trí công việc', ct_tu_ngay: 'Từ ngày', ct_den_ngay: 'Đến ngày', ct_so_nam: 'Năm công tác', ct_ghi_chu: 'Ghi chú',
  ma_pt: 'Mã người phụ thuộc', loai_giay_to: 'Loại giấy tờ', loai_qh: 'Loại quan hệ', ngay_hl_tu: 'Hiệu lực từ ngày',
  que_quan_tinh_ma: 'Quê quán - Tỉnh/thành', que_quan_xa_ma: 'Quê quán - Phường/xã',
  noi_cap_ma: 'Nơi cấp (mã quốc tịch)', noi_cap_visa_ma: 'Nơi cấp thị thực (mã quốc tịch)'
};

/** Thêm các khóa mã (thuong_tru_tinh_ma...) vào bản sao dữ liệu OCR. Ánh xạ FBO tham chiếu các khóa này. */
export function enrichData(docType, data, dm, ctx) {
  const out = { ...(data || {}) };
  if (docType === 'CV_NHANVIEN' && ctx && Number.isInteger(ctx.job)) { // điền công việc thứ ctx.job (từ 0) vào form quá trình công tác
    const job = normalizeJobs(out.cong_viec)[ctx.job];
    if (job) Object.assign(out, jobFields(job, ctx.today).fields);
  }
  if (docType === 'KHAI_SINH') { // người phụ thuộc: loại quan hệ chọn ở Side Panel (Con 01, Cha/Mẹ 03), hiệu lực từ = ngày quét
    out.loai_qh = ctx && ctx.relation === 'CHA_ME' ? '03' : '01';
    out.ngay_hl_tu = (ctx && ctx.today) || '';
  }
  if (docType === 'CV_NHANVIEN') { // ngày tốt nghiệp: quy ước 30/09 của năm kết thúc học (CV chỉ ghi năm)
    const y = String(out.den_nam == null ? '' : out.den_nam).match(/\b(19[5-9]\d|20\d\d)\b/);
    if (y) out.ngay_tot_nghiep = '30/09/' + y[1];
  }
  if (!dm) return out;
  if (docType === 'CV_NHANVIEN') { const mj = lookupMajor(out.chuyen_nganh, dm); if (mj) out.chuyen_nganh_ma = mj.ma; }
  if (docType === 'CV_NHANVIEN') { // form nhân viên chỉ có ô ngày đầy đủ cho thời gian học: không bịa ngày/tháng, đưa khoảng năm vào Ghi chú
    const a = String(out.tu_nam == null ? '' : out.tu_nam).trim(), b = String(out.den_nam == null ? '' : out.den_nam).trim();
    out.thoi_gian_hoc = a && b ? a + ' - ' + b : a || b;
  }
  if (docType === 'CCCD') {
    // Nơi sinh chỉ có một ô chữ: thẻ không in Nơi sinh thì gom thông tin nơi chốn trên thẻ (Quê quán) vào ô này.
    if (!String(out.noi_sinh == null ? '' : out.noi_sinh).trim() && out.que_quan) out.noi_sinh = out.que_quan;
  }
  for (const [p, k] of Object.entries(ADDR[docType] || {})) {
    const r = lookupAddress(dm, out[k]);
    out[p + '_tinh_ma'] = r.tinh ? r.tinh.ma : '';
    out[p + '_xa_ma'] = r.xa ? r.xa.ma : '';
    out[p + '_chi_tiet'] = addressDetail(dm, out[k]); // số nhà, tổ... cắt từ địa chỉ
    if (r.candidates.length) out[p + '_xa_goi_y'] = r.candidates.map((c) => c.ten).join(' / '); // xã cũ bị chia cho nhiều xã mới: không tự chọn, chỉ gợi ý
  }
  if (docType === 'HO_CHIEU') {
    out.noi_cap_ma = lookupNationality(dm, out.noi_cap);
    out.noi_cap_visa_ma = lookupNationality(dm, out.noi_cap_visa);
  }
  return out;
}
