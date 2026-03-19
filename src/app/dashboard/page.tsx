import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import LogoutButton from './LogoutButton';

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <main style={{ maxWidth: 600, margin: '80px auto', padding: '0 16px' }}>
      <h1>控制台</h1>
      <p>欢迎，{session.email}</p>
      <LogoutButton />
    </main>
  );
}
