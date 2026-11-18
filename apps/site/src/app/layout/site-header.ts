import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { REPO_URL } from '../site';
import { ThemeService } from '../theme.service';
import { Icon } from '../ui/icon';
import { Logo } from '../ui/logo';

@Component({
  selector: 'site-header',
  imports: [RouterLink, RouterLinkActive, Icon, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'sticky top-0 z-40 block border-b border-base-content/10 bg-base-200/85 pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] backdrop-blur-md',
  },
  templateUrl: './site-header.html',
})
export class SiteHeader {
  protected readonly theme = inject(ThemeService);
  protected readonly repo = REPO_URL;
  protected readonly open = signal(false);
  protected readonly links = [
    { label: 'Features', path: '/', fragment: 'features' },
    { label: 'How it works', path: '/', fragment: 'how-it-works' },
    { label: 'Docs', path: '/docs', fragment: undefined },
  ];
}
