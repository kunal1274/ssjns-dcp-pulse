import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQuery } from '../schemes/dto';

/** numeric(18,3), non-negative. */
export const QUANTITY_PATTERN = /^\d{1,15}(\.\d{1,3})?$/;

export class MeasurementDto {
  @ApiProperty() @IsUUID() milestoneId!: string;
  @ApiProperty({ example: '4.000', description: 'Cumulative quantity completed to date' })
  @Matches(QUANTITY_PATTERN)
  quantityCompleted!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class CreateProgressDto {
  @ApiProperty() @IsUUID() schemeId!: string;
  @ApiProperty() @IsUUID() periodId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
  @ApiProperty({ type: [MeasurementDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MeasurementDto)
  measurements!: MeasurementDto[];
}

export class UpdateProgressDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
  @ApiPropertyOptional({ type: [MeasurementDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MeasurementDto)
  measurements?: MeasurementDto[];
}

export class ProgressVersionDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}

export class ProgressReturnDto extends ProgressVersionDto {
  @ApiProperty() @IsString() @MaxLength(1000) reason!: string;
}

export class ProgressQuery extends PageQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() schemeId?: string;
  @ApiPropertyOptional({
    enum: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'RETURNED', 'RESUBMITTED'],
  })
  @IsOptional()
  @IsIn(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'RETURNED', 'RESUBMITTED'])
  status?: string;
}
