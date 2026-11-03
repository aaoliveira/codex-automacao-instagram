import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../shared/decorators/public.decorator';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness check' })
  health() {
    return this.healthService.health();
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness check for PostgreSQL and Redis' })
  ready() {
    return this.healthService.ready();
  }
}
