import { BadRequestException } from '@nestjs/common';
import { ValidationError } from 'class-validator';

type Translator = (field: string, error: ValidationError) => string;

/** Mensagens em português para as regras padrão do class-validator. */
const PT: Record<string, Translator> = {
  whitelistValidation: (f) => `${f}: campo não permitido`,
  isDefined: (f) => `${f}: campo obrigatório`,
  isString: (f) => `${f}: deve ser um texto`,
  isLength: (f) => `${f}: tamanho inválido`,
  maxLength: (f) => `${f}: texto muito longo`,
  isEmail: (f) => `${f}: e-mail inválido`,
  isEnum: (f) => `${f}: valor não permitido`,
  isIn: (f) => `${f}: valor não permitido`,
  isLatitude: (f) => `${f}: latitude inválida`,
  isLongitude: (f) => `${f}: longitude inválida`,
  isUuid: (f) => `${f}: identificador inválido`,
  isInt: (f) => `${f}: deve ser um número inteiro`,
  isNumber: (f) => `${f}: deve ser um número`,
  min: (f) => `${f}: valor abaixo do mínimo permitido`,
  max: (f) => `${f}: valor acima do máximo permitido`,
  isBoolean: (f) => `${f}: deve ser verdadeiro ou falso`,
  isDate: (f) => `${f}: data inválida`,
  arrayMaxSize: (f) => `${f}: itens demais`,
};

/** Mensagens padrão do class-validator são em inglês; as personalizadas já estão em português. */
const looksDefault = (message: string) => /\b(must|should|property)\b/.test(message);

export interface FieldErrors {
  [field: string]: string[];
}

/**
 * Converte erros de validação em:
 *  - `message`: lista legível (compatível com o formato padrão do Nest);
 *  - `errors`: mapa campo → mensagens, para exibir o erro ao lado de cada campo no app e no painel.
 */
export function validationExceptionFactory(validationErrors: ValidationError[]): BadRequestException {
  const errors: FieldErrors = {};
  const walk = (list: ValidationError[], prefix = '') => {
    for (const e of list) {
      const field = prefix ? `${prefix}.${e.property}` : e.property;
      for (const [key, raw] of Object.entries(e.constraints ?? {})) {
        const message = looksDefault(raw) && PT[key] ? PT[key](field, e) : raw;
        (errors[field] ??= []).push(message);
      }
      if (e.children?.length) walk(e.children, field);
    }
  };
  walk(validationErrors);
  const message = Object.entries(errors).flatMap(([field, msgs]) =>
    msgs.map((m) => (m.startsWith(`${field}:`) ? m : `${field}: ${m}`)),
  );
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', message, errors });
}
