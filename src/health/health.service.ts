import { Injectable, OnModuleDestroy } from '@nestjs/common';
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
    this.redis.on('error', () => undefined);
  }

  health() {
    return {
      status: 'ok' as const,
      service: 'instagram-automation-api',
      uptimeSeconds: Math.floor(process.uptime()),
      checkedAt: new Date().toISOString(),
    };
  }

  async ready() {
    const [postgresResult, redisResult] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.checkRedis(),
    ]);
    const dependencies = {
      postgres: postgresResult.status === 'fulfilled' ? 'ok' as const : 'unavailable' as const,
      redis: redisResult.status === 'fulfilled' ? 'ok' as const : 'unavailable' as const,
    };
    if (postgresResult.status === 'rejected' || redisResult.status === 'rejected') {
      return {
        status: 'not_ready',
        service: 'instagram-automation-api',
        dependencies,
        checkedAt: new Date().toISOString(),
      };
    }
    return {
      status: 'ready' as const,
      service: 'instagram-automation-api',
      dependencies,
      uptimeSeconds: Math.floor(process.uptime()),
      checkedAt: new Date().toISOString(),
    };
  }

  private async checkRedis() {
    if (this.redis.status === 'wait') await this.redis.connect();
    await this.redis.ping();
  }

  async onModuleDestroy() {
    if (this.redis.status === 'end') return;
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
