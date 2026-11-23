'use client';
import { useEffect, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import type { RawFiles } from '@/lib/types';

/** Xem lại ảnh / PDF gốc của bản ghi (Apps Script trả base64, hiển thị ngay không cần quyền vào Drive). */
export default function RawViewer({ docType, period, fileId }: { docType: string; period: string; fileId: string }) {
  const [files, setFiles] = useState<RawFiles['files']>([]);
  const [idx, setIdx] = useState(0);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr('');
    api<RawFiles>('getRawFile', [docType, period, fileId])
      .then((r) => { if (alive) setFiles(r.files); })
      .catch((e) => { if (alive) setErr(errMsg(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [docType, period, fileId]);

  if (loading) return <p className="text-sm text-slate-500">Đang tải tệp gốc…</p>;
  if (err) return <p className="rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>;
  const f = files[idx];
  return (
    <div className="space-y-2">
      {files.length > 1 && (
        <div className="flex gap-1">{files.map((x, i) => (
          <button key={i} type="button" className={`btn ${i === idx ? 'btn-primary' : ''}`} onClick={() => setIdx(i)}>Tệp {i + 1}/{files.length}</button>
        ))}</div>
      )}
      {!f ? null : f.error ? <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">{f.error}</p>
        : f.mimeType === 'application/pdf'
          ? <iframe title={f.name} className="h-[70vh] w-full rounded border" src={`data:application/pdf;base64,${f.base64}`} />
          // eslint-disable-next-line @next/next/no-img-element
          : <img alt={f.name} className="max-h-[70vh] w-full rounded border bg-slate-100 object-contain" src={`data:${f.mimeType};base64,${f.base64}`} />}
    </div>
  );
}
