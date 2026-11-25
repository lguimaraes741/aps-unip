import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConfirmationType, OccurrenceStatus, Severity } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxDate,
  MaxLength,
  Min,
  MinDate,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const csv = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : value;

/** Tolerância para relógios de celular adiantados. */
const CLOCK_SKEW_MS = 5 * 60_000;
const MAX_AGE_MS = 7 * 24 * 3_600_000;

export class CreateOccurrenceDto {
  @ApiProperty({ example: 'Alagamento na Av. do Estado', minLength: 3, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(3, 120)
  title: string;

  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @Transform(trim)
  @IsString()
  @Length(10, 2000)
  description: string;

  @ApiProperty({ example: 'Av. do Estado, próximo ao viaduto' })
  @Transform(trim)
  @IsString()
  @Length(3, 255)
  address: string;

  @ApiPropertyOptional({ example: 'Cambuci' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  neighborhood?: string;

  @ApiProperty({ example: -23.5662 })
  @IsLatitude()
  latitude: number;

  @ApiProperty({ example: -46.6205 })
  @IsLongitude()
  longitude: number;

  @ApiProperty({ enum: Severity, description: 'Gravidade percebida pelo cidadão' })
  @IsEnum(Severity)
  severity: Severity;

  @ApiProperty({ description: 'Quando o alagamento foi observado (ISO-8601). Até 7 dias atrás.' })
  @Type(() => Date)
  @IsDate()
  @MaxDate(() => new Date(Date.now() + CLOCK_SKEW_MS), { message: 'A data não pode estar no futuro' })
  @MinDate(() => new Date(Date.now() - MAX_AGE_MS), { message: 'A data deve estar nos últimos 7 dias' })
  occurredAt: Date;

  @ApiPropertyOptional({ description: 'Chave de idempotência (UUID gerado pelo app). Reenvios retornam o mesmo registro.' })
  @IsOptional()
  @IsUUID()
  clientRequestId?: string;
}

export class GeoQuery {
  @ApiPropertyOptional({ description: 'Latitude do usuário (para distância)' })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;
}

export class ListOccurrencesQuery extends GeoQuery {
  @ApiPropertyOptional({ description: 'Raio em metros (requer lat/lng)', default: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(50000)
  radius = 5000;

  @ApiPropertyOptional({ description: 'Lista separada por vírgula', example: 'HIGH,CRITICAL' })
  @IsOptional()
  @Transform(csv)
  @IsEnum(Severity, { each: true })
  @ArrayMaxSize(4)
  severity?: Severity[];

  @ApiPropertyOptional({ description: 'Padrão: PENDING,UNDER_REVIEW,VALIDATED', example: 'VALIDATED,RESOLVED' })
  @IsOptional()
  @Transform(csv)
  @IsEnum(OccurrenceStatus, { each: true })
  @ArrayMaxSize(5)
  status?: OccurrenceStatus[];

  @ApiPropertyOptional({ description: 'Somente registros das últimas N horas', example: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  periodHours?: number;

  @ApiPropertyOptional({ description: 'Busca em título, endereço e bairro' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({ enum: ['distance', 'recent'] })
  @IsOptional()
  @IsIn(['distance', 'recent'])
  sort?: 'distance' | 'recent';

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

export const MINE_FILTERS = ['all', 'pending', 'validated', 'resolved', 'rejected'] as const;
export type MineFilter = (typeof MINE_FILTERS)[number];

export class MyOccurrencesQuery {
  @ApiPropertyOptional({ enum: MINE_FILTERS, default: 'all' })
  @IsOptional()
  @IsIn(MINE_FILTERS)
  filter: MineFilter = 'all';

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class ConfirmationDto {
  @ApiProperty({ enum: ConfirmationType })
  @IsEnum(ConfirmationType)
  type: ConfirmationType;
}

export const REPORT_REASONS = ['SPAM', 'OFFENSIVE', 'FALSE_INFORMATION', 'PERSONAL_DATA', 'OTHER'] as const;

export class ReportContentDto {
  @ApiProperty({ enum: REPORT_REASONS })
  @IsIn(REPORT_REASONS)
  reason: (typeof REPORT_REASONS)[number];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  details?: string;
}

/** Usado apenas para documentação no Swagger. */
export class OccurrenceSummaryView {
  @ApiProperty() id: string;
  @ApiProperty() code: number;
  @ApiProperty() title: string;
  @ApiProperty() address: string;
  @ApiProperty({ nullable: true }) neighborhood: string | null;
  @ApiProperty() latitude: number;
  @ApiProperty() longitude: number;
  @ApiProperty({ enum: Severity }) severity: Severity;
  @ApiProperty({ enum: OccurrenceStatus }) status: OccurrenceStatus;
  @ApiProperty() occurredAt: string;
  @ApiProperty() createdAt: string;
  @ApiProperty() confirmCount: number;
  @ApiProperty() contestCount: number;
  @ApiProperty({ nullable: true }) coverPhotoUrl: string | null;
  @ApiPropertyOptional() distanceMeters?: number;
  @ApiProperty({ description: 'Registro de demonstração (seed) — exibir com selo' }) isDemo: boolean;
}

