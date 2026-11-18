import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { UserRole } from '@cadence/shared';
import { ApiService } from './api.service';
import { AuthStore } from './auth.store';

let setupDone = false;

/** Until the first admin has a password, every route redirects to /setup. */
export const setupGuard: CanActivateFn = async () => {
  if (setupDone) return true;
  const router = inject(Router);
  try {
    const status = await inject(ApiService).setupStatus();
    if (status.needsSetup) return router.parseUrl('/setup');
    setupDone = true;
    return true;
  } catch {
    return true; // API unreachable — let the page surface the error
  }
};

/** /setup is only reachable while setup is pending. */
export const setupPageGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const status = await inject(ApiService)
    .setupStatus()
    .catch(() => null);
  if (status && !status.needsSetup) {
    setupDone = true;
    return router.parseUrl('/login');
  }
  return true;
};

export const markSetupDone = () => (setupDone = true);

export const authGuard: CanActivateFn = async (_, state) => {
  const router = inject(Router);
  const ok = await inject(AuthStore).ensureUser();
  return ok ? true : router.createUrlTree(['/login'], { queryParams: { next: state.url } });
};

export const guestGuard: CanActivateFn = async () => {
  // inject() must run before the first await (injection context ends there).
  const router = inject(Router);
  const ok = await inject(AuthStore).ensureUser();
  return ok ? router.parseUrl('/') : true;
};

export const roleGuard =
  (...roles: UserRole[]): CanActivateFn =>
  () => {
    const auth = inject(AuthStore);
    return auth.hasRole(...roles) ? true : inject(Router).parseUrl('/');
  };
