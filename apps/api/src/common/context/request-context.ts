import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

/** Per-request ambient data (client IP, authenticated user) for audit logging. */
export interface RequestContext {
  ip?: string;
  userAgent?: string;
  user?: AuthenticatedUser;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  requestContext.run({ ip: req.ip, userAgent: req.headers['user-agent'] }, next);
}

export const currentContext = (): RequestContext => requestContext.getStore() ?? {};
