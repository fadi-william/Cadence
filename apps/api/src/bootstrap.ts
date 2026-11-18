import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { requestContextMiddleware } from './common/context/request-context';

/** Shared HTTP setup for main.ts and the integration tests. */
export function configureApp(app: INestApplication) {
  const express = app as NestExpressApplication;
  express.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  app.enableCors({ origin: process.env.WEB_ORIGIN?.split(',') ?? 'http://localhost:4200', credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  return app;
}
