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

const hasWord = (hay, needle) => needle && (' ' + hay + ' ').includes(' ' + needle + ' ');

/** Tách địa chỉ chữ thành { tinh: {ma, ten}|null, xa: {ma, ten}|null }. */
export function lookupAddress(dm, text) {
  const out = { tinh: null, xa: null };
  const parts = String(text || '').split(/[,;]|\s-\s/).map(norm).filter(Boolean);
  if (!parts.length) return out;
  let prov = null, provIdx = -1;
  for (let i = parts.length - 1; i >= 0 && !prov; i--) {
    const k = strip(parts[i], PROV_PREFIX);
    const p = dm.provinces.find((x) => x.key === k);
    if (p) { prov = p; provIdx = i; }
  }
  if (!prov) {
    const all = parts.join(' ');
    prov = dm.provinces.find((x) => hasWord(all, x.key)) || null; // không có dấu phẩy: tìm tên tỉnh ngay trong chuỗi
  }
  if (!prov) return out;
  out.tinh = { ma: prov.ma, ten: prov.ten };
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

const ADDR = { thuong_tru: 'noi_thuong_tru', que_quan: 'que_quan' };
export const DERIVED_LABELS = {
  thuong_tru_tinh_ma: 'Thường trú - Tỉnh/thành', thuong_tru_xa_ma: 'Thường trú - Phường/xã',
  que_quan_tinh_ma: 'Quê quán - Tỉnh/thành', que_quan_xa_ma: 'Quê quán - Phường/xã',
  noi_cap_ma: 'Nơi cấp (mã quốc tịch)', noi_cap_visa_ma: 'Nơi cấp thị thực (mã quốc tịch)'
};

/** Thêm các khóa mã (thuong_tru_tinh_ma...) vào bản sao dữ liệu OCR. Ánh xạ FBO tham chiếu các khóa này. */
export function enrichData(docType, data, dm) {
  const out = { ...(data || {}) };
  if (!dm) return out;
  if (docType === 'CCCD') {
    // Nơi sinh chỉ có một ô chữ: thẻ không in Nơi sinh thì gom thông tin nơi chốn trên thẻ (Quê quán) vào ô này.
    if (!String(out.noi_sinh == null ? '' : out.noi_sinh).trim() && out.que_quan) out.noi_sinh = out.que_quan;
    for (const [p, k] of Object.entries(ADDR)) {
      const r = lookupAddress(dm, out[k]);
      out[p + '_tinh_ma'] = r.tinh ? r.tinh.ma : '';
      out[p + '_xa_ma'] = r.xa ? r.xa.ma : '';
    }
  }
  if (docType === 'HO_CHIEU') {
    out.noi_cap_ma = lookupNationality(dm, out.noi_cap);
    out.noi_cap_visa_ma = lookupNationality(dm, out.noi_cap_visa);
  }
  return out;
}
