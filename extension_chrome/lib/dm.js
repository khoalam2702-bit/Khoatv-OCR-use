// Tra cứu danh mục FBO (tỉnh/thành, phường/xã, quốc tịch) từ presets/dm/*.json: đổi tên trong dữ liệu OCR thành MÃ để điền ô tra cứu.
// Không khớp thì trả rỗng (không đoán). Địa chỉ theo 2 cấp (tỉnh + phường/xã) của danh mục hiện hành.

export function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
const PROV_PREFIX = /^(thanh pho|tinh|tp)\s+/;
const WARD_PREFIX = /^(phuong|xa|thi tran|dac khu|p|x|tt)\s+/;
const strip = (n, re) => n.replace(re, '');

/** Dựng chỉ mục tra cứu từ dữ liệu thô: tinh [[ma, ten]], xa [[ma_tinh, ma_xa, ten]], quocTich [[ma, ten]]. */
export function buildDm({ tinh = [], xa = [], quocTich = [] } = {}) {
  const provinces = tinh.map(([ma, ten]) => ({ ma, ten, key: strip(norm(ten), PROV_PREFIX) }))
    .sort((a, b) => b.key.length - a.key.length);
  const wardsBy = {};
  for (const [mt, ma, ten] of xa) (wardsBy[mt] = wardsBy[mt] || []).push({ ma, ten, full: norm(ten), key: strip(norm(ten), WARD_PREFIX) });
  const nat = quocTich.map(([ma, ten]) => ({ ma, ten, key: norm(ten) }));
  return { provinces, wardsBy, nat };
}

// Tỉnh cũ đã nhập vào tỉnh khác từ 01/7/2025 (Nghị quyết 202/2025/QH15, 63 -> 34 tỉnh): tên cũ (không dấu, không tiền tố) -> mã tỉnh mới trong danh mục.
// Thẻ CCCD cấp trước 2025 vẫn in tên tỉnh cũ. Chỉ quy đổi cấp tỉnh; xã/phường cũ đã đổi tên và sáp nhập nên KHÔNG tự đoán (để trống cho người dùng chọn).
const OLD_PROVINCE = {
  'ha giang': '08', 'yen bai': '15', 'bac kan': '19', 'vinh phuc': '25', 'hoa binh': '25', 'bac giang': '24',
  'thai binh': '33', 'hai duong': '31', 'ha nam': '37', 'nam dinh': '37',
  'quang binh': '44', 'thua thien hue': '46', 'quang nam': '48', 'kon tum': '51', 'binh dinh': '52',
  'ninh thuan': '56', 'phu yen': '66', 'dak nong': '68', 'binh thuan': '68',
  'binh phuoc': '75', 'ba ria vung tau': '79', 'binh duong': '79',
  'long an': '80', 'tien giang': '82', 'ben tre': '86', 'tra vinh': '86', 'soc trang': '92', 'hau giang': '92', 'kien giang': '91', 'bac lieu': '96'
};

const hasWord = (hay, needle) => needle && (' ' + hay + ' ').includes(' ' + needle + ' ');

/** Tách địa chỉ chữ thành { tinh: {ma, ten}|null, xa: {ma, ten}|null }. */
export function lookupAddress(dm, text) {
  const out = { tinh: null, xa: null, legacy: false, provKey: '' };
  const parts = String(text || '').split(/[,;]|\s-\s/).map(norm).filter(Boolean);
  if (!parts.length) return out;
  let prov = null, provIdx = -1;
  for (let i = parts.length - 1; i >= 0 && !prov; i--) {
    const k = strip(parts[i], PROV_PREFIX);
    const p = dm.provinces.find((x) => x.key === k);
    if (p) { prov = p; provIdx = i; out.provKey = k; }
  }
  if (!prov) { // tên tỉnh cũ đã sáp nhập: quy đổi sang tỉnh mới, không tra xã/phường
    for (let i = parts.length - 1; i >= 0 && !prov; i--) {
      const k = strip(parts[i], PROV_PREFIX), ma = OLD_PROVINCE[k];
      const p = ma ? dm.provinces.find((x) => x.ma === ma) : null;
      if (p) { prov = p; provIdx = i; out.provKey = k; out.legacy = true; }
    }
  }
  if (!prov) {
    const all = parts.join(' ');
    prov = dm.provinces.find((x) => hasWord(all, x.key)) || null; // không có dấu phẩy: tìm tên tỉnh ngay trong chuỗi
  }
  if (!prov) return out;
  if (!out.provKey) out.provKey = prov.key;
  out.tinh = { ma: prov.ma, ten: prov.ten };
  if (out.legacy) return out; // xã/phường theo đơn vị cũ: để trống
  const wards = dm.wardsBy[prov.ma] || [];
  for (let i = 0; i < parts.length && !out.xa; i++) {
    if (i === provIdx) continue;
    const p = parts[i];
    const typed = WARD_PREFIX.test(p);
    let hit = wards.filter((w) => w.full === p);
    if (!hit.length && !typed) hit = wards.filter((w) => w.key === p); // không ghi loại (Phường/Xã): chỉ nhận khi duy nhất
    if (hit.length === 1) out.xa = { ma: hit[0].ma, ten: hit[0].ten };
  }
  return out;
}

/** Phần địa chỉ còn lại sau khi bỏ tỉnh/thành và phường/xã đã tra được (số nhà, tổ, đường, thôn...). Không tra được gì thì giữ nguyên chuỗi. */
export function addressDetail(dm, text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const r = lookupAddress(dm, raw);
  if (!r.tinh) return raw;
  const prov = dm.provinces.find((x) => x.ma === r.tinh.ma);
  const ward = r.xa ? (dm.wardsBy[r.tinh.ma] || []).find((w) => w.ma === r.xa.ma) : null;
  const keep = raw.split(/[,;]|\s-\s/).map((x) => x.trim()).filter((x) => {
    const n = norm(x);
    if (!n) return false;
    if (strip(n, PROV_PREFIX) === r.provKey || (prov && strip(n, PROV_PREFIX) === prov.key && !r.legacy)) return false;
    if (ward && (n === ward.full || (!WARD_PREFIX.test(n) && n === ward.key))) return false;
    return true;
  });
  return keep.length ? keep.join(', ') : '';
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
  CV_UNGVIEN: { dia_chi: 'dia_chi' }
};
export const DERIVED_LABELS = {
  thuong_tru_tinh_ma: 'Thường trú - Tỉnh/thành', thuong_tru_xa_ma: 'Thường trú - Phường/xã',
  thuong_tru_chi_tiet: 'Thường trú - Số nhà, tổ', que_quan_chi_tiet: 'Quê quán - Số nhà, tổ',
  dia_chi_tinh_ma: 'Địa chỉ - Tỉnh/thành', dia_chi_xa_ma: 'Địa chỉ - Phường/xã', dia_chi_chi_tiet: 'Địa chỉ - Số nhà, tổ',
  ma_pt: 'Mã người phụ thuộc', loai_giay_to: 'Loại giấy tờ', loai_qh: 'Loại quan hệ', ngay_hl_tu: 'Hiệu lực từ ngày',
  que_quan_tinh_ma: 'Quê quán - Tỉnh/thành', que_quan_xa_ma: 'Quê quán - Phường/xã',
  noi_cap_ma: 'Nơi cấp (mã quốc tịch)', noi_cap_visa_ma: 'Nơi cấp thị thực (mã quốc tịch)'
};

/** Thêm các khóa mã (thuong_tru_tinh_ma...) vào bản sao dữ liệu OCR. Ánh xạ FBO tham chiếu các khóa này. */
export function enrichData(docType, data, dm, ctx) {
  const out = { ...(data || {}) };
  if (docType === 'KHAI_SINH') { // người phụ thuộc: loại quan hệ chọn ở Side Panel (Con 01, Cha/Mẹ 03), hiệu lực từ = ngày quét
    out.loai_qh = ctx && ctx.relation === 'CHA_ME' ? '03' : '01';
    out.ngay_hl_tu = (ctx && ctx.today) || '';
  }
  if (!dm) return out;
  if (docType === 'CCCD') {
    // Nơi sinh chỉ có một ô chữ: thẻ không in Nơi sinh thì gom thông tin nơi chốn trên thẻ (Quê quán) vào ô này.
    if (!String(out.noi_sinh == null ? '' : out.noi_sinh).trim() && out.que_quan) out.noi_sinh = out.que_quan;
  }
  for (const [p, k] of Object.entries(ADDR[docType] || {})) {
    const r = lookupAddress(dm, out[k]);
    out[p + '_tinh_ma'] = r.tinh ? r.tinh.ma : '';
    out[p + '_xa_ma'] = r.xa ? r.xa.ma : '';
    out[p + '_chi_tiet'] = addressDetail(dm, out[k]); // số nhà, tổ... cắt từ địa chỉ
  }
  if (docType === 'HO_CHIEU') {
    out.noi_cap_ma = lookupNationality(dm, out.noi_cap);
    out.noi_cap_visa_ma = lookupNationality(dm, out.noi_cap_visa);
  }
  return out;
}
