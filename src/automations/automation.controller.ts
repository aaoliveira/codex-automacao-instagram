import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { MembershipRole } from "@prisma/client";
import { Roles } from "../shared/decorators/roles.decorator";
import { CurrentUser } from "../shared/decorators/current-user.decorator";
import { AuthenticatedUser } from "../shared/types/authenticated-user";
import {
  AutomationExecutionListQueryDto,
  AutomationNotificationsQueryDto,
  AutomationRulesQueryDto,
  CreateAutomationRuleDto,
  SimulateAutomationEventDto,
  UpdateAutomationRuleDto,
} from "./dto/automation-rule.dto";
import { AutomationRulesService } from "./automation-rules.service";

@ApiTags("Instagram automations")
@ApiBearerAuth()
@Controller("api/organizations/:organizationId")
export class AutomationController {
  constructor(private readonly automations: AutomationRulesService) {}

  @Post("automation-rules")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: "Create an organization-scoped automation rule" })
  createRule(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body() dto: CreateAutomationRuleDto,
  ) {
    return this.automations.create(organizationId, dto);
  }

  @Get("automation-rules")
  listRules(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query() query: AutomationRulesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.automations.listForUser(
      organizationId,
      user,
      query.instagramAccountId,
    );
  }

  @Get("automation-rules/:ruleId")
  getRule(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("ruleId", ParseUUIDPipe) ruleId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.automations.getForUser(organizationId, ruleId, user);
  }

  @Patch("automation-rules/:ruleId")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  updateRule(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("ruleId", ParseUUIDPipe) ruleId: string,
    @Body() dto: UpdateAutomationRuleDto,
  ) {
    return this.automations.update(organizationId, ruleId, dto);
  }

  @Delete("automation-rules/:ruleId")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  deleteRule(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("ruleId", ParseUUIDPipe) ruleId: string,
  ) {
    return this.automations.delete(organizationId, ruleId);
  }

  @Post("automation-rules/:ruleId/simulate")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: "Queue a deterministic local MOCK automation event",
  })
  simulate(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("ruleId", ParseUUIDPipe) ruleId: string,
    @Body() dto: SimulateAutomationEventDto,
  ) {
    return this.automations.simulate(organizationId, ruleId, dto);
  }

  @Get("automation-executions")
  listExecutions(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query() query: AutomationExecutionListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.automations.listExecutions(organizationId, query, user);
  }

  @Get("automation-executions/:executionId")
  getExecution(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("executionId", ParseUUIDPipe) executionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.automations.getExecution(organizationId, executionId, user);
  }

  @Get("automation-notifications")
  listNotifications(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query() query: AutomationNotificationsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.automations.listNotifications(organizationId, query, user);
  }
}
