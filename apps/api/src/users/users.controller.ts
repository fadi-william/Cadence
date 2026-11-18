import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserBody, UpdateUserBody } from './dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../generated/prisma/enums';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Query('role') role?: UserRole) {
    return this.users.list(actor, role && Object.values(UserRole).includes(role) ? role : undefined);
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.users.get(actor, id);
  }

  @Roles(UserRole.ADMIN, UserRole.TRIBE_LEAD)
  @Post()
  create(@CurrentUser() actor: AuthenticatedUser, @Body() body: CreateUserBody) {
    return this.users.create(actor, body);
  }

  @Roles(UserRole.ADMIN, UserRole.TRIBE_LEAD)
  @Patch(':id')
  update(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: UpdateUserBody) {
    return this.users.update(actor, id, body);
  }

  @Roles(UserRole.ADMIN, UserRole.TRIBE_LEAD)
  @Post(':id/reset-link')
  resetLink(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.users.resetLink(actor, id);
  }

  @Roles(UserRole.ADMIN, UserRole.TRIBE_LEAD)
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.users.remove(actor, id);
  }
}
