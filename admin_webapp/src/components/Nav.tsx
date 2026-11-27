'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Coins, Database, KeyRound, LogOut, ScanLine, ScanText, Sparkles, Users, type LucideIcon } from 'lucide-react';

/** Thanh menu dọc bên trái (màn hình nhỏ: xếp thành dải ngang phía trên). */
export default function Nav({ name, role }: { name: string; role: 'ADMIN' | 'USER' }) {
  const path = usePathname();
  const item = (href: string, label: string, Icon: LucideIcon) => {
    const on = path.startsWith(href);
    return (
      <Link href={href} aria-current={on ? 'page' : undefined} className={`flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${on ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>
        <Icon size={18} aria-hidden />{label}
      </Link>
    );
  };
  return (
    <aside className="z-40 flex w-full shrink-0 flex-col gap-3 border-b bg-white p-3 md:sticky md:top-0 md:h-screen md:w-56 md:border-b-0 md:border-r">
      <span className="flex items-center gap-2 px-1 py-1 text-base font-bold">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 text-white"><ScanText size={18} aria-hidden /></span>OCR Admin
      </span>
      <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {item('/scan', 'Quét OCR', ScanLine)}
        {item('/records', 'Bản ghi', Database)}
        {role === 'ADMIN' && item('/users', 'Tài khoản', Users)}
        {role === 'ADMIN' && item('/credits', 'Lượt quét', Coins)}
        {role === 'ADMIN' && item('/settings', 'Cài đặt AI', Sparkles)}
      </nav>
      <div className="mt-auto flex flex-col gap-2 border-t pt-3">
        <span className="flex items-center gap-2 px-1 text-sm">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-200 font-semibold uppercase text-slate-600">{name.slice(0, 1)}</span>
          <span className="min-w-0"><span className="block truncate font-medium">{name}</span><span className={`text-xs font-semibold ${role === 'ADMIN' ? 'text-amber-600' : 'text-slate-500'}`}>{role}</span></span>
        </span>
        <Link href="/password" className="btn"><KeyRound size={15} aria-hidden />Mật khẩu</Link>
        <button className="btn" onClick={() => signOut({ callbackUrl: '/login' })}><LogOut size={15} aria-hidden />Đăng xuất</button>
      </div>
    </aside>
  );
}
