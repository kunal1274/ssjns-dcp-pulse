import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, IsUUID, Length, MaxLength, Min } from 'class-validator';

export class ImportPreviewDto {
  @ApiProperty() @IsUUID() sourceId!: string;
  @ApiProperty({ example: 'releases-2026-11.csv' }) @IsString() @Length(1, 300) filename!: string;
  @ApiProperty({ description: 'CSV text (UTF-8), at most 1 MB' })
  @IsString()
  @MaxLength(1_048_576)
  content!: string;
}

export class ImportCommitDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}
