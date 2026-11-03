import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      enableOfflineQueue: false,
    });
  }

  health() {
    return { status: 'ok' as const };
  }

  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      if (this.redis.status === 'wait') await this.redis.connect();
      await this.redis.ping();
      return { status: 'ready' as const, dependencies: { postgres: 'ok', redis: 'ok' } };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        dependencies: { postgres: 'unknown', redis: 'unknown' },
      });
    }
  }

  async onModuleDestroy() {
    if (this.redis.status === 'end') return;
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
