import { Module } from '@nestjs/common';
import { ProgressController } from './progress.controller';
import { ProgressService } from './progress.service';
import { QueueService } from './queue.service';

@Module({
  controllers: [ProgressController],
  providers: [ProgressService, QueueService],
})
export class ProgressModule {}
