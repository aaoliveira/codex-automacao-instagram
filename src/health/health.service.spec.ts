import { ConfigService } from '@nestjs/config';
import { HealthService } from './health.service';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthService', () => {
  it('reports dependency failures without exposing connection errors', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('database-secret-sentinel')),
    } as unknown as PrismaService;
    const config = {
      getOrThrow: jest.fn().mockReturnValue('redis://127.0.0.1:1'),
    } as unknown as ConfigService;
    const health = new HealthService(prisma, config);

    try {
      const result = await health.ready();
      expect(result).toMatchObject({
        status: 'not_ready',
        service: 'instagram-automation-api',
        dependencies: { postgres: 'unavailable', redis: 'unavailable' },
      });
      expect(JSON.stringify(result)).not.toContain('database-secret-sentinel');
    } finally {
      await health.onModuleDestroy();
    }
  });
});
