import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { gasCall } from '@/lib/gas';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Hành động cần phiên đăng nhập: token Apps Script được thêm vào đầu danh sách tham số ở phía server. */
const AUTHED = new Set([
  'getMe', 'changeMyPassword', 'listRecords', 'getRawFile', 'updateRecord', 'deleteRecord', 'updateSyncStatus', 'logExport',
  'listUsers', 'createUser', 'updateUser', 'resetUserPassword', 'deleteUser', 'setUserAiKey',
  'getAiConfig', 'setAiConfig', 'testAiConfig',
  'getAnonConfig', 'setAnonConfig',
  'myCredit', 'creditAdmin', 'creditSaveSettings', 'creditSaveTiers', 'creditTopup', 'creditOrder', 'creditAdjust', 'creditTransfer', 'creditReject', 'creditHistory'
]);
/** Không cần phiên (cấu hình công khai, quên mật khẩu). */
const PUBLIC = new Set(['getAppConfig', 'requestPasswordReset', 'resetPasswordWithCode']);

export async function POST(req: NextRequest) {
  let body: { action?: string; args?: unknown[] };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Yêu cầu không hợp lệ.' }, { status: 400 }); }
  const action = String(body.action || '');
  const args = Array.isArray(body.args) ? body.args : [];

  try {
    if (PUBLIC.has(action)) {
      return NextResponse.json({ ok: true, data: await gasCall(action, args) });
    }
    if (!AUTHED.has(action)) return NextResponse.json({ ok: false, error: 'Hành động không hợp lệ.' }, { status: 400 });
    const jwt = await getToken({ req });
    if (!jwt?.gasToken) return NextResponse.json({ ok: false, error: 'SESSION_EXPIRED' }, { status: 401 });
    const data = await gasCall(action, [jwt.gasToken, ...args]);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Lỗi không xác định.';
    const status = msg === 'SESSION_EXPIRED' ? 401 : 200; // lỗi nghiệp vụ trả 200 + ok:false để giao diện hiện thông báo
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
