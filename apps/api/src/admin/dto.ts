import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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

export class CreateRoleDto {
  @ApiProperty({ example: 'BLOCK_DATA_ENTRY' })
  @Matches(/^[A-Z][A-Z0-9_]{2,49}$/)
  code!: string;
  @ApiProperty() @IsString() @Length(1, 100) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  permissions!: string[];
}

export class UpdateRoleDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  permissions?: string[];
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class AssignRoleScopeDto {
  @ApiProperty() @IsUUID() roleId!: string;
  @ApiProperty({ enum: ['TENANT', 'JURISDICTION', 'AGENCY', 'SCHEME'] })
  @IsIn(['TENANT', 'JURISDICTION', 'AGENCY', 'SCHEME'])
  scopeType!: 'TENANT' | 'JURISDICTION' | 'AGENCY' | 'SCHEME';
  @ApiPropertyOptional({ description: 'Required unless scopeType is TENANT' })
  @IsOptional()
  @IsUUID()
  scopeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() includeDescendants?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() validTo?: string;
}

export class RevokeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class UserStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'DISABLED'] })
  @IsIn(['ACTIVE', 'SUSPENDED', 'DISABLED'])
  status!: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
