'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { api, errMsg } from '@/lib/api';
import { nf } from '@/lib/format';
import Modal from '@/components/Modal';
import NumberInput from '@/components/NumberInput';
import { Badge, PageTitle, StatCard, TONE, type Tone } from '@/components/ui';
import { AlertTriangle, BarChart3, BellRing, CheckCircle2, Clock, Coins, Eye, Hourglass, Layers, ListChecks, Lock, Monitor, Plus, RefreshCw, Save, Settings as SettingsIcon, ShoppingBag, Sparkles, Trash2, User, Users, X, XCircle, type LucideIcon } from 'lucide-react';
import Report from './Report';
import type { CreditAccount, CreditAdmin, CreditHistory, CreditSettings, CreditTier } from '@/lib/types';

const STATUS: Record<CreditAccount['status'], [string, Tone, LucideIcon]> = {
  HET: ['Đã hết lượt', 'red', XCircle], SAP_HET: ['Sắp hết', 'amber', AlertTriangle],
  DA_MUA: ['Đã mua', 'green', CheckCircle2], DUNG_THU: ['Đang dùng thử', 'sky', Sparkles]
};
const ORDER: Record<string, [string, Tone, LucideIcon]> = { CHO_THU: ['Chờ thanh toán', 'amber', Clock], DA_THU: ['Đã thu tiền', 'green', CheckCircle2], HUY: ['Đã huỷ', 'slate', XCircle] };
const KIND_TONE: Record<string, Tone> = { TANG: 'sky', TRU: 'slate', MUA: 'green', DIEU_CHINH: 'amber', CHUYEN: 'violet', TU_CAP: 'blue' };
const signed = (n: number) => `${n > 0 ? '+' : ''}${nf.format(n)}`;
const KIND: Record<string, string> = { TANG: 'Tặng ban đầu', TRU: 'Dùng', MUA: 'Mua', DIEU_CHINH: 'Điều chỉnh', CHUYEN: 'Chuyển', TU_CAP: 'Tự cấp lại' };
const money = (n: number) => `${nf.format(n)}đ`;
const unit = (a: number, c: number) => (c > 0 ? `${nf.format(Math.round(a / c))}đ/lượt` : '');
const custName = (a: CreditAccount) => (a.type === 'USER' ? `${a.name}${a.fullName ? ` – ${a.fullName}` : ''}` : `${a.name}${a.contact ? ` – ${a.contact.company}` : ''}`);
const needsAttention = (a: CreditAccount) => !!a.request || a.pendingOrders > 0 || ((a.type === 'USER' || a.bought > 0) && (a.status === 'HET' || a.status === 'SAP_HET'));

type Tab = 'need' | 'all' | 'customers' | 'money' | 'tiers' | 'settings';

export default function CreditsPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<CreditAdmin | null>(null);
  const [tab, setTab] = useState<Tab>('need');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [topup, setTopup] = useState<CreditAccount | null>(null);
  const [detail, setDetail] = useState<CreditAccount | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(() => api<CreditAdmin>('creditAdmin').then(setData).catch((e) => setErr(errMsg(e))), []);
  useEffect(() => { load(); }, [load]);
  // thông báo thành công tự ẩn; lỗi giữ lại đến khi đóng
  useEffect(() => { if (!ok) return; const t = setTimeout(() => setOk(''), 8000); return () => clearTimeout(t); }, [ok]);

  if (session && session.me.role !== 'ADMIN') return <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">Chỉ quản trị viên được xem trang này.</p>;

  const accounts = data?.accounts ?? [];
  const need = accounts.filter(needsAttention).sort((a, b) => Number(!!b.request) - Number(!!a.request) || b.pendingOrders - a.pendingOrders || a.remaining - b.remaining);
  const shown = (tab === 'need' ? need : accounts).filter((a) => `${custName(a)} ${a.contact?.phone ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const users = accounts.filter((a) => a.type === 'USER');
  const cards: [string, number, LucideIcon, Tone][] = [
    ['Cần gia hạn', need.length, BellRing, 'red'], ['Tài khoản đã mua', users.filter((a) => a.bought > 0).length, ShoppingBag, 'green'],
    ['Tài khoản đang dùng thử', users.filter((a) => a.bought === 0).length, Sparkles, 'sky'], ['Đợt chờ thanh toán', data?.pending.length ?? 0, Hourglass, 'amber']
  ];
  const tabs: [Tab, string, LucideIcon][] = [['need', 'Cần gia hạn', BellRing], ['all', 'Tất cả tài khoản và thiết bị', ListChecks], ['customers', 'Khách hàng', Users], ['money', 'Doanh thu và chi phí', BarChart3], ['tiers', 'Bậc thang', Layers], ['settings', 'Cài đặt lượt', SettingsIcon]];

  async function reject(a: CreditAccount) {
    if (!a.request || !confirm(`Từ chối đề nghị của "${a.request.company}"? Thiết bị vẫn được tự cấp lại sau thời gian chờ.`)) return;
    setErr(''); setOk('');
    try { await api('creditReject', [a.request.id]); setOk('Đã từ chối đề nghị.'); } catch (e) { setErr(errMsg(e)); }
    load();
  }

  return (
    <div className="space-y-3">
      <PageTitle icon={Coins} title="Lượt quét">
        <button className="btn" onClick={() => { setErr(''); setOk(''); load(); }}><RefreshCw size={15} aria-hidden />Tải lại</button>
      </PageTitle>
      {/* Thông báo nổi: nút Lưu thường nằm cuối trang nên thông báo ở đầu trang sẽ bị khuất */}
      <div className="fixed bottom-4 right-4 z-[60] flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-2 text-sm">
        {err && <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-red-800 shadow-lg"><XCircle size={18} className="shrink-0" aria-hidden /><span className="flex-1">{err}</span><button aria-label="Đóng thông báo" onClick={() => setErr('')}><X size={16} aria-hidden /></button></p>}
        {ok && <p role="status" className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-900 shadow-lg"><CheckCircle2 size={18} className="shrink-0" aria-hidden /><span className="flex-1">{ok}</span><button aria-label="Đóng thông báo" onClick={() => setOk('')}><X size={16} aria-hidden /></button></p>}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(([label, n, icon, tone]) => <StatCard key={label} label={label} value={data ? nf.format(n) : '…'} icon={icon} tone={tone} />)}
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            <Icon size={16} aria-hidden />{label}
            {k === 'need' && need.length > 0 && <span className="rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">{nf.format(need.length)}</span>}
          </button>
        ))}
      </div>

      {(tab === 'need' || tab === 'all') && (
        <>
          <input className="input max-w-sm" placeholder="Tìm tên, công ty, số điện thoại, mã máy" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="card overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="thead"><tr>
                <th className="th">Khách hàng</th><th className="th-num">Còn</th><th className="th-num">Đã dùng</th><th className="th-num">Đã mua</th><th className="th">Tình trạng</th><th className="th">Đề nghị gia hạn</th><th className="th" />
              </tr></thead>
              <tbody>
                {shown.map((a) => {
                  const [label, tone, icon] = STATUS[a.status];
                  const TypeIcon = a.type === 'USER' ? User : Monitor;
                  return (
                    <tr key={a.id} className="row align-top">
                      <td className={`td min-w-[13rem] border-l-4 font-medium ${TONE[a.request ? 'violet' : tone].bar}`}>
                        {custName(a)}
                        <div className="flex items-center gap-1 text-xs font-normal text-slate-500"><TypeIcon size={13} aria-hidden />{a.type === 'USER' ? 'Tài khoản' : 'Không đăng nhập'}{a.contact && ` · SĐT: ${a.contact.phone}`}</div>
                      </td>
                      <td className={`td-num text-base font-bold ${TONE[tone].text}`}>{nf.format(a.remaining)}</td>
                      <td className="td-num">{nf.format(a.used)}</td>
                      <td className="td-num">{nf.format(a.bought)}</td>
                      <td className="td space-y-1">
                        <Badge tone={tone} icon={icon}>{label}</Badge>
                        {a.blocked && <div><Badge tone="slate" icon={Lock}>Đã đăng nhập: chặn dùng thử</Badge></div>}
                        {a.pendingOrders > 0 && <div><Badge tone="amber" icon={Clock}>{nf.format(a.pendingOrders)} đợt chờ thanh toán</Badge></div>}
                        {a.type === 'DEVICE' && a.resetAt > 0 && <div className="text-xs text-slate-500">Tự cấp lại: {new Date(a.resetAt).toLocaleString('vi-VN')}</div>}
                      </td>
                      <td className="td text-xs">{a.request ? <><Badge tone="violet" icon={BellRing}>{a.request.company}</Badge><div className="mt-1 text-slate-500">{a.request.time}</div></> : ''}</td>
                      <td className="td whitespace-nowrap text-right">
                        <button className="btn btn-primary mr-1" onClick={() => { setOk(''); setTopup(a); }}><Plus size={15} aria-hidden />Gia hạn</button>
                        {a.request && <button className="btn btn-outline-danger mr-1 !px-2" title="Từ chối đề nghị" aria-label="Từ chối đề nghị" onClick={() => reject(a)}><X size={16} aria-hidden /></button>}
                        <button className="btn !px-2" title="Chi tiết, lịch sử" aria-label="Chi tiết" onClick={() => setDetail(a)}><Eye size={16} aria-hidden /></button>
                      </td>
                    </tr>
                  );
                })}
                {data && !shown.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500"><CheckCircle2 size={26} className="mx-auto mb-1 text-emerald-500" aria-hidden />{tab === 'need' ? 'Không có khách nào cần gia hạn.' : 'Không có dữ liệu.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
      {(tab === 'customers' || tab === 'money') && <Report key={tab} view={tab} />}
      {tab === 'tiers' && data && <Tiers tiers={data.tiers} onSaved={(d) => { setData(d); setErr(''); setOk('Đã lưu bậc thang.'); }} onError={setErr} />}
      {tab === 'settings' && data && <Settings settings={data.settings} onSaved={(d) => { setData(d); setErr(''); setOk('Đã lưu cài đặt lượt.'); }} onError={(m) => { setErr(m); if (m) setOk(''); }} />}
      {topup && data && <TopupModal account={topup} tiers={data.tiers} onClose={() => setTopup(null)} onDone={(m) => { setTopup(null); setErr(''); setOk(m); load(); }} />}
      {detail && data && <DetailModal account={accounts.find((a) => a.id === detail.id) ?? detail} accounts={accounts} onClose={() => setDetail(null)} onChanged={load} />}
    </div>
  );
}

function TopupModal({ account, tiers, onClose, onDone }: { account: CreditAccount; tiers: CreditTier[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [tierId, setTierId] = useState(tiers[0]?.id ?? '');
  const [paid, setPaid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const tier = tiers.find((t) => t.id === tierId);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!tier) return;
    setBusy(true); setErr('');
    try {
      const r = await api<{ paid: boolean; result: { before: number; added: number; after: number } | null }>('creditTopup', [account.id, tier.id, paid]);
      onDone(r.result ? `${custName(account)}: còn ${nf.format(r.result.before)} + mua ${nf.format(r.result.added)} = ${nf.format(r.result.after)} lượt.` : `${custName(account)}: đã tạo đợt chờ thanh toán (${money(tier.amount)}), chưa cộng lượt.`);
    } catch (x) { setErr(errMsg(x)); setBusy(false); }
  }
  return (
    <Modal title={`Gia hạn: ${custName(account)}`} onClose={onClose}>
      {!tiers.length ? <p className="text-sm">Chưa khai báo bậc thang. Vào mục <b>Bậc thang</b> để thêm trước.</p> : (
        <form onSubmit={submit} className="space-y-3 text-sm">
          <fieldset className="space-y-1"><legend className="label">Chọn bậc thang</legend>
            {tiers.map((t) => (
              <label key={t.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 tabular-nums ${t.id === tierId ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input type="radio" name="tier" checked={t.id === tierId} onChange={() => setTierId(t.id)} />
                <b className="w-28 text-right">{money(t.amount)}</b><span className="flex-1">{nf.format(t.credits)} lượt</span><span className="text-xs text-slate-500">{unit(t.amount, t.credits)}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="space-y-1"><legend className="label">Tình trạng đóng phí</legend>
            <label className="flex gap-2"><input type="radio" name="paid" checked={paid} onChange={() => setPaid(true)} />Đã thu tiền (cộng lượt ngay)</label>
            <label className="flex gap-2"><input type="radio" name="paid" checked={!paid} onChange={() => setPaid(false)} />Chờ thanh toán (chưa cộng lượt)</label>
          </fieldset>
          {tier && <p className={`rounded-lg p-2 font-medium ${paid ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{paid ? `Còn ${nf.format(account.remaining)} + mua ${nf.format(tier.credits)} = ${nf.format(account.remaining + tier.credits)} lượt` : `Còn ${nf.format(account.remaining)} lượt; cộng ${nf.format(tier.credits)} lượt khi xác nhận đã thu tiền.`}</p>}
          {err && <p className="rounded bg-red-50 p-2 text-red-700">{err}</p>}
          <button className="btn btn-primary" disabled={busy || !tier}><CheckCircle2 size={15} aria-hidden />{busy ? 'Đang lưu...' : 'Xác nhận gia hạn'}</button>
        </form>
      )}
    </Modal>
  );
}

function DetailModal({ account, accounts, onClose, onChanged }: { account: CreditAccount; accounts: CreditAccount[]; onClose: () => void; onChanged: () => void }) {
  const [hist, setHist] = useState<CreditHistory | null>(null);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [to, setTo] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<CreditHistory>('creditHistory', [account.id]).then(setHist).catch((e) => setErr(errMsg(e))), [account.id]);
  useEffect(() => { load(); }, [load]);

  async function run(action: string, args: unknown[], question?: string) {
    if (question && !confirm(question)) return false;
    setBusy(true); setErr('');
    let done = false;
    try { await api(action, args); done = true; } catch (x) { setErr(errMsg(x)); }
    await load(); onChanged(); setBusy(false);
    return done;
  }

  return (
    <Modal title={`${custName(account)} · còn ${nf.format(account.remaining)} lượt`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        {err && <p className="rounded bg-red-50 p-2 text-red-700">{err}</p>}
        <section>
          <h3 className="mb-1 font-semibold">Các đợt gia hạn</h3>
          <div className="overflow-auto"><table className="min-w-full">
            <thead className="bg-slate-100 text-xs text-slate-600"><tr>{['Ngày tạo', 'Số tiền', 'Số lượt', 'Tình trạng', 'Ngày xử lý / người', 'Số dư', ''].map((h) => <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {hist?.orders.map((o) => (
                <tr key={o.code} className="border-t">
                  <td className="whitespace-nowrap px-2 py-1">{o.time}</td><td className="px-2 py-1">{money(o.amount)}</td><td className="px-2 py-1">{nf.format(o.credits)}</td><td className="px-2 py-1">{ORDER[o.status] ? <Badge tone={ORDER[o.status][1]} icon={ORDER[o.status][2]}>{ORDER[o.status][0]}</Badge> : o.status}</td>
                  <td className="px-2 py-1 text-xs">{o.paidAt}{o.by ? ` · ${o.by}` : ''}</td><td className="px-2 py-1">{o.status === 'DA_THU' ? `${nf.format(Number(o.before))} → ${nf.format(Number(o.after))}` : ''}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right">{o.status === 'CHO_THU' && <>
                    <button className="btn btn-success mr-1" disabled={busy} onClick={() => run('creditOrder', [o.code, 'PAY'], `Xác nhận đã thu ${money(o.amount)} và cộng ${nf.format(o.credits)} lượt?`)}>Đã thu tiền</button>
                    <button className="btn btn-outline-danger" disabled={busy} onClick={() => run('creditOrder', [o.code, 'CANCEL'], 'Huỷ đợt chưa thu tiền này?')}>Huỷ</button></>}</td>
                </tr>
              ))}
              {hist && !hist.orders.length && <tr><td colSpan={7} className="px-2 py-2 text-slate-500">Chưa có đợt nào.</td></tr>}
            </tbody>
          </table></div>
        </section>
        <section>
          <h3 className="mb-1 font-semibold">Điều chỉnh (khi cộng nhầm hoặc bù lượt)</h3>
          <form className="flex flex-wrap gap-2" onSubmit={async (e) => { e.preventDefault(); if (await run('creditAdjust', [account.id, Number(delta), reason], `Điều chỉnh ${signed(Number(delta))} lượt cho ${custName(account)}?`)) { setDelta(''); setReason(''); } }}>
            <NumberInput signed required className="input !w-32" placeholder="Số lượt (+/−)" value={delta} onValue={setDelta} />
            <input required maxLength={200} className="input min-w-[16rem] flex-1" placeholder="Lý do" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button className="btn" disabled={busy}>Điều chỉnh</button>
          </form>
        </section>
        {account.type === 'DEVICE' && account.bought > 0 && (
          <section>
            <h3 className="mb-1 font-semibold">Chuyển lượt đã mua (khách cài lại extension hoặc có tài khoản)</h3>
            <div className="flex flex-wrap gap-2">
              <select className="input max-w-sm" value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Chọn nơi nhận</option>
                {accounts.filter((a) => a.id !== account.id).map((a) => <option key={a.id} value={a.id}>{a.type === 'USER' ? 'Tài khoản ' : 'Máy '}{custName(a)}</option>)}
              </select>
              <button className="btn" disabled={busy || !to} onClick={() => run('creditTransfer', [account.id, to], 'Chuyển toàn bộ lượt đã mua còn lại của máy này sang nơi đã chọn?')}>Chuyển lượt</button>
            </div>
          </section>
        )}
        <section>
          <h3 className="mb-1 font-semibold">Nhật ký lượt (không sửa, xoá được)</h3>
          <div className="max-h-72 overflow-auto"><table className="min-w-full">
            <thead className="bg-slate-100 text-xs text-slate-600"><tr>{['Thời gian', 'Loại', 'Số lượt', 'Số dư', 'Người thực hiện', 'Ghi chú'].map((h) => <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {hist?.log.map((r, i) => <tr key={i} className="border-t"><td className="whitespace-nowrap px-2 py-1">{r.time}</td><td className="px-2 py-1"><Badge tone={KIND_TONE[r.kind] ?? 'slate'}>{KIND[r.kind] ?? r.kind}</Badge></td><td className={`px-2 py-1 font-semibold tabular-nums ${r.amount > 0 ? 'text-emerald-700' : r.amount < 0 ? 'text-red-700' : ''}`}>{signed(r.amount)}</td><td className="px-2 py-1 tabular-nums">{nf.format(r.balance)}</td><td className="px-2 py-1">{r.by}</td><td className="px-2 py-1">{r.note}</td></tr>)}
              {hist && !hist.log.length && <tr><td colSpan={6} className="px-2 py-2 text-slate-500">Chưa có phát sinh.</td></tr>}
            </tbody>
          </table></div>
        </section>
      </div>
    </Modal>
  );
}

function Tiers({ tiers, onSaved, onError }: { tiers: CreditTier[]; onSaved: (d: CreditAdmin) => void; onError: (m: string) => void }) {
  const toRows = (t: CreditTier[]) => t.map((x) => ({ id: x.id, amount: String(x.amount), credits: String(x.credits) }));
  const [rows, setRows] = useState(() => toRows(tiers));
  const [busy, setBusy] = useState(false);
  const set = (i: number, k: 'amount' | 'credits', v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); onError('');
    try {
      const d = await api<CreditAdmin>('creditSaveTiers', [rows.map((r) => ({ id: r.id, amount: Number(r.amount), credits: Number(r.credits) }))]);
      setRows(toRows(d.tiers)); onSaved(d);
    } catch (x) { onError(errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="card max-w-2xl space-y-2 p-4 text-sm">
      <p className="text-slate-600">Áp dụng chung cho mọi khách hàng. Sửa bậc không làm thay đổi các đợt đã tạo. Chưa bấm Lưu lần nào thì đang dùng 6 bậc đề xuất.</p>
      <div className="grid grid-cols-[3.5rem_1fr_1fr_8rem_2.5rem] items-center gap-2">
        {['Bậc', 'Số tiền (đ)', 'Tổng số lượt', 'Đơn giá', ''].map((h, i) => <span key={i} className={`text-xs font-semibold text-slate-500 ${i > 0 && i < 4 ? 'text-right' : ''}`}>{h}</span>)}
        {rows.map((r, i) => (
          <Fragment key={i}>
            <span className="inline-flex items-center gap-1 font-semibold text-blue-700"><Layers size={14} aria-hidden />{i + 1}</span>
            <NumberInput required aria-label={`Số tiền bậc ${i + 1}`} value={r.amount} onValue={(v) => set(i, 'amount', v)} />
            <NumberInput required aria-label={`Số lượt bậc ${i + 1}`} value={r.credits} onValue={(v) => set(i, 'credits', v)} />
            <span className="text-right tabular-nums text-slate-600">{unit(Number(r.amount), Number(r.credits))}</span>
            <button type="button" className="btn btn-outline-danger !px-2" aria-label={`Xoá bậc ${i + 1}`} title="Xoá bậc" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><Trash2 size={15} aria-hidden /></button>
          </Fragment>
        ))}
      </div>
      {!rows.length && <p className="text-slate-500">Chưa có bậc nào.</p>}
      <div className="flex gap-2 pt-1">
        <button type="button" className="btn" disabled={rows.length >= 20} onClick={() => setRows((r) => [...r, { id: '', amount: '', credits: '' }])}><Plus size={15} aria-hidden />Thêm bậc</button>
        <button className="btn btn-primary" disabled={busy}><Save size={15} aria-hidden />{busy ? 'Đang lưu...' : 'Lưu bậc thang'}</button>
      </div>
    </form>
  );
}

type NumKey = 'initial' | 'low' | 'perDevice' | 'resetHours' | 'global' | 'priceIn' | 'priceOut' | 'usdRate';
const FIELDS: [NumKey, string, string][] = [
  ['initial', 'Lượt tặng cho tài khoản mới', 'Cấp một lần, không hết hạn. Tài khoản ADMIN không giới hạn.'],
  ['low', 'Ngưỡng báo sắp hết (lượt)', 'Còn bằng hoặc ít hơn thì vào danh sách Cần gia hạn.'],
  ['perDevice', 'Lượt dùng thử mỗi thiết bị không đăng nhập', 'Nhập 0 để tắt quét không đăng nhập.'],
  ['resetHours', 'Số giờ tự cấp lại lượt dùng thử', 'Tính từ lúc thiết bị hết lượt.'],
  ['global', 'Trần tổng số lần quét dùng thử mỗi ngày', 'Mọi thiết bị cộng lại, kể cả lần quét chưa điền. Nhập 0 để tắt.'],
  ['priceIn', 'Giá token vào (USD / 1 triệu token)', 'Theo bảng giá Gemini hiện hành; chỉ dùng để ước tính chi phí.'],
  ['priceOut', 'Giá token ra (USD / 1 triệu token)', 'Gồm cả token suy luận.'],
  ['usdRate', 'Tỷ giá (đồng / USD)', 'Dùng để quy chi phí ra đồng.']
];
const DECIMAL: NumKey[] = ['priceIn', 'priceOut'];
function Settings({ settings, onSaved, onError }: { settings: CreditSettings; onSaved: (d: CreditAdmin) => void; onError: (m: string) => void }) {
  const [form, setForm] = useState(() => Object.fromEntries(FIELDS.map(([k]) => [k, String(settings[k])])));
  const [busy, setBusy] = useState(false);
  const [blockTrial, setBlockTrial] = useState(settings.blockTrial);
  const [trialKey, setTrialKey] = useState(settings.trialKey);
  const [trialApiKey, setTrialApiKey] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); onError('');
    try {
      onSaved(await api<CreditAdmin>('creditSaveSettings', [{ ...form, blockTrial, trialKey, trialApiKey: trialApiKey.trim() }]));
      setTrialApiKey('');
    } catch (x) { onError(errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="card max-w-2xl space-y-3 p-4 text-sm">
      <p className="text-slate-600">CV tính 2 lượt, loại khác 1 lượt. Extension chỉ trừ khi điền được lên FBO; quét trên web và loại chưa có form FBO trừ khi quét xong.</p>
      {FIELDS.map(([k, label, hint]) => (
        <label key={k} className="block">{label}
          <NumberInput decimal={DECIMAL.includes(k)} required className="input mt-1 block max-w-xs" value={form[k]} onValue={(v) => setForm((f) => ({ ...f, [k]: v }))} />
          <span className="block text-xs text-slate-500">{hint}</span>
        </label>
      ))}
      <label className="flex gap-2"><input type="checkbox" checked={blockTrial} onChange={(e) => setBlockTrial(e.target.checked)} />
        <span>Máy đã đăng nhập tài khoản OCR thì không được dùng thử nữa<span className="block text-xs text-slate-500">Đăng nhập bằng ADMIN không khoá máy. Lượt đã mua cho máy vẫn dùng được.</span></span></label>
      <fieldset className="space-y-1 border-t pt-3"><legend className="label">Khoá Gemini cho lượt dùng thử (máy không đăng nhập và tài khoản chưa mua)</legend>
        <label className="flex gap-2"><input type="radio" name="trialKey" checked={trialKey === 'paid'} onChange={() => setTrialKey('paid')} />Khoá chung (trả phí)</label>
        <label className="flex gap-2"><input type="radio" name="trialKey" checked={trialKey === 'free'} onChange={() => setTrialKey('free')} />Khoá riêng miễn phí {settings.trialKeyHint && <span className="text-slate-500">(đang lưu {settings.trialKeyHint})</span>}</label>
        <input type="password" autoComplete="off" className="input max-w-md" placeholder={settings.trialKeyHint ? 'Nhập khoá mới nếu muốn đổi' : 'Dán khoá miễn phí'} value={trialApiKey} onChange={(e) => setTrialApiKey(e.target.value)} />
        <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">Với gói miễn phí, Google được phép dùng dữ liệu gửi lên để cải thiện sản phẩm. Hồ sơ có CCCD, CV là dữ liệu cá nhân: cân nhắc trước khi chọn. Hạn mức miễn phí thấp, hết hạn mức thì lượt dùng thử báo lỗi (không tự chuyển sang khoá trả phí).</p>
      </fieldset>
      <button className="btn btn-primary" disabled={busy}><Save size={15} aria-hidden />{busy ? 'Đang lưu...' : 'Lưu cài đặt'}</button>
    </form>
  );
}
