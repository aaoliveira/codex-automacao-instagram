import { ApiProperty } from "@nestjs/swagger";
import { IsDateString, IsString, Matches, MaxLength } from "class-validator";

export class SchedulePublicationDto {
  @ApiProperty({
    description:
      "RFC 3339 timestamp with an explicit UTC offset, for example 2026-11-03T14:30:00-03:00",
  })
  @IsDateString({ strict: true, strictSeparator: true })
  @Matches(
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/,
  )
  scheduledAt!: string;

  @ApiProperty({
    description: "IANA timezone used when scheduling, for example America/Bahia",
    example: "America/Bahia",
  })
  @IsString()
  @MaxLength(64)
  timezone!: string;
}
