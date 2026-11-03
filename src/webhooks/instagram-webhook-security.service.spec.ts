import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac } from "node:crypto";
import { InstagramWebhookSecurityService } from "./instagram-webhook-security.service";

describe("InstagramWebhookSecurityService", () => {
  it("echoes a valid subscription challenge and rejects an invalid token", () => {
    const security = createSecurity({
      INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "test-webhook-verify-token-123",
    });

    expect(
      security.verifyChallenge(
        "subscribe",
        "test-webhook-verify-token-123",
        "challenge-value",
      ),
    ).toBe("challenge-value");
    expect(() =>
      security.verifyChallenge("subscribe", "wrong-token", "challenge-value"),
    ).toThrow(ForbiddenException);
  });

  it("accepts a valid SHA-256 signature over the raw body", () => {
    const secret = "local-test-app-secret";
    const body = Buffer.from('{"object":"instagram","entry":[]}');
    const digest = createHmac("sha256", secret).update(body).digest("hex");
    const security = createSecurity({ META_INSTAGRAM_APP_SECRET: secret });

    expect(() =>
      security.verifySignature(body, `sha256=${digest}`),
    ).not.toThrow();
    expect(() =>
      security.verifySignature(body, `sha256=${"0".repeat(64)}`),
    ).toThrow(UnauthorizedException);
  });

  it("fails closed when the app secret is not configured", () => {
    const security = createSecurity({});
    expect(() =>
      security.verifySignature(Buffer.from("{}"), `sha256=${"0".repeat(64)}`),
    ).toThrow(ServiceUnavailableException);
  });
});

function createSecurity(values: Record<string, string>) {
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
  return new InstagramWebhookSecurityService(config);
}
