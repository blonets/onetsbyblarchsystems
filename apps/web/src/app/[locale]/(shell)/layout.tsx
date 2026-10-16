import { setRequestLocale } from 'next-intl/server';
import { AuthGuard } from '@/components/auth-guard';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';

export default async function ShellLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <Header />
          <main className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
