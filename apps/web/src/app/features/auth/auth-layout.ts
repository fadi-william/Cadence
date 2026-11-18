import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Avatar } from '../../shared/avatar';
import { BrandArcs } from '../../shared/brand-arcs';
import { Icon } from '../../shared/icon';
import { Logo } from '../../shared/logo';

/** Split auth layout: wine brand panel with a product preview (desktop) + form column. */
@Component({
  selector: 'app-auth-layout',
  imports: [Avatar, BrandArcs, Icon, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './auth-layout.html',
})
export class AuthLayout {
  readonly tagline = input('Understand how your teams deliver.');
  protected readonly bars = [35, 55, 42, 70, 60, 85, 72, 95];
  protected readonly bullets = [
    { icon: 'org', text: 'Tribes, teams and people in one place' },
    { icon: 'layers', text: 'Azure DevOps and Jira, merged per person' },
    { icon: 'rocket', text: 'DORA delivery metrics from your pipelines' },
  ];
}
