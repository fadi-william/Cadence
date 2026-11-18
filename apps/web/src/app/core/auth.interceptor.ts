import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthStore } from './auth.store';

const withToken = (req: HttpRequest<unknown>, token: string | null) =>
  token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

/** Adds the access token; on 401 refreshes once (single-flight) and retries the request. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthStore);
  if (
    req.url.includes('/api/auth/') &&
    !req.url.endsWith('/auth/me') &&
    !req.url.endsWith('/auth/change-password')
  ) {
    return next(req);
  }
  return next(withToken(req, auth.token())).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401 || !auth.token())
        return throwError(() => err);
      return from(auth.refresh()).pipe(
        switchMap((ok) => {
          if (!ok) {
            auth.expire();
            return throwError(() => err);
          }
          return next(withToken(req, auth.token()));
        }),
      );
    }),
  );
};
