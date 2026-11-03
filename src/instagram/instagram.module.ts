import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InstagramProviderType } from "@prisma/client";
import { PrismaModule } from "../prisma/prisma.module";
import { InstagramAccountsController } from "./instagram-accounts.controller";
import { InstagramAccountsService } from "./instagram-accounts.service";
import { InstagramAccountManagementService } from "./instagram-account-management.service";
import { InstagramConnectionValidator } from "./instagram-connection-validator.service";
import { INSTAGRAM_PROVIDER, InstagramProvider } from "./instagram-provider";
import { InstagramOAuthController } from "./instagram-oauth.controller";
import { MetaInstagramProvider } from "./meta-instagram.provider";
import { MockInstagramProvider } from "./mock-instagram.provider";
import { TokenEncryptionService } from "./token-encryption.service";

@Module({
  imports: [PrismaModule],
  controllers: [InstagramAccountsController, InstagramOAuthController],
  providers: [
    InstagramAccountsService,
    InstagramAccountManagementService,
    InstagramConnectionValidator,
    TokenEncryptionService,
    MockInstagramProvider,
    MetaInstagramProvider,
    {
      provide: INSTAGRAM_PROVIDER,
      inject: [ConfigService, MockInstagramProvider, MetaInstagramProvider],
      useFactory: (
        config: ConfigService,
        mockProvider: MockInstagramProvider,
        metaProvider: MetaInstagramProvider,
      ): InstagramProvider =>
        config.get<InstagramProviderType>(
          "INSTAGRAM_PROVIDER",
          InstagramProviderType.MOCK,
        ) === InstagramProviderType.META
          ? metaProvider
          : mockProvider,
    },
  ],
  exports: [InstagramAccountManagementService],
})
export class InstagramModule {}
