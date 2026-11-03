import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsUUID, Matches } from "class-validator";
import { AnalyticsPeriodDto } from "./analytics-period.dto";

export class StartAnalyticsSyncDto extends AnalyticsPeriodDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  declare instagramAccountId: string;

  @ApiProperty({
    example: "analytics-sync-june-2026-account-1",
    minLength: 8,
    maxLength: 128,
  })
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,128}$/)
  declare idempotencyKey: string;
}
