import { ApiPropertyOptional } from '@nestjs/swagger';
import { NewsAlertLevel, Severity } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsEnum, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const csv = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : value;

/**
 * Consulta pública de alertas de notícia (mapa do app e tela "Notícias e monitoramento").
 * Só aparece o que foi PUBLICADO (existe `news_alerts`); alerta retirado nunca entra na lista.
 */
export class ListNewsAlertsQuery {
  @ApiPropertyOptional({ description: 'Latitude do centro da busca' })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({ description: 'Raio em metros (requer lat/lng); alerta regional entra se o contorno da cidade estiver no raio', default: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(100000)
  radius = 10000;

  @ApiPropertyOptional({ description: 'active = só alertas em vigor (mapa); all = inclui encerrados e expirados (histórico)', default: 'active' })
  @IsOptional()
  @IsIn(['active', 'all'])
  scope: 'active' | 'all' = 'active';

  @ApiPropertyOptional({ description: 'Gravidade publicada, separada por vírgula. Alertas sem gravidade informada ficam de fora quando há filtro.', example: 'HIGH,CRITICAL' })
  @IsOptional()
  @Transform(csv)
  @IsEnum(Severity, { each: true })
  @ArrayMaxSize(4)
  severity?: Severity[];

  @ApiPropertyOptional({ description: 'Nível de verificação, separado por vírgula', example: 'VERIFIED,OFFICIAL' })
  @IsOptional()
  @Transform(csv)
  @IsEnum(NewsAlertLevel, { each: true })
  @ArrayMaxSize(3)
  level?: NewsAlertLevel[];

  @ApiPropertyOptional({ description: 'Código IBGE do município (7 dígitos)', example: '3534401' })
  @IsOptional()
  @Matches(/^\d{7}$/)
  cityIbge?: string;

  @ApiPropertyOptional({ description: 'Chave da fonte (ex.: g1-sp); só eventos com ao menos uma matéria dela' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{1,60}$/)
  source?: string;

  @ApiPropertyOptional({ description: 'Somente eventos com evidência nas últimas N horas', example: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  periodHours?: number;

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

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}
