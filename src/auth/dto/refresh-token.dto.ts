import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Opaque refresh token returned by register, login or refresh.' })
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}
