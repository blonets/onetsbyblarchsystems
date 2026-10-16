import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { getCorsOptions } from './common/cors.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Accept both `/api/v1/*` (web UI HttpApiClient & router onboarding scripts)
  // and unprefixed `/*` (internal worker & healthcheck) routes.
  app.use((req: { url: string }, _res: unknown, next: () => void) => {
    if (req.url === '/api/v1') req.url = '/';
    else if (req.url.startsWith('/api/v1/')) req.url = req.url.slice('/api/v1'.length);
    next();
  });
  // CORS allowlist is env-driven (CORS_ORIGINS); the production panel host
  // https://admin.onetsbyblarch.online must be listed or the web UI's REST
  // and Socket.IO calls are blocked.
  app.enableCors(getCorsOptions());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`@mtk/api listening on :${port}`);
}

void bootstrap();
