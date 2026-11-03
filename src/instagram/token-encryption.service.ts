import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedToken {
  ciphertext: string;
  iv: string;
  tag: string;
}

@Injectable()
export class TokenEncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const encoded = config.getOrThrow<string>("INSTAGRAM_TOKEN_ENCRYPTION_KEY");
    this.key = Buffer.from(encoded, "base64");
    if (this.key.length !== 32) {
      throw new Error(
        "INSTAGRAM_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes",
      );
    }
  }

  encrypt(plainText: string): EncryptedToken {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plainText, "utf8"),
      cipher.final(),
    ]);
    return {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
    };
  }

  decrypt(encrypted: EncryptedToken): string {
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(encrypted.iv, "hex"),
      );
      decipher.setAuthTag(Buffer.from(encrypted.tag, "hex"));
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new InternalServerErrorException(
        "Stored Instagram credentials could not be read",
      );
    }
  }
}
