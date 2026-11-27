'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';

/** Thanh menu dọc bên trái (màn hình nhỏ: xếp thành dải ngang phía trên). */
export default function Nav({ name, role }: { name: string; role: 'ADMIN' | 'USER' }) {
  const path = usePathname();
  const item = (href: string, label: string) => (
    <Link href={href} className={`block whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${path.startsWith(href) ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</Link>
  );
  return (
    <aside className="z-40 flex w-full shrink-0 flex-col gap-2 border-b bg-white p-3 md:sticky md:top-0 md:h-screen md:w-52 md:border-b-0 md:border-r">
      <span className="px-3 py-1 text-base font-semibold">OCR Admin</span>
      <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {item('/scan', 'Quét OCR')}
        {item('/records', 'Bản ghi')}
        {role === 'ADMIN' && item('/users', 'Tài khoản')}
        {role === 'ADMIN' && item('/credits', 'Lượt quét')}
        {role === 'ADMIN' && item('/settings', 'Cài đặt AI')}
      </nav>
      <div className="mt-auto flex flex-col gap-2 border-t pt-3">
        <span className="px-1 text-sm text-slate-500">{name} · {role}</span>
        <Link href="/password" className="btn text-center">Mật khẩu</Link>
        <button className="btn" onClick={() => signOut({ callbackUrl: '/login' })}>Đăng xuất</button>
      </div>
    </aside>
  );
}
