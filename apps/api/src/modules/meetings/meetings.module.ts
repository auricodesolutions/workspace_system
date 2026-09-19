import { BadRequestException, Body, Controller, Get, Inject, Module, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ArrayUnique, IsArray, IsBoolean, IsISO8601, IsOptional, IsString, MinLength } from "class-validator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { Roles, RolesGuard } from "../../auth/roles.guard.js";
import type { AuthRequest } from "../../auth/auth.types.js";
import { PrismaService } from "../../database/prisma.service.js";

class CreateMeetingDto {
  @IsString() @MinLength(3) title!: string;
  @IsISO8601() scheduledAt!: string;
  @IsOptional() @IsString() remarks?: string;
  @IsOptional() @IsString() specialNotes?: string;
  @IsArray() @ArrayUnique() @IsString({ each: true }) participantIds!: string[];
  @IsArray() @ArrayUnique() @IsString({ each: true }) clientIds!: string[];
  @IsArray() @ArrayUnique() @IsString({ each: true }) taskIds!: string[];
}

class MeetingItemStatusDto { @IsBoolean() completed!: boolean; @IsOptional() @IsString() notes?: string; }

const meetingInclude = {
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  participants: { include: { user: { select: { id: true, firstName: true, lastName: true, jobTitle: true } } } },
  items: {
    include: {
      client: { select: { id: true, name: true } },
      task: { select: { id: true, title: true, status: true, taskType: { select: { id: true, name: true, color: true } }, project: { select: { id: true, code: true, name: true, client: { select: { id: true, name: true } } } } } },
    },
    orderBy: { createdAt: "asc" as const },
  },
};

@ApiTags("weekly-meetings") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller("meetings")
class MeetingsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  list(@Req() request: AuthRequest) {
    const isAdmin = request.user.roles.includes("ADMIN");
    return this.prisma.weeklyMeeting.findMany({
      where: { organizationId: request.user.organizationId, ...(isAdmin ? {} : { participants: { some: { userId: request.user.id } } }) },
      include: meetingInclude,
      orderBy: [{ status: "asc" }, { scheduledAt: "desc" }],
    });
  }

  @Get("options") @Roles("ADMIN") @UseGuards(RolesGuard)
  async options(@Req() request: AuthRequest) {
    const [users, clients, tasks] = await Promise.all([
      this.prisma.user.findMany({ where: { organizationId: request.user.organizationId, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true, jobTitle: true }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }] }),
      this.prisma.client.findMany({ where: { organizationId: request.user.organizationId, status: { in: ["ACTIVE", "LEAD"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      this.prisma.task.findMany({ where: { createdBy: { organizationId: request.user.organizationId }, status: { notIn: ["ACCEPTED", "CANCELLED"] } }, select: { id: true, title: true, status: true, taskType: { select: { id: true, name: true, color: true } }, project: { select: { code: true, name: true, client: { select: { id: true, name: true } } } } }, orderBy: { createdAt: "desc" }, take: 200 }),
    ]);
    return { users, clients, tasks };
  }

  @Get(":id")
  detail(@Req() request: AuthRequest, @Param("id") id: string) {
    const isAdmin = request.user.roles.includes("ADMIN");
    return this.prisma.weeklyMeeting.findFirstOrThrow({ where: { id, organizationId: request.user.organizationId, ...(isAdmin ? {} : { participants: { some: { userId: request.user.id } } }) }, include: meetingInclude });
  }

  @Post() @Roles("ADMIN") @UseGuards(RolesGuard)
  async create(@Req() request: AuthRequest, @Body() dto: CreateMeetingDto) {
    if (!dto.participantIds.length) throw new BadRequestException("Assign at least one user to the meeting");
    if (!dto.clientIds.length && !dto.taskIds.length) throw new BadRequestException("Select at least one client or task for the meeting agenda");
    const [users, clients, tasks] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: dto.participantIds }, organizationId: request.user.organizationId, status: "ACTIVE" }, select: { id: true } }),
      this.prisma.client.findMany({ where: { id: { in: dto.clientIds }, organizationId: request.user.organizationId }, select: { id: true, name: true } }),
      this.prisma.task.findMany({ where: { id: { in: dto.taskIds }, createdBy: { organizationId: request.user.organizationId } }, select: { id: true, title: true, taskType: { select: { name: true } }, project: { select: { code: true, name: true, client: { select: { name: true } } } } } }),
    ]);
    if (users.length !== dto.participantIds.length) throw new BadRequestException("One or more selected users are unavailable");
    if (clients.length !== dto.clientIds.length || tasks.length !== dto.taskIds.length) throw new BadRequestException("One or more selected agenda items are unavailable");
    const meeting = await this.prisma.weeklyMeeting.create({
      data: {
        organizationId: request.user.organizationId, createdById: request.user.id, title: dto.title, scheduledAt: new Date(dto.scheduledAt), remarks: dto.remarks, specialNotes: dto.specialNotes,
        participants: { create: users.map((user) => ({ userId: user.id })) },
        items: { create: [...clients.map((client) => ({ clientId: client.id, title: `Customer: ${client.name}` })), ...tasks.map((task) => ({ taskId: task.id, title: `Task: ${task.title} · Type: ${task.taskType?.name ?? "Uncategorized"} — ${task.project ? `${task.project.code} · ${task.project.name}${task.project.client ? ` · Client: ${task.project.client.name}` : ""}` : "No project"}` }))] },
      },
      include: meetingInclude,
    });
    await this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "CREATE", entityType: "WEEKLY_MEETING", entityId: meeting.id, summary: `Scheduled weekly meeting: ${meeting.title}`, metadata: { participantCount: users.length, agendaItemCount: clients.length + tasks.length } } });
    return meeting;
  }

  @Post(":id/start") @Roles("ADMIN") @UseGuards(RolesGuard)
  async start(@Req() request: AuthRequest, @Param("id") id: string) {
    const meeting = await this.prisma.weeklyMeeting.findFirstOrThrow({ where: { id, organizationId: request.user.organizationId } });
    if (meeting.status === "COMPLETED" || meeting.status === "CANCELLED") throw new BadRequestException("This meeting can no longer be started");
    return this.prisma.weeklyMeeting.update({ where: { id }, data: { status: "IN_PROGRESS", startedAt: meeting.startedAt ?? new Date() }, include: meetingInclude });
  }

  @Patch(":id/items/:itemId") @Roles("ADMIN") @UseGuards(RolesGuard)
  async updateItem(@Req() request: AuthRequest, @Param("id") id: string, @Param("itemId") itemId: string, @Body() dto: MeetingItemStatusDto) {
    return this.prisma.$transaction(async (tx) => {
      const meeting = await tx.weeklyMeeting.findFirstOrThrow({ where: { id, organizationId: request.user.organizationId }, include: { items: true } });
      if (meeting.status === "SCHEDULED") throw new BadRequestException("Start the meeting before completing agenda items");
      if (meeting.status === "CANCELLED") throw new BadRequestException("A cancelled meeting cannot be changed");
      if (!meeting.items.some((item) => item.id === itemId)) throw new BadRequestException("Agenda item does not belong to this meeting");
      await tx.meetingItem.update({ where: { id: itemId }, data: { status: dto.completed ? "COMPLETED" : "ONGOING", completedAt: dto.completed ? new Date() : null, completedById: dto.completed ? request.user.id : null, ...(dto.notes !== undefined ? { notes: dto.notes } : {}) } });
      const remaining = await tx.meetingItem.count({ where: { meetingId: id, status: "ONGOING" } });
      await tx.weeklyMeeting.update({ where: { id }, data: { status: remaining === 0 ? "COMPLETED" : "IN_PROGRESS", completedAt: remaining === 0 ? new Date() : null, startedAt: meeting.startedAt ?? new Date() } });
      await tx.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: dto.completed ? "COMPLETE_ITEM" : "REOPEN_ITEM", entityType: "WEEKLY_MEETING", entityId: id, summary: `${dto.completed ? "Completed" : "Reopened"} a meeting agenda item` } });
      return tx.weeklyMeeting.findUniqueOrThrow({ where: { id }, include: meetingInclude });
    });
  }

  @Post(":id/cancel") @Roles("ADMIN") @UseGuards(RolesGuard)
  async cancel(@Req() request: AuthRequest, @Param("id") id: string) {
    const meeting = await this.prisma.weeklyMeeting.findFirstOrThrow({ where: { id, organizationId: request.user.organizationId } });
    if (meeting.status === "COMPLETED") throw new BadRequestException("A completed meeting cannot be cancelled");
    return this.prisma.weeklyMeeting.update({ where: { id }, data: { status: "CANCELLED" }, include: meetingInclude });
  }
}

@Module({ controllers: [MeetingsController], providers: [JwtAuthGuard, RolesGuard] })
export class MeetingsModule {}
