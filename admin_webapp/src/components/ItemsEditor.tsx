'use client';
import NumberInput from './NumberInput';
import type { FieldDef, ItemRow } from '@/lib/types';

export default function ItemsEditor({ fields, rows, onChange, readOnly }: { fields: FieldDef[]; rows: ItemRow[]; onChange: (rows: ItemRow[]) => void; readOnly: boolean }) {
  // ô số giữ chuỗi trong lúc gõ; RecordModal đổi sang số khi lưu
  const set = (i: number, k: string, v: string | null) => {
    const next = rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) as ItemRow[];
    onChange(next);
  };
  return (
    <div className="overflow-x-auto rounded border">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600">
          <tr>{fields.map((f) => <th key={f.k} className="px-2 py-1 text-left font-medium">{f.label}</th>)}{!readOnly && <th />}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              {fields.map((f) => (
                <td key={f.k} className="px-1 py-1">
                  {f.type === 'number'
                    ? <NumberInput decimal signed disabled={readOnly} value={r[f.k] === null || r[f.k] === undefined ? '' : String(r[f.k])} onValue={(v) => set(i, f.k, v === '' ? null : v)} />
                    : <input className="input" disabled={readOnly} value={r[f.k] === null || r[f.k] === undefined ? '' : String(r[f.k])} onChange={(e) => set(i, f.k, e.target.value)} />}
                </td>
              ))}
              {!readOnly && <td className="px-1"><button type="button" className="text-red-600" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Xoá dòng">✕</button></td>}
            </tr>
          ))}
          {!rows.length && <tr><td className="px-2 py-2 text-slate-400" colSpan={fields.length + 1}>Không có dòng nào</td></tr>}
        </tbody>
      </table>
      {!readOnly && <div className="border-t p-1"><button type="button" className="btn" onClick={() => onChange([...rows, {}])}>+ Thêm dòng</button></div>}
    </div>
  );
}
