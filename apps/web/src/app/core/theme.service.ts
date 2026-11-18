import { Injectable, computed, signal } from '@angular/core';

const KEY = 'cadence-theme';
export type Theme = 'cadence' | 'cadence-dark';

/** Applies a theme instantly: suspends CSS transitions while the theme attribute flips. */
function applyThemeInstantly(theme: string) {
  const root = document.documentElement;
  root.setAttribute('data-theme-switching', '');
  root.dataset['theme'] = theme;
  void getComputedStyle(root).color; // flush styles while transitions are off
  requestAnimationFrame(() =>
    requestAnimationFrame(() => root.removeAttribute('data-theme-switching')),
  );
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>((document.documentElement.dataset['theme'] as Theme) ?? 'cadence');
  readonly isDark = computed(() => this.theme() === 'cadence-dark');

  toggle() {
    this.set(this.theme() === 'cadence' ? 'cadence-dark' : 'cadence');
  }

  set(theme: Theme) {
    this.theme.set(theme);
    applyThemeInstantly(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* storage unavailable */
    }
  }
}
