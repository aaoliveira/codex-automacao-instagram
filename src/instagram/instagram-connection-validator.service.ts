import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  INSTAGRAM_PROVIDER,
  InstagramCredentials,
  InstagramProfile,
  InstagramProvider,
} from "./instagram-provider";

@Injectable()
export class InstagramConnectionValidator {
  constructor(
    @Inject(INSTAGRAM_PROVIDER) private readonly provider: InstagramProvider,
  ) {}

  async validate(credentials: InstagramCredentials): Promise<InstagramProfile> {
    if (!credentials.accessToken || !credentials.externalAccountId) {
      throw new ServiceUnavailableException(
        "Instagram connection credentials are incomplete",
      );
    }

    const profile = await this.provider.validateConnection(credentials);
    if (profile.externalAccountId !== credentials.externalAccountId) {
      throw new ServiceUnavailableException(
        "Instagram account identity did not match",
      );
    }
    return profile;
  }
}
