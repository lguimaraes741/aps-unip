import { Module } from '@nestjs/common';
import { AdminController, GovernanceController } from './admin.controller';
import { GovernanceService } from './governance.service';
import { ModerationService } from './moderation.service';
import { StatisticsService } from './statistics.service';

@Module({
  controllers: [AdminController, GovernanceController],
  providers: [ModerationService, StatisticsService, GovernanceService],
})
export class AdminModule {}
