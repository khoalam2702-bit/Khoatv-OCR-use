import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import Nav from '@/components/Nav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.me) redirect('/login');
  if (session.me.must_change) redirect('/password');
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Nav name={session.me.name} role={session.me.role} />
      <main className="min-w-0 flex-1 p-4">{children}</main>
    </div>
  );
}
