'use client';
import { useEffect, useState } from 'react';

/** Khung toàn màn hình mở ứng dụng quét OCR (Apps Script). Tải chậm quá 8 giây thì hiện nút mở trực tiếp. */
export default function ScanFrame({ url, embedded = false }: { url: string; embedded?: boolean }) {
  // embedded: nằm trong khung nội dung của Web Admin (dưới thanh menu); mặc định: phủ toàn màn hình
  const pos = embedded ? 'absolute' : 'fixed';
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setSlow(true), 8000); return () => clearTimeout(t); }, []);
  return (
    <>
      <iframe
        title="OCR Tài liệu" src={url} onLoad={() => setLoaded(true)}
        allow="camera; microphone; clipboard-write; fullscreen" referrerPolicy="no-referrer"
        style={{ position: pos, inset: 0, width: '100%', height: '100%', border: 0 }}
      />
      {!loaded && (
        <div style={{ position: pos, inset: 0, display: 'grid', placeItems: 'center', padding: 16, pointerEvents: 'none' }}>
          <div className="rounded-xl border border-slate-300 bg-white p-5 text-center" style={{ maxWidth: 380, pointerEvents: 'auto' }}>
            <h1 className="mb-1 text-lg font-bold">Quét &amp; nhận dạng tài liệu</h1>
            <p className="mb-3 text-slate-500">{slow ? 'Ứng dụng đang tải chậm. Nếu màn hình vẫn trống, hãy mở trực tiếp:' : 'Đang mở ứng dụng...'}</p>
            {slow && <a className="block rounded-lg bg-blue-600 px-3 py-2 font-bold text-white" href={url} target="_top">Mở ứng dụng ở tab mới</a>}
          </div>
        </div>
      )}
      <a href={url} target="_blank" rel="noopener"
        style={{ position: pos, right: 10, bottom: 10, zIndex: 5, padding: '5px 10px', borderRadius: 999, background: '#fff', border: '1px solid #cbd5e1', color: '#64748b', fontSize: 12, opacity: 0.75 }}>
        Mở tab mới
      </a>
    </>
  );
}
