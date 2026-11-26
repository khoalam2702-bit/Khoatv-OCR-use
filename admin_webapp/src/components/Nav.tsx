'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';

export default function Nav({ name, role }: { name: string; role: 'ADMIN' | 'USER' }) {
  const path = usePathname();
  const item = (href: string, label: string) => (
    <Link href={href} className={`rounded-md px-3 py-1.5 text-sm font-medium ${path.startsWith(href) ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</Link>
  );
  return (
    <header className="sticky top-0 z-40 border-b bg-white">
      <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-4 py-2">
        <span className="mr-4 text-base font-semibold">OCR Admin</span>
        {item('/scan', 'Quét OCR')}
        {item('/records', 'Bản ghi')}
        {role === 'ADMIN' && item('/users', 'Tài khoản')}
        {role === 'ADMIN' && item('/settings', 'Cài đặt AI')}
        <span className="ml-auto text-sm text-slate-500">{name} · {role}</span>
        <Link href="/password" className="btn">Mật khẩu</Link>
        <button className="btn" onClick={() => signOut({ callbackUrl: '/login' })}>Đăng xuất</button>
      </div>
    </header>
  );
}
