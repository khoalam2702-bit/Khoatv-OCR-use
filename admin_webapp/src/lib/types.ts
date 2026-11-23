export type PermKey = 'perm_add' | 'perm_edit_own' | 'perm_edit_other' | 'perm_del_own' | 'perm_del_other';
export const PERM_LABELS: Record<PermKey, string> = {
  perm_add: 'Thêm bản ghi',
  perm_edit_own: 'Sửa bản ghi của mình',
  perm_edit_other: 'Sửa bản ghi của người khác',
  perm_del_own: 'Xoá bản ghi của mình',
  perm_del_other: 'Xoá bản ghi của người khác'
};
export const PERM_KEYS = Object.keys(PERM_LABELS) as PermKey[];

export interface Me {
  username: string;
  name: string;
  role: 'ADMIN' | 'USER';
  perms: Record<PermKey, boolean>;
  must_change: boolean;
}

export interface FieldDef { k: string; label: string; type: 'string' | 'long' | 'number' | 'items' | 'date'; money?: boolean; afterItems?: boolean }
export interface DocTypeDef { code: string; label: string; required: string[]; fields: FieldDef[] }
export interface AppConfig { types: DocTypeDef[]; itemFields: FieldDef[] }

export type ItemRow = Record<string, string | number | null>;
export type RecordRow = Record<string, unknown> & {
  raw_file_id: string; scan_timestamp: string; scanned_by: string; source?: string; fbo_sync_status?: string;
  _period: string; _edit: boolean; _del: boolean;
};
export interface ListResult { rows: RecordRow[]; viewAll: boolean; truncated: boolean; total: number; from: string; to: string }
export interface RawFiles { files: { mimeType?: string; name: string; base64?: string; error?: string }[] }

export interface UserLite {
  username: string; full_name: string; email: string; role: 'ADMIN' | 'USER'; active: boolean; must_change: boolean;
  perms: Record<PermKey, boolean>;
}

export const SYNC_STATUSES = ['PENDING', 'FILLED', 'ERROR'] as const;
