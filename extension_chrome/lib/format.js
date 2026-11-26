/** Bỏ dấu tiếng Việt, hạ chữ thường, gộp khoảng trắng (dùng để so khớp nhãn ô chọn). */
export function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Chuỗi nhập tay sang số. money: dấu chấm là ngăn cách hàng nghìn; còn lại dấu phẩy là dấu thập phân. */
export function parseNumber(text, money) {
  let s = String(text ?? '').trim().replace(/\s/g, '');
  if (s === '') return null;
  if (money) s = s.replace(/\./g, '').replace(/,/g, '.');
  else s = s.replace(/,/g, '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Số sang chuỗi hiển thị trên form. */
export function numberToText(n, money) {
  if (n === null || n === undefined || n === '') return '';
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  return money ? v.toLocaleString('vi-VN') : String(v);
}

/** dd/MM/yyyy -> yyyy-MM-dd (cho ô <input type="date">). Không khớp thì trả nguyên. */
export function dmyToIso(s) {
  const m = /^\s*(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\s*$/.exec(String(s ?? ''));
  if (!m) return String(s ?? '');
  return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
}

/** Dữ liệu OCR -> chuỗi trên form (null thành rỗng). */
export function toFormValues(fields, data) {
  const out = {};
  for (const f of fields) {
    const v = data ? data[f.k] : null;
    out[f.k] = f.type === 'number' ? numberToText(v, f.money) : v == null ? '' : String(v);
  }
  return out;
}

/** Chuỗi trên form -> dữ liệu gửi backend. Trả { data, errors } với errors là danh sách trường số sai định dạng. */
export function fromFormValues(fields, values) {
  const data = {}, errors = [];
  for (const f of fields) {
    const raw = values[f.k];
    if (f.type === 'number') {
      const n = parseNumber(raw, f.money);
      if (Number.isNaN(n)) { errors.push(f.k); data[f.k] = null; } else data[f.k] = n;
    } else {
      const t = String(raw ?? '').trim();
      data[f.k] = t === '' ? null : t;
    }
  }
  return { data, errors };
}

/** Trường bắt buộc còn trống. */
export function missingRequired(required, data) {
  return (required || []).filter((k) => data[k] === null || data[k] === undefined || data[k] === '');
}

/** Nhãn cảnh báo cho giá trị không có trên CV (backend đánh dấu ở <trường>_nguon). */
const SOURCE_NOTES = { ten_dem: 'đoán theo tên đệm, cần kiểm tra', ten: 'AI đoán theo tên, cần kiểm tra', anh: 'AI đoán theo ảnh, cần kiểm tra', mac_dinh: 'mặc định, CV không ghi' };
export function sourceNote(key, data) {
  return (data && SOURCE_NOTES[data[key + '_nguon']]) || '';
}
