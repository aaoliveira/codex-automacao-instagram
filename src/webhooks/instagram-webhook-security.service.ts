import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "node:crypto";

@Injectable()
export class InstagramWebhookSecurityService {
  constructor(private readonly config: ConfigService) {}

  verifyChallenge(
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ): string {
    const expectedToken = this.config.get<string>(
      "INSTAGRAM_WEBHOOK_VERIFY_TOKEN",
    );
    if (
      mode !== "subscribe" ||
      !expectedToken ||
      !secureStringEquals(token, expectedToken) ||
      !challenge ||
      challenge.length > 4096
    ) {
      throw new ForbiddenException("Instagram webhook verification failed");
    }
    return challenge;
  }

  verifySignature(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): void {
    const appSecret = this.config.get<string>("META_INSTAGRAM_APP_SECRET");
    if (!appSecret) {
      throw new ServiceUnavailableException(
        "Meta webhook signature verification is not configured",
      );
    }
    if (!rawBody || !signature) {
      throw new UnauthorizedException("Instagram webhook signature is missing");
    }

    const match = /^sha256=([a-f0-9]{64})$/i.exec(signature);
    if (!match) {
      throw new UnauthorizedException("Instagram webhook signature is invalid");
    }

    const expected = createHmac("sha256", appSecret).update(rawBody).digest();
    const received = Buffer.from(match[1], "hex");
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new UnauthorizedException("Instagram webhook signature is invalid");
    }
  }
}

function secureStringEquals(
  value: string | undefined,
  expected: string,
): boolean {
  if (!value) return false;
  const actualBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
