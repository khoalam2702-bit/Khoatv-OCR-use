'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { api, errMsg } from '@/lib/api';
import Modal from '@/components/Modal';
import { PERM_KEYS, PERM_LABELS, type PermKey, type UserLite } from '@/lib/types';

interface Form { username: string; full_name: string; email: string; role: 'ADMIN' | 'USER'; password: string; active: boolean; perms: Record<PermKey, boolean> }
const emptyPerms = (): Record<PermKey, boolean> => ({ perm_add: true, perm_edit_own: true, perm_edit_other: false, perm_del_own: false, perm_del_other: false });

export default function UsersPage() {
  const { data } = useSession();
  const [users, setUsers] = useState<UserLite[]>([]);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<{ isNew: boolean; f: Form } | null>(null);
  const [temp, setTemp] = useState<{ username: string; password: string } | null>(null);

  const load = useCallback(() => { api<UserLite[]>('listUsers').then(setUsers).catch((e) => setErr(errMsg(e))); }, []);
  useEffect(() => { load(); }, [load]);

  if (data && data.me.role !== 'ADMIN') return <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">Chỉ quản trị viên được xem trang này.</p>;

  const open = (u?: UserLite) => setEdit(u
    ? { isNew: false, f: { username: u.username, full_name: u.full_name, email: u.email, role: u.role, password: '', active: u.active, perms: { ...u.perms } } }
    : { isNew: true, f: { username: '', full_name: '', email: '', role: 'USER', password: '', active: true, perms: emptyPerms() } });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    const { f, isNew } = edit;
    setErr('');
    try {
      if (isNew) await api('createUser', [{ username: f.username, full_name: f.full_name, email: f.email, role: f.role, password: f.password, perms: f.perms }]);
      else await api('updateUser', [f.username, { full_name: f.full_name, email: f.email, role: f.role, active: f.active, perms: f.perms }]);
      setEdit(null); load();
    } catch (x) { setErr(errMsg(x)); }
  }
  async function resetPw(u: UserLite) {
    if (!confirm(`Cấp mật khẩu tạm cho "${u.username}"? Mật khẩu cũ bị vô hiệu và các phiên đang mở bị đăng xuất.`)) return;
    try { setTemp(await api('resetUserPassword', [u.username])); load(); } catch (x) { setErr(errMsg(x)); }
  }
  async function remove(u: UserLite) {
    if (!confirm(`Xoá tài khoản "${u.username}"? Các bản ghi OCR đã quét vẫn được giữ.`)) return;
    try { await api('deleteUser', [u.username]); load(); } catch (x) { setErr(errMsg(x)); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center"><h1 className="text-lg font-semibold">Tài khoản</h1><button className="btn btn-primary ml-auto" onClick={() => open()}>+ Tạo tài khoản</button></div>
      {err && !edit && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}
      <div className="overflow-auto rounded-lg border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-xs text-slate-600"><tr>{['Tên đăng nhập', 'Họ tên', 'Email', 'Vai trò', 'Trạng thái', 'Quyền', ''].map((h) => <th key={h} className="px-2 py-2 text-left font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.username} className="border-t">
                <td className="px-2 py-1.5 font-medium">{u.username}</td><td className="px-2 py-1.5">{u.full_name}</td><td className="px-2 py-1.5">{u.email}</td>
                <td className="px-2 py-1.5">{u.role}</td>
                <td className="px-2 py-1.5">{u.active ? 'Hoạt động' : 'Đã khoá'}{u.must_change ? ' · chờ đổi mật khẩu' : ''}</td>
                <td className="px-2 py-1.5 text-xs text-slate-600">{u.role === 'ADMIN' ? 'Toàn quyền' : PERM_KEYS.filter((k) => u.perms[k]).map((k) => PERM_LABELS[k]).join('; ') || 'Không có'}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right">
                  <button className="btn mr-1" onClick={() => open(u)}>Sửa</button>
                  {u.username !== data?.me.username && <><button className="btn mr-1" onClick={() => void resetPw(u)}>Cấp MK tạm</button><button className="btn" onClick={() => void remove(u)}>Xoá</button></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <Modal title={edit.isNew ? 'Tạo tài khoản' : `Sửa ${edit.f.username}`} onClose={() => setEdit(null)}>
          <form onSubmit={submit} className="space-y-3">
            {err && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}
            {edit.isNew && <div><label className="label">Tên đăng nhập (chữ thường không dấu, số, . _ -)</label><input className="input" value={edit.f.username} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, username: e.target.value } })} required /></div>}
            <div><label className="label">Họ tên</label><input className="input" value={edit.f.full_name} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, full_name: e.target.value } })} /></div>
            <div><label className="label">Email (dùng để gửi mã quên mật khẩu)</label><input className="input" type="email" value={edit.f.email} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, email: e.target.value } })} /></div>
            {edit.isNew && <div><label className="label">Mật khẩu ban đầu (người dùng phải đổi khi đăng nhập lần đầu)</label><input className="input" type="text" value={edit.f.password} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, password: e.target.value } })} required minLength={8} /></div>}
            <div className="flex gap-3">
              <div className="flex-1"><label className="label">Vai trò</label>
                <select className="input" value={edit.f.role} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, role: e.target.value as 'ADMIN' | 'USER' } })}><option>USER</option><option>ADMIN</option></select></div>
              {!edit.isNew && <label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.f.active} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, active: e.target.checked } })} />Đang hoạt động</label>}
            </div>
            {edit.f.role === 'USER' && (
              <fieldset className="space-y-1 rounded border p-3"><legend className="px-1 text-xs text-slate-600">Quyền trên bản ghi OCR</legend>
                {PERM_KEYS.map((k) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.f.perms[k]} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, perms: { ...edit.f.perms, [k]: e.target.checked } } })} />{PERM_LABELS[k]}</label>)}
              </fieldset>
            )}
            <div className="flex gap-2"><button className="btn btn-primary">Lưu</button><button type="button" className="btn" onClick={() => setEdit(null)}>Huỷ</button></div>
          </form>
        </Modal>
      )}

      {temp && (
        <Modal title="Mật khẩu tạm" onClose={() => setTemp(null)}>
          <p className="text-sm">Tài khoản <b>{temp.username}</b>. Mật khẩu chỉ hiện <b>một lần</b>, hãy sao chép ngay:</p>
          <p className="my-3 select-all rounded bg-slate-100 p-3 text-center font-mono text-lg">{temp.password}</p>
          <button className="btn btn-primary" onClick={() => setTemp(null)}>Đã sao chép</button>
        </Modal>
      )}
    </div>
  );
}
