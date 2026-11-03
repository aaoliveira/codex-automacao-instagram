import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Request, Response } from "express";
import { PinoLogger } from "nestjs-pino";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const message = process.env.NODE_ENV === 'production' && status >= 500
      ? 'The request could not be completed'
      :
      typeof exceptionResponse === "string"
        ? exceptionResponse
        : exceptionResponse &&
            typeof exceptionResponse === "object" &&
            "message" in exceptionResponse
          ? (exceptionResponse as { message: string | string[] }).message
          : status === HttpStatus.INTERNAL_SERVER_ERROR
            ? "Internal server error"
            : "Request failed";

    const correlationId = (request as Request & { id?: string }).id ?? 'unknown';
    const safeContext = {
      statusCode: status,
      method: request.method,
      path: request.path,
    };
    if (status >= 500) this.logger.error(safeContext, 'Unhandled HTTP request error');
    else if (status >= 400) this.logger.warn(safeContext, 'HTTP request rejected');

    response.status(status).json({
      statusCode: status,
      message,
      path: request.path,
      timestamp: new Date().toISOString(),
      correlationId,
    });
  }
}
