import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { Icon } from './icon';

@Component({
  selector: 'app-copy-button',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './copy-button.html',
})
export class CopyButton {
  readonly value = input.required<string>();
  readonly what = input('value');
  protected readonly copied = signal(false);

  async copy() {
    try {
      await navigator.clipboard.writeText(this.value());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context) */
    }
  }
}
