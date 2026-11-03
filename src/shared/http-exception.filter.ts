import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Request, Response } from "express";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
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
    const message =
      typeof exceptionResponse === "string"
        ? exceptionResponse
        : exceptionResponse &&
            typeof exceptionResponse === "object" &&
            "message" in exceptionResponse
          ? (exceptionResponse as { message: string | string[] }).message
          : status === HttpStatus.INTERNAL_SERVER_ERROR
            ? "Internal server error"
            : "Request failed";

    response.status(status).json({
      statusCode: status,
      message,
      path: request.path,
      timestamp: new Date().toISOString(),
    });
  }
}
