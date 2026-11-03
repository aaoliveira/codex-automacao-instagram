import { ServiceUnavailableException } from "@nestjs/common";
import { InstagramConnectionValidator } from "./instagram-connection-validator.service";
import { InstagramCredentials, InstagramProvider } from "./instagram-provider";

describe("InstagramConnectionValidator", () => {
  const credentials: InstagramCredentials = {
    accessToken: "opaque-token",
    externalAccountId: "account-1",
    tokenExpiresAt: null,
  };

  it("accepts provider-validated identity and profile metadata", async () => {
    const provider = {
      validateConnection: jest.fn().mockResolvedValue({
        externalAccountId: "account-1",
        username: "creator",
        name: "Creator",
        avatarUrl: null,
      }),
    } as unknown as InstagramProvider;
    const validator = new InstagramConnectionValidator(provider);

    await expect(validator.validate(credentials)).resolves.toMatchObject({
      username: "creator",
    });
  });

  it("rejects credentials that resolve to a different account", async () => {
    const provider = {
      validateConnection: jest.fn().mockResolvedValue({
        externalAccountId: "somebody-else",
        username: null,
        name: null,
        avatarUrl: null,
      }),
    } as unknown as InstagramProvider;
    const validator = new InstagramConnectionValidator(provider);

    await expect(validator.validate(credentials)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
