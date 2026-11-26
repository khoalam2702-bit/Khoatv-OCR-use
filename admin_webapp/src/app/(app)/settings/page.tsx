'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { api, errMsg } from '@/lib/api';

interface Slot { set: boolean; hint: string; waitSec?: number }
interface AiConfig { model: string; defaultModel: string; tier: '' | 'free' | 'paid'; main: Slot; backup: Slot; backups?: Slot[]; tested?: string[] }
interface AnonConfig { perDevice: number; global: number; defaults: { perDevice: number; global: number }; today: { total: number; devices: number } }
interface TestRow { slot: string; label: string; set: boolean; hint?: string; ok?: boolean; warn?: boolean; message?: string }

/** Hạn mức quét không cần tài khoản (Extension): số lượt / ngày / thiết bị và tổng chung. 0 = tắt. */
function AnonSection() {
  const [cfg, setCfg] = useState<AnonConfig | null>(null);
  const [perDevice, setPerDevice] = useState('');
  const [global, setGlobal] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const apply = (c: AnonConfig) => { setCfg(c); setPerDevice(String(c.perDevice)); setGlobal(String(c.global)); };
  useEffect(() => { api<AnonConfig>('getAnonConfig').then(apply).catch((e) => setErr(errMsg(e))); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setOk(''); setBusy(true);
    try {
      apply(await api<AnonConfig>('setAnonConfig', [{ perDevice: perDevice.trim(), global: global.trim() }]));
      setOk('Đã lưu hạn mức quét không cần tài khoản.');
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  const off = cfg && (cfg.perDevice === 0 || cfg.global === 0);
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-lg font-semibold">Quét không cần tài khoản (Extension)</h1>
      <div className="rounded-lg border bg-sky-50 p-3 text-sm text-sky-900">
        <p>Người dùng Extension chưa có tài khoản OCR vẫn quét được để điền form FBO. Kết quả <b>không</b> lưu vào Web Admin và không lưu ảnh lên Drive; mất khi đóng trình duyệt. Mỗi lượt quét vẫn dùng hạn mức Gemini của hệ thống nên cần giới hạn.</p>
      </div>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}
      {ok && <p className="rounded bg-green-50 p-2 text-sm text-green-700">{ok}</p>}
      <form onSubmit={save} className="space-y-3 rounded-lg border bg-white p-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Số lần quét / ngày / thiết bị
            <input type="number" min={0} max={1000} step={1} className="mt-1 w-full rounded border px-2 py-1.5" value={perDevice} onChange={(e) => setPerDevice(e.target.value)} />
            <span className="text-xs text-slate-500">Mặc định {cfg?.defaults.perDevice ?? 10}. Nhập 0 để tắt.</span>
          </label>
          <label className="block text-sm">Tổng số lần quét / ngày (mọi thiết bị)
            <input type="number" min={0} max={100000} step={1} className="mt-1 w-full rounded border px-2 py-1.5" value={global} onChange={(e) => setGlobal(e.target.value)} />
            <span className="text-xs text-slate-500">Mặc định {cfg?.defaults.global ?? 500}. Chặn việc đổi mã thiết bị để lách hạn mức. Nhập 0 để tắt.</span>
          </label>
        </div>
        <p className="text-xs text-slate-600">
          Trạng thái: {cfg ? (off ? 'đang TẮT, Extension không hiện nút "Dùng không cần tài khoản".' : 'đang BẬT.') : '...'}
          {cfg && <> Hôm nay đã quét {cfg.today.total} lần từ {cfg.today.devices} thiết bị. Bộ đếm đặt lại lúc 0 giờ (giờ Việt Nam).</>}
        </p>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Đang lưu...' : 'Lưu hạn mức'}</button>
      </form>
    </div>
  );
}

export default function SettingsPage() {
  const { data } = useSession();
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [backupKeys, setBackupKeys] = useState<string[]>(['', '', '', '']);
  const [clearBackups, setClearBackups] = useState<boolean[]>([false, false, false, false]);
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
      if (backupKeys.some((k) => k.trim())) patch.backupKeys = backupKeys.map((k) => k.trim());
      const clr = clearBackups.map((c, i) => (c && !backupKeys[i].trim() ? i + 1 : 0)).filter(Boolean);
      if (clr.length) patch.clearBackups = clr;
      const c = await api<AiConfig>('setAiConfig', [patch]);
      apply(c); setApiKey(''); setBackupKeys(['', '', '', '']); setClearBackups([false, false, false, false]);
      setOk('Đã lưu cấu hình AI.' + (c.tested?.length ? ' Đã thử: ' + c.tested.join('; ') + '.' : ''));
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }
  async function test() {
    setErr(''); setOk(''); setBusy(true);
    try { setRows(await api<TestRow[]>('testAiConfig')); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  }

  const baks: Slot[] = cfg ? (cfg.backups ?? [cfg.backup]) : [];
  const setBak = (i: number, v: string) => setBackupKeys((a) => a.map((x, j) => (j === i ? v : x)));
  const setClr = (i: number, v: boolean) => setClearBackups((a) => a.map((x, j) => (j === i ? v : x)));
  const slotText = (s: Slot) => (s.set ? `Đã khai báo (${s.hint})${s.waitSec ? ` — đang tạm nghỉ ~${Math.max(1, Math.round(s.waitSec / 60))} phút (hết hạn mức/lỗi), hệ thống tự dùng khoá khác` : ''}` : 'Chưa khai báo');
  return (
    <div className="space-y-8">
    <div className="max-w-2xl space-y-4">
      <h1 className="text-lg font-semibold">Cài đặt AI (Gemini)</h1>
      <div className="rounded-lg border bg-sky-50 p-3 text-sm text-sky-900">
        <p className="font-medium">Gói Google AI Pro / Ultra (đăng ký ở ứng dụng Gemini) không áp dụng cho khoá API.</p>
        <p className="mt-1">Muốn quét nhiều và ổn định: tạo khoá ở Google AI Studio (aistudio.google.com/apikey), gắn tài khoản thanh toán (Cloud Billing) cho project của khoá, rồi dán vào ô &quot;Khoá chính&quot; bên dưới. Khoá chỉ lưu trên máy chủ Apps Script, không hiện lại trên giao diện.</p>
      </div>
      <form onSubmit={save} className="space-y-3 rounded-lg border bg-white p-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-slate-500">Khoá chính</span><div className="font-medium">{cfg ? slotText(cfg.main) : '...'}</div></div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i}><span className="text-slate-500">Khoá dự phòng {i + 1}</span><div className="font-medium">{cfg ? slotText(baks[i] ?? { set: false, hint: '' }) : '...'}</div></div>
          ))}
        </div>
        <p className="rounded bg-slate-50 p-2 text-xs text-slate-600">Thứ tự dùng: khoá chính, khi hết hạn mức (hoặc bị từ chối, lỗi máy chủ) thì lần lượt dự phòng 1, 2, 3, 4. Mỗi khoá nên tạo ở một dự án Google khác nhau để hạn mức độc lập. Ô để trống = giữ nguyên khoá đang lưu.</p>
        <label className="block text-sm">Khoá chính (trả phí) — để trống nếu không đổi
          <input type="password" autoComplete="new-password" spellCheck={false} className="mt-1 w-full rounded border px-2 py-1.5 font-mono" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={cfg?.main.set ? `Đang dùng ${cfg.main.hint}, để trống nếu không đổi` : 'AIza...'} />
        </label>
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <label className="block text-sm">Khoá dự phòng {i + 1} — để trống nếu không đổi
              <input type="password" autoComplete="new-password" spellCheck={false} className="mt-1 w-full rounded border px-2 py-1.5 font-mono" value={backupKeys[i]} onChange={(e) => setBak(i, e.target.value)} placeholder={baks[i]?.set ? `Đang dùng ${baks[i].hint}, để trống nếu không đổi` : 'AIza...'} />
            </label>
            {baks[i]?.set && !backupKeys[i].trim() && (
              <label className="mt-1 flex items-center gap-2 text-xs"><input type="checkbox" checked={clearBackups[i]} onChange={(e) => setClr(i, e.target.checked)} /> Xoá khoá dự phòng {i + 1} đang lưu</label>
            )}
          </div>
        ))}
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
        {err && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}
        {ok && <p role="status" className="rounded bg-green-50 p-2 text-sm text-green-700">{ok}</p>}
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
    <AnonSection />
    </div>
  );
}
