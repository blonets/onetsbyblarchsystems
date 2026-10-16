'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const { login, isMock } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      router.replace('/');
    } catch {
      setError(t('loginFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-xl font-black text-slate-950">
            M
          </div>
          <div>
            <p className="text-lg font-bold">MikroTik Fleet</p>
            <p className="text-xs text-slate-400">{t('subtitle')}</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{t('title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <Field label={t('email')}>
                <Input
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@fleet.local"
                />
              </Field>
              <Field label={t('password')}>
                <Input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              {error && (
                <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
              )}
              <Button type="submit" size="lg" disabled={busy}>
                {busy ? t('signingIn') : t('signIn')}
              </Button>
              {isMock && (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-300">
                  {t('mockHint')}
                </p>
              )}
            </form>
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-[11px] text-slate-600">{tCommon('demoBanner')}</p>
      </div>
    </div>
  );
}
