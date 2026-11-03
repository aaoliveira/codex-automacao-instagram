import {
  IsIn,
  IsObject,
  IsOptional,
  IsNumber,
  IsString,
  MaxLength,
} from "class-validator";

export class MockInstagramWebhookDto {
  @IsIn(["instagram.change", "instagram.messaging"])
  eventType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  externalEventId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  entryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  field?: string;

  @IsOptional()
  @IsNumber()
  eventTimestamp?: number;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
