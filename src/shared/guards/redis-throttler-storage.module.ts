import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisThrottlerStorage } from './redis-throttler-storage';

@Module({
  imports: [ConfigModule],
  providers: [RedisThrottlerStorage],
  exports: [RedisThrottlerStorage],
})
export class RedisThrottlerStorageModule {}
