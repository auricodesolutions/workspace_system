import { Body, Controller, Get, Inject, Module, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, Matches, MinLength } from "class-validator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { Roles, RolesGuard } from "../../auth/roles.guard.js";
import type { AuthRequest } from "../../auth/auth.types.js";
import { PrismaService } from "../../database/prisma.service.js";

class CreateTaskTypeDto { @IsString() @MinLength(2) name!: string; @IsOptional() @IsString() description?: string; @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string; }
class UpdateTaskTypeDto { @IsOptional() @IsString() @MinLength(2) name?: string; @IsOptional() @IsString() description?: string; @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string; @IsOptional() @IsBoolean() active?: boolean; }

@ApiTags("task-types") @ApiBearerAuth() @UseGuards(JwtAuthGuard, RolesGuard) @Roles("ADMIN")
@Controller("task-types")
class TaskTypesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get() list(@Req() request: AuthRequest) { return this.prisma.taskType.findMany({ where: { organizationId: request.user.organizationId }, include: { _count: { select: { tasks: true } } }, orderBy: [{ active: "desc" }, { name: "asc" }] }); }
  @Post() async create(@Req() request: AuthRequest, @Body() dto: CreateTaskTypeDto) { const type = await this.prisma.taskType.create({ data: { organizationId: request.user.organizationId, name: dto.name.trim(), description: dto.description, color: dto.color } }); await this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "CREATE", entityType: "TASK_TYPE", entityId: type.id, summary: `Created task type ${type.name}` } }); return type; }
  @Patch(":id") async update(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: UpdateTaskTypeDto) { await this.prisma.taskType.findFirstOrThrow({ where: { id, organizationId: request.user.organizationId } }); const type = await this.prisma.taskType.update({ where: { id }, data: { name: dto.name?.trim(), description: dto.description, color: dto.color, active: dto.active } }); await this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "UPDATE", entityType: "TASK_TYPE", entityId: type.id, summary: `Updated task type ${type.name}` } }); return type; }
}

@Module({ controllers: [TaskTypesController], providers: [JwtAuthGuard, RolesGuard] })
export class TaskTypesModule {}
