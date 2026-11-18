import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { IntegrationProvider } from '../../generated/prisma/enums';
import { INTEGRATION_ADAPTERS, IntegrationAdapter } from './adapter.types';

@Injectable()
export class AdapterRegistry {
  private readonly byProvider = new Map<IntegrationProvider, IntegrationAdapter>();

  constructor(@Inject(INTEGRATION_ADAPTERS) adapters: IntegrationAdapter[]) {
    for (const a of adapters) this.byProvider.set(a.provider, a);
  }

  get(provider: IntegrationProvider): IntegrationAdapter {
    const adapter = this.byProvider.get(provider);
    if (!adapter) throw new BadRequestException(`No adapter registered for ${provider}`);
    return adapter;
  }

  all(): IntegrationAdapter[] {
    return [...this.byProvider.values()];
  }
}
