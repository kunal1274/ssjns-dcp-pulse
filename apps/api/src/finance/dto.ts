import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { MONEY_PATTERN } from '../common/money';
import { PageQuery } from '../schemes/dto';

export class FinanceQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() schemeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) status?: string;
}

export class CreateReleaseDto {
  @ApiProperty() @IsUUID() schemeId!: string;
  @ApiProperty({ example: '1500000.00' }) @Matches(MONEY_PATTERN) amount!: string;
  @ApiProperty({ example: '2026-11-05' }) @IsDateString() releaseDate!: string;
  @ApiProperty() @IsString() @Length(3, 200) reference!: string;
}

export class CreateExpenditureDto {
  @ApiProperty() @IsUUID() schemeId!: string;
  @ApiProperty() @IsUUID() periodId!: string;
  @ApiProperty({ example: '250000.00' }) @Matches(MONEY_PATTERN) amount!: string;
  @ApiProperty({ example: '2026-11-20' }) @IsDateString() expenditureDate!: string;
  @ApiProperty() @IsString() @Length(3, 200) reference!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() progressSubmissionId?: string;
}

export class ResubmitExpenditureDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional() @IsOptional() @Matches(MONEY_PATTERN) amount?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expenditureDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 200) reference?: string;
}

export class FinanceDecisionDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiProperty({ enum: ['VERIFY', 'RETURN', 'REJECT'] })
  @IsIn(['VERIFY', 'RETURN', 'REJECT'])
  decision!: 'VERIFY' | 'RETURN' | 'REJECT';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class CorrectionDto {
  @ApiProperty({ example: '1450000.00' }) @Matches(MONEY_PATTERN) amount!: string;
  @ApiProperty() @IsString() @Length(10, 1000) reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 200) reference?: string;
}

export class CreateCommitmentDto {
  @ApiProperty() @IsUUID() schemeId!: string;
  @ApiProperty() @Matches(MONEY_PATTERN) amount!: string;
  @ApiProperty() @IsString() @Length(3, 200) reference!: string;
}

export class VersionDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}
