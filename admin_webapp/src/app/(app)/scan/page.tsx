import ScanEmbed from './ScanEmbed';
import { getGasUrl } from '@/lib/gasUrl';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Quét OCR' };

/** Trang Quét OCR nằm trong Web Admin: cùng một link với Bản ghi, Tài khoản, Cài đặt AI. Địa chỉ Apps Script lấy theo lib/gasUrl. */
export default async function ScanInAdmin() {
  const url = await getGasUrl();
  const ok = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url);
  if (!ok) return <p className="text-amber-700">Chưa cấu hình địa chỉ ứng dụng. Kiểm tra dòng APP_URL (link Web App dạng .../exec) trong public/index.html trên GitHub.</p>;
  return <div style={{ position: 'relative', height: 'calc(100vh - 32px)', minHeight: 480 }}><ScanEmbed url={url} /></div>;
}
