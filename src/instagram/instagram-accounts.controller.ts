import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { MembershipRole } from "@prisma/client";
import { CurrentUser } from "../shared/decorators/current-user.decorator";
import { Roles } from "../shared/decorators/roles.decorator";
import { AuthenticatedUser } from "../shared/types/authenticated-user";
import { InstagramAccountsService } from "./instagram-accounts.service";

@ApiTags("Instagram accounts")
@ApiBearerAuth()
@Controller("api/organizations/:organizationId/instagram/accounts")
export class InstagramAccountsController {
  constructor(private readonly instagramAccounts: InstagramAccountsService) {}

  @Post("connect")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: "Start the Instagram OAuth connection flow" })
  startConnection(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.instagramAccounts.startConnection(user, organizationId);
  }

  @Get()
  @ApiOperation({
    summary: "List Instagram accounts in the active organization",
  })
  listAccounts(@Param("organizationId", ParseUUIDPipe) organizationId: string) {
    return this.instagramAccounts.listAccounts(organizationId);
  }

  @Get(":accountId")
  @ApiOperation({
    summary: "Get an Instagram account in the active organization",
  })
  getAccount(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("accountId", ParseUUIDPipe) accountId: string,
  ) {
    return this.instagramAccounts.getAccount(organizationId, accountId);
  }

  @Post(":accountId/sync")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary: "Validate and synchronize an Instagram account profile",
  })
  syncAccount(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("accountId", ParseUUIDPipe) accountId: string,
  ) {
    return this.instagramAccounts.syncAccount(organizationId, accountId);
  }

  @Delete(":accountId")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary:
      "Disconnect an Instagram account and erase its stored access token",
  })
  disconnectAccount(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("accountId", ParseUUIDPipe) accountId: string,
  ) {
    return this.instagramAccounts.disconnectAccount(organizationId, accountId);
  }
}
