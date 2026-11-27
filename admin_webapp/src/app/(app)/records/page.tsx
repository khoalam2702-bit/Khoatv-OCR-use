'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { fmtCell, monthStart, rowKey, SOURCE_LABEL, today } from '@/lib/format';
import { exportRecords } from '@/lib/exportXlsx';
import RecordModal from '@/components/RecordModal';
import { Badge, PageTitle, type Tone } from '@/components/ui';
import { AlertTriangle, CheckCircle2, Clock, Database, FileSpreadsheet, RefreshCw } from 'lucide-react';
import type { AppConfig, ListResult, RecordRow } from '@/lib/types';

const SYNC: Record<string, [Tone, typeof Clock]> = { PENDING: ['amber', Clock], FILLED: ['green', CheckCircle2], ERROR: ['red', AlertTriangle] };
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();

export default function RecordsPage() {
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [code, setCode] = useState('CCCD');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [res, setRes] = useState<ListResult | null>(null);
  const [q, setQ] = useState('');
  const [sync, setSync] = useState('');
  const [sel, setSel] = useState<RecordRow | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { api<AppConfig>('getAppConfig').then(setCfg).catch((e) => setErr(errMsg(e))); }, []);
  const type = useMemo(() => cfg?.types.find((t) => t.code === code), [cfg, code]);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setRes(await api<ListResult>('listRecords', [code, from, to])); } catch (e) { setErr(errMsg(e)); setRes(null); } finally { setLoading(false); }
  }, [code, from, to]);
  useEffect(() => { if (cfg) void load(); }, [cfg, load]);

  const rows = useMemo(() => {
    if (!res || !type) return [];
    const needle = norm(q.trim());
    return res.rows.filter((r) => (!sync || (r.fbo_sync_status || 'PENDING') === sync) &&
      (!needle || norm([r.scanned_by, ...type.fields.filter((f) => f.type !== 'items').map((f) => String(r[f.k] ?? ''))].join(' ')).includes(needle)));
  }, [res, q, sync, type]);

  async function doExport() {
    if (!type || !cfg) return;
    try {
      await exportRecords(type, rows, cfg, `${code}_${from}_${to}.xlsx`);
      await api('logExport', [code, from, to, rows.length]).catch(() => undefined);
    } catch (e) { setErr(errMsg(e)); }
  }

  const cols = type?.fields || [];
  return (
    <div className="space-y-3">
      <PageTitle icon={Database} title="Bản ghi" />
      <div className="card flex flex-wrap items-end gap-3 p-3">
        <div><label className="label">Loại tài liệu</label>
          <select className="input" value={code} onChange={(e) => setCode(e.target.value)}>{cfg?.types.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</select></div>
        <div><label className="label">Từ ngày</label><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">Đến ngày</label><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div><label className="label">Đồng bộ FBO</label>
          <select className="input" value={sync} onChange={(e) => setSync(e.target.value)}><option value="">Tất cả</option><option>PENDING</option><option>FILLED</option><option>ERROR</option></select></div>
        <div className="min-w-[200px] flex-1"><label className="label">Lọc chữ (không phân biệt hoa thường, dấu)</label><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên, số, nơi…" /></div>
        <button className="btn" onClick={() => void load()} disabled={loading}><RefreshCw size={15} aria-hidden />{loading ? 'Đang tải…' : 'Tải lại'}</button>
        <button className="btn btn-primary" onClick={() => void doExport()} disabled={!rows.length}><FileSpreadsheet size={15} aria-hidden />Xuất Excel</button>
      </div>

      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}
      {res?.truncated && <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">Chỉ hiển thị {res.rows.length}/{res.total} bản ghi mới nhất. Hãy thu hẹp khoảng ngày.</p>}
      <p className="text-sm text-slate-500">{rows.length} bản ghi{res && !res.viewAll ? ' (chỉ bản ghi của bạn)' : ''}</p>

      <div className="overflow-auto rounded-lg border bg-white">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-slate-100 text-xs text-slate-600">
            <tr>
              {['Thời gian lưu', 'Người quét', 'Nguồn', 'FBO', ...cols.map((f) => f.label)].map((h) => <th key={h} className="whitespace-nowrap px-2 py-2 text-left font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} className="cursor-pointer border-t hover:bg-blue-50" onClick={() => setSel(r)}>
                <td className="whitespace-nowrap px-2 py-1.5">{r.scan_timestamp}</td>
                <td className="px-2 py-1.5">{r.scanned_by}</td>
                <td className="px-2 py-1.5">{SOURCE_LABEL[r.source || ''] || r.source || ''}</td>
                <td className="px-2 py-1.5"><Badge tone={(SYNC[r.fbo_sync_status || 'PENDING'] ?? SYNC.PENDING)[0]} icon={(SYNC[r.fbo_sync_status || 'PENDING'] ?? SYNC.PENDING)[1]}>{r.fbo_sync_status || 'PENDING'}</Badge></td>
                {cols.map((f) => <td key={f.k} className={`max-w-[260px] truncate px-2 py-1.5 ${f.type === 'number' ? 'text-right' : ''}`} title={fmtCell(f, r[f.k])}>{fmtCell(f, r[f.k])}</td>)}
              </tr>
            ))}
            {!rows.length && !loading && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={4 + cols.length}>Không có bản ghi</td></tr>}
          </tbody>
        </table>
      </div>

      {sel && type && cfg && <RecordModal key={rowKey(sel)} type={type} row={sel} cfg={cfg} onClose={() => setSel(null)} onChanged={() => void load()} />}
    </div>
  );
}
