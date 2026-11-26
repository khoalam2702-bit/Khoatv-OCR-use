import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePeriod, jobFields, normalizeJobs } from '../lib/jobs.js';
import { enrichData } from '../lib/dm.js';

test('parsePeriod: ngày đầu/cuối theo quy ước, Nay → còn làm, ngày đủ giữ nguyên', () => {
  assert.deepEqual(parsePeriod('06/2023', 'from'), { date: '01/06/2023', approx: true, ongoing: false });
  assert.deepEqual(parsePeriod('02/2024', 'to'), { date: '29/02/2024', approx: true, ongoing: false });
  assert.deepEqual(parsePeriod('2019', 'from').date, '01/01/2019');
  assert.deepEqual(parsePeriod('2019', 'to').date, '31/12/2019');
  assert.deepEqual(parsePeriod('Hiện tại', 'to'), { date: '', approx: false, ongoing: true });
  assert.deepEqual(parsePeriod('5/3/2020', 'from'), { date: '05/03/2020', approx: false, ongoing: false });
  assert.equal(parsePeriod('quý 2', 'from').date, '');
  assert.equal(parsePeriod('13/2020', 'from').date, '');
});

test('jobFields: khóa ct_*, số năm, ghi chú giữ thời gian gốc; normalizeJobs bỏ dòng trống', () => {
  const { fields, meta } = jobFields({ cong_ty: 'ABC', chuc_danh: 'Kế toán', tu: '01/2020', den: '12/2021', mo_ta: 'Lập báo cáo' });
  assert.equal(fields.ct_don_vi, 'ABC'); assert.equal(fields.ct_tu_ngay, '01/01/2020'); assert.equal(fields.ct_den_ngay, '31/12/2021');
  assert.equal(fields.ct_so_nam, '2'); assert.match(fields.ct_ghi_chu, /Thời gian theo CV: 01\/2020 - 12\/2021\nLập báo cáo/);
  assert.equal(meta.approx, true);
  assert.equal(jobFields({ cong_ty: 'X', tu: '2022', den: 'Nay' }, '26/11/2026').fields.ct_den_ngay, '26/11/2026');
  const m = jobFields({ cong_ty: 'Y' }, '26/11/2026').fields; // không có thời gian: Từ = hôm nay, Đến = Từ
  assert.deepEqual([m.ct_tu_ngay, m.ct_den_ngay, m.ct_so_nam], ['26/11/2026', '26/11/2026', '0']);
  const n = jobFields({ cong_ty: 'Z', tu: '03/2021' }, '26/11/2026').fields; // có Từ, thiếu Đến: Đến = Từ
  assert.deepEqual([n.ct_tu_ngay, n.ct_den_ngay], ['01/03/2021', '01/03/2021']);
  assert.deepEqual(normalizeJobs([{ cong_ty: '', chuc_danh: '' }, { cong_ty: ' A ' }, null]).map((j) => j.cong_ty), ['A']);
});

test('enrichData: ctx.job chọn đúng công việc, không có ctx.job thì không thêm khóa ct_*', () => {
  const data = { cong_viec: [{ cong_ty: 'A', tu: '2018', den: '2019' }, { cong_ty: 'B', tu: '2020', den: 'Nay' }] };
  assert.equal(enrichData('CV_NHANVIEN', data, null, { job: 1 }).ct_don_vi, 'B');
  assert.equal(enrichData('CV_NHANVIEN', data, null, { job: 1, today: '26/11/2026' }).ct_den_ngay, '26/11/2026');
  assert.equal(enrichData('CV_NHANVIEN', data, null, {}).ct_don_vi, undefined);
  assert.equal(enrichData('CV_NHANVIEN', data, null, { job: 5 }).ct_don_vi, undefined);
});
