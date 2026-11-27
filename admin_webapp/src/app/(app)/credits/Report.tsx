'use client';
import { useEffect, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { nf } from '@/lib/format';
import { StatCard, type Tone } from '@/components/ui';
import { AlertTriangle, Banknote, Calculator, Clock, Coins, Cpu, Lock, Monitor, Moon, PiggyBank, ShoppingBag, Sparkles, TrendingUp, User, Users, Wallet, XCircle, type LucideIcon } from 'lucide-react';
import type { CreditReport } from '@/lib/types';

const money = (n: number) => `${nf.format(Math.round(n))}đ`;
type Card = [string, string, LucideIcon, Tone, string?];
function Cards({ items }: { items: Card[] }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{items.map(([label, value, icon, tone, hint]) => <StatCard key={label} label={label} value={value} icon={icon} tone={tone} hint={hint} />)}</div>;
}
/** Cột số (từ cột `numFrom` đến `numTo`) canh phải. */
function Table({ heads, rows, empty, numFrom, numTo }: { heads: string[]; rows: React.ReactNode[][]; empty: string; numFrom: number; numTo: number }) {
  const num = (i: number) => i >= numFrom && i <= numTo;
  return (
    <div className="card max-h-[32rem] overflow-auto">
      <table className="min-w-full text-sm">
        <thead className="thead sticky top-0"><tr>{heads.map((h, i) => <th key={h} className={num(i) ? 'th-num' : 'th'}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i} className="row">{r.map((c, j) => <td key={j} className={num(j) ? 'td-num' : 'td whitespace-nowrap'}>{c}</td>)}</tr>)}
          {!rows.length && <tr><td colSpan={heads.length} className="px-3 py-6 text-center text-slate-500">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
const gain = (n: number) => <span className={n < 0 ? 'font-semibold text-red-700' : 'font-semibold text-emerald-700'}>{money(n)}</span>;

export default function Report({ view }: { view: 'customers' | 'money' }) {
  const [data, setData] = useState<CreditReport | null>(null);
  const [err, setErr] = useState('');
  const [idleOnly, setIdleOnly] = useState(false);
  useEffect(() => { api<CreditReport>('creditReport').then(setData).catch((e) => setErr(errMsg(e))); }, []);
  if (err) return <p className="rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>;
  if (!data) return <p className="text-sm text-slate-500">Đang tải số liệu…</p>;
  const { customers: c, totals: t } = data;

  if (view === 'customers') {
    const list = data.list.filter((x) => !idleOnly || (x.type === 'USER' && x.idle));
    return (
      <div className="space-y-3">
        <Cards items={[
          ['Tài khoản khách', nf.format(c.users), Users, 'blue', 'không tính ADMIN'], ['Đã mua lượt', nf.format(c.bought), ShoppingBag, 'green'], ['Chưa mua (đang dùng thử)', nf.format(c.trial), Sparkles, 'sky'], ['Đã hết lượt', nf.format(c.out), XCircle, 'red'],
          ['Sắp hết lượt', nf.format(c.low), AlertTriangle, 'amber'], ['Không dùng 30 ngày', nf.format(c.idle), Moon, 'slate'], ['Máy không đăng nhập', nf.format(c.devices), Monitor, 'violet'], ['Máy đã chặn dùng thử', nf.format(c.devicesBlocked), Lock, 'slate']
        ]} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={idleOnly} onChange={(e) => setIdleOnly(e.target.checked)} />Chỉ xem tài khoản không dùng 30 ngày</label>
        <Table numFrom={2} numTo={5} heads={['Khách hàng', 'Loại', 'Đã thu', 'Lượt đã dùng', 'Lần quét', 'Chi phí AI (ước tính)', 'Dùng gần nhất']} empty="Chưa có dữ liệu."
          rows={list.map((x) => [x.name, <span key="t" className="inline-flex items-center gap-1.5 text-slate-600">{x.type === 'USER' ? <User size={14} aria-hidden /> : <Monitor size={14} aria-hidden />}{x.type === 'USER' ? 'Tài khoản' : 'Không đăng nhập'}</span>, money(x.collected), nf.format(x.used), nf.format(x.scans), money(x.cost), x.last || 'chưa dùng'])} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Cards items={[
        ['Tiền đã thu', money(t.collected), Banknote, 'green'], ['Chờ thu', money(t.pendingAmount), Clock, 'amber', `${nf.format(t.pendingCount)} đợt`], ['Chi phí AI (ước tính)', money(t.cost), Cpu, 'red'], ['Thu trừ chi phí AI', money(t.collected - t.cost), TrendingUp, t.collected - t.cost < 0 ? 'red' : 'blue'],
        ['Lượt đã bán', nf.format(t.sold), Coins, 'violet'], ['Lượt đã dùng (tính tiền)', nf.format(t.used), Wallet, 'sky'], ['Lượt đã bán chưa dùng', nf.format(t.owed), PiggyBank, 'slate', 'còn nợ khách'], ['Chi phí AI mỗi lượt đã dùng', t.used ? money(t.cost / t.used) : '–', Calculator, 'slate']
      ]} />
      <Table numFrom={1} numTo={8} heads={['Tháng', 'Đã thu', 'Lượt bán', 'Lượt dùng', 'Lần quét', 'Token vào', 'Token ra', 'Chi phí AI', 'Thu trừ chi phí']} empty="Chưa có dữ liệu."
        rows={data.months.map((m) => [m.month, money(m.collected), nf.format(m.sold), nf.format(m.used), nf.format(m.scans), nf.format(m.tokensIn), nf.format(m.tokensOut), money(m.cost), gain(m.collected - m.cost)])} />
      <p className="text-xs text-slate-500">Chi phí là ước tính theo đơn giá token và tỷ giá ở mục Cài đặt lượt (một đơn giá cho mọi model), chưa gồm lượt quét trước khi bật ghi token. Đối chiếu với hoá đơn Google để lấy số thật.</p>
    </div>
  );
}
