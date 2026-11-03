import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AutomationTemplateCategory,
  AutomationTemplateScope,
  AutomationTriggerType,
  InstagramAccountStatus,
  Prisma,
} from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../shared/types/authenticated-user";
import { InstagramAccountManagementService } from "../instagram/instagram-account-management.service";
import { AutomationRulesService } from "./automation-rules.service";
import {
  ApplyAutomationTemplateDto,
  CreateAutomationTemplateDto,
  DuplicateAutomationTemplateDto,
  UpdateAutomationTemplateDto,
} from "./dto/automation-template.dto";
import {
  assertTemplateContent,
  exportTemplate,
  parseTemplateImport,
  renderTemplate,
  resolveTemplateVariables,
  TemplateContent,
  templateSnapshot,
  validateVariableSchema,
} from "./automation-template.schema";
import {
  isAutomationActions,
  isAutomationConditions,
} from "./automation-rule.schema";

const MAX_ORGANIZATION_TEMPLATES = 100;

@Injectable()
export class AutomationTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: AutomationRulesService,
    private readonly audit: AuditService,
    private readonly accountAccess: InstagramAccountManagementService,
  ) {}

  async list(
    organizationId: string,
    query: { category?: AutomationTemplateCategory; search?: string; includeArchived?: boolean },
  ) {
    const common: Prisma.AutomationTemplateWhereInput = {
      ...(query.category ? { category: query.category } : {}),
      ...(query.search ? { name: { contains: query.search.trim(), mode: "insensitive" } } : {}),
    };
    const [system, organization] = await Promise.all([
      this.prisma.automationTemplate.findMany({
        where: { ...common, scope: "SYSTEM", active: true, archivedAt: null },
      }),
      this.prisma.automationTemplate.findMany({
        where: {
          ...common,
          scope: "ORGANIZATION",
          organizationId,
          ...(query.includeArchived ? {} : { archivedAt: null }),
        },
      }),
    ]);
    return [...system, ...organization].sort(
      (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
    );
  }

  get(organizationId: string, templateId: string) {
    return this.findVisible(organizationId, templateId);
  }

  async create(organizationId: string, user: AuthenticatedUser, dto: CreateAutomationTemplateDto) {
    const content: TemplateContent = { ...dto, schemaVersion: dto.schemaVersion ?? 1, active: dto.active ?? true };
    assertTemplateContent(content);
    const template = await this.createWithInitialVersion(organizationId, user.sub, content);
    await this.auditTemplate(organizationId, user.sub, "AUTOMATION_TEMPLATE_CREATED", template.id);
    return template;
  }

  async update(organizationId: string, templateId: string, user: AuthenticatedUser, dto: UpdateAutomationTemplateDto) {
    await this.requireOrganizationTemplate(organizationId, templateId);
    let template;
    try {
      template = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM automation_templates WHERE id = ${templateId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
        const current = await tx.automationTemplate.findFirst({ where: { id: templateId, organizationId, scope: "ORGANIZATION" } });
        if (!current) throw new NotFoundException("Automation template not found");
        const content = this.contentFrom(current, dto);
        assertTemplateContent(content);
        const version = current.version + 1;
        const updated = await tx.automationTemplate.update({ where: { id: templateId }, data: { ...this.contentData(content), version } });
        await tx.automationTemplateVersion.create({
          data: { templateId, version, schemaVersion: content.schemaVersion, snapshot: templateSnapshot(content), authorUserId: user.sub },
        });
        return updated;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException("A template with this name already exists in the organization");
      throw error;
    }
    await this.auditTemplate(organizationId, user.sub, "AUTOMATION_TEMPLATE_UPDATED", templateId, { version: template.version });
    return template;
  }

  async versions(organizationId: string, templateId: string) {
    await this.findVisible(organizationId, templateId);
    return this.prisma.automationTemplateVersion.findMany({
      where: { templateId }, orderBy: { version: "desc" },
      select: { version: true, schemaVersion: true, snapshot: true, authorUserId: true, createdAt: true },
    });
  }

  async version(organizationId: string, templateId: string, version: number) {
    await this.findVisible(organizationId, templateId);
    const item = await this.prisma.automationTemplateVersion.findFirst({
      where: { templateId, version },
      select: { version: true, schemaVersion: true, snapshot: true, authorUserId: true, createdAt: true },
    });
    if (!item) throw new NotFoundException("Automation template version not found");
    return item;
  }

  async duplicate(organizationId: string, user: AuthenticatedUser, templateId: string, dto: DuplicateAutomationTemplateDto) {
    const source = await this.findVisible(organizationId, templateId);
    const content = {
      ...this.contentFrom(source, {}),
      name: (dto.name ?? `${source.name} (copy)`).trim(),
      active: true,
    };
    assertTemplateContent(content);
    const created = await this.createWithInitialVersion(organizationId, user.sub, content);
    await this.auditTemplate(organizationId, user.sub, "AUTOMATION_TEMPLATE_DUPLICATED", created.id, { sourceScope: source.scope });
    return created;
  }

  async archive(organizationId: string, user: AuthenticatedUser, templateId: string) {
    await this.requireOrganizationTemplate(organizationId, templateId);
    const result = await this.prisma.automationTemplate.updateMany({
      where: { id: templateId, organizationId, archivedAt: null }, data: { archivedAt: new Date() },
    });
    if (!result.count) throw new ConflictException("Template is already archived");
    await this.auditTemplate(organizationId, user.sub, "AUTOMATION_TEMPLATE_ARCHIVED", templateId);
    return this.get(organizationId, templateId);
  }

  async restore(organizationId: string, user: AuthenticatedUser, templateId: string) {
    await this.requireOrganizationTemplate(organizationId, templateId);
    try {
      const result = await this.prisma.automationTemplate.updateMany({
        where: { id: templateId, organizationId, archivedAt: { not: null } }, data: { archivedAt: null },
      });
      if (!result.count) throw new ConflictException("Template is not archived");
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException("An active template with this name already exists");
      throw error;
    }
    await this.auditTemplate(organizationId, user.sub, "AUTOMATION_TEMPLATE_RESTORED", templateId);
    return this.get(organizationId, templateId);
  }

  async remove(organizationId: string, user: AuthenticatedUser, templateId: string) {
    await this.requireOrganizationTemplate(organizationId, templateId);
    const result = await this.prisma.automationTemplate.deleteMany({
      where: { id: templateId, organizationId, archivedAt: { not: null } },
    });
    if (!result.count) throw new ConflictException("Archive the template before permanently deleting it");
    await this.auditTemplate(organizationId, user.sub, "AUTOMATION_TEMPLATE_DELETED", templateId);
    return { deleted: true };
  }

  async validateVariables(organizationId: string, templateId: string, input: unknown) {
    const template = await this.findVisible(organizationId, templateId);
    try {
      const schema = validateVariableSchema(template.variables);
      return { valid: true, values: resolveTemplateVariables(schema, input), errors: [] };
    } catch (error) {
      if (error instanceof BadRequestException) return { valid: false, values: {}, errors: [error.message] };
      throw error;
    }
  }

  async preview(organizationId: string, user: AuthenticatedUser, templateId: string, dto: ApplyAutomationTemplateDto) {
    const template = await this.findVisible(organizationId, templateId);
    const rendered = this.prepareRule(template, dto.variables);
    await this.accountAccess.assertAccountReadable(organizationId, dto.instagramAccountId, user);
    await this.assertConnectedAccount(organizationId, dto.instagramAccountId);
    return {
      instagramAccountId: dto.instagramAccountId,
      name: dto.ruleName?.trim() || template.name,
      active: false,
      triggerType: template.triggerType,
      ...rendered,
    };
  }

  async apply(organizationId: string, user: AuthenticatedUser, templateId: string, dto: ApplyAutomationTemplateDto) {
    const template = await this.findVisible(organizationId, templateId);
    if (!template.active || template.archivedAt) throw new ConflictException("Inactive or archived templates cannot be applied");
    const rendered = this.prepareRule(template, dto.variables);
    const rule = await this.rules.create(organizationId, {
      instagramAccountId: dto.instagramAccountId,
      name: dto.ruleName?.trim() || template.name,
      active: false,
      triggerType: template.triggerType,
      ...rendered,
    });
    await this.auditTemplate(organizationId, user.sub, "AUTOMATION_TEMPLATE_APPLIED", templateId, { ruleId: rule.id, version: template.version });
    return rule;
  }

  async export(organizationId: string, user: AuthenticatedUser, templateId: string) {
    const template = await this.findVisible(organizationId, templateId);
    await this.auditTemplate(organizationId, user.sub, "AUTOMATION_TEMPLATE_EXPORTED", templateId, { version: template.version });
    return exportTemplate(this.contentFrom(template, {}));
  }

  async import(organizationId: string, user: AuthenticatedUser, document: unknown) {
    const imported = parseTemplateImport(document);
    const content: TemplateContent = { ...imported, active: true };
    const created = await this.createWithInitialVersion(organizationId, user.sub, content);
    await this.auditTemplate(organizationId, user.sub, "AUTOMATION_TEMPLATE_IMPORTED", created.id);
    return created;
  }

  private async findVisible(organizationId: string, id: string) {
    const template = await this.prisma.automationTemplate.findFirst({
      where: {
        id,
        OR: [
          { scope: AutomationTemplateScope.SYSTEM, organizationId: null },
          { scope: AutomationTemplateScope.ORGANIZATION, organizationId },
        ],
      },
    });
    if (!template) throw new NotFoundException("Automation template not found");
    return template;
  }

  private async requireOrganizationTemplate(organizationId: string, id: string) {
    const template = await this.prisma.automationTemplate.findFirst({
      where: { id, scope: AutomationTemplateScope.ORGANIZATION, organizationId },
    });
    if (template) return template;
    const system = await this.prisma.automationTemplate.findFirst({
      where: { id, scope: AutomationTemplateScope.SYSTEM, organizationId: null }, select: { id: true },
    });
    if (system) throw new ForbiddenException("System templates are read-only; duplicate the template to customize it");
    throw new NotFoundException("Automation template not found");
  }

  private contentFrom(
    template: {
      name: string;
      description: string | null;
      category: AutomationTemplateCategory;
      schemaVersion: number;
      triggerType: AutomationTriggerType;
      conditions: Prisma.JsonValue;
      actions: Prisma.JsonValue;
      variables: Prisma.JsonValue;
      active: boolean;
    },
    changes: UpdateAutomationTemplateDto,
  ): TemplateContent {
    return {
      name: changes.name ?? template.name,
      description: changes.description === undefined ? template.description : changes.description,
      category: changes.category ?? template.category,
      schemaVersion: changes.schemaVersion ?? template.schemaVersion,
      triggerType: changes.triggerType ?? template.triggerType,
      conditions: changes.conditions ?? template.conditions,
      actions: changes.actions ?? template.actions,
      variables: changes.variables ?? template.variables,
      active: changes.active ?? template.active,
    };
  }

  private createData(organizationId: string, authorUserId: string, content: TemplateContent): Prisma.AutomationTemplateCreateInput {
    return {
      scope: AutomationTemplateScope.ORGANIZATION,
      organization: { connect: { id: organizationId } },
      author: { connect: { id: authorUserId } },
      version: 1,
      ...this.contentData(content),
    };
  }

  private contentData(content: TemplateContent) {
    return {
      name: content.name.trim(),
      description: content.description ?? null,
      category: content.category,
      schemaVersion: content.schemaVersion,
      triggerType: content.triggerType,
      conditions: content.conditions as Prisma.InputJsonValue,
      actions: content.actions as Prisma.InputJsonValue,
      variables: content.variables as Prisma.InputJsonValue,
      active: content.active,
    };
  }

  private async createWithInitialVersion(organizationId: string, authorUserId: string, content: TemplateContent) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
        const count = await tx.automationTemplate.count({ where: { organizationId, scope: AutomationTemplateScope.ORGANIZATION } });
        if (count >= MAX_ORGANIZATION_TEMPLATES) throw new ConflictException(`Organization template limit (${MAX_ORGANIZATION_TEMPLATES}) reached`);
        const created = await tx.automationTemplate.create({ data: this.createData(organizationId, authorUserId, content) });
        await tx.automationTemplateVersion.create({
          data: { templateId: created.id, version: 1, schemaVersion: content.schemaVersion, snapshot: templateSnapshot(content), authorUserId },
        });
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException("A template with this name already exists in the organization");
      throw error;
    }
  }

  private prepareRule(
    template: {
      active: boolean;
      archivedAt: Date | null;
      name: string;
      category: AutomationTemplateCategory;
      schemaVersion: number;
      triggerType: AutomationTriggerType;
      conditions: Prisma.JsonValue;
      actions: Prisma.JsonValue;
      variables: Prisma.JsonValue;
    },
    input: unknown,
  ) {
    if (template.schemaVersion !== 1) throw new BadRequestException("Template schema version is not compatible");
    assertTemplateContent(template as TemplateContent);
    const variables = resolveTemplateVariables(validateVariableSchema(template.variables), input);
    const rendered = renderTemplate(template, variables);
    if (!isAutomationConditions(rendered.conditions) || !isAutomationActions(rendered.actions)) {
      throw new BadRequestException("Resolved template is not a valid automation rule");
    }
    return rendered;
  }

  private async assertConnectedAccount(organizationId: string, accountId: string) {
    const account = await this.prisma.instagramAccount.findFirst({
      where: { id: accountId, organizationId, status: InstagramAccountStatus.CONNECTED },
      select: { id: true },
    });
    if (!account) throw new NotFoundException("Connected Instagram account not found");
  }

  private async auditTemplate(organizationId: string, userId: string, action: string, resourceId: string, metadata?: Record<string, unknown>) {
    await this.audit.record({ organizationId, userId, action, resourceType: "automation_template", resourceId, metadata });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
