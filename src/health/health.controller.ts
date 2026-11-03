import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
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
  async ready(@Res({ passthrough: true }) response: Response) {
    const readiness = await this.healthService.ready();
    if (readiness.status === 'not_ready') response.status(503);
    return readiness;
  }
}
