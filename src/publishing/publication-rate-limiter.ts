import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { INSTAGRAM_PUBLICATION_QUEUE } from "./publication.constants";

const RATE_LIMIT_SCRIPT = `
local organizationCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local accountCount = tonumber(redis.call('GET', KEYS[2]) or '0')
local organizationLimit = tonumber(ARGV[1])
local accountLimit = tonumber(ARGV[2])
local windowMs = tonumber(ARGV[3])

if organizationCount >= organizationLimit then
  local ttl = redis.call('PTTL', KEYS[1])
  return ttl > 0 and ttl or windowMs
end
if accountCount >= accountLimit then
  local ttl = redis.call('PTTL', KEYS[2])
  return ttl > 0 and ttl or windowMs
end

organizationCount = redis.call('INCR', KEYS[1])
if organizationCount == 1 then redis.call('PEXPIRE', KEYS[1], windowMs) end
accountCount = redis.call('INCR', KEYS[2])
if accountCount == 1 then redis.call('PEXPIRE', KEYS[2], windowMs) end
return 0
`;
const RATE_LIMIT_COMMAND = "publicationRateLimitWindow";

@Injectable()
export class PublicationRateLimiter {
  private readonly registeredClients = new WeakSet<object>();

  constructor(
    @InjectQueue(INSTAGRAM_PUBLICATION_QUEUE)
    private readonly queue: Queue,
    private readonly config: ConfigService,
  ) {}

  async consume(
    organizationId: string,
    instagramAccountId: string,
  ): Promise<number> {
    const organizationLimit = this.config.getOrThrow<number>(
      "PUBLICATION_ORGANIZATION_RATE_LIMIT_MAX",
    );
    const accountLimit = this.config.getOrThrow<number>(
      "PUBLICATION_ACCOUNT_RATE_LIMIT_MAX",
    );
    const windowMs = this.config.getOrThrow<number>(
      "PUBLICATION_RATE_LIMIT_WINDOW_MS",
    );
    const slot = `{${organizationId}}`;
    const client = await this.queue.getBackend().client;
    if (!this.registeredClients.has(client)) {
      client.defineCommand(RATE_LIMIT_COMMAND, {
        numberOfKeys: 2,
        lua: RATE_LIMIT_SCRIPT,
      });
      this.registeredClients.add(client);
    }
    const waitMs = await client.runCommand(RATE_LIMIT_COMMAND, [
      `publication-rate:${slot}:organization`,
      `publication-rate:${slot}:account:${instagramAccountId}`,
      organizationLimit,
      accountLimit,
      windowMs,
    ]);
    return Number(waitMs);
  }
}
