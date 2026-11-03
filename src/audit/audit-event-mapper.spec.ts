import { mapRequestToAuditRecord } from './audit-event-mapper';

describe('audit event mapping', () => {
  it('records safe identity and correlation fields for a successful login, never its credentials or tokens', () => {
    const result = mapRequestToAuditRecord({
      method: 'POST',
      path: '/api/auth/login',
      id: 'corr-login-123',
      body: { email: 'private@example.com', password: 'password-sentinel' },
    }, 200, {
      accessToken: 'access-token-sentinel',
      refreshToken: 'refresh-token-sentinel',
      user: { id: 'user-123', email: 'private@example.com' },
      organizationId: 'organization-123',
    });

    expect(result).toEqual(expect.objectContaining({
      action: 'LOGIN',
      userId: 'user-123',
      organizationId: 'organization-123',
      correlationId: 'corr-login-123',
      outcome: 'SUCCESS',
      metadata: { statusCode: 200 },
    }));
    expect(JSON.stringify(result)).not.toMatch(/private@example|password-sentinel|access-token-sentinel|refresh-token-sentinel/);
  });

  it('records a failed login without copying its request body', () => {
    const result = mapRequestToAuditRecord({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: 'private@example.com', password: 'password-sentinel' },
    }, 401);

    expect(result).toEqual(expect.objectContaining({
      action: 'LOGIN_FAILED',
      userId: null,
      organizationId: null,
      outcome: 'FAILURE',
      metadata: { statusCode: 401 },
    }));
    expect(JSON.stringify(result)).not.toMatch(/private@example|password-sentinel/);
  });

  it('does not audit ordinary read-only requests', () => {
    expect(mapRequestToAuditRecord({ method: 'GET', path: '/api/auth/me' }, 200)).toBeNull();
  });
});
