import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { Providers } from '@/components/providers';
import { routing } from '@/i18n/routing';
import '../globals.css';

export const metadata: Metadata = {
  title: 'MikroTik Fleet — CafeAndResturantsSystems',
  description: 'Control panel for the managed MikroTik router fleet',
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as 'ar' | 'en')) notFound();
  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <Providers>
            <div className="flex min-h-screen">
              <Sidebar />
              <div className="min-w-0 flex-1">
                <Header />
                <main className="mx-auto max-w-6xl p-6">{children}</main>
              </div>
            </div>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
