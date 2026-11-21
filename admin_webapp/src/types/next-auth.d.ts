import type { Me } from '@/lib/types';

declare module 'next-auth' {
  interface Session { me: Me }
  interface User { me: Me; gasToken: string }
}
declare module 'next-auth/jwt' {
  interface JWT { me?: Me; gasToken?: string }
}
