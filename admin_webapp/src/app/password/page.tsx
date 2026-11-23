'use client';
import { useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import Link from 'next/link';
import { api, errMsg } from '@/lib/api';

export default function PasswordPage() {
  const { data } = useSession();
  const forced = data?.me?.must_change;
  const [oldPw, setOldPw] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (pw !== pw2) { setErr('Hai ô mật khẩu mới không khớp.'); return; }
    setBusy(true);
    try {
      await api('changeMyPassword', [oldPw, pw]);
      // Apps Script đã huỷ phiên cũ: đăng nhập lại bằng mật khẩu mới
      await signOut({ callbackUrl: '/login?changed=1' });
    } catch (x) { setErr(errMsg(x)); setBusy(false); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Đổi mật khẩu</h1>
        {forced && <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">Bạn cần đổi mật khẩu trước khi dùng hệ thống.</p>}
        {err && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <div><label className="label">Mật khẩu hiện tại</label><input className="input" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" required /></div>
        <div><label className="label">Mật khẩu mới (tối thiểu 8 ký tự)</label><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required /></div>
        <div><label className="label">Nhập lại mật khẩu mới</label><input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required /></div>
        <button className="btn btn-primary w-full" disabled={busy}>Đổi mật khẩu</button>
        {!forced && <p className="text-center text-sm"><Link href="/records" className="text-blue-600 hover:underline">Quay lại</Link></p>}
      </form>
    </main>
  );
}
