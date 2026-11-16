import { Global, Module } from '@nestjs/common';
import { AlertEngineService } from './alert-engine.service';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { CorrectiveActionsService } from './corrective-actions.service';
import { GisService } from './gis.service';

@Global()
@Module({
  controllers: [AlertsController],
  providers: [AlertEngineService, AlertsService, CorrectiveActionsService, GisService],
  exports: [AlertEngineService],
})
export class AlertsModule {}
