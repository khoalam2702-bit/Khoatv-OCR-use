import type { DocTypeDef, AppConfig, ItemRow, RecordRow } from './types';
import { itemsField } from './format';

/** Xuất Excel ngay trên trình duyệt: đúng các bản ghi đang lọc, không kèm ảnh / PDF; loại có chi tiết hàng có thêm sheet chi tiết. */
export async function exportRecords(type: DocTypeDef, rows: RecordRow[], cfg: AppConfig, fileName: string) {
  const XLSX = await import('xlsx');
  const items = itemsField(type);
  const plain = type.fields.filter((f) => f.type !== 'items');
  const head = ['Thời gian lưu', 'Người quét', 'Nguồn', 'Đồng bộ FBO', ...plain.map((f) => f.label)];
  const main = rows.map((r) => [r.scan_timestamp, r.scanned_by, r.source || '', r.fbo_sync_status || '', ...plain.map((f) => (r[f.k] === '' ? null : r[f.k]))]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...main]), type.code);

  if (items) {
    const keyField = type.fields[0];
    const dHead = [keyField.label, ...cfg.itemFields.map((f) => f.label)];
    const detail: unknown[][] = [];
    rows.forEach((r) => {
      const list = (r[items.k] as ItemRow[] | null) || [];
      list.forEach((it) => detail.push([r[keyField.k], ...cfg.itemFields.map((f) => it[f.k] ?? null)]));
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([dHead, ...detail]), 'CHI_TIET');
  }
  XLSX.writeFile(wb, fileName);
}
