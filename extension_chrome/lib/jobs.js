// Danh sách công việc (kinh nghiệm làm việc) trên CV -> từng bản ghi cho form "Quá trình công tác trước đây" của FBO.
// CV thường chỉ ghi tháng/năm hoặc năm, trong khi ô ngày của form cần đủ ngày/tháng/năm: ngày được quy ước (xem parsePeriod) và luôn báo là ước lượng.

export const JOB_VARIANT = 'CONGTAC';  // hậu tố ánh xạ "CV_NHANVIEN@CONGTAC" trong presets/fbo-hrm.json

const NOW_RE = /^(nay|hien nay|hien tai|present|now|den nay|current)$/;
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9/]+/g, ' ').trim();
const p2 = (n) => String(n).padStart(2, '0');
const lastDay = (m, y) => new Date(y, m, 0).getDate();
const validYear = (y) => y >= 1950 && y <= 2100;

/** Làm sạch danh sách công việc AI trả về: bỏ dòng trống, ép về chuỗi. */
export function normalizeJobs(list) {
  const s = (v) => (v == null ? '' : String(v).trim());
  return (Array.isArray(list) ? list : []).map((j) => ({ cong_ty: s(j && j.cong_ty), chuc_danh: s(j && j.chuc_danh), tu: s(j && j.tu), den: s(j && j.den), mo_ta: s(j && j.mo_ta) }))
    .filter((j) => j.cong_ty || j.chuc_danh);
}

/**
 * Thời điểm ghi trên CV -> ngày dd/MM/yyyy.
 * edge 'from': ngày đầu (tháng/năm -> 01/MM/yyyy; chỉ năm -> 01/01/yyyy). edge 'to': ngày cuối (tháng/năm -> ngày cuối tháng; chỉ năm -> 31/12/yyyy).
 * "Nay/Hiện tại" (chỉ cho 'to') -> ongoing, không có ngày. Không hiểu được thì date rỗng. approx = ngày do quy ước chứ CV không ghi đủ.
 */
export function parsePeriod(text, edge) {
  const t = norm(text);
  if (!t) return { date: '', approx: false, ongoing: false };
  if (NOW_RE.test(t)) return { date: '', approx: false, ongoing: edge === 'to' };
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t); // đủ ngày
  if (m && validYear(+m[3]) && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= lastDay(+m[2], +m[3])) return { date: p2(+m[1]) + '/' + p2(+m[2]) + '/' + m[3], approx: false, ongoing: false };
  m = /^(\d{1,2})\/(\d{4})$/.exec(t); // tháng/năm
  if (m && validYear(+m[2]) && +m[1] >= 1 && +m[1] <= 12) {
    const mo = +m[1], y = +m[2];
    return { date: (edge === 'to' ? p2(lastDay(mo, y)) : '01') + '/' + p2(mo) + '/' + y, approx: true, ongoing: false };
  }
  m = /^(\d{4})$/.exec(t); // chỉ năm
  if (m && validYear(+m[1])) return { date: edge === 'to' ? '31/12/' + m[1] : '01/01/' + m[1], approx: true, ongoing: false };
  return { date: '', approx: false, ongoing: false };
}

const dmy = (d) => { const [a, b, c] = d.split('/').map(Number); return new Date(c, b - 1, a); };

/** Các khóa dẫn xuất ct_* của một công việc (khóa ánh xạ form quá trình công tác) + meta để báo người dùng. */
export function jobFields(job) {
  const j = job || {};
  const from = parsePeriod(j.tu, 'from'), to = parsePeriod(j.den, 'to');
  let years = '';
  if (from.date && to.date) {
    const d = (dmy(to.date) - dmy(from.date)) / 86400000 / 365.25;
    if (d >= 0) years = String(Math.round(d * 100) / 100);
  }
  const ghi = [(j.tu || j.den) ? 'Thời gian theo CV: ' + [j.tu, j.den].filter(Boolean).join(' - ') : '', j.mo_ta].filter(Boolean).join('\n');
  return {
    fields: { ct_don_vi: j.cong_ty || '', ct_vi_tri: j.chuc_danh || '', ct_tu_ngay: from.date, ct_den_ngay: to.date, ct_so_nam: years, ct_ghi_chu: ghi },
    meta: { approx: from.approx || to.approx, ongoing: to.ongoing, noFrom: !from.date, noTo: !to.date && !to.ongoing }
  };
}
