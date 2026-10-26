import { ValidationError, ValidationPipe } from '@nestjs/common';
import { AppError } from './app-error';
import { ErrorCode } from './error-code';

export interface FieldError {
  field: string;
  message: string;
}

function flatten(errors: ValidationError[], prefix = ''): FieldError[] {
  return errors.flatMap((e) => {
    const field = prefix + e.property;
    const own = Object.values(e.constraints ?? {}).map((message) => ({
      field,
      message,
    }));
    return [...own, ...flatten(e.children ?? [], `${field}.`)];
  });
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Validation failed', {
        fields: flatten(errors),
      }),
  });
}
