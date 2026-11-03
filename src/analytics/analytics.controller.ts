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
import { CurrentUser } from "../shared/decorators/current-user.decorator";
import { AuthenticatedUser } from "../shared/types/authenticated-user";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsPeriodDto } from "./dto/analytics-period.dto";
import { AnalyticsSeriesQueryDto } from "./dto/analytics-series-query.dto";
import { StartAnalyticsSyncDto } from "./dto/start-analytics-sync.dto";

@ApiTags("Publication analytics")
@ApiBearerAuth()
@Controller("api/organizations/:organizationId/analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("metrics")
  @ApiOperation({
    summary:
      "List supported analytics metrics and their source, units and availability",
  })
  metrics() {
    return this.analytics.metricCatalog();
  }

  @Get("summary")
  @ApiOperation({
    summary:
      "Summarize publication metrics and compare with the previous equal-length period",
  })
  @ApiQuery({ name: "fromDate", example: "2026-06-01" })
  @ApiQuery({ name: "toDate", example: "2026-06-30" })
  @ApiQuery({ name: "timezone", example: "America/Sao_Paulo" })
  summary(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AnalyticsPeriodDto,
  ) {
    return this.analytics.summary(organizationId, user, query);
  }

  @Get("series")
  @ApiOperation({
    summary:
      "Group the latest publication metrics by publication date in an explicit timezone",
  })
  @ApiQuery({ name: "fromDate", example: "2026-06-01" })
  @ApiQuery({ name: "toDate", example: "2026-06-30" })
  @ApiQuery({ name: "timezone", example: "America/Sao_Paulo" })
  @ApiQuery({ name: "metricKey", required: false })
  series(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AnalyticsSeriesQueryDto,
  ) {
    return this.analytics.series(organizationId, user, query);
  }

  @Get("ranking")
  @ApiOperation({
    summary:
      "Rank publications by a metric for the selected publication period",
  })
  @ApiQuery({ name: "fromDate", example: "2026-06-01" })
  @ApiQuery({ name: "toDate", example: "2026-06-30" })
  @ApiQuery({ name: "timezone", example: "America/Sao_Paulo" })
  @ApiQuery({ name: "metricKey", required: false })
  ranking(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AnalyticsSeriesQueryDto,
  ) {
    return this.analytics.ranking(organizationId, user, query);
  }

  @Get("publications/:publicationId")
  @ApiOperation({
    summary:
      "Read the latest insights and snapshot history for an accessible publication",
  })
  publication(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("publicationId", ParseUUIDPipe) publicationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.analytics.publicationDetail(
      organizationId,
      publicationId,
      user,
    );
  }

  @Post("sync-runs")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      "Queue an idempotent insights synchronization for a connected account",
  })
  startSync(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartAnalyticsSyncDto,
  ) {
    return this.analytics.startSync(organizationId, user, dto);
  }

  @Get("sync-runs/:runId")
  @ApiOperation({
    summary:
      "Read the status and counters for an accessible synchronization run",
  })
  syncStatus(
    @Param("organizationId", ParseUUIDPipe) organizationId: string,
    @Param("runId", ParseUUIDPipe) runId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.analytics.syncStatus(organizationId, runId, user);
  }
}
