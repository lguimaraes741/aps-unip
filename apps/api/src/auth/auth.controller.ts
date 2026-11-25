import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/auth/decorators';
import { ReqMeta, RequestMetaValue } from '../common/http/request-meta';
import { AuthService } from './auth.service';
import { AuthResponse, ForgotPasswordDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto } from './dto/auth.dto';

/** Limite mais restrito nas rotas de autenticação (proteção contra força bruta). */
const AUTH_LIMIT = { default: { limit: () => Number(process.env.AUTH_THROTTLE_LIMIT ?? 10), ttl: 60_000 } };

@ApiTags('auth')
@Public()
@Throttle(AUTH_LIMIT)
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Cadastro de cidadão' })
  @ApiOkResponse({ type: AuthResponse })
  register(@Body() dto: RegisterDto, @ReqMeta() meta: RequestMetaValue): Promise<AuthResponse> {
    return this.auth.register(dto, meta);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login com e-mail e senha' })
  @ApiOkResponse({ type: AuthResponse })
  login(@Body() dto: LoginDto, @ReqMeta() meta: RequestMetaValue): Promise<AuthResponse> {
    return this.auth.login(dto, meta);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renova a sessão (o refresh token usado é invalidado)' })
  @ApiOkResponse({ type: AuthResponse })
  refresh(@Body() dto: RefreshDto, @ReqMeta() meta: RequestMetaValue): Promise<AuthResponse> {
    return this.auth.refresh(dto.refreshToken, meta);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Encerra a sessão (revoga a cadeia do refresh token)' })
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Solicita código de recuperação (resposta idêntica exista ou não a conta)' })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    await this.auth.forgotPassword(dto.email);
    return { message: 'Se o e-mail estiver cadastrado, você receberá um código de recuperação.' };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Redefine a senha com o código recebido; encerra todas as sessões' })
  async resetPassword(@Body() dto: ResetPasswordDto, @ReqMeta() meta: RequestMetaValue): Promise<void> {
    await this.auth.resetPassword(dto, meta);
  }
}
