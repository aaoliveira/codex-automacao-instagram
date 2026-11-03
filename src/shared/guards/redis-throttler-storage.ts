import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ThrottlerStorage } from '@nestjs/throttler';

type ThrottlerRecord = {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
};

const INCREMENT_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local state = redis.call('HMGET', KEYS[1], 'hits', 'expiresAt', 'blockedUntil')
local hits = tonumber(state[1] or '0')
local expiresAt = tonumber(state[2] or '0')
local blockedUntil = tonumber(state[3] or '0')
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])

if expiresAt <= now then
  hits = 0
  expiresAt = now + ttl
  blockedUntil = 0
end

if blockedUntil > now then
  return { hits, expiresAt - now, 1, blockedUntil - now }
end

hits = hits + 1
local isBlocked = 0
if hits > limit then
  isBlocked = 1
  if blockDuration > 0 then blockedUntil = now + blockDuration end
end

redis.call('HSET', KEYS[1], 'hits', hits, 'expiresAt', expiresAt, 'blockedUntil', blockedUntil)
redis.call('PEXPIRE', KEYS[1], math.max(1, math.max(expiresAt, blockedUntil) - now))
return { hits, math.max(0, expiresAt - now), isBlocked, math.max(0, blockedUntil - now) }
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    const redisUrl = config.getOrThrow<string>('REDIS_URL');
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      connectTimeout: 3_000,
      retryStrategy: (attempt) => attempt > 3 ? null : Math.min(attempt * 250, 1_000),
    });
    this.redis.on('error', () => undefined);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerRecord> {
    await this.ensureConnected();
    const result = await this.redis.eval(
      INCREMENT_SCRIPT,
      1,
      `security:throttle:${key}`,
      ttl,
      limit,
      blockDuration,
    ) as Array<number | string>;
    return {
      totalHits: Number(result[0]),
      timeToExpire: Math.ceil(Number(result[1]) / 1000),
      isBlocked: Number(result[2]) === 1,
      timeToBlockExpire: Math.ceil(Number(result[3]) / 1000),
    };
  }

  async onModuleDestroy() {
    if (this.redis.status === 'end') return;
    await this.redis.quit().catch(() => this.redis.disconnect());
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === 'ready') return;
    if (this.redis.status === 'wait') {
      await this.redis.connect();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onEnd = () => {
        cleanup();
        reject(new Error('Rate limit storage is unavailable'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Rate limit storage connection timed out'));
      }, 5_000);
      timer.unref();
      const cleanup = () => {
        clearTimeout(timer);
        this.redis.off('ready', onReady);
        this.redis.off('end', onEnd);
      };
      this.redis.once('ready', onReady);
      this.redis.once('end', onEnd);
    });
  }
}
