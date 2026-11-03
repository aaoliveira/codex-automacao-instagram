import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class InstagramOAuthCallbackDto {
  @ApiPropertyOptional({
    description: "Authorization code returned by Instagram.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  code?: string;

  @ApiPropertyOptional({
    description: "One-time OAuth state issued by this API.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  state?: string;

  @ApiPropertyOptional({
    description: "OAuth error code returned by Instagram.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  error?: string;

  @ApiPropertyOptional({
    description: "Provider error detail. Never stored or returned by the API.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  error_description?: string;

  @ApiPropertyOptional({ description: "Provider error reason." })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  error_reason?: string;
}
