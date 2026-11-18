import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormField, applyWhen, form, required, submit, validate } from '@angular/forms/signals';
import {
  KIND_LABELS,
  type IntegrationConnectionDto,
  type ProviderDescriptorDto,
  type SyncRunDto,
  type WebhookInfoDto,
} from '@cadence/shared';
import { ApiService, errorMessage } from '../../core/api.service';
import { ToastService } from '../../core/toast.service';
import { CopyButton } from '../../shared/copy-button';
import { Field, isInvalid } from '../../shared/field';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { ProviderIcon } from '../../shared/provider-icon';

const ACTIVE = new Set(['QUEUED', 'RUNNING']);

interface ConnectionForm {
  name: string;
  baseUrl: string;
  secret: string;
  config: Record<string, string>;
}

@Component({
  selector: 'app-integrations-page',
  imports: [FormField, DatePipe, CopyButton, Field, Icon, PageHeader, ProviderIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './integrations.page.html',
})
export class IntegrationsPage implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly webhookDialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('webhookDialog');
  protected readonly kindLabels = KIND_LABELS;
  protected readonly invalid = isInvalid;

  private readonly providerRes = resource({ loader: () => this.api.providers() });
  private readonly list = resource({ loader: () => this.api.integrations() });
  protected readonly providers = computed(() => this.providerRes.value() ?? []);
  protected readonly connections = computed(() => this.list.value() ?? []);

  protected readonly provider = signal<ProviderDescriptorDto | null>(null);
  protected readonly editing = signal<IntegrationConnectionDto | null>(null);
  protected readonly pending = signal<string | null>(null);
  /** Runs being polled, by connection id. */
  protected readonly liveRuns = signal<Record<string, SyncRunDto>>({});
  protected readonly webhookFor = signal<IntegrationConnectionDto | null>(null);
  protected readonly webhook = signal<WebhookInfoDto | null>(null);
  protected readonly providerSecret = signal('');
  private pollTimer?: ReturnType<typeof setInterval>;

  protected readonly model = signal<ConnectionForm>({
    name: '',
    baseUrl: '',
    secret: '',
    config: {},
  });
  protected readonly cf = form(this.model, (p) => {
    required(p.name, { message: 'Give the connection a name' });
    required(p.baseUrl, { message: 'Enter the base URL' });
    validate(p.baseUrl, ({ value }) =>
      /^https?:\/\/\S+$/.test(value())
        ? null
        : { kind: 'url', message: 'Enter a full URL (https://…)' },
    );
    applyWhen(
      p,
      () => !this.editing(),
      (q) => required(q.secret, { message: 'A token is required' }),
    );
    validate(p.config, ({ value }) => {
      const missing = (this.provider()?.configFields ?? []).filter(
        (f) => f.required && !value()[f.key]?.trim(),
      );
      return missing.length
        ? { kind: 'config', message: `Required: ${missing.map((f) => f.label).join(', ')}` }
        : null;
    });
  });

  describe = (p: string) => this.providers().find((d) => d.provider === p);
  kinds = (p: ProviderDescriptorDto) => p.capabilities.map((c) => KIND_LABELS[c]).join(' · ');
  active = (r: SyncRunDto) => ACTIVE.has(r.status);
  lastRun = (c: IntegrationConnectionDto) => this.liveRuns()[c.id] ?? c.lastSync ?? null;
  isSyncing = (c: IntegrationConnectionDto) => {
    const r = this.lastRun(c);
    return !!r && this.active(r);
  };
  statusLabel = (r: SyncRunDto) =>
    ({
      QUEUED: 'Queued…',
      RUNNING: 'Syncing…',
      SUCCESS: 'Last sync succeeded',
      FAILED: 'Last sync failed',
    })[r.status];

  private configToForm(p: ProviderDescriptorDto, cfg: Record<string, unknown> = {}) {
    const out: Record<string, string> = {};
    for (const f of p.configFields) {
      const v = cfg[f.key];
      out[f.key] = Array.isArray(v) ? v.join(', ') : String(v ?? f.options?.[0]?.value ?? '');
    }
    return out;
  }

  private formToConfig(p: ProviderDescriptorDto, config: Record<string, string>) {
    const out: Record<string, unknown> = {};
    for (const f of p.configFields) {
      const v = (config[f.key] ?? '').trim();
      out[f.key] =
        f.type === 'list'
          ? v
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : v;
    }
    return out;
  }

  private openDialog(p: ProviderDescriptorDto, c: IntegrationConnectionDto | null) {
    (document.activeElement as HTMLElement | null)?.blur();
    this.provider.set(p);
    this.editing.set(c);
    this.model.set({
      name: c?.name ?? p.label,
      baseUrl: c?.baseUrl ?? p.defaultBaseUrl ?? '',
      secret: '',
      config: this.configToForm(p, c?.config),
    });
    this.cf().reset();
    this.dialog().nativeElement.showModal();
  }

  openCreate(p: ProviderDescriptorDto) {
    this.openDialog(p, null);
  }

  openEdit(c: IntegrationConnectionDto) {
    const p = this.describe(c.provider);
    if (p) this.openDialog(p, c);
  }

  async save(event: Event) {
    event.preventDefault();
    const p = this.provider()!;
    await submit(this.cf, async () => {
      const v = this.model();
      const base = { name: v.name, baseUrl: v.baseUrl, config: this.formToConfig(p, v.config) };
      try {
        const c = this.editing();
        if (c)
          await this.api.updateIntegration(c.id, {
            ...base,
            ...(v.secret ? { secret: v.secret } : {}),
          });
        else await this.api.createIntegration({ ...base, provider: p.provider, secret: v.secret });
        this.toast.success('Integration saved');
        this.dialog().nativeElement.close();
        this.list.reload();
      } catch (e) {
        this.toast.error(errorMessage(e));
      }
      return undefined;
    });
  }

  async toggle(c: IntegrationConnectionDto) {
    await this.api
      .updateIntegration(c.id, { enabled: !c.enabled })
      .catch((e) => this.toast.error(errorMessage(e)));
    this.list.reload();
  }

  async test(c: IntegrationConnectionDto) {
    this.pending.set(c.id);
    try {
      const r = await this.api.testIntegration(c.id);
      if (r.ok) this.toast.success(r.message ?? 'Connection OK');
      else this.toast.error(r.message ?? 'Connection failed');
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.pending.set(null);
    }
  }

  async sync(c: IntegrationConnectionDto) {
    try {
      const run = await this.api.syncIntegration(c.id, 14);
      this.liveRuns.update((r) => ({ ...r, [c.id]: run }));
      this.startPolling();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  /** Syncs run in the background (queue or in-process); poll until each finishes. */
  private startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      const live = Object.entries(this.liveRuns()).filter(([, r]) => this.active(r));
      if (!live.length) {
        clearInterval(this.pollTimer);
        this.pollTimer = undefined;
        this.list.reload();
        return;
      }
      for (const [connectionId, r] of live) {
        const next = await this.api.syncRun(connectionId, r.id).catch(() => null);
        if (!next) continue;
        this.liveRuns.update((m) => ({ ...m, [connectionId]: next }));
        if (next.status === 'SUCCESS')
          this.toast.success(`Sync finished: ${next.recordsWritten} rows`);
        if (next.status === 'FAILED') this.toast.error(next.error ?? 'Sync failed');
      }
    }, 1500);
  }

  async openWebhook(c: IntegrationConnectionDto) {
    this.webhookFor.set(c);
    this.webhook.set(null);
    this.providerSecret.set('');
    this.webhookDialog().nativeElement.showModal();
    try {
      this.webhook.set(await this.api.webhook(c.id));
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async setSecret(secret?: string) {
    const c = this.webhookFor();
    if (!c) return;
    if (
      this.webhook()?.configured &&
      !secret &&
      !confirm('Rotate the secret? The current one stops working immediately.')
    )
      return;
    try {
      const info = await this.api.setWebhookSecret(c.id, secret);
      // Don't echo back a secret the user typed themselves.
      this.webhook.set(secret ? { ...info, secret: undefined } : info);
      this.providerSecret.set('');
      this.toast.success('Webhook enabled');
      this.list.reload();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async disableWebhook() {
    const c = this.webhookFor();
    if (!c || !confirm('Disable this webhook? Incoming events will be rejected.')) return;
    this.webhook.set(await this.api.disableWebhook(c.id));
    this.list.reload();
  }

  async remove(c: IntegrationConnectionDto) {
    if (
      !confirm(
        `Delete ${c.name}? Linked identities, metrics and deployments from it will be removed.`,
      )
    )
      return;
    try {
      await this.api.deleteIntegration(c.id);
      this.list.reload();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  ngOnDestroy() {
    clearInterval(this.pollTimer);
  }
}
