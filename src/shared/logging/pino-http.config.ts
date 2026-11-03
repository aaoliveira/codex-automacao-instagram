import { randomUUID } from 'node:crypto';
import type { Options as PinoHttpOptions } from 'pino-http';

const CORRELATION_ID_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

export function normalizeCorrelationId(value: unknown): string {
  return typeof value === 'string' && CORRELATION_ID_PATTERN.test(value)
    ? value
    : randomUUID();
}

export function createPinoHttpOptions(): PinoHttpOptions {
  return {
    genReqId(request, response) {
      const candidate = request.headers['x-correlation-id'];
      const id = normalizeCorrelationId(Array.isArray(candidate) ? candidate[0] : candidate);
      response.setHeader('X-Correlation-ID', id);
      return id;
    },
    customProps(request) {
      return { correlationId: request.id ?? 'unknown' };
    },
    customErrorObject(request, response, _error, value) {
      return {
        req: {
          id: request.id,
          method: request.method,
          url: request.url?.split('?')[0],
        },
        res: { statusCode: response.statusCode },
        responseTime: value.responseTime,
      };
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-hub-signature',
        'req.headers.x-hub-signature-256',
        'req.body.password',
        'req.body.refreshToken',
        'req.body.refresh_token',
        'req.body.accessToken',
        'req.body.access_token',
        'req.body.token',
        'req.body.client_secret',
        'req.body.appSecret',
        'req.body.secret',
        'req.body.code',
        'req.body.state',
        'req.query.access_token',
        'req.query.token',
        'req.query.code',
        'req.query.state',
        'req.query.hub.verify_token',
        'res.headers.set-cookie',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      req(request) {
        return {
          id: request.id,
          method: request.method,
          url: request.url?.split('?')[0],
        };
      },
      res(response) {
        return { statusCode: response.statusCode };
      },
    },
  };
}

