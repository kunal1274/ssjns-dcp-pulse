import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQuery } from '../schemes/dto';
import { FREQUENCIES, RULE_CODES } from './rules';

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const PRIORITIES = SEVERITIES;
const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
const CA_STATUSES = [
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'PENDING_VERIFICATION',
  'CLOSED',
  'REOPENED',
  'CANCELLED',
] as const;
const bool = ({ value }: { value: unknown }) => value === true || value === 'true';

export class VersionDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}

export class CreateAlertRuleDto {
  @ApiProperty({ enum: RULE_CODES }) @IsIn(RULE_CODES) ruleCode!: (typeof RULE_CODES)[number];
  @ApiProperty({ enum: ['TENANT', 'JURISDICTION', 'AGENCY', 'SCHEME'] })
  @IsIn(['TENANT', 'JURISDICTION', 'AGENCY', 'SCHEME'])
  scopeType!: 'TENANT' | 'JURISDICTION' | 'AGENCY' | 'SCHEME';
  @ApiPropertyOptional({ description: 'Omit for TENANT scope' })
  @IsOptional()
  @IsUUID()
  scopeId?: string;
  @ApiProperty() @IsDateString() effectiveFrom!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() effectiveTo?: string;
  @ApiProperty({ example: { gapPercentagePoints: 15 } }) @IsObject() threshold!: Record<
    string,
    unknown
  >;
  @ApiProperty({ enum: SEVERITIES }) @IsIn(SEVERITIES) severity!: (typeof SEVERITIES)[number];
  @ApiProperty() @IsString() @Length(2, 50) ownerRoleCode!: string;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ enum: FREQUENCIES })
  @IsOptional()
  @IsIn(FREQUENCIES)
  evaluationFrequency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class UpdateAlertRuleDto extends VersionDto {
  @ApiPropertyOptional() @IsOptional() @IsObject() threshold?: Record<string, unknown>;
  @ApiPropertyOptional({ enum: SEVERITIES })
  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: (typeof SEVERITIES)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 50) ownerRoleCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ enum: FREQUENCIES })
  @IsOptional()
  @IsIn(FREQUENCIES)
  evaluationFrequency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsDateString() effectiveTo?:
    string | null;
  @ApiProperty({ description: 'Why the rule is being changed (audited)' })
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class AlertQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ALERT_STATUSES })
  @IsOptional()
  @IsIn(ALERT_STATUSES)
  status?: string;
  @ApiPropertyOptional({ description: 'active = OPEN, ACKNOWLEDGED or IN_PROGRESS' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  active?: boolean;
  @ApiPropertyOptional({ enum: SEVERITIES }) @IsOptional() @IsIn(SEVERITIES) severity?: string;
  @ApiPropertyOptional({ enum: RULE_CODES }) @IsOptional() @IsIn(RULE_CODES) ruleCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() schemeId?: string;
  @ApiPropertyOptional({ description: 'Jurisdiction subtree' })
  @IsOptional()
  @IsUUID()
  jurisdictionId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(bool) @IsBoolean() assignedToMe?: boolean;
}

export class AlertNoteDto extends VersionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class AssignAlertDto extends VersionDto {
  @ApiProperty() @IsUUID() assigneeId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ResolveAlertDto extends VersionDto {
  @ApiProperty() @IsString() @Length(5, 1000) reason!: string;
}

export class CorrectiveActionQuery extends PageQuery {
  @ApiPropertyOptional({ enum: CA_STATUSES }) @IsOptional() @IsIn(CA_STATUSES) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() alertId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() schemeId?: string;
  @ApiPropertyOptional({ description: 'Only actions owned by the caller' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  mine?: boolean;
  @ApiPropertyOptional({ description: 'Pending verification that the caller may close' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  toVerify?: boolean;
}

export class CreateCorrectiveActionDto {
  @ApiProperty() @IsUUID() alertId!: string;
  @ApiProperty() @IsUUID() ownerId!: string;
  @ApiProperty() @IsString() @Length(5, 2000) actionText!: string;
  @ApiProperty() @IsDateString() dueAt!: string;
  @ApiPropertyOptional({ enum: PRIORITIES, default: 'MEDIUM' })
  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: string;
}

export class UpdateCorrectiveActionDto extends VersionDto {
  @ApiPropertyOptional({ description: 'Progress note from the responsible officer' })
  @IsOptional()
  @IsString()
  @Length(3, 2000)
  progressNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() ownerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueAt?: string;
  @ApiPropertyOptional({ enum: PRIORITIES }) @IsOptional() @IsIn(PRIORITIES) priority?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(5, 2000) actionText?: string;
}

export class SubmitCorrectiveActionDto extends VersionDto {
  @ApiProperty({
    description: 'Evidence description (file upload is not implemented in this build)',
  })
  @IsString()
  @Length(5, 2000)
  evidenceNote!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

export class CloseCorrectiveActionDto extends VersionDto {
  @ApiProperty({ enum: ['CLOSE', 'REOPEN'] }) @IsIn(['CLOSE', 'REOPEN']) decision!:
    'CLOSE' | 'REOPEN';
  @ApiProperty() @IsString() @Length(5, 1000) reason!: string;
}

export class GisQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() financialYearId?: string;
  @ApiPropertyOptional({ description: 'Jurisdiction subtree' })
  @IsOptional()
  @IsUUID()
  jurisdictionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) status?: string;
}
