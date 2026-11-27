'use client';
import { useState } from 'react';
import Modal from './Modal';
import ItemsEditor from './ItemsEditor';
import NumberInput from './NumberInput';
import RawViewer from './RawViewer';
import { api, errMsg } from '@/lib/api';
import { SYNC_STATUSES, type AppConfig, type DocTypeDef, type FieldDef, type ItemRow, type RecordRow } from '@/lib/types';
import { SOURCE_LABEL } from '@/lib/format';

type Draft = Record<string, unknown>;

export default function RecordModal({ type, row, cfg, onClose, onChanged }: {
  type: DocTypeDef; row: RecordRow; cfg: AppConfig; onClose: () => void; onChanged: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => { const d: Draft = {}; type.fields.forEach((f) => { d[f.k] = row[f.k]; }); return d; });
  const [status, setStatus] = useState(row.fbo_sync_status || 'PENDING');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const readOnly = !row._edit;

  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));

  async function run(fn: () => Promise<unknown>, done = true) {
    setBusy(true); setErr('');
    try { await fn(); onChanged(); if (done) onClose(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  const num = (v: unknown) => (v === null || v === undefined || v === '' || v === '-' ? null : Number(v));
  const clean = () => {
    const d: Draft = { ...draft };
    type.fields.forEach((f) => {
      if (f.type === 'number') d[f.k] = num(d[f.k]);
      if (f.type === 'items' && Array.isArray(d[f.k])) d[f.k] = (d[f.k] as ItemRow[]).map((r) => {
        const x: Record<string, unknown> = { ...r };
        cfg.itemFields.forEach((c) => { if (c.type === 'number') x[c.k] = num(x[c.k]); });
        return x;
      });
    });
    return d;
  };
  const save = () => run(() => api('updateRecord', [type.code, row._period, row.raw_file_id, clean()]));
  const del = () => { if (confirm('Xoá bản ghi này? Tệp gốc trên Drive vẫn được giữ để đối soát.')) void run(() => api('deleteRecord', [type.code, row._period, row.raw_file_id])); };
  const saveStatus = () => run(() => api('updateSyncStatus', [type.code, row._period, row.raw_file_id, status]), false);

  const input = (f: FieldDef) => {
    if (f.type === 'items') return <ItemsEditor fields={cfg.itemFields} rows={(draft[f.k] as ItemRow[] | null) || []} readOnly={readOnly} onChange={(v) => set(f.k, v)} />;
    const val = draft[f.k] === null || draft[f.k] === undefined ? '' : String(draft[f.k]);
    if (f.type === 'long') return <textarea className="input" rows={3} disabled={readOnly} value={val} onChange={(e) => set(f.k, e.target.value)} />;
    // giữ chuỗi trong lúc gõ (ví dụ "1234."), đổi sang số khi lưu
    if (f.type === 'number') return <NumberInput decimal signed disabled={readOnly} value={val} onValue={(v) => set(f.k, v === '' ? null : v)} />;
    return <input className="input" disabled={readOnly} value={val} onChange={(e) => set(f.k, e.target.value)} />;
  };

  return (
    <Modal wide title={`${type.label} · ${row.scan_timestamp}`} onClose={onClose}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Quét bởi <b>{row.scanned_by}</b> · Nguồn: {SOURCE_LABEL[row.source || ''] || row.source || '—'} · Kỳ {row._period}
            {readOnly && ' · Bạn chỉ có quyền xem bản ghi này'}
          </p>
          {err && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}
          {type.fields.map((f) => (
            <div key={f.k}>
              <label className="label">{f.label}{type.required.includes(f.k) && <span className="text-red-600"> *</span>}</label>
              {input(f)}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <label className="label !mb-0">Đồng bộ FBO</label>
            <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
              {SYNC_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <button className="btn" disabled={busy || status === (row.fbo_sync_status || 'PENDING')} onClick={saveStatus}>Cập nhật trạng thái</button>
          </div>
          <div className="flex gap-2 pt-1">
            {row._edit && <button className="btn btn-primary" disabled={busy} onClick={save}>Lưu thay đổi</button>}
            {row._del && <button className="btn btn-danger" disabled={busy} onClick={del}>Xoá bản ghi</button>}
            <button className="btn" onClick={onClose}>Đóng</button>
          </div>
        </div>
        <div><RawViewer docType={type.code} period={row._period} fileId={row.raw_file_id} /></div>
      </div>
    </Modal>
  );
}
