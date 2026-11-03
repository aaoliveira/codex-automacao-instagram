import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import helmet from 'helmet';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Authentication and tenant isolation (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(helmet());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('provides liveness and readiness checks', async () => {
    await request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
    await request(app.getHttpServer()).get('/ready').expect(200).expect({
      status: 'ready',
      dependencies: { postgres: 'ok', redis: 'ok' },
    });
  });

  it('registers, logs in, rotates refresh tokens, and rejects access across organizations', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const firstRegistration = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `owner-${suffix}@example.com`,
        password: 'a-strong-test-password-123',
        organizationName: 'Tenant A',
      })
      .expect(201);
    expect(firstRegistration.body.role).toBe('OWNER');
    expect(firstRegistration.body.refreshToken).toBeDefined();

    const firstLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: `owner-${suffix}@example.com`, password: 'a-strong-test-password-123' })
      .expect(200);

    const ownOrganization = await request(app.getHttpServer())
      .get(`/api/organizations/${firstRegistration.body.organizationId}`)
      .set('Authorization', `Bearer ${firstLogin.body.accessToken}`)
      .expect(200);
    expect(ownOrganization.body.name).toBe('Tenant A');

    const ownMembers = await request(app.getHttpServer())
      .get(`/api/organizations/${firstRegistration.body.organizationId}/members`)
      .set('Authorization', `Bearer ${firstLogin.body.accessToken}`)
      .expect(200);
    expect(ownMembers.body).toHaveLength(1);

    const secondRegistration = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        email: `other-${suffix}@example.com`,
        password: 'another-strong-test-password-456',
        organizationName: 'Tenant B',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/organizations/${firstRegistration.body.organizationId}/members`)
      .set('Authorization', `Bearer ${firstLogin.body.accessToken}`)
      .send({ email: `other-${suffix}@example.com` })
      .expect(201)
      .expect((response) => expect(response.body.role).toBe('MEMBER'));

    const memberLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: `other-${suffix}@example.com`,
        password: 'another-strong-test-password-456',
        organizationId: firstRegistration.body.organizationId,
      })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/organizations/${firstRegistration.body.organizationId}/members`)
      .set('Authorization', `Bearer ${memberLogin.body.accessToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get(`/api/organizations/${secondRegistration.body.organizationId}`)
      .set('Authorization', `Bearer ${firstLogin.body.accessToken}`)
      .expect(404);

    const rotated = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: firstRegistration.body.refreshToken })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(firstRegistration.body.refreshToken);

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: firstRegistration.body.refreshToken })
      .expect(401);
  });

  it('rejects invalid credentials and invalid registration input', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'invalid', password: 'short', organizationName: '' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'not-the-password' })
      .expect(401);
  });
});
