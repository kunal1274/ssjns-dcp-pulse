import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MONEY_PATTERN } from '../common/money';

export class PageQuery {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

export class SchemeQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() financialYearId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() jurisdictionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class CreateSchemeDto {
  @ApiProperty({ example: 'DEMO-101' }) @Matches(/^[A-Z0-9][A-Z0-9-]{2,49}$/) schemeCode!: string;
  @ApiProperty() @IsString() @Length(3, 300) name!: string;
  @ApiProperty() @IsString() @Length(2, 50) category!: string;
  @ApiProperty() @IsUUID() financialYearId!: string;
  @ApiProperty() @IsUUID() agencyId!: string;
  @ApiProperty({ description: 'District or co-district' }) @IsUUID() jurisdictionId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) department?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) objectives?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() targetEndDate?: string;
  @ApiPropertyOptional({
    example: '2500000.00',
    description: 'Proposed scheme budget (INR); approved with the scheme',
  })
  @IsOptional()
  @Matches(MONEY_PATTERN)
  proposedBudget?: string;
}

export class UpdateSchemeDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 300) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 50) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) department?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) objectives?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() targetEndDate?: string;
}

export class VersionDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}

export class SchemeDecisionDto extends VersionDto {
  @ApiProperty({ enum: ['APPROVE', 'RETURN'] }) @IsIn(['APPROVE', 'RETURN']) decision!:
    'APPROVE' | 'RETURN';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

export class SchemeTransitionDto extends VersionDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'COMPLETED', 'CLOSED', 'CANCELLED'] })
  @IsIn(['ACTIVE', 'SUSPENDED', 'COMPLETED', 'CLOSED', 'CANCELLED'])
  to!: 'ACTIVE' | 'SUSPENDED' | 'COMPLETED' | 'CLOSED' | 'CANCELLED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
