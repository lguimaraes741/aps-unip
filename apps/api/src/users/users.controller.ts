import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../common/auth/auth-user';
import { CurrentUser, Roles } from '../common/auth/decorators';
import { ReqMeta, RequestMetaValue } from '../common/http/request-meta';
import { ChangePasswordDto, DeleteAccountDto, ListUsersQuery, NotificationPreferencesDto, UpdateProfileDto } from './dto/users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Perfil do usuário autenticado' })
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Atualiza dados do perfil' })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto.name);
  }

  @Patch('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Altera a senha e encerra as sessões ativas' })
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @ReqMeta() meta: RequestMetaValue) {
    await this.users.changePassword(user.id, dto, meta.ip);
  }

  @Get('me/notification-preferences')
  @ApiOperation({ summary: 'Preferências de alertas (raio, gravidade mínima, área de interesse)' })
  preferences(@CurrentUser() user: AuthUser) {
    return this.users.getPreferences(user.id);
  }

  @Put('me/notification-preferences')
  @ApiOperation({ summary: 'Atualiza as preferências de alertas' })
  updatePreferences(@CurrentUser() user: AuthUser, @Body() dto: NotificationPreferencesDto) {
    return this.users.updatePreferences(user.id, dto);
  }

  @Get('me/export')
  @ApiOperation({ summary: 'LGPD: exporta os dados pessoais do titular' })
  export(@CurrentUser() user: AuthUser) {
    return this.users.exportData(user.id);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'LGPD: exclui (anonimiza) a conta' })
  async delete(@CurrentUser() user: AuthUser, @Body() dto: DeleteAccountDto, @ReqMeta() meta: RequestMetaValue) {
    await this.users.deleteAccount(user.id, dto.password, meta.ip);
  }

  @Get()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Lista usuários (somente administrador)' })
  list(@Query() query: ListUsersQuery) {
    return this.users.list(query);
  }
}
