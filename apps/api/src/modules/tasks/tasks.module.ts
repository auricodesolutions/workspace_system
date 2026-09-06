import { BadRequestException, Body, Controller, Get, Inject, Module, NotFoundException, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsArray, IsIn, IsISO8601, IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { Roles, RolesGuard } from "../../auth/roles.guard.js";
import type { AuthRequest } from "../../auth/auth.types.js";
import { PrismaService } from "../../database/prisma.service.js";

const priorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const statuses = ["BACKLOG", "TODO", "IN_PROGRESS", "WAITING", "REVIEW", "COMPLETED", "CANCELLED"] as const;

class CreateTaskDto {
  @IsString() @MinLength(3) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsArray() @IsString({ each: true }) assigneeIds!: string[];
  @IsOptional() @IsISO8601() dueDate?: string;
  @IsIn(priorities) priority!: typeof priorities[number];
}
class UpdateStatusDto { @IsIn(statuses) status!: typeof statuses[number]; }
class RevisionDto { @IsOptional() @IsString() note?: string; }
class AcceptTaskDto { @IsString() userId!: string; @IsString() fundingAccountId!: string; @IsNumber() @Min(0.01) cost!: number; }

@ApiTags("tasks") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("tasks")
class TasksController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("my")
  myTasks(@Req() request: AuthRequest) {
    return this.prisma.task.findMany({ where: { assignments: { some: { userId: request.user.id } } }, include: { project: { select: { id: true, name: true, code: true } }, revisions: { orderBy: { revisionNumber: "desc" }, take: 1 } }, orderBy: [{ priorityScore: "desc" }, { dueDate: "asc" }] });
  }

  @Get() @Roles("ADMIN") @UseGuards(RolesGuard)
  allTasks() {
    return this.prisma.task.findMany({ include: { project: true, fundingAccount: { select: { id: true, name: true, type: true } }, revisions: { orderBy: { revisionNumber: "desc" }, take: 1 }, assignments: { include: { user: { select: { id: true, firstName: true, lastName: true } } } } }, orderBy: { createdAt: "desc" } });
  }

  @Post() @Roles("ADMIN") @UseGuards(RolesGuard)
  create(@Req() request: AuthRequest, @Body() dto: CreateTaskDto) {
    const score = { LOW: 25, MEDIUM: 50, HIGH: 75, CRITICAL: 100 }[dto.priority];
    return this.prisma.task.create({ data: { title: dto.title, description: dto.description, projectId: dto.projectId || undefined, createdById: request.user.id, priority: dto.priority, priorityScore: score, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined, assignments: { create: dto.assigneeIds.map((userId) => ({ userId })) } }, include: { assignments: true } });
  }

  @Patch(":id/status")
  async updateStatus(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: UpdateStatusDto) {
    const isAdmin = request.user.roles.includes("ADMIN");
    const task = await this.prisma.task.findFirst({ where: { id, ...(isAdmin ? {} : { assignments: { some: { userId: request.user.id } } }) } });
    if (!task) throw new NotFoundException("Task not found or not assigned to you");
    if (task.status === "ACCEPTED") throw new BadRequestException("An accepted task is final and cannot be changed");
    if (!isAdmin && task.status === "COMPLETED") throw new BadRequestException("This task is awaiting administrator review");
    return this.prisma.task.update({ where: { id }, data: { status: dto.status, completedAt: dto.status === "COMPLETED" ? new Date() : null } });
  }

  @Post(":id/revision") @Roles("ADMIN") @UseGuards(RolesGuard)
  async requestRevision(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: RevisionDto) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.findUniqueOrThrow({ where: { id } });
      if (task.status !== "COMPLETED") throw new BadRequestException("Only a completed task can be reopened for revision");
      const revisionNumber = task.revisionCount + 1;
      await tx.taskRevision.create({ data: { taskId: id, requestedById: request.user.id, revisionNumber, note: dto.note } });
      await tx.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "REVISION", entityType: "TASK", entityId: id, summary: `Requested revision ${String(revisionNumber).padStart(2, "0")} for ${task.title}` } });
      return tx.task.update({ where: { id }, data: { status: "REVISION", revisionCount: revisionNumber, completedAt: null }, include: { revisions: { orderBy: { revisionNumber: "desc" }, take: 1 } } });
    });
  }

  @Post(":id/accept") @Roles("ADMIN") @UseGuards(RolesGuard)
  async accept(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: AcceptTaskDto) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.task.findUniqueOrThrow({ where: { id }, include: { assignments: true, project: { select: { clientId: true } } } });
      if (task.status !== "COMPLETED") throw new BadRequestException("Only a completed task can be accepted");
      if (!task.assignments.some((assignment) => assignment.userId === dto.userId)) throw new BadRequestException("Wallet recipient must be assigned to this task");
      await tx.financialAccount.findFirstOrThrow({ where: { id: dto.fundingAccountId, organizationId: request.user.organizationId, active: true } });
      const wallet = await tx.wallet.upsert({ where: { userId: dto.userId }, update: {}, create: { userId: dto.userId } });
      const updatedWallet = await tx.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: dto.cost } } });
      await tx.walletTransaction.create({ data: { walletId: wallet.id, taskId: task.id, projectId: task.projectId, type: "TASK_CREDIT", status: "CREDITED", amount: dto.cost, balanceAfter: updatedWallet.balance, description: `Accepted task: ${task.title}` } });
      if (task.projectId) await tx.project.update({ where: { id: task.projectId }, data: { taskCostTotal: { increment: dto.cost } } });
      if (task.project?.clientId) {
        const account = await tx.clientAccount.upsert({ where: { clientId: task.project.clientId }, update: {}, create: { clientId: task.project.clientId } });
        const updatedAccount = await tx.clientAccount.update({ where: { id: account.id }, data: { balance: { increment: dto.cost } } });
        await tx.clientTransaction.create({ data: { accountId: account.id, taskId: task.id, projectId: task.projectId, type: "TASK_CHARGE", status: "CHARGED", amount: dto.cost, balanceAfter: updatedAccount.balance, description: `Approved task: ${task.title}` } });
      }
      await tx.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "ACCEPT", entityType: "TASK", entityId: id, summary: `Accepted ${task.title} at LKR ${dto.cost}`, metadata: { cost: dto.cost, recipientId: dto.userId } } });
      return tx.task.update({ where: { id }, data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedById: request.user.id, laborCost: dto.cost, fundingAccountId: dto.fundingAccountId } });
    });
  }
}

@ApiTags("directory") @ApiBearerAuth() @UseGuards(JwtAuthGuard, RolesGuard) @Roles("ADMIN")
@Controller()
class DirectoryController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get("users/assignable")
  users(@Req() request: AuthRequest) { return this.prisma.user.findMany({ where: { organizationId: request.user.organizationId, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true } }); }
  @Get("projects/options")
  projects() { return this.prisma.project.findMany({ where: { status: { in: ["PLANNING", "ACTIVE", "AT_RISK"] } }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }); }
}

@Module({ controllers: [TasksController, DirectoryController], providers: [JwtAuthGuard, RolesGuard] })
export class TasksModule {}
