import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`@mtk/api listening on :${port}`);
}

void bootstrap();
