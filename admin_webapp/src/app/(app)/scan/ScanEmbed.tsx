'use client';
import { useEffect, useRef, useState } from 'react';
import ScanFrame from '../../app/ScanFrame';
import { api } from '@/lib/api';

/** Mở khung quét kèm mã đăng nhập một lần để không phải đăng nhập lần hai. Không lấy được mã thì mở như thường. */
export default function ScanEmbed({ url }: { url: string }) {
  const [src, setSrc] = useState('');
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // mã chỉ dùng một lần, không xin hai lần
    started.current = true;
    api<{ code: string }>('createWebHandoff')
      .then((r) => setSrc(`${url}?embed=1&h=${encodeURIComponent(r.code)}`))
      .catch(() => setSrc(`${url}?embed=1`));
  }, [url]);
  if (!src) return <p className="p-4 text-sm text-slate-500">Đang mở trang quét…</p>;
  // "Mở tab mới" không mang theo mã (mã đã dùng trong khung)
  return <ScanFrame url={src} newTabUrl={url} embedded />;
}
