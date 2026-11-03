import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { InstagramAccountAccessLevel, MembershipRole } from "@prisma/client";
import { CurrentUser } from "../shared/decorators/current-user.decorator";
import { Roles } from "../shared/decorators/roles.decorator";
import { AuthenticatedUser } from "../shared/types/authenticated-user";
import {
  AccountMetadataDto,
  BulkAccountsDto,
  BulkMoveAccountsDto,
  BulkUpdateTagsDto,
  CreateAccountGroupDto,
  GrantAccountAccessDto,
  MoveAccountDto,
  OrderAccountGroupsDto,
  UpdateAccountGroupDto,
  UpdateAccountSettingsDto,
} from "./dto/account-group.dto";
import { InstagramAccountsQueryDto } from "./dto/instagram-accounts-query.dto";
import { InstagramAccountManagementService } from "./instagram-account-management.service";
import { InstagramAccountsService } from "./instagram-accounts.service";

@ApiTags("Instagram accounts")
@ApiBearerAuth()
@Controller("api/organizations/:organizationId/instagram/accounts")
export class InstagramAccountsController {
  constructor(
    private readonly instagramAccounts: InstagramAccountsService,
    private readonly management: InstagramAccountManagementService,
  ) {}

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
    summary: "List accessible Instagram accounts",
    description:
      "Supports status, provider, group, tag, favorite, search, pagination and stable sorting. MEMBER results are restricted to explicit account grants.",
  })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @ApiQuery({
    name: "status",
    required: false,
    enum: ["DISCONNECTED", "CONNECTING", "CONNECTED", "ERROR"],
  })
  @ApiQuery({ name: "provider", required: false, enum: ["MOCK", "META"] })
  @ApiQuery({ name: "groupId", required: false, type: String })
  @ApiQuery({ name: "tag", required: false, type: String })
  @ApiQuery({ name: "favorite", required: false, type: Boolean })
  @ApiQuery({ name: "search", required: false, type: String })
  @ApiQuery({
    name: "sortBy",
    required: false,
    enum: ["createdAt", "username", "name", "lastSyncedAt", "internalAlias"],
  })
  @ApiQuery({ name: "sortOrder", required: false, enum: ["asc", "desc"] })
  listAccounts(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: InstagramAccountsQueryDto,
  ) {
    return this.management.listAccounts(organizationId, user, query);
  }

  @Get("summary")
  @ApiOperation({
    summary: "Summarize accessible accounts, groups and organization limits",
  })
  getAccountSummary(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.management.summary(organizationId, user);
  }

  @Get("groups")
  @ApiOperation({ summary: "List account groups" })
  listGroups(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.management.listGroups(organizationId, user);
  }

  @Post("groups")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: "Create an account group" })
  createGroup(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAccountGroupDto,
  ) {
    return this.management.createGroup(organizationId, user, dto);
  }

  @Put("groups/order")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary: "Set the complete group ordering for this organization",
  })
  orderGroups(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: OrderAccountGroupsDto,
  ) {
    return this.management.orderGroups(organizationId, user, dto.groupIds);
  }

  @Patch("groups/:groupId")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: "Update a group name, description or order" })
  updateGroup(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("groupId", ParseUUIDPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAccountGroupDto,
  ) {
    return this.management.updateGroup(organizationId, groupId, user, dto);
  }

  @Delete("groups/:groupId")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: "Delete a group and leave its accounts ungrouped" })
  deleteGroup(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("groupId", ParseUUIDPipe) groupId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.management.deleteGroup(organizationId, groupId, user);
  }

  @Get("settings")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: "Get organization account and group limits" })
  getSettings(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.management.getSettings(organizationId, user);
  }

  @Patch("settings")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: "Update organization account and group limits" })
  updateSettings(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAccountSettingsDto,
  ) {
    if (dto.maxActiveAccounts === undefined && dto.maxGroups === undefined) {
      throw new BadRequestException(
        "At least one organization limit must be provided",
      );
    }
    return this.management.updateSettings(organizationId, user, dto);
  }

  @Get("preferences")
  @ApiOperation({
    summary: "List the current user's account favorites and default",
  })
  getPreferences(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.management.getPreferences(organizationId, user);
  }

  @Post("bulk/move-group")
  @ApiOperation({
    summary: "Move accessible accounts to a group (partial success)",
  })
  bulkMove(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkMoveAccountsDto,
  ) {
    return this.management.bulkMove(
      organizationId,
      user,
      dto.accountIds,
      dto.groupId ?? null,
    );
  }

  @Post("bulk/tags")
  @ApiOperation({
    summary: "Replace tags for accessible accounts (partial success)",
  })
  bulkTags(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkUpdateTagsDto,
  ) {
    return this.management.bulkTags(
      organizationId,
      user,
      dto.accountIds,
      dto.tags,
    );
  }

  @Post("bulk/sync")
  @ApiOperation({
    summary:
      "Synchronize accessible accounts using the configured provider (partial success)",
  })
  bulkSync(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BulkAccountsDto,
  ) {
    return this.management.bulkSync(organizationId, user, dto.accountIds);
  }

  @Get(":accountId/access")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary: "List explicit MEMBER access grants for an account",
  })
  listAccess(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.management.listAccess(organizationId, accountId, user);
  }

  @Put(":accountId/access/:membershipId")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary: "Grant VIEW or MANAGE access to an organization MEMBER",
  })
  grantAccess(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Param("membershipId", ParseUUIDPipe) membershipId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GrantAccountAccessDto,
  ) {
    return this.management.grantAccess(
      organizationId,
      accountId,
      membershipId,
      user,
      dto.level as InstagramAccountAccessLevel,
    );
  }

  @Delete(":accountId/access/:membershipId")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary: "Revoke account access from an organization MEMBER",
  })
  revokeAccess(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Param("membershipId", ParseUUIDPipe) membershipId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.management.revokeAccess(
      organizationId,
      accountId,
      membershipId,
      user,
    );
  }

  @Patch(":accountId/metadata")
  @ApiOperation({ summary: "Update internal alias and tags" })
  updateMetadata(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AccountMetadataDto,
  ) {
    return this.management.updateAccountMetadata(
      organizationId,
      accountId,
      user,
      dto,
    );
  }

  @Put(":accountId/group")
  @ApiOperation({
    summary: "Move an account to a group; null clears its group",
  })
  moveAccount(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MoveAccountDto,
  ) {
    return this.management.moveAccount(
      organizationId,
      accountId,
      dto.groupId ?? null,
      user,
    );
  }

  @Put(":accountId/favorite")
  @ApiOperation({ summary: "Favorite an account for the current user" })
  favorite(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.management.setFavorite(organizationId, accountId, user, true);
  }

  @Delete(":accountId/favorite")
  @ApiOperation({ summary: "Remove an account favorite for the current user" })
  unfavorite(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.management.setFavorite(organizationId, accountId, user, false);
  }

  @Put(":accountId/default")
  @ApiOperation({ summary: "Set the current user's default account" })
  setDefault(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.management.setDefault(organizationId, accountId, user);
  }

  @Delete(":accountId/default")
  @ApiOperation({ summary: "Clear the current user's default account" })
  clearDefault(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.management.setDefault(organizationId, null, user);
  }

  @Get(":accountId")
  @ApiOperation({
    summary: "Get an accessible account in the active organization",
  })
  getAccount(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.management.getAccount(organizationId, accountId, user);
  }

  @Post(":accountId/sync")
  @ApiOperation({ summary: "Synchronize an account the user can manage" })
  syncAccount(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.management.sync(organizationId, accountId, user);
  }

  @Delete(":accountId")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary:
      "Disconnect unless active rules or publications depend on this account",
  })
  disconnectAccount(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.management.disconnect(organizationId, accountId, user);
  }
}
