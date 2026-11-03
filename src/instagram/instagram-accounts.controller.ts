import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { MembershipRole } from "@prisma/client";
import { CurrentUser } from "../shared/decorators/current-user.decorator";
import { Roles } from "../shared/decorators/roles.decorator";
import { AuthenticatedUser } from "../shared/types/authenticated-user";
import { InstagramAccountsQueryDto } from "./dto/instagram-accounts-query.dto";
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
    description:
      "Without query parameters, returns the legacy array. With filters or pagination, returns a paginated items envelope.",
  })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @ApiQuery({
    name: "status",
    required: false,
    enum: ["DISCONNECTED", "CONNECTING", "CONNECTED", "ERROR"],
  })
  @ApiQuery({ name: "provider", required: false, enum: ["MOCK", "META"] })
  @ApiQuery({ name: "search", required: false, type: String })
  listAccounts(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query() query: InstagramAccountsQueryDto,
  ) {
    return this.instagramAccounts.listAccounts(organizationId, query);
  }

  @Get("summary")
  @ApiOperation({
    summary: "Summarize account statuses and providers for the organization",
  })
  getAccountSummary(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
  ) {
    return this.instagramAccounts.getAccountSummary(organizationId);
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
