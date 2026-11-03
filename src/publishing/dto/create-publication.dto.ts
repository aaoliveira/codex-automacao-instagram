import { PublicationMediaType } from "@prisma/client";
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";

export class CreatePublicationDto {
  @IsUUID()
  instagramAccountId!: string;

  @IsEnum(PublicationMediaType)
  mediaType!: PublicationMediaType;

  @ValidateIf((dto: CreatePublicationDto) => !dto.mediaAssetId)
  @IsUrl({ protocols: ["https"], require_protocol: true })
  @MaxLength(2048)
  mediaUrl?: string;

  @IsOptional()
  @IsUUID()
  mediaAssetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2200)
  caption?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  altText?: string;

  @IsOptional()
  @IsBoolean()
  shareToFeed?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  idempotencyKey?: string;
}
