import { Body, Controller, Get, Inject, Module, Patch, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, MinLength } from "class-validator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { Roles, RolesGuard } from "../../auth/roles.guard.js";
import type { AuthRequest } from "../../auth/auth.types.js";
import { PrismaService } from "../../database/prisma.service.js";

const projectStatuses = ["PLANNING", "ACTIVE", "ON_HOLD", "AWAITING_CLIENT", "AT_RISK", "COMPLETED", "CANCELLED"] as const;
const priorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

class CreateProjectDto {
  @IsString() @MinLength(3) name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsISO8601() startDate?: string;
  @IsOptional() @IsISO8601() dueDate?: string;
  @IsOptional() @IsNumber() budget?: number;
  @IsIn(priorities) priority!: typeof priorities[number];
}
class ProjectStatusDto { @IsIn(projectStatuses) status!: typeof projectStatuses[number]; }
class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(3) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsISO8601() startDate?: string;
  @IsOptional() @IsISO8601() dueDate?: string;
  @IsOptional() @IsNumber() budget?: number;
  @IsOptional() @IsIn(priorities) priority?: typeof priorities[number];
  @IsOptional() @IsIn(projectStatuses) status?: typeof projectStatuses[number];
}

@ApiTags("projects") @ApiBearerAuth() @UseGuards(JwtAuthGuard, RolesGuard) @Roles("ADMIN")
@Controller("projects")
class ProjectsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    return this.prisma.project.findMany({ include: { client: { select: { id: true, name: true } }, _count: { select: { tasks: true } } }, orderBy: { createdAt: "desc" } });
  }

  @Get("clients")
  clients(@Req() request: AuthRequest) {
    return this.prisma.client.findMany({ where: { organizationId: request.user.organizationId, status: { in: ["ACTIVE", "LEAD"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  }

  @Get(":id")
  async detail(@Req() request: AuthRequest, @Param("id") id: string) {
    return this.prisma.project.findFirstOrThrow({ where: { id, businessUnit: { organizationId: request.user.organizationId } }, include: { client: true, tasks: { include: { assignments: { include: { user: { select: { id: true, firstName: true, lastName: true } } } } }, orderBy: { createdAt: "desc" } }, invoices: { include: { payments: true }, orderBy: { createdAt: "desc" } } } });
  }

  @Post()
  async create(@Req() request: AuthRequest, @Body() dto: CreateProjectDto) {
    const unit = await this.prisma.businessUnit.findFirstOrThrow({ where: { code: "ALD", organizationId: request.user.organizationId } });
    const count = await this.prisma.project.count({ where: { businessUnitId: unit.id } });
    const code = `${unit.code}-PRJ-${String(count + 1).padStart(4, "0")}`;
    const project = await this.prisma.project.create({ data: { businessUnitId: unit.id, clientId: dto.clientId || undefined, code, name: dto.name, description: dto.description, priority: dto.priority, status: "PLANNING", startDate: dto.startDate ? new Date(dto.startDate) : undefined, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined, budget: dto.budget }, include: { client: true } });
    await this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "CREATE", entityType: "PROJECT", entityId: project.id, summary: `Created project ${project.code} — ${project.name}` } });
    return project;
  }

  @Patch(":id")
  async update(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: UpdateProjectDto) {
    await this.prisma.project.findFirstOrThrow({ where: { id, businessUnit: { organizationId: request.user.organizationId } } });
    const project = await this.prisma.project.update({ where: { id }, data: { name: dto.name, description: dto.description, clientId: dto.clientId || undefined, startDate: dto.startDate ? new Date(dto.startDate) : undefined, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined, budget: dto.budget, priority: dto.priority, status: dto.status } });
    await this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "UPDATE", entityType: "PROJECT", entityId: id, summary: `Updated project ${project.code}`, metadata: { name: dto.name ?? null, status: dto.status ?? null, priority: dto.priority ?? null } } });
    return project;
  }

  @Patch(":id/status")
  async updateStatus(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: ProjectStatusDto) {
    await this.prisma.project.findFirstOrThrow({ where: { id, businessUnit: { organizationId: request.user.organizationId } } });
    const project = await this.prisma.project.update({ where: { id }, data: { status: dto.status } });
    await this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "STATUS_CHANGE", entityType: "PROJECT", entityId: id, summary: `Changed ${project.code} status to ${dto.status}` } });
    return project;
  }
}

@Module({ controllers: [ProjectsController], providers: [JwtAuthGuard, RolesGuard] })
export class ProjectsModule {}
