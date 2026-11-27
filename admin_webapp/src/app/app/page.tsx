import ScanFrame from './ScanFrame';
import { getGasUrl } from '@/lib/gasUrl';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'OCR Tài liệu', robots: { index: false } };

/** Giao diện quét OCR (Apps Script) nhúng trong khung toàn màn hình, cùng domain với Web Admin. Địa chỉ lấy theo lib/gasUrl. */
export default async function ScanPage() {
  const url = await getGasUrl();
  const ok = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url);
  if (!ok) {
    return (
      <main className="grid min-h-screen place-items-center p-4">
        <p className="text-amber-700">Chưa cấu hình địa chỉ ứng dụng. Quản trị viên kiểm tra dòng APP_URL (link Web App dạng .../exec) trong public/index.html trên GitHub.</p>
      </main>
    );
  }
  return <ScanFrame url={url} />;
}
