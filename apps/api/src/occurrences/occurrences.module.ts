import { Module } from '@nestjs/common';
import { ConfirmationsService } from './confirmations.service';
import { OccurrencesController } from './occurrences.controller';
import { OccurrencesService } from './occurrences.service';

@Module({
  controllers: [OccurrencesController],
  providers: [OccurrencesService, ConfirmationsService],
  exports: [OccurrencesService],
})
export class OccurrencesModule {}
