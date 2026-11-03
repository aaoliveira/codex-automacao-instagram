import {
  Body,
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
import { MembershipRole, PublicationStatus } from "@prisma/client";
import { Roles } from "../shared/decorators/roles.decorator";
import { CreatePublicationDto } from "./dto/create-publication.dto";
import { PublicationsQueryDto } from "./dto/publications-query.dto";
import { SchedulePublicationDto } from "./dto/schedule-publication.dto";
import { PublishingService } from "./publishing.service";

@ApiTags("Instagram publications")
@ApiBearerAuth()
@Controller("api/organizations/:organizationId/instagram/publications")
export class PublishingController {
  constructor(private readonly publishing: PublishingService) {}

  @Post()
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: "Create an idempotent Instagram publication draft" })
  createDraft(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Body() dto: CreatePublicationDto,
  ) {
    return this.publishing.createDraft(organizationId, dto);
  }

  @Post(":publicationId/publish")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Queue a draft for immediate publication" })
  publishNow(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("publicationId", ParseUUIDPipe) publicationId: string,
  ) {
    return this.publishing.publishNow(organizationId, publicationId);
  }

  @Post(":publicationId/schedule")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Schedule a draft at an RFC 3339 date and time" })
  schedule(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("publicationId", ParseUUIDPipe) publicationId: string,
    @Body() dto: SchedulePublicationDto,
  ) {
    return this.publishing.schedule(organizationId, publicationId, dto);
  }

  @Get()
  @ApiOperation({ summary: "List tenant publication history" })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @ApiQuery({ name: "instagramAccountId", required: false, type: String })
  @ApiQuery({ name: "status", required: false, enum: PublicationStatus })
  list(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query() query: PublicationsQueryDto,
  ) {
    return this.publishing.list(organizationId, query);
  }

  @Get(":publicationId")
  @ApiOperation({ summary: "Read publication status and provider identifiers" })
  get(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("publicationId", ParseUUIDPipe) publicationId: string,
  ) {
    return this.publishing.get(organizationId, publicationId);
  }

  @Post(":publicationId/cancel")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: "Cancel a draft or a publication still waiting in the queue" })
  cancel(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("publicationId", ParseUUIDPipe) publicationId: string,
  ) {
    return this.publishing.cancel(organizationId, publicationId);
  }
}
