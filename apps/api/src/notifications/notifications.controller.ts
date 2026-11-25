import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { NotificationFilter } from '@alertacidade/shared-types';
import { DevicePlatform } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { AuthUser } from '../common/auth/auth-user';
import { CurrentUser } from '../common/auth/decorators';
import { NotificationsService } from './notifications.service';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'Identificador de envio do aparelho no FCM (Firebase Installation ID)' })
  @IsString()
  @Length(10, 512)
  token!: string;

  @ApiProperty({ enum: DevicePlatform })
  @IsEnum(DevicePlatform, { message: 'Plataforma inválida' })
  platform!: DevicePlatform;
}

export class ListNotificationsQuery {
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

  @ApiPropertyOptional({ enum: Object.values(NotificationFilter), default: 'all' })
  @IsOptional()
  @IsIn(Object.values(NotificationFilter), { message: 'Filtro inválido' })
  filter: NotificationFilter = 'all';
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Put('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Registra (ou renova) o token de push deste aparelho para o usuário autenticado' })
  async registerDevice(@CurrentUser() user: AuthUser, @Body() dto: RegisterDeviceDto) {
    await this.notifications.registerDevice(user.id, dto.token, dto.platform);
  }

  @Delete('devices/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove o token de push (ao sair da conta)' })
  async removeDevice(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    await this.notifications.removeDevice(user.id, token);
  }

  @Get('notifications')
  @ApiOperation({ summary: 'Caixa de alertas do usuário (mais recentes primeiro)' })
  list(@CurrentUser() user: AuthUser, @Query() query: ListNotificationsQuery) {
    return this.notifications.list(user.id, query.page, query.limit, query.filter);
  }

  @Post('notifications/read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Marca todos os alertas como lidos' })
  async readAll(@CurrentUser() user: AuthUser) {
    await this.notifications.markAllRead(user.id);
  }

  @Post('notifications/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Marca um alerta como lido' })
  async read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.notifications.markRead(user.id, id);
  }
}
