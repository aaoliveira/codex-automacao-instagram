import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { MembershipRole } from "@prisma/client";
import { CurrentUser } from "../shared/decorators/current-user.decorator";
import { Roles } from "../shared/decorators/roles.decorator";
import { AuthenticatedUser } from "../shared/types/authenticated-user";
import { ApplyAutomationTemplateDto, AutomationTemplateListQueryDto, CreateAutomationTemplateDto, DuplicateAutomationTemplateDto, ImportAutomationTemplateDto, TemplateVariablesDto, UpdateAutomationTemplateDto } from "./dto/automation-template.dto";
import { AutomationTemplatesService } from "./automation-templates.service";

@ApiTags("Instagram automation templates")
@ApiBearerAuth()
@Controller("api/organizations/:organizationId/automation-templates")
export class AutomationTemplatesController {
  constructor(private readonly templates: AutomationTemplatesService) {}

  @Get()
  @ApiOperation({ summary: "List system and organization automation templates" })
  list(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Query() query: AutomationTemplateListQueryDto) {
    return this.templates.list(organizationId, query);
  }

  @Post()
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  create(@Param("organizationId", ParseUUIDPipe) organizationId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAutomationTemplateDto) {
    return this.templates.create(organizationId, user, dto);
  }

  @Post("import")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  import(@Param("organizationId", ParseUUIDPipe) organizationId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: ImportAutomationTemplateDto) {
    return this.templates.import(organizationId, user, dto.document);
  }

  @Get(":templateId")
  get(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("templateId", ParseUUIDPipe) templateId: string) {
    return this.templates.get(organizationId, templateId);
  }

  @Get(":templateId/export")
  export(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("templateId", ParseUUIDPipe) templateId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.export(organizationId, user, templateId);
  }

  @Get(":templateId/versions")
  versions(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("templateId", ParseUUIDPipe) templateId: string) {
    return this.templates.versions(organizationId, templateId);
  }

  @Get(":templateId/versions/:version")
  version(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("templateId", ParseUUIDPipe) templateId: string, @Param("version", ParseIntPipe) version: number) {
    return this.templates.version(organizationId, templateId, version);
  }

  @Patch(":templateId")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  update(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("templateId", ParseUUIDPipe) templateId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateAutomationTemplateDto) {
    return this.templates.update(organizationId, templateId, user, dto);
  }

  @Post(":templateId/duplicate")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  duplicate(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("templateId", ParseUUIDPipe) templateId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: DuplicateAutomationTemplateDto) {
    return this.templates.duplicate(organizationId, user, templateId, dto);
  }

  @Post(":templateId/archive")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  archive(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("templateId", ParseUUIDPipe) templateId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.archive(organizationId, user, templateId);
  }

  @Post(":templateId/restore")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  restore(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("templateId", ParseUUIDPipe) templateId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.restore(organizationId, user, templateId);
  }

  @Delete(":templateId")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  remove(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("templateId", ParseUUIDPipe) templateId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.templates.remove(organizationId, user, templateId);
  }

  @Post(":templateId/validate")
  validate(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("templateId", ParseUUIDPipe) templateId: string, @Body() dto: TemplateVariablesDto) {
    return this.templates.validateVariables(organizationId, templateId, dto.variables);
  }

  @Post(":templateId/preview")
  preview(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("templateId", ParseUUIDPipe) templateId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: ApplyAutomationTemplateDto) {
    return this.templates.preview(organizationId, user, templateId, dto);
  }

  @Post(":templateId/apply")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  apply(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Param("templateId", ParseUUIDPipe) templateId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: ApplyAutomationTemplateDto) {
    return this.templates.apply(organizationId, user, templateId, dto);
  }
}
