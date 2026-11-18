import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GUIDES } from '../docs/guides';
import { REPO_BLOB, REPO_URL } from '../site';
import { Logo } from '../ui/logo';

@Component({
  selector: 'site-footer',
  imports: [RouterLink, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'block border-t border-base-content/10 bg-base-100 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]',
  },
  templateUrl: './site-footer.html',
})
export class SiteFooter {
  protected readonly guides = GUIDES;
  protected readonly repo = REPO_URL;
  protected readonly blob = REPO_BLOB;
}
