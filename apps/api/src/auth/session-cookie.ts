import type { CookieOptions, Request, Response } from 'express';

export const REFRESH_COOKIE = 'cadence_rt';

const options = (maxAgeMs?: number): CookieOptions => ({
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
  path: '/api/auth',
  ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
});

export const setRefreshCookie = (res: Response, token: string, maxAgeMs: number) =>
  res.cookie(REFRESH_COOKIE, token, options(maxAgeMs));

export const clearRefreshCookie = (res: Response) => res.clearCookie(REFRESH_COOKIE, options());

export const readRefreshCookie = (req: Request): string | undefined =>
  (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
