import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { MemberDto } from '@cadence/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { AccessScopeService } from '../org/access-scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Prisma } from '../generated/prisma/client';
import { UserRole } from '../generated/prisma/enums';
import { CreateMemberBody, UpdateMemberBody, UpsertIdentityBody } from './dto';

const memberInclude = {
  manager: { select: { id: true, name: true } },
  identities: { include: { connection: { select: { name: true, provider: true } } } },
} satisfies Prisma.MemberInclude;

type MemberRow = Prisma.MemberGetPayload<{ include: typeof memberInclude }>;

const toDto = (m: MemberRow): MemberDto => ({
  id: m.id,
  name: m.name,
  email: m.email,
  title: m.title,
  managerId: m.managerId,
  manager: m.manager,
  createdAt: m.createdAt.toISOString(),
  identities: m.identities.map((i) => ({
    id: i.id,
    connectionId: i.connectionId,
    provider: i.connection.provider,
    connectionName: i.connection.name,
    username: i.username,
    displayName: i.displayName,
  })),
});

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: AccessScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedUser, managerId?: string) {
    const where: Prisma.MemberWhereInput = { ...(await this.scope.memberWhere(actor)) };
    if (managerId) where.AND = [{ managerId }];
    const rows = await this.prisma.member.findMany({ where, include: memberInclude, orderBy: { name: 'asc' } });
    return rows.map(toDto);
  }

  async get(actor: AuthenticatedUser, id: string) {
    await this.scope.assertMemberInScope(actor, id);
    return toDto(await this.prisma.member.findUniqueOrThrow({ where: { id }, include: memberInclude }));
  }

  async create(actor: AuthenticatedUser, body: CreateMemberBody) {
    const managerId = body.managerId ?? (actor.role === UserRole.ENGINEERING_MANAGER ? actor.id : undefined);
    if (!managerId) throw new BadRequestException('managerId is required');
    await this.scope.assertManagerInScope(actor, managerId);
    const row = await this.prisma.member.create({
      data: { name: body.name, email: body.email?.toLowerCase(), title: body.title, managerId },
      include: memberInclude,
    });
    await this.audit.record({
      action: 'member.created',
      entityType: 'member',
      entityId: row.id,
      metadata: { name: row.name, managerId },
    });
    return toDto(row);
  }

  async update(actor: AuthenticatedUser, id: string, body: UpdateMemberBody) {
    await this.scope.assertMemberInScope(actor, id);
    if (body.managerId) await this.scope.assertManagerInScope(actor, body.managerId);
    const row = await this.prisma.member.update({
      where: { id },
      data: { name: body.name, email: body.email?.toLowerCase(), title: body.title, managerId: body.managerId },
      include: memberInclude,
    });
    await this.audit.record({
      action: 'member.updated',
      entityType: 'member',
      entityId: id,
      metadata: { fields: Object.keys(body) },
    });
    return toDto(row);
  }

  async remove(actor: AuthenticatedUser, id: string) {
    await this.scope.assertMemberInScope(actor, id);
    const removed = await this.prisma.member.delete({ where: { id } });
    await this.audit.record({
      action: 'member.deleted',
      entityType: 'member',
      entityId: id,
      metadata: { name: removed.name },
    });
  }

  async upsertIdentity(actor: AuthenticatedUser, memberId: string, connectionId: string, body: UpsertIdentityBody) {
    await this.scope.assertMemberInScope(actor, memberId);
    const connection = await this.prisma.integrationConnection.findUnique({ where: { id: connectionId } });
    if (!connection) throw new NotFoundException('Integration not found');
    const username = body.username.trim();
    try {
      await this.prisma.externalIdentity.upsert({
        where: { memberId_connectionId: { memberId, connectionId } },
        create: { memberId, connectionId, username, displayName: body.displayName },
        update: { username, displayName: body.displayName, externalId: null },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`"${username}" is already linked to another member on ${connection.name}`);
      }
      throw e;
    }
    await this.audit.record({
      action: 'identity.linked',
      entityType: 'member',
      entityId: memberId,
      metadata: { connectionId, provider: connection.provider, username },
    });
    return this.get(actor, memberId);
  }

  async removeIdentity(actor: AuthenticatedUser, memberId: string, connectionId: string) {
    await this.scope.assertMemberInScope(actor, memberId);
    await this.prisma.externalIdentity.deleteMany({ where: { memberId, connectionId } });
    await this.audit.record({
      action: 'identity.unlinked',
      entityType: 'member',
      entityId: memberId,
      metadata: { connectionId },
    });
    return this.get(actor, memberId);
  }
}
