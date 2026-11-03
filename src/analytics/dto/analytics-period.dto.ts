import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from "class-validator";

export class AnalyticsPeriodDto {
  @ApiProperty({
    example: "2026-06-01",
    description: "Inclusive local calendar date",
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fromDate!: string;

  @ApiProperty({
    example: "2026-06-30",
    description: "Inclusive local calendar date",
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  toDate!: string;

  @ApiProperty({
    example: "America/Sao_Paulo",
    description:
      "IANA timezone used for period boundaries and calendar grouping",
  })
  @IsString()
  @MaxLength(64)
  timezone!: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  instagramAccountId?: string;
}
