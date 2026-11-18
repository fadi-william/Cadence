import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../generated/prisma/enums';

/**
 * Central visibility rules:
 *  - ADMIN sees everything
 *  - TRIBE_LEAD sees the engineering managers reporting to them (and their members)
 *  - ENGINEERING_MANAGER sees only their own members
 */
@Injectable()
export class AccessScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Manager ids visible to the user, or `null` meaning "all". */
  async managerIds(user: AuthenticatedUser): Promise<string[] | null> {
    switch (user.role) {
      case UserRole.ADMIN:
        return null;
      case UserRole.TRIBE_LEAD: {
        const ems = await this.prisma.user.findMany({
          where: { reportsToId: user.id, role: UserRole.ENGINEERING_MANAGER },
          select: { id: true },
        });
        return ems.map((e) => e.id);
      }
      case UserRole.ENGINEERING_MANAGER:
        return [user.id];
    }
  }

  async memberWhere(user: AuthenticatedUser) {
    const ids = await this.managerIds(user);
    return ids === null ? {} : { managerId: { in: ids } };
  }

  async assertManagerInScope(user: AuthenticatedUser, managerId: string) {
    const manager = await this.prisma.user.findUnique({ where: { id: managerId } });
    if (!manager || manager.role !== UserRole.ENGINEERING_MANAGER) {
      throw new NotFoundException('Engineering manager not found');
    }
    const ids = await this.managerIds(user);
    if (ids !== null && !ids.includes(managerId)) throw new ForbiddenException('Manager is outside your scope');
    return manager;
  }

  async assertMemberInScope(user: AuthenticatedUser, memberId: string) {
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, ...(await this.memberWhere(user)) },
    });
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }
}
