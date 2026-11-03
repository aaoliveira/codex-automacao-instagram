import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { MembershipRole } from "@prisma/client";
import { Roles } from "../shared/decorators/roles.decorator";
import { QueueJobsQueryDto } from "./dto/queue-jobs-query.dto";
import { PublishingService } from "./publishing.service";

@ApiTags("Queue operations")
@ApiBearerAuth()
@Controller("api/organizations/:organizationId/jobs")
export class QueueOperationsController {
  constructor(private readonly publishing: PublishingService) {}

  @Get()
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({
    summary: "List this organization's Instagram publication jobs",
  })
  @ApiQuery({ name: "state", required: false, enum: ["WAITING", "PROCESSING", "COMPLETED", "FAILED", "CANCELED"] })
  list(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query() query: QueueJobsQueryDto,
  ) {
    return this.publishing.listJobs(organizationId, query);
  }

  @Get("metrics")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: "Read tenant-scoped publication queue metrics" })
  metrics(@Param("organizationId", ParseUUIDPipe) organizationId: string) {
    return this.publishing.jobMetrics(organizationId);
  }

  @Post("publications/:publicationId/retry")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Manually retry a retained failed publication job" })
  retry(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("publicationId", ParseUUIDPipe) publicationId: string,
  ) {
    return this.publishing.retryFailed(organizationId, publicationId);
  }

  @Post("publications/:publicationId/cancel")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Cancel a publication job that has not started" })
  cancel(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("publicationId", ParseUUIDPipe) publicationId: string,
  ) {
    return this.publishing.cancel(organizationId, publicationId);
  }
}
