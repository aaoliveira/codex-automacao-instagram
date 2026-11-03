import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { catchError, Observable, tap, throwError } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = process.hrtime.bigint();
    let recorded = false;
    const record = (statusCode: number) => {
      if (recorded) return;
      recorded = true;
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      this.metrics.observe(request.method, routeLabel(request), statusCode, durationSeconds);
    };

    return next.handle().pipe(
      tap({ next: () => record(response.statusCode || 200) }),
      catchError((error: unknown) => {
        record(error instanceof HttpException ? error.getStatus() : 500);
        return throwError(() => error);
      }),
    );
  }
}

function routeLabel(request: Request): string {
  const routePath = request.route?.path;
  if (typeof routePath === 'string') return `${request.baseUrl ?? ''}${routePath}` || '/';
  if (Array.isArray(routePath)) return `${request.baseUrl ?? ''}${routePath.join('|')}` || '/';
  return request.path.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,36}(?=\/|$)/gi, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:id') || '/';
}

