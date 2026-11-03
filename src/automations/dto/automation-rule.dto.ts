import { AutomationTriggerType } from "@prisma/client";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import {
  IsBoolean,
  IsEnum,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import {
  isAutomationActions,
  isAutomationConditions,
} from "../automation-rule.schema";

@ValidatorConstraint({ name: "automationConditions", async: false })
class AutomationConditionsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isAutomationConditions(value);
  }

  defaultMessage(): string {
    return "conditions must use the supported structured condition schema";
  }
}

@ValidatorConstraint({ name: "automationActions", async: false })
class AutomationActionsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isAutomationActions(value);
  }

  defaultMessage(): string {
    return "actions must use supported action objects and safe per-rule limits";
  }
}

export class CreateAutomationRuleDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  instagramAccountId!: string;

  @ApiProperty({ example: "Comment keyword response", maxLength: 120 })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiProperty({ enum: AutomationTriggerType })
  @IsEnum(AutomationTriggerType)
  triggerType!: AutomationTriggerType;

  @ApiProperty({
    example: {
      match: "ALL",
      rules: [{ field: "text", operator: "CONTAINS", value: "launch" }],
    },
  })
  @IsObject()
  @Validate(AutomationConditionsConstraint)
  conditions!: unknown;

  @ApiProperty({
    example: [{ type: "REPLY_COMMENT", text: "Thanks for your comment!" }],
  })
  @IsArray()
  @Validate(AutomationActionsConstraint)
  actions!: unknown;
}

export class UpdateAutomationRuleDto extends PartialType(
  CreateAutomationRuleDto,
) {}

export class AutomationRulesQueryDto {
  @IsOptional()
  @IsUUID()
  instagramAccountId?: string;
}

export class AutomationExecutionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsUUID()
  instagramAccountId?: string;

  @IsOptional()
  @IsUUID()
  ruleId?: string;

  @IsOptional()
  @IsUUID()
  webhookEventId?: string;

  @IsOptional()
  @IsIn(["PROCESSING", "SUCCESS", "FAILED", "SKIPPED"])
  status?: "PROCESSING" | "SUCCESS" | "FAILED" | "SKIPPED";
}

@ValidatorConstraint({ name: "automationSimulationData", async: false })
class AutomationSimulationDataConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const allowed = new Set([
      "text",
      "commentId",
      "messageId",
      "senderId",
      "mediaId",
      "conversationId",
    ]);
    const record = value as Record<string, unknown>;
    return Object.entries(record).every(
      ([key, item]) =>
        allowed.has(key) &&
        typeof item === "string" &&
        item.length > 0 &&
        item.length <= (key === "text" ? 5_000 : 255),
    );
  }

  defaultMessage(): string {
    return "data may contain only bounded text and Instagram event identifiers";
  }
}

export class SimulateAutomationEventDto {
  @ApiProperty({ enum: ["instagram.change", "instagram.messaging"] })
  @IsString()
  eventType!: "instagram.change" | "instagram.messaging";

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalEventId?: string;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  field?: string;

  @ApiPropertyOptional({
    description: "Unix timestamp in milliseconds for message-window validation",
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  eventTimestamp?: number;

  @ApiProperty({
    example: {
      text: "I want details",
      commentId: "mock-comment-1",
      senderId: "mock-contact-1",
    },
  })
  @IsObject()
  @Validate(AutomationSimulationDataConstraint)
  data!: Record<string, string>;
}

export class AutomationNotificationsQueryDto {
  @IsOptional()
  @IsUUID()
  instagramAccountId?: string;

  @IsOptional()
  @IsUUID()
  ruleId?: string;
}

export class AutomationExecutionListQueryDto extends AutomationExecutionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number;
}
