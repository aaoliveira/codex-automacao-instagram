import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../shared/decorators/public.decorator';
import { MetricsService } from './metrics.service';

@ApiTags('Observability')
@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Prometheus-compatible process and HTTP metrics' })
  scrape() {
    return this.metrics.renderPrometheus();
  }
}
