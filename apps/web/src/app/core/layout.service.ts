import { Injectable, signal } from '@angular/core';

const KEY = 'cadence-nav-collapsed';

/** Sidenav state shared by the shell. */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  readonly collapsed = signal(read());
  readonly mobileOpen = signal(false);

  toggleCollapsed() {
    this.collapsed.update((v) => !v);
    try {
      localStorage.setItem(KEY, this.collapsed() ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }
}

function read() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
