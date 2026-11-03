import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import helmet from 'helmet';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { isolateE2eRateLimitClient } from './e2e-client-isolation';

describe('Audit and observability security (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    isolateE2eRateLimitClient(app);
    app.use(helmet());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('records scoped audit events with correlation IDs and blocks cross-tenant reads', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const registrationCorrelation = `audit-register-${suffix}`;
    const first = await request(app.getHttpServer())
      .post('/api/auth/register')
      .set('X-Correlation-ID', registrationCorrelation)
      .set('X-Forwarded-For', '198.51.100.41')
      .send({
        email: `audit-owner-${suffix}@example.com`,
        password: 'audit-strong-password-123',
        organizationName: 'Audit Tenant A',
      })
      .expect(201);
    expect(first.headers['x-correlation-id']).toBe(registrationCorrelation);

    const second = await request(app.getHttpServer())
      .post('/api/auth/register')
      .set('X-Forwarded-For', '198.51.100.42')
      .send({
        email: `audit-owner-b-${suffix}@example.com`,
        password: 'audit-strong-password-456',
        organizationName: 'Audit Tenant B',
      })
      .expect(201);

    const ownAudit = await request(app.getHttpServer())
      .get(`/api/organizations/${first.body.organizationId}/audit-logs?page=1&pageSize=20`)
      .set('Authorization', `Bearer ${first.body.accessToken}`)
      .set('X-Forwarded-For', '198.51.100.41')
      .expect(200);
    expect(ownAudit.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'USER_REGISTERED',
        organizationId: first.body.organizationId,
        userId: first.body.user.id,
        correlationId: registrationCorrelation,
      }),
    ]));
    expect(JSON.stringify(ownAudit.body)).not.toContain(first.body.accessToken);
    expect(JSON.stringify(ownAudit.body)).not.toContain(first.body.refreshToken);
    expect(JSON.stringify(ownAudit.body)).not.toContain('audit-strong-password');

    await request(app.getHttpServer())
      .get(`/api/organizations/${second.body.organizationId}/audit-logs`)
      .set('Authorization', `Bearer ${first.body.accessToken}`)
      .set('X-Forwarded-For', '198.51.100.41')
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/organizations/${first.body.organizationId}/audit-logs`)
      .set('Authorization', `Bearer ${second.body.accessToken}`)
      .set('X-Forwarded-For', '198.51.100.42')
      .expect(404);
  });

  it('serves process metrics and applies auth throttling and security headers', async () => {
    const health = await request(app.getHttpServer())
      .get('/health')
      .set('X-Correlation-ID', 'security-check-123')
      .set('X-Forwarded-For', '198.51.100.50')
      .expect(200);
    expect(health.headers['x-correlation-id']).toBe('security-check-123');
    expect(health.headers['x-content-type-options']).toBe('nosniff');

    const ready = await request(app.getHttpServer())
      .get('/ready')
      .set('X-Forwarded-For', '198.51.100.50')
      .expect(200);
    expect(ready.body.dependencies).toEqual({ postgres: 'ok', redis: 'ok' });

    const metrics = await request(app.getHttpServer())
      .get('/metrics')
      .set('X-Forwarded-For', '198.51.100.50')
      .expect(200);
    expect(metrics.text).toContain('http_requests_total');
    expect(metrics.text).toContain('process_resident_memory_bytes');

    const ip = '198.51.100.60';
    for (let index = 0; index < 5; index += 1) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: `throttle-${index}@example.com`, password: 'invalid-password' })
        .expect(401);
    }
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email: 'throttle-over-limit@example.com', password: 'invalid-password' })
      .expect(429);
  });
});
