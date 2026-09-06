import { BadRequestException, Body, Controller, Get, Inject, Injectable, Module, OnModuleDestroy, OnModuleInit, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { Roles, RolesGuard } from "../../auth/roles.guard.js";
import type { AuthRequest } from "../../auth/auth.types.js";
import { PrismaService } from "../../database/prisma.service.js";

const frequencies = ["MONTHLY", "ANNUAL"] as const; const reminderDays = [60, 30, 14, 7, 3];
class CreateRenewalDto { @IsString() projectId!: string; @IsString() @MinLength(2) name!: string; @IsIn(frequencies) frequency!: typeof frequencies[number]; @IsNumber() @Min(0.01) amount!: number; @IsISO8601() nextDueDate!: string; @IsOptional() @IsString() notes?: string; }
class UpdateRenewalDto { @IsOptional() @IsString() @MinLength(2) name?: string; @IsOptional() @IsIn(frequencies) frequency?: typeof frequencies[number]; @IsOptional() @IsNumber() @Min(0.01) amount?: number; @IsOptional() @IsISO8601() nextDueDate?: string; @IsOptional() @IsBoolean() active?: boolean; @IsOptional() @IsString() notes?: string; }

@Injectable()
class RenewalProcessor implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout; private processing = false;
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  onModuleInit() { void this.process(); this.timer = setInterval(() => void this.process(), 60 * 60 * 1000); this.timer.unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  private nextDate(date: Date, frequency: "MONTHLY" | "ANNUAL") { const next = new Date(date); if (frequency === "ANNUAL") { next.setFullYear(next.getFullYear() + 1); return next; } const day = next.getDate(); next.setDate(1); next.setMonth(next.getMonth() + 1); const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate(); next.setDate(Math.min(day, lastDay)); return next; }
  async process() {
    if (this.processing) return; this.processing = true;
    try {
      const now = new Date(); const renewals = await this.prisma.projectRenewal.findMany({ where: { active: true }, include: { project: { include: { client: true, businessUnit: true } } } });
      for (const renewal of renewals) {
        if (!renewal.project.clientId) continue;
        let due = new Date(renewal.nextDueDate); let cycles = 0;
        while (due <= now && cycles < 36) {
          await this.prisma.$transaction(async (tx) => {
            const existing = await tx.clientTransaction.findFirst({ where: { renewalId: renewal.id, renewalDueDate: due, type: "RENEWAL_CHARGE" } });
            if (!existing) { const account = await tx.clientAccount.upsert({ where: { clientId: renewal.project.clientId! }, update: {}, create: { clientId: renewal.project.clientId! } }); const updated = await tx.clientAccount.update({ where: { id: account.id }, data: { balance: { increment: renewal.amount } } }); await tx.clientTransaction.create({ data: { accountId: account.id, projectId: renewal.projectId, renewalId: renewal.id, renewalDueDate: due, type: "RENEWAL_CHARGE", status: "CHARGED", amount: renewal.amount, balanceAfter: updated.balance, description: `${renewal.name} renewal - ${renewal.project.code}` } }); await tx.auditLog.create({ data: { organizationId: renewal.project.businessUnit.organizationId, action: "AUTO_CHARGE", entityType: "RENEWAL", entityId: renewal.id, summary: `Charged ${renewal.project.client!.name} LKR ${renewal.amount} for ${renewal.name}` } }); }
            await tx.renewalReminder.updateMany({ where: { renewalId: renewal.id, dueDate: { lte: due } }, data: { dismissed: true } });
          });
          due = this.nextDate(due, renewal.frequency); cycles++;
        }
        if (cycles) await this.prisma.projectRenewal.update({ where: { id: renewal.id }, data: { nextDueDate: due } });
        const days = Math.ceil((due.getTime() - now.getTime()) / 86400000);
        for (const offset of reminderDays.filter((value) => days >= 0 && days <= value)) await this.prisma.renewalReminder.upsert({ where: { renewalId_dueDate_daysBefore: { renewalId: renewal.id, dueDate: due, daysBefore: offset } }, update: {}, create: { renewalId: renewal.id, dueDate: due, daysBefore: offset } });
      }
    } finally { this.processing = false; }
  }
}

@ApiTags("renewals") @ApiBearerAuth() @UseGuards(JwtAuthGuard, RolesGuard) @Roles("ADMIN") @Controller("renewals")
class RenewalsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, private readonly processor: RenewalProcessor) {}
  @Get() async list(@Req() request: AuthRequest) { await this.processor.process(); return this.prisma.projectRenewal.findMany({ where: { project: { businessUnit: { organizationId: request.user.organizationId } } }, include: { project: { include: { client: { select: { id: true, name: true } } } }, reminders: { where: { dismissed: false }, orderBy: { daysBefore: "desc" } }, transactions: { orderBy: { createdAt: "desc" }, take: 20 } }, orderBy: [{ active: "desc" }, { nextDueDate: "asc" }] }); }
  @Post() async create(@Req() request: AuthRequest, @Body() dto: CreateRenewalDto) { const project = await this.prisma.project.findFirstOrThrow({ where: { id: dto.projectId, businessUnit: { organizationId: request.user.organizationId } } }); if (!project.clientId) throw new BadRequestException("Renewals require a project with a client"); const renewal = await this.prisma.projectRenewal.create({ data: { projectId: dto.projectId, name: dto.name, frequency: dto.frequency, amount: dto.amount, nextDueDate: new Date(dto.nextDueDate), notes: dto.notes } }); await this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "CREATE", entityType: "RENEWAL", entityId: renewal.id, summary: `Created ${dto.frequency.toLowerCase()} renewal ${dto.name}` } }); await this.processor.process(); return renewal; }
  @Patch(":id") async update(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: UpdateRenewalDto) { await this.prisma.projectRenewal.findFirstOrThrow({ where: { id, project: { businessUnit: { organizationId: request.user.organizationId } } } }); const renewal = await this.prisma.projectRenewal.update({ where: { id }, data: { name: dto.name, frequency: dto.frequency, amount: dto.amount, nextDueDate: dto.nextDueDate ? new Date(dto.nextDueDate) : undefined, active: dto.active, notes: dto.notes } }); await this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "UPDATE", entityType: "RENEWAL", entityId: id, summary: `Updated renewal ${renewal.name}` } }); await this.processor.process(); return renewal; }
  @Post("reminders/:id/dismiss") async dismiss(@Req() request: AuthRequest, @Param("id") id: string) { await this.prisma.renewalReminder.findFirstOrThrow({ where: { id, renewal: { project: { businessUnit: { organizationId: request.user.organizationId } } } } }); return this.prisma.renewalReminder.update({ where: { id }, data: { dismissed: true } }); }
}
@Module({ controllers: [RenewalsController], providers: [RenewalProcessor, JwtAuthGuard, RolesGuard], exports: [RenewalProcessor] }) export class RenewalsModule {}
