import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Max, MaxLength, Min, IsInt } from 'class-validator';

export class AuditLogsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;
}
