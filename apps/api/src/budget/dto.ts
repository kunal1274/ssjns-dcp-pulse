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

export class CreateFinancialYearDto {
  @ApiProperty({ example: '2027-28' }) @Matches(/^[A-Za-z0-9-]{4,20}$/) code!: string;
  @ApiProperty({ example: '2027-04-01' }) @IsDateString() startDate!: string;
  @ApiProperty({ example: '2028-03-31' }) @IsDateString() endDate!: string;
}

export class CeilingQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() financialYearId?: string;
}

export class CreateCeilingDto {
  @ApiProperty() @IsUUID() financialYearId!: string;
  @ApiProperty({ description: 'Jurisdiction the ceiling applies to (normally the state)' })
  @IsUUID()
  jurisdictionId!: string;
  @ApiProperty({ example: '500000000.00' }) @Matches(MONEY_PATTERN) totalAmount!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) approvalReference?: string;
}

export class VersionBody {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}

export class AllocationQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() budgetVersionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['DRAFT', 'APPROVED', 'CANCELLED']) status?:
    'DRAFT' | 'APPROVED' | 'CANCELLED';
}

export class CreateAllocationDto {
  @ApiProperty() @IsUUID() budgetVersionId!: string;
  @ApiPropertyOptional({ description: 'Omit for a top-level allocation against the ceiling' })
  @IsOptional()
  @IsUUID()
  parentAllocationId?: string;
  @ApiProperty() @IsUUID() recipientJurisdictionId!: string;
  @ApiPropertyOptional({ description: 'Set for a leaf allocation to a scheme' })
  @IsOptional()
  @IsUUID()
  schemeId?: string;
  @ApiProperty({ example: '100000000.00' }) @Matches(MONEY_PATTERN) amount!: string;
}

export class CancelDto extends VersionBody {
  @ApiProperty() @IsString() @Length(3, 1000) reason!: string;
}

export class CreateRevisionDto {
  @ApiProperty({ enum: ['BUDGET_VERSION', 'ALLOCATION'] })
  @IsIn(['BUDGET_VERSION', 'ALLOCATION'])
  targetType!: 'BUDGET_VERSION' | 'ALLOCATION';
  @ApiProperty() @IsUUID() targetId!: string;
  @ApiProperty() @Matches(MONEY_PATTERN) requestedAmount!: string;
  @ApiProperty() @IsString() @Length(3, 1000) reason!: string;
}

export class DecisionDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) @IsIn(['APPROVE', 'REJECT']) decision!:
    'APPROVE' | 'REJECT';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

export class CreateFundingRequestDto {
  @ApiProperty() @IsUUID() schemeId!: string;
  @ApiProperty() @IsUUID() periodId!: string;
  @ApiProperty() @Matches(MONEY_PATTERN) amount!: string;
  @ApiProperty() @IsString() @Length(10, 5000) justification!: string;
}

export class ReviewFundingRequestDto extends VersionBody {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED', 'RETURNED'] })
  @IsIn(['APPROVED', 'REJECTED', 'RETURNED'])
  decision!: 'APPROVED' | 'REJECTED' | 'RETURNED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}
