import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = { title: 'Quản trị · Cú' };
export const dynamic = 'force-dynamic';

export default function AdminLoginPage() {
  if (process.env.ADMIN_ENABLED !== 'true') notFound();
  return (
    <main className="login-page">
      <h1>Cú · Quản trị</h1>
      <div className="card">
        <LoginForm mode="admin" />
      </div>
    </main>
  );
}
