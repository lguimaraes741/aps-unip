import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NewsCollectionStatus, NewsConfidence, NewsEventStatus, Severity } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, Min } from 'class-validator';
import { PageQuery } from '../admin/admin.dto';

const csv = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value);
const bool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export class NewsReviewQuery extends PageQuery {
  @ApiPropertyOptional({ description: 'Status separados por vírgula (padrão: todos os não finais)', example: 'AWAITING_VALIDATION,PUBLISHED_PRELIMINARY' })
  @IsOptional()
  @Transform(csv)
  @IsEnum(NewsEventStatus, { each: true, message: 'Status inválido' })
  status?: NewsEventStatus[];

  @ApiPropertyOptional({ description: 'Gravidades separadas por vírgula; NONE = não informada' })
  @IsOptional()
  @Transform(csv)
  @IsIn([...Object.values(Severity), 'NONE'], { each: true, message: 'Gravidade inválida' })
  severity?: (Severity | 'NONE')[];

  @ApiPropertyOptional({ description: 'Confianças separadas por vírgula' })
  @IsOptional()
  @Transform(csv)
  @IsEnum(NewsConfidence, { each: true, message: 'Confiança inválida' })
  confidence?: NewsConfidence[];

  @ApiPropertyOptional({ description: 'Código IBGE da cidade (7 dígitos) ou parte do nome' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional({ description: 'Somente com revisão urgente' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  urgent?: boolean;

  @ApiPropertyOptional({ description: 'Título ou número do evento (N-12)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Última evidência a partir de' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'Data inicial inválida' })
  from?: Date;

  @ApiPropertyOptional({ description: 'Última evidência antes de' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'Data final inválida' })
  to?: Date;
}

export class NewsDecisionDto {
  @ApiProperty({ description: 'Versão que o moderador viu (controle otimista)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateNewsEventDto extends NewsDecisionDto {
  @ApiPropertyOptional({ minLength: 3, maxLength: 200 })
  @IsOptional()
  @IsString()
  @Length(3, 200, { message: 'O título deve ter entre 3 e 200 caracteres' })
  title?: string;

  @ApiPropertyOptional({ enum: [...Object.values(Severity), 'NONE'], description: 'NONE = não informada pela fonte' })
  @IsOptional()
  @IsIn([...Object.values(Severity), 'NONE'], { message: 'Gravidade inválida' })
  severity?: Severity | 'NONE';

  @ApiPropertyOptional({ description: 'Corrige a localização: código IBGE de cidade monitorada (7) ou distrito da capital (9)' })
  @IsOptional()
  @Matches(/^\d{7}(\d{2})?$/, { message: 'Código IBGE inválido' })
  regionIbge?: string;
}

export class MergeNewsEventDto extends NewsDecisionDto {
  @ApiProperty({ description: 'Evento que fica (recebe as fontes deste)' })
  @IsUUID('4', { message: 'Evento de destino inválido' })
  intoEventId!: string;
}

export class RequestCollectionDto {
  @ApiPropertyOptional({ description: 'Fonte a coletar; sem ela, todas as fontes ligadas' })
  @IsOptional()
  @IsUUID('4', { message: 'Fonte inválida' })
  sourceId?: string;
}

export class UpdateNewsSourceDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

export class CollectionsQuery extends PageQuery {
  @ApiPropertyOptional({ enum: NewsCollectionStatus })
  @IsOptional()
  @IsEnum(NewsCollectionStatus, { message: 'Status inválido' })
  status?: NewsCollectionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4', { message: 'Fonte inválida' })
  sourceId?: string;
}
