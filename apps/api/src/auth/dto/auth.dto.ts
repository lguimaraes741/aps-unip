import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const normalizeEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/** Política de senha: 8–72 caracteres, com letra maiúscula, minúscula e número. */
export const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/;
export const PASSWORD_MESSAGE = 'A senha deve ter de 8 a 72 caracteres, com letra maiúscula, minúscula e número';

export class RegisterDto {
  @ApiProperty({ example: 'Maria Souza' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiProperty({ example: 'maria@email.com' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Senha@123' })
  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password: string;

  @ApiProperty({ description: 'Aceite dos termos de uso e da política de privacidade (LGPD)' })
  @IsBoolean()
  @Equals(true, { message: 'É necessário aceitar os termos de uso e a política de privacidade' })
  acceptTerms: boolean;
}

export class LoginDto {
  @ApiProperty({ example: 'cidada.a@alertacidade.demo' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'E-mail inválido' })
  email: string;

  @ApiProperty()
  @IsString()
  @Length(1, 128)
  password: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @Length(20, 200)
  refreshToken: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'E-mail inválido' })
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'E-mail inválido' })
  email: string;

  @ApiProperty({ example: '123456', description: 'Código de 6 dígitos enviado por e-mail' })
  @Matches(/^\d{6}$/, { message: 'O código deve ter 6 dígitos' })
  code: string;

  @ApiProperty()
  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  newPassword: string;
}

export class AuthUserView {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty({ enum: ['CITIZEN', 'MODERATOR', 'ADMIN'] }) role: string;
}

export class AuthResponse {
  @ApiProperty() accessToken: string;
  @ApiProperty({ description: 'Validade do token de acesso em segundos' }) expiresIn: number;
  @ApiProperty({ description: 'Token opaco de renovação (rotativo, uso único)' }) refreshToken: string;
  @ApiProperty({ type: AuthUserView }) user: AuthUserView;
}
