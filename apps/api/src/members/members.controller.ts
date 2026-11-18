import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { MembersService } from './members.service';
import { CreateMemberBody, UpdateMemberBody, UpsertIdentityBody } from './dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Query('managerId') managerId?: string) {
    return this.members.list(actor, managerId);
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.members.get(actor, id);
  }

  @Post()
  create(@CurrentUser() actor: AuthenticatedUser, @Body() body: CreateMemberBody) {
    return this.members.create(actor, body);
  }

  @Patch(':id')
  update(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: UpdateMemberBody) {
    return this.members.update(actor, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.members.remove(actor, id);
  }

  @Put(':id/identities/:connectionId')
  upsertIdentity(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('connectionId') connectionId: string,
    @Body() body: UpsertIdentityBody,
  ) {
    return this.members.upsertIdentity(actor, id, connectionId, body);
  }

  @Delete(':id/identities/:connectionId')
  removeIdentity(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Param('connectionId') connectionId: string,
  ) {
    return this.members.removeIdentity(actor, id, connectionId);
  }
}
