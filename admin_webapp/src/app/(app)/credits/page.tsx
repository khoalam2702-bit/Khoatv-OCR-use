'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { api, errMsg } from '@/lib/api';
import { nf } from '@/lib/format';
import Modal from '@/components/Modal';
import type { CreditAccount, CreditAdmin, CreditHistory, CreditSettings, CreditTier } from '@/lib/types';

const STATUS: Record<CreditAccount['status'], [string, string]> = {
  HET: ['Đã hết lượt', 'bg-red-50 text-red-700'], SAP_HET: ['Sắp hết', 'bg-amber-50 text-amber-800'],
  DA_MUA: ['Đã mua', 'bg-green-50 text-green-700'], DUNG_THU: ['Đang dùng thử', 'bg-slate-100 text-slate-700']
};
const ORDER: Record<string, string> = { CHO_THU: 'Chờ thanh toán', DA_THU: 'Đã thu tiền', HUY: 'Đã huỷ' };
const KIND: Record<string, string> = { TANG: 'Tặng ban đầu', TRU: 'Dùng', MUA: 'Mua', DIEU_CHINH: 'Điều chỉnh', CHUYEN: 'Chuyển', TU_CAP: 'Tự cấp lại' };
const money = (n: number) => `${nf.format(n)}đ`;
const unit = (a: number, c: number) => (c > 0 ? `${nf.format(Math.round(a / c))}đ/lượt` : '');
const custName = (a: CreditAccount) => (a.type === 'USER' ? `${a.name}${a.fullName ? ` – ${a.fullName}` : ''}` : `${a.name}${a.contact ? ` – ${a.contact.company}` : ''}`);
const needsAttention = (a: CreditAccount) => !!a.request || a.pendingOrders > 0 || ((a.type === 'USER' || a.bought > 0) && (a.status === 'HET' || a.status === 'SAP_HET'));

type Tab = 'need' | 'all' | 'tiers' | 'settings';

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

  if (session && session.me.role !== 'ADMIN') return <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">Chỉ quản trị viên được xem trang này.</p>;

  const accounts = data?.accounts ?? [];
  const need = accounts.filter(needsAttention).sort((a, b) => Number(!!b.request) - Number(!!a.request) || b.pendingOrders - a.pendingOrders || a.remaining - b.remaining);
  const shown = (tab === 'need' ? need : accounts).filter((a) => `${custName(a)} ${a.contact?.phone ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const users = accounts.filter((a) => a.type === 'USER');
  const cards: [string, number][] = [
    ['Cần gia hạn', need.length], ['Tài khoản đã mua', users.filter((a) => a.bought > 0).length],
    ['Tài khoản đang dùng thử', users.filter((a) => a.bought === 0).length], ['Đợt chờ thanh toán', data?.pending.length ?? 0]
  ];

  async function reject(a: CreditAccount) {
    if (!a.request || !confirm(`Từ chối đề nghị của "${a.request.company}"? Thiết bị vẫn được tự cấp lại sau thời gian chờ.`)) return;
    setErr(''); setOk('');
    try { await api('creditReject', [a.request.id]); setOk('Đã từ chối đề nghị.'); } catch (e) { setErr(errMsg(e)); }
    load();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center"><h1 className="text-lg font-semibold">Lượt quét</h1><button className="btn ml-auto" onClick={() => { setErr(''); setOk(''); load(); }}>Tải lại</button></div>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}
      {ok && <p role="status" className="rounded bg-green-50 p-2 text-sm text-green-700">{ok}</p>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {cards.map(([label, n]) => <div key={label} className="rounded-lg border bg-white p-3"><div className="text-xs text-slate-500">{label}</div><div className="text-2xl font-semibold">{data ? nf.format(n) : '…'}</div></div>)}
      </div>
      <div className="flex flex-wrap gap-1">
        {([['need', `Cần gia hạn (${need.length})`], ['all', 'Tất cả tài khoản và thiết bị'], ['tiers', 'Bậc thang'], ['settings', 'Cài đặt lượt']] as [Tab, string][]).map(([k, label]) =>
          <button key={k} className={`btn ${tab === k ? 'btn-primary' : ''}`} onClick={() => setTab(k)}>{label}</button>)}
      </div>

      {(tab === 'need' || tab === 'all') && (
        <>
          <input className="input max-w-sm" placeholder="Tìm tên, công ty, số điện thoại, mã máy" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="overflow-auto rounded-lg border bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-xs text-slate-600"><tr>{['Khách hàng', 'Loại', 'Còn', 'Đã dùng', 'Đã mua', 'Tình trạng', 'Đề nghị gia hạn', ''].map((h) => <th key={h} className="px-2 py-2 text-left font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.id} className="border-t align-top">
                    <td className="px-2 py-1.5 font-medium">{custName(a)}{a.contact && <div className="text-xs font-normal text-slate-500">SĐT: {a.contact.phone}</div>}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{a.type === 'USER' ? 'Tài khoản' : 'Không đăng nhập'}</td>
                    <td className="px-2 py-1.5 font-semibold">{nf.format(a.remaining)}</td>
                    <td className="px-2 py-1.5">{nf.format(a.used)}</td>
                    <td className="px-2 py-1.5">{nf.format(a.bought)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS[a.status][1]}`}>{STATUS[a.status][0]}</span>
                      {a.pendingOrders > 0 && <div className="mt-1 text-xs text-amber-700">{a.pendingOrders} đợt chờ thanh toán</div>}
                      {a.type === 'DEVICE' && a.resetAt > 0 && <div className="mt-1 text-xs text-slate-500">Tự cấp lại: {new Date(a.resetAt).toLocaleString('vi-VN')}</div>}
                    </td>
                    <td className="px-2 py-1.5 text-xs">{a.request ? <>{a.request.company}<div className="text-slate-500">{a.request.time}</div></> : ''}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      <button className="btn btn-primary mr-1" onClick={() => { setOk(''); setTopup(a); }}>Gia hạn</button>
                      {a.request && <button className="btn mr-1" onClick={() => reject(a)}>Từ chối</button>}
                      <button className="btn" onClick={() => setDetail(a)}>Chi tiết</button>
                    </td>
                  </tr>
                ))}
                {data && !shown.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">{tab === 'need' ? 'Không có khách nào cần gia hạn.' : 'Không có dữ liệu.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === 'tiers' && data && <Tiers tiers={data.tiers} onSaved={(d) => { setData(d); setErr(''); setOk('Đã lưu bậc thang.'); }} onError={setErr} />}
      {tab === 'settings' && data && <Settings settings={data.settings} onSaved={(d) => { setData(d); setErr(''); setOk('Đã lưu cài đặt lượt.'); }} onError={setErr} />}
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
      onDone(r.result ? `${custName(account)}: còn ${r.result.before} + mua ${r.result.added} = ${r.result.after} lượt.` : `${custName(account)}: đã tạo đợt chờ thanh toán (${money(tier.amount)}), chưa cộng lượt.`);
    } catch (x) { setErr(errMsg(x)); setBusy(false); }
  }
  return (
    <Modal title={`Gia hạn: ${custName(account)}`} onClose={onClose}>
      {!tiers.length ? <p className="text-sm">Chưa khai báo bậc thang. Vào mục <b>Bậc thang</b> để thêm trước.</p> : (
        <form onSubmit={submit} className="space-y-3 text-sm">
          <fieldset className="space-y-1"><legend className="label">Chọn bậc thang</legend>
            {tiers.map((t) => <label key={t.id} className="flex gap-2"><input type="radio" name="tier" checked={t.id === tierId} onChange={() => setTierId(t.id)} />{money(t.amount)} = {nf.format(t.credits)} lượt <span className="text-slate-500">({unit(t.amount, t.credits)})</span></label>)}
          </fieldset>
          <fieldset className="space-y-1"><legend className="label">Tình trạng đóng phí</legend>
            <label className="flex gap-2"><input type="radio" name="paid" checked={paid} onChange={() => setPaid(true)} />Đã thu tiền (cộng lượt ngay)</label>
            <label className="flex gap-2"><input type="radio" name="paid" checked={!paid} onChange={() => setPaid(false)} />Chờ thanh toán (chưa cộng lượt)</label>
          </fieldset>
          {tier && <p className="rounded bg-slate-100 p-2">{paid ? `Còn ${account.remaining} + mua ${tier.credits} = ${account.remaining + tier.credits} lượt` : `Còn ${account.remaining} lượt; cộng ${tier.credits} lượt khi xác nhận đã thu tiền.`}</p>}
          {err && <p className="rounded bg-red-50 p-2 text-red-700">{err}</p>}
          <button className="btn btn-primary" disabled={busy || !tier}>{busy ? 'Đang lưu...' : 'Xác nhận gia hạn'}</button>
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
    <Modal title={`${custName(account)} · còn ${account.remaining} lượt`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        {err && <p className="rounded bg-red-50 p-2 text-red-700">{err}</p>}
        <section>
          <h3 className="mb-1 font-semibold">Các đợt gia hạn</h3>
          <div className="overflow-auto"><table className="min-w-full">
            <thead className="bg-slate-100 text-xs text-slate-600"><tr>{['Ngày tạo', 'Số tiền', 'Số lượt', 'Tình trạng', 'Ngày xử lý / người', 'Số dư', ''].map((h) => <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {hist?.orders.map((o) => (
                <tr key={o.code} className="border-t">
                  <td className="whitespace-nowrap px-2 py-1">{o.time}</td><td className="px-2 py-1">{money(o.amount)}</td><td className="px-2 py-1">{nf.format(o.credits)}</td><td className="px-2 py-1">{ORDER[o.status] ?? o.status}</td>
                  <td className="px-2 py-1 text-xs">{o.paidAt}{o.by ? ` · ${o.by}` : ''}</td><td className="px-2 py-1">{o.status === 'DA_THU' ? `${o.before} → ${o.after}` : ''}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right">{o.status === 'CHO_THU' && <>
                    <button className="btn btn-primary mr-1" disabled={busy} onClick={() => run('creditOrder', [o.code, 'PAY'], `Xác nhận đã thu ${money(o.amount)} và cộng ${o.credits} lượt?`)}>Đã thu tiền</button>
                    <button className="btn" disabled={busy} onClick={() => run('creditOrder', [o.code, 'CANCEL'], 'Huỷ đợt chưa thu tiền này?')}>Huỷ</button></>}</td>
                </tr>
              ))}
              {hist && !hist.orders.length && <tr><td colSpan={7} className="px-2 py-2 text-slate-500">Chưa có đợt nào.</td></tr>}
            </tbody>
          </table></div>
        </section>
        <section>
          <h3 className="mb-1 font-semibold">Điều chỉnh (khi cộng nhầm hoặc bù lượt)</h3>
          <form className="flex flex-wrap gap-2" onSubmit={async (e) => { e.preventDefault(); if (await run('creditAdjust', [account.id, Number(delta), reason], `Điều chỉnh ${delta} lượt cho ${custName(account)}?`)) { setDelta(''); setReason(''); } }}>
            <input type="number" step={1} required className="input w-32" placeholder="Số lượt (+/−)" value={delta} onChange={(e) => setDelta(e.target.value)} />
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
              {hist?.log.map((r, i) => <tr key={i} className="border-t"><td className="whitespace-nowrap px-2 py-1">{r.time}</td><td className="px-2 py-1">{KIND[r.kind] ?? r.kind}</td><td className="px-2 py-1">{r.amount > 0 ? `+${r.amount}` : r.amount}</td><td className="px-2 py-1">{r.balance}</td><td className="px-2 py-1">{r.by}</td><td className="px-2 py-1">{r.note}</td></tr>)}
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
    <form onSubmit={save} className="max-w-2xl space-y-2 rounded-lg border bg-white p-4 text-sm">
      <p className="text-slate-600">Áp dụng chung cho mọi khách hàng. Sửa bậc không làm thay đổi các đợt đã tạo.</p>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <input type="number" min={1000} step={1} required className="input w-40" aria-label="Số tiền (đồng)" placeholder="Số tiền (đ)" value={r.amount} onChange={(e) => set(i, 'amount', e.target.value)} />
          <input type="number" min={1} step={1} required className="input w-32" aria-label="Tổng số lượt" placeholder="Số lượt" value={r.credits} onChange={(e) => set(i, 'credits', e.target.value)} />
          <span className="w-32 text-slate-500">{unit(Number(r.amount), Number(r.credits))}</span>
          <button type="button" className="btn" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>Xoá</button>
        </div>
      ))}
      {!rows.length && <p className="text-slate-500">Chưa có bậc nào.</p>}
      <div className="flex gap-2">
        <button type="button" className="btn" disabled={rows.length >= 20} onClick={() => setRows((r) => [...r, { id: '', amount: '', credits: '' }])}>+ Thêm bậc</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Đang lưu...' : 'Lưu bậc thang'}</button>
      </div>
    </form>
  );
}

const FIELDS: [keyof CreditSettings, string, string][] = [
  ['initial', 'Lượt tặng cho tài khoản mới', 'Cấp một lần, không hết hạn. Tài khoản ADMIN không giới hạn.'],
  ['low', 'Ngưỡng báo sắp hết (lượt)', 'Còn bằng hoặc ít hơn thì vào danh sách Cần gia hạn.'],
  ['perDevice', 'Lượt dùng thử mỗi thiết bị không đăng nhập', 'Nhập 0 để tắt quét không đăng nhập.'],
  ['resetHours', 'Số giờ tự cấp lại lượt dùng thử', 'Tính từ lúc thiết bị hết lượt.'],
  ['global', 'Trần tổng số lần quét dùng thử mỗi ngày', 'Mọi thiết bị cộng lại, kể cả lần quét chưa điền. Nhập 0 để tắt.']
];
function Settings({ settings, onSaved, onError }: { settings: CreditSettings; onSaved: (d: CreditAdmin) => void; onError: (m: string) => void }) {
  const [form, setForm] = useState(() => Object.fromEntries(FIELDS.map(([k]) => [k, String(settings[k])])));
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); onError('');
    try { onSaved(await api<CreditAdmin>('creditSaveSettings', [form])); } catch (x) { onError(errMsg(x)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="max-w-2xl space-y-3 rounded-lg border bg-white p-4 text-sm">
      <p className="text-slate-600">CV tính 2 lượt, loại khác 1 lượt. Extension chỉ trừ khi điền được lên FBO; quét trên web và loại chưa có form FBO trừ khi quét xong.</p>
      {FIELDS.map(([k, label, hint]) => (
        <label key={k} className="block">{label}
          <input type="number" min={0} step={1} required className="input mt-1 max-w-xs" value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
          <span className="block text-xs text-slate-500">{hint}</span>
        </label>
      ))}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Đang lưu...' : 'Lưu cài đặt'}</button>
    </form>
  );
}
