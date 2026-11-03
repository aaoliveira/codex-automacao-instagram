import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import { Roles } from '../shared/decorators/roles.decorator';
import { AuditLogsQueryDto } from './dto/audit-logs-query.dto';
import { AuditService } from './audit.service';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('api/organizations/:organizationId/audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'List organization audit records without request or secret payloads' })
  list(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query() query: AuditLogsQueryDto,
  ) {
    return this.audit.list(organizationId, query);
  }
}
