import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { PublicationRateLimiter } from "./publication-rate-limiter";

describe("PublicationRateLimiter", () => {
  it("uses atomic organization and account windows and returns zero when allowed", async () => {
    const redis = {
      defineCommand: jest.fn(),
      runCommand: jest.fn().mockResolvedValue(0),
    };
    const limiter = createLimiter(redis);

    await expect(limiter.consume("org-1", "account-1")).resolves.toBe(0);
    expect(redis.defineCommand).toHaveBeenCalledWith(
      "publicationRateLimitWindow",
      expect.objectContaining({
        numberOfKeys: 2,
        lua: expect.stringContaining("INCR"),
      }),
    );
    expect(redis.runCommand).toHaveBeenCalledWith(
      "publicationRateLimitWindow",
      [
      "publication-rate:{org-1}:organization",
      "publication-rate:{org-1}:account:account-1",
      20,
      5,
      60_000,
      ],
    );
  });

  it("returns the remaining window when a tenant or account is rate limited", async () => {
    const redis = {
      defineCommand: jest.fn(),
      runCommand: jest.fn().mockResolvedValue(12_345),
    };
    const limiter = createLimiter(redis);

    await expect(limiter.consume("org-1", "account-2")).resolves.toBe(
      12_345,
    );
  });
});

function createLimiter(redis: {
  defineCommand: jest.Mock;
  runCommand: jest.Mock;
}) {
  const config = {
    getOrThrow: (key: string) =>
      ({
        PUBLICATION_ORGANIZATION_RATE_LIMIT_MAX: 20,
        PUBLICATION_ACCOUNT_RATE_LIMIT_MAX: 5,
        PUBLICATION_RATE_LIMIT_WINDOW_MS: 60_000,
      })[key],
  } as unknown as ConfigService;
  const queue = {
    getBackend: () => ({ client: Promise.resolve(redis) }),
  } as unknown as Queue;
  return new PublicationRateLimiter(queue, config);
}
