import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { MailerService } from '../mail/mailer.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { CreateUserBody, UpdateUserBody } from './dto';

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  reportsToId: true,
  tribeName: true,
  createdAt: true,
  reportsTo: { select: { id: true, name: true } },
  _count: { select: { reports: true, members: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
  ) {}

  async list(actor: AuthenticatedUser, role?: UserRole) {
    const where: Prisma.UserWhereInput = { role: role ?? { not: UserRole.ADMIN } };
    if (actor.role === UserRole.TRIBE_LEAD) {
      where.OR = [{ id: actor.id }, { reportsToId: actor.id }];
    } else if (actor.role === UserRole.ENGINEERING_MANAGER) {
      where.id = actor.id;
    }
    return this.prisma.user.findMany({ where, select: userSelect, orderBy: [{ role: 'asc' }, { name: 'asc' }] });
  }

  async get(actor: AuthenticatedUser, id: string) {
    const [user] = await this.list(actor).then((all) => all.filter((u) => u.id === id));
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Resolves and validates who the new/updated user reports to. */
  private async resolveReportsTo(actor: AuthenticatedUser, role: UserRole, reportsToId?: string) {
    if (role === UserRole.TRIBE_LEAD) {
      if (actor.role !== UserRole.ADMIN) throw new ForbiddenException('Only admins manage tribe leads');
      return actor.id;
    }
    // Engineering manager
    if (actor.role === UserRole.TRIBE_LEAD) {
      if (reportsToId && reportsToId !== actor.id) throw new ForbiddenException('EMs you create report to you');
      return actor.id;
    }
    if (actor.role !== UserRole.ADMIN) throw new ForbiddenException();
    if (!reportsToId) throw new BadRequestException('reportsToId (a tribe lead) is required');
    const lead = await this.prisma.user.findUnique({ where: { id: reportsToId } });
    if (!lead || lead.role !== UserRole.TRIBE_LEAD) throw new BadRequestException('reportsToId must be a tribe lead');
    return lead.id;
  }

  async create(actor: AuthenticatedUser, body: CreateUserBody) {
    const reportsToId = await this.resolveReportsTo(actor, body.role, body.reportsToId);
    try {
      const created = await this.prisma.user.create({
        data: {
          email: body.email.toLowerCase(),
          name: body.name,
          role: body.role,
          tribeName: body.role === UserRole.TRIBE_LEAD ? (body.tribeName ?? null) : null,
          reportsToId,
          passwordHash: await this.auth.hashPassword(body.password),
        },
        select: userSelect,
      });
      await this.audit.record({
        action: 'user.created',
        entityType: 'user',
        entityId: created.id,
        metadata: { email: created.email, role: created.role },
      });
      return created;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A user with this email already exists');
      }
      throw e;
    }
  }

  async update(actor: AuthenticatedUser, id: string, body: UpdateUserBody) {
    const target = await this.get(actor, id);
    if (target.role === UserRole.TRIBE_LEAD && actor.role !== UserRole.ADMIN && actor.id !== id) {
      throw new ForbiddenException();
    }
    const data: Prisma.UserUncheckedUpdateInput = {
      name: body.name,
      email: body.email?.toLowerCase(),
      tribeName: target.role === UserRole.TRIBE_LEAD ? body.tribeName : undefined,
    };
    if (body.password) {
      data.passwordHash = await this.auth.hashPassword(body.password);
      data.passwordChangedAt = new Date();
    }
    if (body.reportsToId && target.role === UserRole.ENGINEERING_MANAGER) {
      data.reportsToId = await this.resolveReportsTo(actor, target.role, body.reportsToId);
    }
    const updated = await this.prisma.user.update({ where: { id }, data, select: userSelect });
    if (body.password)
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    await this.audit.record({
      action: 'user.updated',
      entityType: 'user',
      entityId: id,
      metadata: { fields: Object.keys(body).map((k) => (k === 'password' ? 'password(changed)' : k)) },
    });
    return updated;
  }

  /** One-time password reset link (72h) for a user the actor manages. */
  async resetLink(actor: AuthenticatedUser, id: string) {
    const target = await this.get(actor, id);
    if (target.id === actor.id) throw new BadRequestException('Use "change password" for your own account');
    const { url, expiresAt } = await this.auth.createResetLink(target.id, 72, actor.id);
    const emailed =
      this.mailer.configured &&
      (await this.mailer.send(
        target.email,
        'Set your Cadence password',
        `Hi ${target.name},\n\nUse this link within 72 hours to set a new password:\n${url}`,
      ));
    await this.audit.record({
      action: 'user.reset_link_created',
      entityType: 'user',
      entityId: id,
      metadata: { emailed },
    });
    return { url, expiresAt: expiresAt.toISOString(), emailed };
  }

  async remove(actor: AuthenticatedUser, id: string) {
    const target = await this.get(actor, id);
    if (target.id === actor.id) throw new BadRequestException('You cannot delete yourself');
    if (target._count.reports > 0 || target._count.members > 0) {
      throw new ConflictException('Reassign this user’s reports and members before deleting');
    }
    await this.prisma.user.delete({ where: { id } });
    await this.audit.record({
      action: 'user.deleted',
      entityType: 'user',
      entityId: id,
      metadata: { email: target.email },
    });
  }
}
