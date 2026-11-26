import ScanFrame from './ScanFrame';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'OCR Tài liệu', robots: { index: false } };

/** Giao diện quét OCR (Apps Script) nhúng trong khung toàn màn hình, cùng domain với Web Admin. Địa chỉ lấy từ GAS_WEB_APP_URL. */
export default function ScanPage() {
  const url = (process.env.GAS_WEB_APP_URL || '').trim();
  const ok = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url);
  if (!ok) {
    return (
      <main className="grid min-h-screen place-items-center p-4">
        <p className="text-amber-700">Chưa cấu hình địa chỉ ứng dụng. Quản trị viên cần đặt biến môi trường GAS_WEB_APP_URL (link Web App Apps Script dạng .../exec) trên Vercel.</p>
      </main>
    );
  }
  return <ScanFrame url={url} />;
}
