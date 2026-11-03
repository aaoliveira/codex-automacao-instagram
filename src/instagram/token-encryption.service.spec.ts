import { ConfigService } from "@nestjs/config";
import { TokenEncryptionService } from "./token-encryption.service";

describe("TokenEncryptionService", () => {
  const service = new TokenEncryptionService({
    getOrThrow: () => "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
  } as unknown as ConfigService);

  it("encrypts tokens with randomized authenticated ciphertext and decrypts them", () => {
    const token = "provider-token-that-must-not-be-returned";
    const encrypted = service.encrypt(token);
    const secondEncryption = service.encrypt(token);

    expect(encrypted.ciphertext).not.toContain(token);
    expect(encrypted.ciphertext).not.toBe(secondEncryption.ciphertext);
    expect(service.decrypt(encrypted)).toBe(token);
  });
});
