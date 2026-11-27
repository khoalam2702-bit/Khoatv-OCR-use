'use client';
import { signOut } from 'next-auth/react';

export class ApiError extends Error {}

/** Gọi Apps Script qua /api/gas (server thêm token phiên). Hết phiên thì tự đăng xuất; bắt đổi mật khẩu thì chuyển trang. */
export async function api<T>(action: string, args: unknown[] = []): Promise<T> {
  const res = await fetch('/api/gas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, args })
  });
  const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: string } | null;
  if (res.status === 401 || j?.error === 'SESSION_EXPIRED') {
    void signOut({ callbackUrl: '/login?expired=1' });
    throw new ApiError('Phiên đăng nhập đã hết hạn.');
  }
  if (j?.error === 'MUST_CHANGE_PASSWORD') {
    window.location.href = '/password';
    throw new ApiError('Cần đổi mật khẩu trước khi tiếp tục.');
  }
  if (!j?.ok) throw new ApiError((j?.error || 'Không kết nối được máy chủ.').replace(/\s*\[\[[A-Z_]+(:\d+)?\]\]/g, '')); // bỏ dấu hiệu nội bộ của máy chủ
  return j.data as T;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không xác định.');
