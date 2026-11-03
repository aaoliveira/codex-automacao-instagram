import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { InstagramEventsQueryDto } from "./dto/instagram-events-query.dto";
import { InstagramEventsService } from "./instagram-events.service";

@ApiTags("Instagram events")
@ApiBearerAuth()
@Controller("api/organizations/:organizationId/instagram/events")
export class InstagramEventsController {
  constructor(private readonly events: InstagramEventsService) {}

  @Get()
  @ApiOperation({
    summary: "List Instagram events visible to the active organization",
  })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @ApiQuery({ name: "accountId", required: false, type: String })
  @ApiQuery({ name: "type", required: false, enum: ["comments", "messages", "other"] })
  @ApiQuery({ name: "status", required: false, enum: ["pending", "processed", "error"] })
  list(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Query() query: InstagramEventsQueryDto,
  ) {
    return this.events.list(organizationId, query);
  }

  @Get(":eventId")
  @ApiOperation({
    summary: "Get a safe, tenant-scoped Instagram event projection",
  })
  get(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("eventId", ParseUUIDPipe) eventId: string,
  ) {
    return this.events.get(organizationId, eventId);
  }
}
