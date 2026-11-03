import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { PUBLICATION_ANALYTICS_QUEUE } from "./analytics.constants";

const SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
if count >= limit then
  local ttl = redis.call('PTTL', KEYS[1])
  return ttl > 0 and ttl or windowMs
end
count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], windowMs) end
return 0
`;

@Injectable()
export class AnalyticsRateLimiter {
  private readonly clients = new WeakSet<object>();

  constructor(
    @InjectQueue(PUBLICATION_ANALYTICS_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async consume(
    organizationId: string,
    instagramAccountId: string,
  ): Promise<number> {
    const client = await this.queue.getBackend().client;
    if (!this.clients.has(client)) {
      client.defineCommand("analyticsAccountRateLimit", {
        numberOfKeys: 1,
        lua: SCRIPT,
      });
      this.clients.add(client);
    }
    const waitMs = await client.runCommand("analyticsAccountRateLimit", [
      `analytics-rate:{${organizationId}}:account:${instagramAccountId}`,
      this.config.getOrThrow<number>("ANALYTICS_ACCOUNT_RATE_LIMIT_MAX"),
      this.config.getOrThrow<number>("ANALYTICS_RATE_LIMIT_WINDOW_MS"),
    ]);
    return Number(waitMs);
  }
}
