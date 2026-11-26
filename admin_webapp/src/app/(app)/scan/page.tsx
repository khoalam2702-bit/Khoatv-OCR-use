import ScanFrame from '../../app/ScanFrame';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quét OCR' };

/** Trang Quét OCR nằm trong Web Admin: cùng một link với Bản ghi, Tài khoản, Cài đặt AI. Địa chỉ Apps Script lấy từ GAS_WEB_APP_URL. */
export default function ScanInAdmin() {
  const url = (process.env.GAS_WEB_APP_URL || '').trim();
  const ok = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url);
  if (!ok) return <p className="text-amber-700">Chưa cấu hình địa chỉ ứng dụng. Cần đặt biến môi trường GAS_WEB_APP_URL (link Web App Apps Script dạng .../exec) trên Vercel.</p>;
  return <div style={{ position: 'relative', height: 'calc(100vh - 32px)', minHeight: 480 }}><ScanFrame url={url} embedded /></div>;
}
