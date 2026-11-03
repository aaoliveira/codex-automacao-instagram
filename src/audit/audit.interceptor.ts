import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { Request } from 'express';
import { catchError, from, mergeMap, Observable, of, throwError } from 'rxjs';
import { AuthenticatedUser } from '../shared/types/authenticated-user';
import { AuditService } from './audit.service';
import { mapRequestToAuditRecord } from './audit-event-mapper';

type AuditedRequest = Request & {
  id?: string;
  user?: AuthenticatedUser;
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuditedRequest>();
    const response = http.getResponse<{ statusCode: number }>();

    return next.handle().pipe(
      mergeMap((body: unknown) => {
        const record = mapRequestToAuditRecord(request, response.statusCode || 200, body);
        return record ? from(this.audit.record(record)).pipe(mergeMap(() => of(body))) : of(body);
      }),
      catchError((error: unknown) => {
        const statusCode = error instanceof HttpException ? error.getStatus() : 500;
        const record = mapRequestToAuditRecord(request, statusCode);
        if (!record) return throwError(() => error);
        return from(this.audit.record(record)).pipe(mergeMap(() => throwError(() => error)));
      }),
    );
  }
}
