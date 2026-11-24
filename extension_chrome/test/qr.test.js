import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { parseCccdQr, mergeQr, decodeQr } from '../lib/qr.js';

const SAMPLE = '079090001234||Nguyễn Văn An|15031990|Nam|12 Lê Lợi, Phường Bến Nghé, Quận 1, Thành phố Hồ Chí Minh|02082021';

test('parseCccdQr: đọc đủ trường, đổi ngày ddMMyyyy -> dd/MM/yyyy', () => {
  assert.deepEqual(parseCccdQr(SAMPLE), {
    so_cccd: '079090001234', ho_ten: 'Nguyễn Văn An', ngay_sinh: '15/03/1990', gioi_tinh: 'Nam',
    noi_thuong_tru: '12 Lê Lợi, Phường Bến Nghé, Quận 1, Thành phố Hồ Chí Minh', ngay_cap: '02/08/2021'
  });
  assert.equal(parseCccdQr(SAMPLE.replace('|Nam|', '|Nữ|')).gioi_tinh, 'Nữ');
});

test('parseCccdQr: sai dạng thì null (rồi dùng OCR)', () => {
  assert.equal(parseCccdQr(''), null);
  assert.equal(parseCccdQr('https://example.com'), null);
  assert.equal(parseCccdQr(SAMPLE.replace('079090001234', '0790900012')), null); // số CCCD không đủ 12 số
  assert.equal(parseCccdQr(SAMPLE.replace('15031990', '1503199')), null); // ngày sinh sai
  assert.equal(parseCccdQr(SAMPLE.replace('15031990', '45131990')), null); // ngày/tháng không hợp lệ
  assert.equal(parseCccdQr('a|b|c'), null);
});

test('mergeQr: QR ghi đè OCR; họ tên QR không dấu thì giữ OCR có dấu cùng chữ', () => {
  const data = { so_cccd: '1', ho_ten: 'NGUYEN VAN AN', ngay_sinh: '', que_quan: 'Cà Mau' };
  const used = mergeQr(data, parseCccdQr(SAMPLE));
  assert.equal(data.ho_ten, 'Nguyễn Văn An');
  assert.equal(data.so_cccd, '079090001234');
  assert.equal(data.que_quan, 'Cà Mau'); // QR không có quê quán: giữ OCR
  assert.ok(used.includes('ho_ten') && used.includes('ngay_cap'));
  const d2 = { ho_ten: 'Nguyễn Văn An' };
  mergeQr(d2, parseCccdQr(SAMPLE.replace('Nguyễn Văn An', 'NGUYEN VAN AN')));
  assert.equal(d2.ho_ten, 'Nguyễn Văn An');
  const d3 = { ho_ten: 'Trần Văn B' };
  mergeQr(d3, parseCccdQr(SAMPLE.replace('Nguyễn Văn An', 'NGUYEN VAN AN')));
  assert.equal(d3.ho_ten, 'NGUYEN VAN AN'); // khác chữ: tin QR
  assert.deepEqual(mergeQr({}, null), []);
});

/** Vẽ QR thành ảnh RGBA, đặt ở góc trên bên phải của nền trắng cỡ (W x H). */
function render(text, W, H, scale) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size, quiet = 4, side = (n + quiet * 2) * scale;
  const px = new Uint8ClampedArray(W * H * 4).fill(255);
  const ox = W - side - 10, oy = 10;
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const mx = Math.floor(x / scale) - quiet, my = Math.floor(y / scale) - quiet;
    const dark = mx >= 0 && my >= 0 && mx < n && my < n && qr.modules.data[my * n + mx];
    const i = ((oy + y) * W + (ox + x)) * 4;
    px[i] = px[i + 1] = px[i + 2] = dark ? 0 : 255; px[i + 3] = 255;
  }
  return px;
}

test('decodeQr: giải mã QR (cả khi nhỏ ở góc trên phải của ảnh lớn), giữ nguyên dấu tiếng Việt', () => {
  const big = render(SAMPLE, 1200, 800, 4);
  assert.equal(decodeQr(big, 1200, 800, jsQR), SAMPLE);
  assert.equal(decodeQr(new Uint8ClampedArray(100 * 100 * 4).fill(255), 100, 100, jsQR), '');
  assert.equal(decodeQr(big, 1200, 800, undefined), ''); // chưa nạp thư viện thì bỏ qua
});
