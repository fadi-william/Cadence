import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { DoraService } from './dora.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../generated/prisma/enums';

class SetOwnerBody {
  @IsOptional()
  @IsString()
  managerId?: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v?: string) => (v && DATE.test(v) ? v : undefined);

@Controller('dora')
export class DoraController {
  constructor(private readonly dora: DoraService) {}

  @Get('summary')
  summary(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('managerId') managerId?: string,
  ) {
    return this.dora.summary(actor, date(from), date(to), managerId);
  }

  @Get('services')
  services(@CurrentUser() actor: AuthenticatedUser) {
    return this.dora.services(actor);
  }

  @Roles(UserRole.ADMIN, UserRole.TRIBE_LEAD)
  @Patch('services/:id')
  setOwner(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: SetOwnerBody) {
    return this.dora.setOwner(actor, id, body.managerId ?? null);
  }
}
