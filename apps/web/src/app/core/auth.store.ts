import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { AuthResponseDto, AuthUserDto, UserRole } from '@cadence/shared';
import { ApiService } from './api.service';

/** Non-secret hint that a refresh cookie may exist, so anonymous visits skip a pointless /auth/refresh. */
const SESSION_HINT = 'cadence-session';
const hint = {
  get: () => {
    try {
      return localStorage.getItem(SESSION_HINT) === '1';
    } catch {
      return true;
    }
  },
  set: (on: boolean) => {
    try {
      if (on) localStorage.setItem(SESSION_HINT, '1');
      else localStorage.removeItem(SESSION_HINT);
    } catch {
      /* storage unavailable */
    }
  },
};

/**
 * Session state. The access token lives in memory only; the refresh token is an httpOnly
 * cookie scoped to /api/auth, so a page reload restores the session via POST /auth/refresh.
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly token = signal<string | null>(null);
  readonly user = signal<AuthUserDto | null>(null);
  readonly isAuthenticated = computed(() => !!this.token());
  readonly role = computed(() => this.user()?.role ?? null);
  readonly isAdmin = computed(() => this.role() === 'ADMIN');

  private refreshing: Promise<boolean> | null = null;
  private refreshTimer?: ReturnType<typeof setTimeout>;

  hasRole(...roles: UserRole[]) {
    const r = this.role();
    return !!r && roles.includes(r);
  }

  accept(res: AuthResponseDto) {
    this.token.set(res.accessToken);
    this.user.set(res.user);
    hint.set(true);
    // Refresh a minute before the access token expires.
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(
      () => void this.refresh(),
      Math.max(10, res.expiresIn - 60) * 1000,
    );
  }

  async login(email: string, password: string) {
    this.accept(await this.api.login({ email, password }));
  }

  /** Single-flight refresh shared by the interceptor, guards and the timer. */
  refresh(): Promise<boolean> {
    this.refreshing ??= this.api
      .refresh()
      .then((res) => {
        this.accept(res);
        return true;
      })
      .catch(() => {
        this.clear();
        return false;
      })
      .finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  /** True when a session exists (restoring it from the refresh cookie if needed). */
  async ensureUser(): Promise<boolean> {
    if (this.token() && this.user()) return true;
    if (!hint.get()) return false;
    return this.refresh();
  }

  clear() {
    clearTimeout(this.refreshTimer);
    this.token.set(null);
    this.user.set(null);
    hint.set(false);
  }

  async logout() {
    await this.api.logout().catch(() => undefined);
    this.clear();
    void this.router.navigateByUrl('/login');
  }

  /** Called when a refresh fails mid-session. */
  expire() {
    this.clear();
    void this.router.navigate(['/login'], { queryParams: { next: this.router.url, expired: 1 } });
  }
}
