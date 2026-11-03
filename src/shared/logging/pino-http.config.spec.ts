import pino from 'pino';
import { createPinoHttpOptions, normalizeCorrelationId } from './pino-http.config';

describe('request logging security', () => {
  it('omits credentials, query values, signatures and cookies from serialized request logs', () => {
    const lines: string[] = [];
    const options = createPinoHttpOptions();
    const logger = pino({ redact: options.redact, serializers: options.serializers }, {
      write: (line) => lines.push(line),
    });
    logger.info({
      req: {
        id: 'correlation-log-test',
        method: 'POST',
        url: '/api/auth/login?code=query-code-sentinel&state=query-state-sentinel',
        headers: {
          authorization: 'Bearer authorization-sentinel',
          cookie: 'session=cookie-sentinel',
          'x-hub-signature-256': 'signature-sentinel',
        },
        body: {
          password: 'password-sentinel',
          refreshToken: 'refresh-token-sentinel',
          accessToken: 'access-token-sentinel',
          client_secret: 'client-secret-sentinel',
        },
      },
      res: { statusCode: 200, headers: { 'set-cookie': 'refresh=set-cookie-sentinel' } },
    }, 'request completed');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('correlation-log-test');
    for (const secret of [
      'query-code-sentinel', 'query-state-sentinel', 'authorization-sentinel',
      'cookie-sentinel', 'signature-sentinel', 'password-sentinel',
      'refresh-token-sentinel', 'access-token-sentinel', 'client-secret-sentinel',
      'set-cookie-sentinel',
    ]) {
      expect(lines[0]).not.toContain(secret);
    }
  });

  it('accepts only bounded, header-safe correlation IDs', () => {
    expect(normalizeCorrelationId('trace_123-abc')).toBe('trace_123-abc');
    expect(normalizeCorrelationId('bad\r\nheader')).toMatch(/^[0-9a-f-]{36}$/);
    expect(normalizeCorrelationId('x'.repeat(65))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('omits exception stacks from automatic HTTP error logs', () => {
    const customErrorObject = createPinoHttpOptions().customErrorObject;
    const entry = customErrorObject?.(
      { id: 'safe-correlation', method: 'POST', url: '/api/example?token=secret' } as never,
      { statusCode: 500 } as never,
      new Error('internal detail'),
      { responseTime: 12, err: new Error('internal detail') },
    );

    expect(entry).toEqual({
      req: { id: 'safe-correlation', method: 'POST', url: '/api/example' },
      res: { statusCode: 500 },
      responseTime: 12,
    });
    expect(JSON.stringify(entry)).not.toContain('internal detail');
    expect(JSON.stringify(entry)).not.toContain('stack');
  });
});
