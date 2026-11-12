import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiPropertyOptional({ example: 'ASSAM-DEMO' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  tenantCode?: string;

  @ApiProperty({ example: 'state.planner@example.test' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 256)
  password!: string;
}

export class ForgotPasswordDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) tenantCode?: string;
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @Length(20, 200) token!: string;
  @ApiProperty() @IsString() @Length(1, 256) newPassword!: string;
}

export class InviteUserDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty() @IsString() @Length(1, 200) name!: string;
}
