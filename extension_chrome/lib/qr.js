// Đọc mã QR trên CCCD gắn chip để lấy chính xác số CCCD, họ tên (đủ dấu), ngày sinh, giới tính, thường trú, ngày cấp.
// Quê quán, nơi sinh, ngày hết hạn, nơi cấp, quốc tịch KHÔNG có trong QR: vẫn lấy từ OCR.
// Định dạng giả định: các trường cách nhau bằng "|" theo thứ tự số CCCD | số CMND cũ | họ tên | ngày sinh | giới tính | địa chỉ | ngày cấp (ngày dạng ddMMyyyy).
// Chỉ nhận khi các trường kiểm tra được đúng dạng; sai là bỏ qua và dùng OCR như cũ.

const stripVi = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
const hasVi = (s) => !!s && stripVi(s) !== s;
const sameLetters = (a, b) => stripVi(a).toLowerCase().replace(/\s+/g, ' ').trim() === stripVi(b).toLowerCase().replace(/\s+/g, ' ').trim();

function ddmmyyyy(s) {
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(String(s).trim());
  if (!m) return '';
  const d = +m[1], mo = +m[2], y = +m[3];
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 1900 || y > 2100) return '';
  return m[1] + '/' + m[2] + '/' + m[3];
}

/** Chuỗi QR -> { so_cccd, ho_ten, ngay_sinh, gioi_tinh, noi_thuong_tru, ngay_cap } hoặc null nếu không đúng dạng CCCD. */
export function parseCccdQr(text) {
  const p = String(text || '').split('|').map((x) => x.trim());
  if (p.length < 7) return null;
  if (!/^\d{12}$/.test(p[0])) return null;
  const ngaySinh = ddmmyyyy(p[3]), ngayCap = ddmmyyyy(p[6]);
  if (!p[2] || !ngaySinh || !ngayCap) return null;
  const sex = stripVi(p[4]).toLowerCase();
  const out = {
    so_cccd: p[0],
    ho_ten: p[2],
    ngay_sinh: ngaySinh,
    gioi_tinh: sex === 'nam' ? 'Nam' : sex === 'nu' ? 'Nữ' : '',
    noi_thuong_tru: p[5],
    ngay_cap: ngayCap
  };
  return out;
}

/** Ghi đè dữ liệu OCR bằng dữ liệu QR (đáng tin hơn). Họ tên QR không dấu mà OCR có dấu và cùng chữ thì giữ OCR. Trả danh sách khóa đã dùng. */
export function mergeQr(data, qr) {
  const used = [];
  if (!qr) return used;
  for (const [k, v] of Object.entries(qr)) {
    if (!v) continue;
    if (k === 'ho_ten' && !hasVi(v) && hasVi(data.ho_ten) && sameLetters(v, data.ho_ten)) continue;
    data[k] = v;
    used.push(k);
  }
  return used;
}

/** Tìm và giải mã QR trong ảnh (dữ liệu RGBA). Thử toàn ảnh, rồi nửa trên bên phải (nơi QR của CCCD thường nằm). */
export function decodeQr(rgba, width, height, jsQR = globalThis.jsQR) {
  if (typeof jsQR !== 'function') return '';
  const full = jsQR(rgba, width, height, { inversionAttempts: 'attemptBoth' });
  if (full && full.data) return full.data;
  const cw = Math.floor(width / 2), ch = Math.floor(height / 2);
  const crop = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const src = (y * width + (width - cw)) * 4;
    crop.set(rgba.subarray(src, src + cw * 4), y * cw * 4);
  }
  const part = jsQR(crop, cw, ch, { inversionAttempts: 'attemptBoth' });
  return part && part.data ? part.data : '';
}

/** Trình duyệt: ảnh base64 -> chuỗi QR ('' nếu không có). */
export async function qrFromImage(base64, mimeType) {
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: mimeType }));
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width; canvas.height = bmp.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return decodeQr(img.data, img.width, img.height);
  } catch { return ''; }
}

/** Đọc QR CCCD từ các ảnh (bỏ qua PDF). Trả dữ liệu QR hợp lệ đầu tiên hoặc null. */
export async function readCccdQr(files) {
  for (const f of files) {
    if (!/^image\//.test(f.mimeType)) continue;
    const parsed = parseCccdQr(await qrFromImage(f.base64, f.mimeType));
    if (parsed) return parsed;
  }
  return null;
}
