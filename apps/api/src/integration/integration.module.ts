import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [FinanceModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class IntegrationModule {}
