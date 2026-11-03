import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

export function isolateE2eRateLimitClient(app: INestApplication): void {
  const expressApp = app.getHttpAdapter().getInstance() as {
    set(name: string, value: number): void;
  };
  expressApp.set('trust proxy', 1);
  const clientIp = `e2e-${randomUUID()}`;
  app.use((request: Request, _response: Response, next: NextFunction) => {
    request.headers['x-forwarded-for'] ??= clientIp;
    next();
  });
}
