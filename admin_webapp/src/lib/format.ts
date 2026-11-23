import type { DocTypeDef, FieldDef, RecordRow } from './types';

export const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 });

export function fmtCell(f: FieldDef, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (f.type === 'items') return Array.isArray(v) ? `${v.length} dòng` : '';
  if (f.type === 'number' && typeof v === 'number') return nf.format(v);
  return String(v);
}

export const today = () => new Date().toISOString().slice(0, 10);
export const monthStart = () => today().slice(0, 8) + '01';

export const SOURCE_LABEL: Record<string, string> = { WEB_APP: 'Web', EXTENSION: 'Extension' };

export function itemsField(type: DocTypeDef): FieldDef | undefined { return type.fields.find((f) => f.type === 'items'); }

export function rowKey(r: RecordRow) { return `${r._period}|${r.raw_file_id}`; }
