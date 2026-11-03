import { Transform } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

export class CreateAccountGroupDto {
  @ApiProperty({ maxLength: 80 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ maxLength: 240, nullable: true })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(240)
  description?: string | null;
}

export class UpdateAccountGroupDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ maxLength: 240, nullable: true })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(240)
  description?: string | null;

  @ApiPropertyOptional({ minimum: 0, maximum: 100_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;
}

export class OrderAccountGroupsDto {
  @ApiProperty({
    type: [String],
    maxItems: 200,
    uniqueItems: true,
    description: "Every group UUID in the organization, in desired order.",
  })
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  groupIds!: string[];
}

export class AccountMetadataDto {
  @ApiPropertyOptional({ maxLength: 100, nullable: true })
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  internalAlias?: string | null;

  @ApiPropertyOptional({ type: [String], maxItems: 20, uniqueItems: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((tag) =>
          typeof tag === "string" ? tag.trim().toLowerCase() : tag,
        )
      : value,
  )
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(50, { each: true })
  tags?: string[];
}

export class BulkAccountsDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 50, uniqueItems: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  accountIds!: string[];
}

export class BulkMoveAccountsDto extends BulkAccountsDto {
  @ApiProperty({
    type: String,
    required: true,
    nullable: true,
    description: "Group UUID; null moves selected accounts to no group.",
  })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  groupId?: string | null;
}

export class BulkUpdateTagsDto extends BulkAccountsDto {
  @ApiProperty({ type: [String], maxItems: 20, uniqueItems: true })
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((tag) =>
          typeof tag === "string" ? tag.trim().toLowerCase() : tag,
        )
      : value,
  )
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(50, { each: true })
  tags!: string[];
}

export class GrantAccountAccessDto {
  @ApiProperty({ enum: ["VIEW", "MANAGE"] })
  @IsIn(["VIEW", "MANAGE"])
  level!: "VIEW" | "MANAGE";
}

export class MoveAccountDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: "Set to null to clear the current group.",
  })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  groupId?: string | null;
}

export class UpdateAccountSettingsDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 1_000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000)
  maxActiveAccounts?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  maxGroups?: number;
}
