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
  ) {
    return this.automations.list(organizationId, query.instagramAccountId);
  }

  @Get("automation-rules/:ruleId")
  getRule(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("ruleId", ParseUUIDPipe) ruleId: string,
  ) {
    return this.automations.get(organizationId, ruleId);
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
  ) {
    return this.automations.listExecutions(organizationId, query);
  }

  @Get("automation-executions/:executionId")
  getExecution(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("executionId", ParseUUIDPipe) executionId: string,
  ) {
    return this.automations.getExecution(organizationId, executionId);
  }

  @Get("automation-notifications")
  listNotifications(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query() query: AutomationNotificationsQueryDto,
  ) {
    return this.automations.listNotifications(organizationId, query);
  }
}
