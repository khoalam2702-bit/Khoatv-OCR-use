import type { NextAuthOptions } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { gasCall } from './gas';
import type { Me } from './types';

const SESSION_SECONDS = 6 * 60 * 60; // bằng thời hạn phiên của Apps Script (CacheService tối đa 6 giờ)

/**
 * Tier 1: đăng nhập bằng chính tài khoản trong file OCR_USERS (do ADMIN tạo). Token phiên của Apps Script chỉ nằm trong
 * cookie JWT đã mã hoá, không bao giờ gửi xuống trình duyệt dưới dạng dữ liệu đọc được.
 */
export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: SESSION_SECONDS },
  jwt: { maxAge: SESSION_SECONDS },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      name: 'Tài khoản OCR',
      credentials: { username: { label: 'Tên đăng nhập', type: 'text' }, password: { label: 'Mật khẩu', type: 'password' } },
      async authorize(credentials) {
        const r = await gasCall<{ token: string; me: Me }>('login', [credentials?.username, credentials?.password]);
        return { id: r.me.username, name: r.me.name, me: r.me, gasToken: r.token };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) { token.gasToken = user.gasToken; token.me = user.me; }
      return token;
    },
    async session({ session, token }) {
      if (token.me) session.me = token.me;
      return session;
    }
  }
};
