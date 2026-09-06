import { Body, Controller, Delete, Get, Inject, Module, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsISO8601, IsOptional, IsString, MinLength } from "class-validator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import type { AuthRequest } from "../../auth/auth.types.js";
import { PrismaService } from "../../database/prisma.service.js";

class CreateTodoDto { @IsString() @MinLength(1) title!: string; @IsOptional() @IsString() notes?: string; @IsOptional() @IsISO8601() dueDate?: string; }
class UpdateTodoDto { @IsOptional() @IsString() @MinLength(1) title?: string; @IsOptional() @IsString() notes?: string; @IsOptional() @IsISO8601() dueDate?: string; @IsOptional() @IsBoolean() completed?: boolean; }

@ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller()
class PlannerController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @ApiTags("calendar") @Get("calendar")
  async calendar(@Req() request: AuthRequest, @Query("from") from?: string, @Query("to") to?: string, @Query("userId") requestedUserId?: string) {
    const isAdmin = request.user.roles.includes("ADMIN");
    const userId = isAdmin ? requestedUserId : request.user.id;
    const start = from ? new Date(from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const end = to ? new Date(to) : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59);
    const tasks = await this.prisma.task.findMany({
      where: { dueDate: { gte: start, lte: end }, createdBy: { organizationId: request.user.organizationId }, ...(userId ? { assignments: { some: { userId } } } : {}) },
      include: { project: { select: { name: true, code: true } }, assignments: { include: { user: { select: { id: true, firstName: true, lastName: true } } } } },
      orderBy: [{ dueDate: "asc" }, { priorityScore: "desc" }],
    });
    return tasks.map((task) => ({ ...task, timing: task.status === "COMPLETED" || task.status === "ACCEPTED" ? "COMPLETED" : task.dueDate && task.dueDate < new Date() ? "OVERDUE" : "UPCOMING" }));
  }

  @ApiTags("personal-todos") @Get("todos")
  todos(@Req() request: AuthRequest) { return this.prisma.personalTodo.findMany({ where: { userId: request.user.id }, orderBy: [{ completed: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }] }); }

  @ApiTags("personal-todos") @Post("todos")
  createTodo(@Req() request: AuthRequest, @Body() dto: CreateTodoDto) { return this.prisma.personalTodo.create({ data: { userId: request.user.id, title: dto.title, notes: dto.notes, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined } }); }

  @ApiTags("personal-todos") @Patch("todos/:id")
  async updateTodo(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: UpdateTodoDto) {
    await this.prisma.personalTodo.findFirstOrThrow({ where: { id, userId: request.user.id } });
    return this.prisma.personalTodo.update({ where: { id }, data: { title: dto.title, notes: dto.notes, completed: dto.completed, ...(dto.dueDate ? { dueDate: new Date(dto.dueDate) } : {}) } });
  }

  @ApiTags("personal-todos") @Delete("todos/:id")
  async deleteTodo(@Req() request: AuthRequest, @Param("id") id: string) { await this.prisma.personalTodo.findFirstOrThrow({ where: { id, userId: request.user.id } }); return this.prisma.personalTodo.delete({ where: { id } }); }
}

@Module({ controllers: [PlannerController], providers: [JwtAuthGuard] })
export class PlannerModule {}
