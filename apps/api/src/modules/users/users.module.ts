import { Body, ConflictException, Controller, ForbiddenException, Get, Inject, Module, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { compare, hash } from "bcryptjs";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { Roles, RolesGuard } from "../../auth/roles.guard.js";
import type { AuthRequest } from "../../auth/auth.types.js";
import { PrismaService } from "../../database/prisma.service.js";

const roles = ["ADMIN", "EMPLOYEE"] as const;
const statuses = ["ACTIVE", "INVITED", "SUSPENDED"] as const;

class CreateUserDto {
  @IsString() @MinLength(2) firstName!: string;
  @IsString() @MinLength(2) lastName!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() jobTitle?: string;
  @IsString() @MinLength(8) password!: string;
  @IsIn(roles) role!: typeof roles[number];
  @IsOptional() @IsString() businessUnitId?: string;
}
class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(2) firstName?: string;
  @IsOptional() @IsString() @MinLength(2) lastName?: string;
  @IsOptional() @IsString() jobTitle?: string;
  @IsOptional() @IsIn(statuses) status?: typeof statuses[number];
  @IsOptional() @IsIn(roles) role?: typeof roles[number];
}
class ResetPasswordDto { @IsOptional() @IsString() @MinLength(8) password?: string; @IsOptional() @IsString() @MinLength(8) currentPassword?: string; @IsOptional() @IsString() @MinLength(8) newPassword?: string; }
class ChangePasswordDto { @IsString() @MinLength(8) currentPassword!: string; @IsString() @MinLength(8) newPassword!: string; }

@ApiTags("users") @ApiBearerAuth() @UseGuards(JwtAuthGuard, RolesGuard) @Roles("ADMIN")
@Controller("users")
class UsersController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  list(@Req() request: AuthRequest) {
    return this.prisma.user.findMany({ where: { organizationId: request.user.organizationId }, select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, status: true, createdAt: true, roles: { select: { role: { select: { name: true } } } }, businessUnits: { select: { isDefault: true, businessUnit: { select: { id: true, name: true, code: true } } } }, _count: { select: { assignments: true } } }, orderBy: [{ status: "asc" }, { firstName: "asc" }] });
  }

  @Get("business-units")
  businessUnits(@Req() request: AuthRequest) { return this.prisma.businessUnit.findMany({ where: { organizationId: request.user.organizationId }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }); }

  @Post()
  async create(@Req() request: AuthRequest, @Body() dto: CreateUserDto) {
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException("A user with this email already exists");
    const [role, defaultUnit] = await Promise.all([
      this.prisma.role.findUniqueOrThrow({ where: { organizationId_name: { organizationId: request.user.organizationId, name: dto.role } } }),
      dto.businessUnitId ? this.prisma.businessUnit.findFirstOrThrow({ where: { id: dto.businessUnitId, organizationId: request.user.organizationId } }) : this.prisma.businessUnit.findFirstOrThrow({ where: { organizationId: request.user.organizationId, code: "ALD" } }),
    ]);
    const user = await this.prisma.user.create({ data: { organizationId: request.user.organizationId, firstName: dto.firstName, lastName: dto.lastName, email, jobTitle: dto.jobTitle, passwordHash: await hash(dto.password, 12), status: "ACTIVE", roles: { create: { roleId: role.id } }, businessUnits: { create: { businessUnitId: defaultUnit.id, isDefault: true } } }, select: { id: true, firstName: true, lastName: true, email: true, status: true } });
    await this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "CREATE", entityType: "USER", entityId: user.id, summary: `Created user ${user.firstName} ${user.lastName}` } });
    return user;
  }

  @Patch(":id/profile")
  async update(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: UpdateUserDto) {
    if (id === request.user.id && (dto.status === "SUSPENDED" || dto.role === "EMPLOYEE")) throw new ForbiddenException("You cannot suspend or demote your own administrator account");
    const target = await this.prisma.user.findFirstOrThrow({ where: { id, organizationId: request.user.organizationId } });
    if (dto.role) {
      const role = await this.prisma.role.findUniqueOrThrow({ where: { organizationId_name: { organizationId: request.user.organizationId, name: dto.role } } });
      await this.prisma.userRole.deleteMany({ where: { userId: target.id } });
      await this.prisma.userRole.create({ data: { userId: target.id, roleId: role.id } });
    }
    return this.prisma.user.update({ where: { id }, data: { firstName: dto.firstName, lastName: dto.lastName, jobTitle: dto.jobTitle, status: dto.status }, select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, status: true } });
  }

  @Patch(":id/password")
  async resetPassword(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: ResetPasswordDto) {
    if (id === "me") {
      if (!dto.currentPassword || !dto.newPassword) throw new ForbiddenException("Current and new passwords are required");
      const current = await this.prisma.user.findUniqueOrThrow({ where: { id: request.user.id } });
      if (!(await compare(dto.currentPassword, current.passwordHash))) throw new ForbiddenException("Current password is incorrect");
      if (dto.currentPassword === dto.newPassword) throw new ForbiddenException("New password must be different from the current password");
      await this.prisma.$transaction([this.prisma.user.update({ where: { id: current.id }, data: { passwordHash: await hash(dto.newPassword, 12) } }), this.prisma.passwordResetToken.updateMany({ where: { userId: current.id, usedAt: null }, data: { usedAt: new Date() } }), this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: current.id, action: "PASSWORD_CHANGE", entityType: "USER", entityId: current.id, summary: "Administrator changed their password" } })]);
      return { message: "Password changed successfully" };
    }
    if (!dto.password) throw new ForbiddenException("New password is required");
    await this.prisma.user.findFirstOrThrow({ where: { id, organizationId: request.user.organizationId } });
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await hash(dto.password, 12) } });
    return { success: true };
  }

  @Patch("me/change-password")
  async changeOwnPassword(@Req() request: AuthRequest, @Body() dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: request.user.id } });
    if (!(await compare(dto.currentPassword, user.passwordHash))) throw new ForbiddenException("Current password is incorrect");
    if (dto.currentPassword === dto.newPassword) throw new ForbiddenException("New password must be different from the current password");
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(dto.newPassword, 12) } }),
      this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: user.id, action: "PASSWORD_CHANGE", entityType: "USER", entityId: user.id, summary: "Administrator changed their password" } }),
    ]);
    return { message: "Password changed successfully" };
  }
}

@Module({ controllers: [UsersController], providers: [JwtAuthGuard, RolesGuard] })
export class UsersModule {}
