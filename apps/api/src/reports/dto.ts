import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ReportQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() financialYearId?: string;
  @ApiPropertyOptional({ description: 'Cumulative up to this reporting period end date' })
  @IsOptional()
  @IsUUID()
  periodId?: string;
  @ApiPropertyOptional({ description: 'Restrict to this jurisdiction and its descendants' })
  @IsOptional()
  @IsUUID()
  jurisdictionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) category?: string;
  @ApiPropertyOptional({ description: 'Required for scheme-history' })
  @IsOptional()
  @IsUUID()
  schemeId?: string;
  @ApiPropertyOptional({ description: 'audit-activity: from date (inclusive)' })
  @IsOptional()
  @IsDateString()
  from?: string;
  @ApiPropertyOptional({ description: 'audit-activity: to date (inclusive)' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ExportQuery extends ReportQuery {
  @ApiPropertyOptional({ enum: ['csv', 'xlsx'] }) @IsIn(['csv', 'xlsx']) format!: 'csv' | 'xlsx';
}
