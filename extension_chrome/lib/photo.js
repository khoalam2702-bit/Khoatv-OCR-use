// Cắt ảnh chân dung từ CV (ảnh hoặc PDF) theo khung do AI trả về, để gắn vào ô ảnh của form FBO.
// Khung AI: anh_tep (tệp thứ mấy, từ 1), anh_trang (trang thứ mấy, từ 1), anh_ymin/xmin/ymax/xmax (0-1000 theo chiều cao/rộng của trang).
// Không có khung hợp lệ thì không cắt (trả null), không đoán.

/** Loại tài liệu có ảnh chân dung gắn vào form: ô chọn tệp và ảnh xem trước của form FBO (đã dò trên form Thông tin nhân viên và form hồ sơ ứng viên). */
export const PHOTO_FORMS = {
  CV_NHANVIEN: { input: '#imageupload', preview: '#empImage' },
  CV_UNGVIEN: { input: '#imageupload', preview: '#empImage' } // form Cập nhật hồ sơ ứng viên (hrrm012) dùng cùng id ô ảnh, đã dò trên demo
};

const MIN_SIDE = 40;        // khung nhỏ hơn thế (điểm ảnh) là sai
const MIN_AREA = 0.002;     // khung nhỏ hơn 0,2% diện tích trang là sai
const MAX_AREA = 0.45;      // ảnh chân dung không thể chiếm quá 45% trang: AI khoanh nhầm cả trang
const OUT_MAX_SIDE = 480;   // ảnh gắn lên form chỉ cần cỡ chân dung
const PDF_TARGET_W = 1600;  // vẽ trang PDF rộng ~1600 điểm ảnh để ảnh cắt còn nét

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

/** Khung AI -> hình chữ nhật điểm ảnh (có nới viền, kẹp trong trang). Khung sai thì null. */
export function boxToRect(d, w, h, pad = 0.06) {
  const [y0, x0, y1, x1] = [num(d && d.anh_ymin), num(d && d.anh_xmin), num(d && d.anh_ymax), num(d && d.anh_xmax)];
  if (![y0, x0, y1, x1].every((n) => Number.isFinite(n) && n >= 0 && n <= 1000)) return null;
  if (!(y1 > y0 && x1 > x0) || !(w > 0 && h > 0)) return null;
  const area = ((y1 - y0) / 1000) * ((x1 - x0) / 1000);
  if (area < MIN_AREA || area > MAX_AREA) return null;
  const bw = ((x1 - x0) / 1000) * w, bh = ((y1 - y0) / 1000) * h;
  const px = bw * pad, py = bh * pad;
  const x = Math.max(0, Math.floor((x0 / 1000) * w - px)), y = Math.max(0, Math.floor((y0 / 1000) * h - py));
  const r = Math.min(w, Math.ceil((x1 / 1000) * w + px)), b = Math.min(h, Math.ceil((y1 / 1000) * h + py));
  if (r - x < MIN_SIDE || b - y < MIN_SIDE) return null;
  return { x, y, w: r - x, h: b - y };
}

/** Chỉ số tệp/trang (từ 1) AI chỉ; không ghi thì mặc định tệp 1, trang 1. */
export function pickTarget(d, fileCount) {
  const f = Math.round(num(d && d.anh_tep)), p = Math.round(num(d && d.anh_trang));
  const file = Number.isFinite(f) && f >= 1 && f <= fileCount ? f : 1;
  return { file, page: Number.isFinite(p) && p >= 1 ? p : 1 };
}

const b64ToBytes = (b64) => { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; };

/** Mặc định dùng canvas của trang; test truyền canvas thay thế. */
const defaultMk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

/** Vẽ một trang PDF ra canvas (pdf.js đóng gói sẵn, chạy ngay trong extension, không gửi đi đâu). */
export async function renderPdfPage(base64, pageNo, deps = {}) {
  const pdfjs = deps.pdfjs || await import('./vendor/pdfjs/pdf.min.mjs');
  if (!deps.pdfjs && pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: b64ToBytes(base64), isEvalSupported: false }).promise;
  try {
    const n = Math.min(Math.max(1, pageNo), doc.numPages);
    const page = await doc.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(3, Math.max(1, PDF_TARGET_W / v1.width));
    const vp = page.getViewport({ scale });
    const canvas = (deps.mk || defaultMk)(Math.ceil(vp.width), Math.ceil(vp.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas }).promise;
    return canvas;
  } finally { try { await doc.destroy(); } catch (e) { /* bỏ qua */ } }
}

async function imageToCanvas(f, deps) {
  const blob = await (await fetch('data:' + f.mimeType + ';base64,' + f.base64)).blob();
  const bmp = await createImageBitmap(blob);
  const c = (deps.mk || defaultMk)(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  try { bmp.close(); } catch (e) { /* bỏ qua */ }
  return c;
}

/** Cắt canvas theo khung, thu về tối đa 480 điểm ảnh, xuất JPEG data URL. */
export function cropCanvas(canvas, rect, deps = {}, quality = 0.9) {
  const k = Math.min(1, OUT_MAX_SIDE / Math.max(rect.w, rect.h));
  const ow = Math.max(1, Math.round(rect.w * k)), oh = Math.max(1, Math.round(rect.h * k));
  const out = (deps.mk || defaultMk)(ow, oh);
  const g = out.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, ow, oh);
  g.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, ow, oh);
  return out.toDataURL('image/jpeg', quality);
}

/** files: [{mimeType, base64}] đúng thứ tự đã gửi quét; d: dữ liệu quét (có khung ảnh). Trả { dataUrl, name } hoặc null. */
export async function extractPhoto(files, d, deps = {}) {
  if (!files || !files.length) return null;
  const t = pickTarget(d, files.length);
  const f = files[t.file - 1];
  if (!f) return null;
  let canvas;
  if (/^image\//.test(f.mimeType)) canvas = await imageToCanvas(f, deps); // ảnh chỉ có 1 trang
  else if (f.mimeType === 'application/pdf') canvas = await renderPdfPage(f.base64, t.page, deps);
  else return null;
  const rect = boxToRect(d, canvas.width, canvas.height);
  if (!rect) return null;
  return { dataUrl: cropCanvas(canvas, rect, deps), name: 'anh_chan_dung.jpg' };
}
