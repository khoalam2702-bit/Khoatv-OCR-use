import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import Nav from '@/components/Nav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.me) redirect('/login');
  if (session.me.must_change) redirect('/password');
  return (
    <>
      <Nav name={session.me.name} role={session.me.role} />
      <main className="mx-auto max-w-[1600px] p-4">{children}</main>
    </>
  );
}
