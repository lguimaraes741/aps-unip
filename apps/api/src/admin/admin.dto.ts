import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OccurrenceStatus, ReportStatus, Severity, UserRole, UserStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min, Max } from 'class-validator';

/** "PENDING,UNDER_REVIEW" → ['PENDING', 'UNDER_REVIEW'] (query string). */
const csv = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value);
const bool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export class PageQuery {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class AdminOccurrencesQuery extends PageQuery {
  @ApiPropertyOptional({ description: 'Status separados por vírgula', example: 'PENDING,UNDER_REVIEW' })
  @IsOptional()
  @Transform(csv)
  @IsEnum(OccurrenceStatus, { each: true, message: 'Status inválido' })
  status?: OccurrenceStatus[];

  @ApiPropertyOptional({ description: 'Gravidades separadas por vírgula' })
  @IsOptional()
  @Transform(csv)
  @IsEnum(Severity, { each: true, message: 'Gravidade inválida' })
  severity?: Severity[];

  @ApiPropertyOptional({ description: 'Título, endereço, bairro ou número da ocorrência' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Somente com denúncias abertas' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  reported?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'Data inicial inválida' })
  from?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'Data final inválida' })
  to?: Date;
}

export class ChangeStatusDto {
  @ApiProperty({ enum: OccurrenceStatus })
  @IsEnum(OccurrenceStatus, { message: 'Status inválido' })
  status!: OccurrenceStatus;

  @ApiProperty({ description: 'Versão que o moderador viu (controle otimista: outra alteração no meio → 409)' })
  @Type(() => Number)
  @IsInt({ message: 'Versão inválida' })
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ description: 'Obrigatória para rejeitar; aparece no histórico' })
  @IsOptional()
  @IsString()
  @Length(3, 500, { message: 'A observação deve ter entre 3 e 500 caracteres' })
  note?: string;
}

export class ContentReportsQuery extends PageQuery {
  @ApiPropertyOptional({ enum: ReportStatus, default: 'OPEN' })
  @IsOptional()
  @IsEnum(ReportStatus, { message: 'Status inválido' })
  status: ReportStatus = 'OPEN';
}

export class ResolveReportDto {
  @ApiProperty({ enum: ['REVIEWED', 'DISMISSED'], description: 'REVIEWED = procedente (já tratada); DISMISSED = improcedente' })
  @IsIn(['REVIEWED', 'DISMISSED'], { message: 'Use REVIEWED ou DISMISSED' })
  status!: 'REVIEWED' | 'DISMISSED';
}

export class PeriodQuery {
  @ApiProperty({ description: 'Início (inclusivo), ex.: 2026-11-01' })
  @Type(() => Date)
  @IsDate({ message: 'Data inicial inválida' })
  from!: Date;

  @ApiProperty({ description: 'Fim (exclusivo), ex.: 2026-12-01' })
  @Type(() => Date)
  @IsDate({ message: 'Data final inválida' })
  to!: Date;
}

export class ExportQuery extends PeriodQuery {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(csv)
  @IsEnum(OccurrenceStatus, { each: true, message: 'Status inválido' })
  status?: OccurrenceStatus[];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(csv)
  @IsEnum(Severity, { each: true, message: 'Gravidade inválida' })
  severity?: Severity[];

  @ApiPropertyOptional({ description: 'Incluir registros de demonstração', default: false })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  includeDemo = false;
}

export class AuditQuery extends PageQuery {
  @ApiPropertyOptional({ example: 'occurrence' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4', { message: 'Usuário inválido' })
  actorId?: string;

  @ApiPropertyOptional({ example: 'occurrence.status_changed' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class UpdateUserAdminDto {
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole, { message: 'Perfil inválido' })
  role?: UserRole;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'] })
  @IsOptional()
  @IsIn([UserStatus.ACTIVE, UserStatus.SUSPENDED], { message: 'Use ACTIVE ou SUSPENDED' })
  status?: 'ACTIVE' | 'SUSPENDED';
}
