'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { api, errMsg } from '@/lib/api';

interface Slot { set: boolean; hint: string }
interface AiConfig { model: string; defaultModel: string; tier: '' | 'free' | 'paid'; main: Slot; backup: Slot; tested?: string[] }
interface TestRow { slot: string; label: string; set: boolean; hint?: string; ok?: boolean; warn?: boolean; message?: string }

export default function SettingsPage() {
  const { data } = useSession();
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [backupKey, setBackupKey] = useState('');
  const [clearBackup, setClearBackup] = useState(false);
  const [model, setModel] = useState('');
  const [tier, setTier] = useState<'' | 'free' | 'paid'>('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [rows, setRows] = useState<TestRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (c: AiConfig) => { setCfg(c); setModel(c.model); setTier(c.tier); };
  const load = useCallback(() => { api<AiConfig>('getAiConfig').then(apply).catch((e) => setErr(errMsg(e))); }, []);
  useEffect(() => { load(); }, [load]);

  if (data && data.me.role !== 'ADMIN') return <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">Chỉ quản trị viên được xem trang này.</p>;

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setOk(''); setRows(null); setBusy(true);
    try {
      const patch: Record<string, unknown> = { model, tier };
      if (apiKey.trim()) patch.apiKey = apiKey.trim();
      if (backupKey.trim()) patch.backupKey = backupKey.trim();
      else if (clearBackup) patch.clearBackup = true;
      const c = await api<AiConfig>('setAiConfig', [patch]);
      apply(c); setApiKey(''); setBackupKey(''); setClearBackup(false);
      setOk('Đã lưu cấu hình AI.' + (c.tested?.length ? ' Đã thử: ' + c.tested.join('; ') + '.' : ''));
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  async function test() {
    setErr(''); setOk(''); setBusy(true);
    try { setRows(await api<TestRow[]>('testAiConfig')); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }

  const slotText = (s: Slot) => (s.set ? `Đã khai báo (${s.hint})` : 'Chưa khai báo');
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-lg font-semibold">Cài đặt AI (Gemini)</h1>
      <div className="rounded-lg border bg-sky-50 p-3 text-sm text-sky-900">
        <p className="font-medium">Gói Google AI Pro / Ultra (đăng ký ở ứng dụng Gemini) không áp dụng cho khoá API.</p>
        <p className="mt-1">Muốn quét nhiều và ổn định: tạo khoá ở Google AI Studio (aistudio.google.com/apikey), gắn tài khoản thanh toán (Cloud Billing) cho project của khoá, rồi dán vào ô &quot;Khoá chính&quot; bên dưới. Khoá chỉ lưu trên máy chủ Apps Script, không hiện lại trên giao diện.</p>
      </div>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}
      {ok && <p className="rounded bg-green-50 p-2 text-sm text-green-700">{ok}</p>}
      <form onSubmit={save} className="space-y-3 rounded-lg border bg-white p-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-slate-500">Khoá chính</span><div className="font-medium">{cfg ? slotText(cfg.main) : '...'}</div></div>
          <div><span className="text-slate-500">Khoá dự phòng</span><div className="font-medium">{cfg ? slotText(cfg.backup) : '...'}</div></div>
        </div>
        <label className="block text-sm">Khoá chính (trả phí) — để trống nếu không đổi
          <input type="password" autoComplete="off" spellCheck={false} className="mt-1 w-full rounded border px-2 py-1.5 font-mono" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="AIza..." />
        </label>
        <label className="block text-sm">Khoá dự phòng (ví dụ khoá miễn phí) — tự dùng khi khoá chính hết hạn mức hoặc bị từ chối
          <input type="password" autoComplete="off" spellCheck={false} className="mt-1 w-full rounded border px-2 py-1.5 font-mono" value={backupKey} onChange={(e) => setBackupKey(e.target.value)} placeholder="AIza..." />
        </label>
        {cfg?.backup.set && !backupKey.trim() && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={clearBackup} onChange={(e) => setClearBackup(e.target.checked)} /> Xoá khoá dự phòng đang lưu</label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Gói của khoá chính
            <select className="mt-1 w-full rounded border px-2 py-1.5" value={tier} onChange={(e) => setTier(e.target.value as '' | 'free' | 'paid')}>
              <option value="">Chưa chọn</option><option value="paid">Trả phí</option><option value="free">Miễn phí</option>
            </select>
          </label>
          <label className="block text-sm">Model
            <input className="mt-1 w-full rounded border px-2 py-1.5 font-mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder={cfg?.defaultModel} />
          </label>
        </div>
        <p className="text-xs text-slate-500">Khi lưu, hệ thống gọi thử Gemini 1 lần với khoá mới. Khoá sai thì không lưu gì.</p>
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Đang xử lý...' : 'Kiểm tra và lưu'}</button>
          <button type="button" className="btn" disabled={busy} onClick={test}>Kiểm tra khoá đang dùng</button>
        </div>
      </form>
      {rows && (
        <ul className="space-y-1 rounded-lg border bg-white p-3 text-sm">
          {rows.map((r) => (
            <li key={r.slot} className={!r.set ? 'text-slate-500' : r.ok ? (r.warn ? 'text-amber-700' : 'text-green-700') : 'text-red-700'}>
              {r.label}: {!r.set ? 'chưa khai báo' : `${r.hint} — ${r.message}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
