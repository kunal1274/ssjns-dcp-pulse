import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  requestId?: string;
}

/**
 * Converts every error into a consistent JSON body. Non-HTTP errors (including
 * Prisma/PostgreSQL errors) become a generic 500 so raw database messages are
 * never returned to clients; details go to the structured log only.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = typeof req.id === 'string' ? req.id : undefined;

    let body: ErrorBody;
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'object' && response !== null && 'message' in response
          ? (response as { message: string | string[] }).message
          : exception.message;
      // Domain code (e.g. INVALID_CREDENTIALS) when the thrower supplied one.
      const code =
        typeof response === 'object' && response !== null && 'error' in response
          ? (response as { error: unknown }).error
          : undefined;
      const error =
        typeof code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(code)
          ? code
          : (HttpStatus[status] ?? 'Error');
      body = { statusCode: status, error, message, requestId };
    } else {
      this.logger.error(
        {
          err:
            exception instanceof Error
              ? { name: exception.name, message: exception.message }
              : exception,
          requestId,
        },
        'Unhandled error',
      );
      body = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred.',
        requestId,
      };
    }
    res.status(body.statusCode).json(body);
  }
}
