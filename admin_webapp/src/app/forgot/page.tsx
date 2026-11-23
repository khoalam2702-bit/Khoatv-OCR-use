'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, errMsg } from '@/lib/api';

export default function ForgotPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function request(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api<{ message?: string } | string>('requestPasswordReset', [username]); setMsg(typeof r === 'string' ? r : r?.message || 'Nếu tài khoản có email, mã 6 số đã được gửi.'); setStep(2); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  async function reset(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api('resetPasswordWithCode', [username, code, pw]); setMsg('Đã đặt lại mật khẩu. Bạn có thể đăng nhập.'); setStep(1); setCode(''); setPw(''); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={step === 1 ? request : reset} className="w-full max-w-sm space-y-4 rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Quên mật khẩu</h1>
        {msg && <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-800">{msg}</p>}
        {err && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        <div><label className="label">Tên đăng nhập</label><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required /></div>
        {step === 2 && <>
          <div><label className="label">Mã 6 số trong email</label><input className="input" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} required /></div>
          <div><label className="label">Mật khẩu mới (tối thiểu 8 ký tự)</label><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required /></div>
        </>}
        <button className="btn btn-primary w-full" disabled={busy}>{step === 1 ? 'Gửi mã về email' : 'Đặt lại mật khẩu'}</button>
        {step === 1 && msg && <button type="button" className="btn w-full" onClick={() => setStep(2)}>Tôi đã có mã</button>}
        <p className="text-center text-sm"><Link href="/login" className="text-blue-600 hover:underline">Về trang đăng nhập</Link></p>
      </form>
    </main>
  );
}
