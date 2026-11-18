import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthStore } from '../../core/auth.store';
import { DateRange, fmtHours, lastNDays, shortDay } from '../../core/dates';
import { ToastService } from '../../core/toast.service';
import { Chart, ChartSpec } from '../../shared/chart';
import { DateRangePicker } from '../../shared/date-range';
import { DoraTile, doraKpis } from '../../shared/dora-tile';
import { PageHeader } from '../../shared/page-header';
import { ProviderIcon } from '../../shared/provider-icon';

@Component({
  selector: 'app-delivery-page',
  imports: [RouterLink, Chart, DateRangePicker, DoraTile, PageHeader, ProviderIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './delivery.page.html',
})
export class DeliveryPage {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthStore);
  protected readonly range = signal<DateRange>(lastNDays(30));
  protected readonly team = signal('');
  protected readonly hours = fmtHours;

  protected readonly summary = resource({
    params: () => ({ ...this.range(), team: this.team() }),
    loader: ({ params }) => this.api.dora(params.from, params.to, params.team || undefined),
  });
  private readonly managerRes = resource({ loader: () => this.api.users('ENGINEERING_MANAGER') });
  protected readonly managers = computed(() => this.managerRes.value() ?? []);
  protected readonly canAssign = computed(() => this.auth.hasRole('ADMIN', 'TRIBE_LEAD'));

  protected readonly tiles = computed(() => {
    const d = this.summary.value();
    return d ? doraKpis(d, fmtHours) : [];
  });

  protected readonly chart = computed<ChartSpec | null>(() => {
    const daily = this.summary.value()?.daily;
    if (!daily) return null;
    return {
      categories: daily.map((d) => shortDay(d.date)),
      series: [
        {
          name: 'Successful',
          type: 'bar',
          data: daily.map((d) => d.deployments - d.failures),
          color: 'success',
          stack: 'd',
        },
        {
          name: 'Failed',
          type: 'bar',
          data: daily.map((d) => d.failures),
          color: 'error',
          stack: 'd',
        },
      ],
    };
  });

  async assign(serviceId: string, managerId: string) {
    try {
      await this.api.setServiceOwner(serviceId, managerId || null);
      this.toast.success('Owner updated');
      this.summary.reload();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
