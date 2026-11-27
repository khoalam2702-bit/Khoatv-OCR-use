'use client';
import { useEffect, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { nf } from '@/lib/format';
import type { CreditReport } from '@/lib/types';

const money = (n: number) => `${nf.format(Math.round(n))}đ`;
function Cards({ items }: { items: [string, string, string?][] }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {items.map(([label, value, hint]) => (
        <div key={label} className="rounded-lg border bg-white p-3">
          <div className="text-xs text-slate-500">{label}</div><div className="text-xl font-semibold">{value}</div>
          {hint && <div className="text-xs text-slate-500">{hint}</div>}
        </div>
      ))}
    </div>
  );
}
function Table({ heads, rows, empty }: { heads: string[]; rows: React.ReactNode[][]; empty: string }) {
  return (
    <div className="max-h-[32rem] overflow-auto rounded-lg border bg-white">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 bg-slate-100 text-xs text-slate-600"><tr>{heads.map((h) => <th key={h} className="px-2 py-2 text-left font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i} className="border-t">{r.map((c, j) => <td key={j} className="whitespace-nowrap px-2 py-1.5">{c}</td>)}</tr>)}
          {!rows.length && <tr><td colSpan={heads.length} className="px-3 py-6 text-center text-slate-500">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

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
          ['Tài khoản khách', nf.format(c.users), 'không tính ADMIN'], ['Đã mua lượt', nf.format(c.bought)], ['Chưa mua (đang dùng thử)', nf.format(c.trial)], ['Đã hết lượt', nf.format(c.out)],
          ['Sắp hết lượt', nf.format(c.low)], ['Không dùng 30 ngày', nf.format(c.idle)], ['Máy không đăng nhập', nf.format(c.devices)], ['Máy đã chặn dùng thử', nf.format(c.devicesBlocked)]
        ]} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={idleOnly} onChange={(e) => setIdleOnly(e.target.checked)} />Chỉ xem tài khoản không dùng 30 ngày</label>
        <Table heads={['Khách hàng', 'Loại', 'Đã thu', 'Lượt đã dùng', 'Lần quét', 'Chi phí AI (ước tính)', 'Dùng gần nhất']} empty="Chưa có dữ liệu."
          rows={list.map((x) => [x.name, x.type === 'USER' ? 'Tài khoản' : 'Không đăng nhập', money(x.collected), nf.format(x.used), nf.format(x.scans), money(x.cost), x.last || 'chưa dùng'])} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Cards items={[
        ['Tiền đã thu', money(t.collected)], ['Chờ thu', money(t.pendingAmount), `${t.pendingCount} đợt`], ['Chi phí AI (ước tính)', money(t.cost)], ['Thu trừ chi phí AI', money(t.collected - t.cost)],
        ['Lượt đã bán', nf.format(t.sold)], ['Lượt đã dùng (tính tiền)', nf.format(t.used)], ['Lượt đã bán chưa dùng', nf.format(t.owed), 'còn nợ khách'], ['Chi phí AI mỗi lượt đã dùng', t.used ? money(t.cost / t.used) : '–']
      ]} />
      <Table heads={['Tháng', 'Đã thu', 'Lượt bán', 'Lượt dùng', 'Lần quét', 'Token vào', 'Token ra', 'Chi phí AI', 'Thu trừ chi phí']} empty="Chưa có dữ liệu."
        rows={data.months.map((m) => [m.month, money(m.collected), nf.format(m.sold), nf.format(m.used), nf.format(m.scans), nf.format(m.tokensIn), nf.format(m.tokensOut), money(m.cost), money(m.collected - m.cost)])} />
      <p className="text-xs text-slate-500">Chi phí là ước tính theo đơn giá token và tỷ giá ở mục Cài đặt lượt (một đơn giá cho mọi model), chưa gồm lượt quét trước khi bật ghi token. Đối chiếu với hoá đơn Google để lấy số thật.</p>
    </div>
  );
}
