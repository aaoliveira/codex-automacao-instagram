import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { AnalyticsPeriodDto } from "./analytics-period.dto";

export class AnalyticsSeriesQueryDto extends AnalyticsPeriodDto {
  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  metricKey?: string;
}
