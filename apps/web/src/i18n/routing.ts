import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ar', 'en'],
  // Arabic is the default locale and the dashboard is RTL-first.
  defaultLocale: 'ar',
  localePrefix: 'always',
});
