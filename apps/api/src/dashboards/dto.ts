import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PageQuery } from '../schemes/dto';

export class DashboardQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() financialYearId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() districtId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() coDistrictId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) department?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() agencyId?: string;
  @ApiPropertyOptional({ description: 'Cumulative up to this reporting period end date' })
  @IsOptional()
  @IsUUID()
  periodId?: string;
}

export class SchemeListQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() financialYearId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() districtId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() coDistrictId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() jurisdictionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) department?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() agencyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() periodId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  delayedOnly?: boolean;
}
