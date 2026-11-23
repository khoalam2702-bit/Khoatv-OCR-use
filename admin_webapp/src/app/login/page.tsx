'use client';
import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(sp.get('expired') ? 'Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.' : sp.get('changed') ? 'Đã đổi mật khẩu. Hãy đăng nhập bằng mật khẩu mới.' : '');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    const r = await signIn('credentials', { username, password, redirect: false });
    setBusy(false);
    if (!r || r.error) { setErr(r?.error && r.error !== 'CredentialsSignin' ? r.error : 'Sai tên đăng nhập hoặc mật khẩu.'); return; }
    router.push('/records');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold">Đăng nhập OCR Admin</h1>
      {err && <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{err}</p>}
      <div><label className="label">Tên đăng nhập</label><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required /></div>
      <div><label className="label">Mật khẩu</label><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
      <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
      <p className="text-center text-sm"><Link href="/forgot" className="text-blue-600 hover:underline">Quên mật khẩu?</Link></p>
    </form>
  );
}

export default function LoginPage() {
  return <main className="flex min-h-screen items-center justify-center p-4"><Suspense><LoginForm /></Suspense></main>;
}
