import { ValidationError } from 'class-validator';
import { validationExceptionFactory } from './validation-exception.factory';

const err = (property: string, constraints: Record<string, string>): ValidationError =>
  Object.assign(new ValidationError(), { property, constraints, children: [] });

describe('validationExceptionFactory', () => {
  it('traduz mensagens padrão e agrupa por campo', () => {
    const ex = validationExceptionFactory([
      err('role', { whitelistValidation: 'property role should not exist' }),
      err('latitude', { isLatitude: 'latitude must be a latitude string or number' }),
    ]);
    const body = ex.getResponse() as { message: string[]; errors: Record<string, string[]> };
    expect(ex.getStatus()).toBe(400);
    expect(body.errors).toEqual({ role: ['role: campo não permitido'], latitude: ['latitude: latitude inválida'] });
    expect(body.message).toEqual(['role: campo não permitido', 'latitude: latitude inválida']);
  });

  it('preserva mensagens personalizadas e prefixa o campo na lista geral', () => {
    const ex = validationExceptionFactory([err('email', { isEmail: 'E-mail inválido' })]);
    const body = ex.getResponse() as { message: string[]; errors: Record<string, string[]> };
    expect(body.errors.email).toEqual(['E-mail inválido']);
    expect(body.message).toEqual(['email: E-mail inválido']);
  });
});
