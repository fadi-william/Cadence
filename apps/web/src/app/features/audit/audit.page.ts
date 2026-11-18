import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import type { AuditLogDto } from '@cadence/shared';
import { ApiService, errorMessage } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { Avatar } from '../../shared/avatar';
import { PageHeader } from '../../shared/page-header';

const FILTERS = [
  { value: '', label: 'Everything' },
  { value: 'user', label: 'Users' },
  { value: 'member', label: 'People' },
  { value: 'integration', label: 'Integrations' },
  { value: 'service', label: 'Services' },
];

@Component({
  selector: 'app-audit-page',
  imports: [DatePipe, JsonPipe, Avatar, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './audit.page.html',
})
export class AuditPage {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly filters = FILTERS;
  protected readonly items = signal<AuditLogDto[]>([]);
  protected readonly cursor = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly entityType = signal('');

  constructor() {
    void this.load(true);
  }

  tone(action: string) {
    if (/deleted|failed|reuse|disabled/.test(action)) return 'badge-error';
    if (/created|completed|linked/.test(action)) return 'badge-success';
    if (/password|reset|secret/.test(action)) return 'badge-warning';
    return 'badge-info';
  }

  filter(type: string) {
    this.entityType.set(type);
    void this.load(true);
  }

  async load(reset = false) {
    this.loading.set(true);
    try {
      const page = await this.api.audit(
        reset ? null : this.cursor(),
        this.entityType() || undefined,
      );
      this.items.update((list) => (reset ? page.items : [...list, ...page.items]));
      this.cursor.set(page.nextCursor);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
