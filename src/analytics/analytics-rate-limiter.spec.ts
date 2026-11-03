import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { AnalyticsRateLimiter } from "./analytics-rate-limiter";

describe("AnalyticsRateLimiter", () => {
  it("uses one atomic Redis quota key scoped by organization and account", async () => {
    const client = {
      defineCommand: jest.fn(),
      runCommand: jest.fn().mockResolvedValue(1500),
    };
    const queue = {
      getBackend: () => ({ client: Promise.resolve(client) }),
    } as unknown as Queue;
    const config = {
      getOrThrow: (name: string) => (name.endsWith("_MAX") ? 3 : 10_000),
    } as unknown as ConfigService;
    const limiter = new AnalyticsRateLimiter(queue, config);
    expect(await limiter.consume("organization-a", "account-a")).toBe(1500);
    expect(await limiter.consume("organization-a", "account-a")).toBe(1500);
    expect(client.defineCommand).toHaveBeenCalledTimes(1);
    expect(client.runCommand).toHaveBeenNthCalledWith(
      1,
      "analyticsAccountRateLimit",
      ["analytics-rate:{organization-a}:account:account-a", 3, 10_000],
    );
  });
});
