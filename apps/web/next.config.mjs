import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone output for the Docker image (infra/docker/Dockerfile.web)
  output: 'standalone',
};

export default withNextIntl(nextConfig);
