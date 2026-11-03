import { Transform, Type } from "class-transformer";
import { InstagramAccountStatus, InstagramProviderType } from "@prisma/client";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsBoolean,
  IsUUID,
  IsIn,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class InstagramAccountsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsEnum(InstagramAccountStatus)
  status?: InstagramAccountStatus;

  @IsOptional()
  @IsEnum(InstagramProviderType)
  provider?: InstagramProviderType;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  tag?: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === "true" || value === true
      ? true
      : value === "false" || value === false
        ? false
        : value,
  )
  @IsBoolean()
  favorite?: boolean;

  @IsOptional()
  @IsIn(["createdAt", "username", "name", "lastSyncedAt", "internalAlias"])
  sortBy?: "createdAt" | "username" | "name" | "lastSyncedAt" | "internalAlias";

  @IsOptional()
  @IsIn(["asc", "desc"])
  sortOrder?: "asc" | "desc";
}
