import { Controller, Get, Param, Query } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v?: string) => (v && DATE.test(v) ? v : undefined);

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('summary')
  summary(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('managerId') managerId?: string,
  ) {
    return this.metrics.summary(actor, date(from), date(to), managerId);
  }

  @Get('rollup')
  rollup(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('groupBy') groupBy?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.metrics.rollup(actor, groupBy === 'tribe' ? 'tribe' : 'manager', date(from), date(to));
  }

  @Get('members/:id')
  member(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.metrics.member(actor, id, date(from), date(to));
  }
}
