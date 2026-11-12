import { Module } from '@nestjs/common';
import { BudgetController } from '../budget/budget.controller';
import { BudgetService } from '../budget/budget.service';
import { SchemesController } from './schemes.controller';
import { SchemesService } from './schemes.service';

@Module({
  controllers: [SchemesController, BudgetController],
  providers: [SchemesService, BudgetService],
})
export class SchemesModule {}
