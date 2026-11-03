import { AutomationTemplateCategory, AutomationTriggerType } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsArray, IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";

export class CreateAutomationTemplateDto {
  @ApiProperty({ maxLength: 120 }) @IsString() @MaxLength(120) name!: string;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @ApiProperty({ enum: AutomationTemplateCategory }) @IsEnum(AutomationTemplateCategory) category!: AutomationTemplateCategory;
  @ApiProperty({ default: 1 }) @Type(() => Number) @IsInt() @Min(1) @Max(1) schemaVersion!: number;
  @ApiProperty({ enum: AutomationTriggerType }) @IsEnum(AutomationTriggerType) triggerType!: AutomationTriggerType;
  @ApiProperty({ type: Object }) @IsObject() conditions!: unknown;
  @ApiProperty({ type: Array }) @IsArray() actions!: unknown;
  @ApiProperty({ type: Array, description: "Typed variable definitions" }) @IsArray() variables!: unknown;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateAutomationTemplateDto extends PartialType(CreateAutomationTemplateDto) {}

export class AutomationTemplateListQueryDto {
  @ApiPropertyOptional({ enum: AutomationTemplateCategory }) @IsOptional() @IsEnum(AutomationTemplateCategory) category?: AutomationTemplateCategory;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) search?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @Transform(({ value }) => value === true || value === "true") @IsBoolean() includeArchived?: boolean;
}

export class DuplicateAutomationTemplateDto {
  @ApiPropertyOptional({ maxLength: 120 }) @IsOptional() @IsString() @MaxLength(120) name?: string;
}

export class TemplateVariablesDto {
  @ApiProperty({ type: Object, example: { brand_name: "Example" } }) @IsObject() variables!: Record<string, unknown>;
}

export class ApplyAutomationTemplateDto extends TemplateVariablesDto {
  @ApiProperty({ format: "uuid" }) @IsUUID() instagramAccountId!: string;
  @ApiPropertyOptional({ maxLength: 120 }) @IsOptional() @IsString() @MaxLength(120) ruleName?: string;
}

export class ImportAutomationTemplateDto {
  @ApiProperty({ type: Object }) @IsObject() document!: Record<string, unknown>;
}
