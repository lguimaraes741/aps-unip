import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Severity, UserRole, UserStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { PASSWORD_MESSAGE, PASSWORD_RULE } from '../../auth/dto/auth.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateProfileDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @Length(1, 128)
  currentPassword: string;

  @ApiProperty()
  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  newPassword: string;
}

export class DeleteAccountDto {
  @ApiProperty({ description: 'Senha atual, para confirmar a exclusão' })
  @IsString()
  @Length(1, 128)
  password: string;
}

export class NotificationPreferencesDto {
  @ApiProperty()
  @IsBoolean()
  pushEnabled: boolean;

  @ApiProperty({ minimum: 100, maximum: 50000, description: 'Raio de monitoramento em metros' })
  @IsInt()
  @Min(100)
  @Max(50000)
  radiusMeters: number;

  @ApiProperty({ enum: Severity })
  @IsEnum(Severity)
  minSeverity: Severity;

  @ApiPropertyOptional({ nullable: true, description: 'Centro da área de interesse (escolhido pelo usuário)' })
  @ValidateIf((o: NotificationPreferencesDto) => o.latitude !== null || o.longitude !== null)
  @IsLatitude()
  latitude: number | null;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((o: NotificationPreferencesDto) => o.latitude !== null || o.longitude !== null)
  @IsLongitude()
  longitude: number | null;
}

export class ListUsersQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional({ enum: UserRole }) @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @ApiPropertyOptional({ enum: UserStatus }) @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 100) q?: string;
}
