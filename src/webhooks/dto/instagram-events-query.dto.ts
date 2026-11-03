import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from "class-validator";

export class InstagramEventsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsIn(["comments", "messages", "other"])
  type?: "comments" | "messages" | "other";

  @IsOptional()
  @IsIn(["pending", "processed", "error"])
  status?: "pending" | "processed" | "error";
}
