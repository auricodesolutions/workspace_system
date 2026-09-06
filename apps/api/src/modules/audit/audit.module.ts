import { Controller, Get, Inject, Module, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { Roles, RolesGuard } from "../../auth/roles.guard.js";
import type { AuthRequest } from "../../auth/auth.types.js";
import { PrismaService } from "../../database/prisma.service.js";

@ApiTags("audit") @ApiBearerAuth() @UseGuards(JwtAuthGuard, RolesGuard) @Roles("ADMIN")
@Controller("audit-logs")
class AuditController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get()
  list(@Req() request: AuthRequest, @Query("entityType") entityType?: string) {
    return this.prisma.auditLog.findMany({ where: { organizationId: request.user.organizationId, ...(entityType ? { entityType } : {}) }, include: { actor: { select: { firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: "desc" }, take: 250 });
  }
}

@Module({ controllers: [AuditController], providers: [JwtAuthGuard, RolesGuard] })
export class AuditModule {}
