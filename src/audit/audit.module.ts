import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditController } from './audit.controller';
import { AuditRetentionService, AuditService } from './audit.service';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AuditController],
  providers: [AuditService, AuditRetentionService],
  exports: [AuditService, AuditRetentionService],
})
export class AuditModule {}
