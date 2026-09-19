import { Controller, Get, Inject, Module, Query, Req, UseGuards } from "@nestjs/common";
import { ApiQuery, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../../database/prisma.service.js";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { Roles, RolesGuard } from "../../auth/roles.guard.js";
import type { AuthRequest } from "../../auth/auth.types.js";

@ApiTags("dashboard")
@Controller("dashboard")
class DashboardController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("summary")
  @Roles("ADMIN")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiQuery({ name: "businessUnit", required: false, example: "ALD" })
  async summary(@Req() request: AuthRequest, @Query("businessUnit") code = "ALD") {
    const businessUnit = await this.prisma.businessUnit.findFirst({ where: { code, organizationId: request.user.organizationId } });
    if (!businessUnit) return { attention: {}, metrics: {}, tasks: [], generatedAt: new Date().toISOString() };
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    const open = ["BACKLOG", "TODO", "IN_PROGRESS", "WAITING", "REVIEW", "REVISION"] as const;
    const [activeProjects, tasksToday, overdueTasks, atRiskProjects, pendingApprovals, pendingAcceptance, invoices, tasks, activeUsers, walletTotals, clientTotals, accountTotals, renewalReminders, team] = await Promise.all([
      this.prisma.project.count({ where: { businessUnitId: businessUnit.id, status: "ACTIVE" } }),
      this.prisma.task.count({ where: { project: { businessUnitId: businessUnit.id }, dueDate: { gte: start, lte: end }, status: { in: [...open] } } }),
      this.prisma.task.count({ where: { project: { businessUnitId: businessUnit.id }, dueDate: { lt: start }, status: { in: [...open] } } }),
      this.prisma.project.count({ where: { businessUnitId: businessUnit.id, status: "AT_RISK" } }),
      this.prisma.approval.count({ where: { organizationId: businessUnit.organizationId, status: "PENDING" } }),
      this.prisma.task.count({ where: { project: { businessUnitId: businessUnit.id }, status: "COMPLETED" } }),
      this.prisma.invoice.findMany({ where: { businessUnitId: businessUnit.id, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } }, include: { payments: true } }),
      this.prisma.task.findMany({ where: { project: { businessUnitId: businessUnit.id }, dueDate: { lte: end }, status: { in: [...open] } }, include: { project: true }, orderBy: [{ priorityScore: "desc" }, { dueDate: "asc" }], take: 8 }),
      this.prisma.user.count({ where: { organizationId: businessUnit.organizationId, status: "ACTIVE" } }),
      this.prisma.wallet.aggregate({ where: { user: { organizationId: businessUnit.organizationId } }, _sum: { balance: true } }),
      this.prisma.clientAccount.aggregate({ where: { client: { organizationId: businessUnit.organizationId } }, _sum: { balance: true } }),
      this.prisma.financialAccount.aggregate({ where: { organizationId: businessUnit.organizationId, active: true }, _sum: { balance: true } }),
      this.prisma.renewalReminder.findMany({ where: { dismissed: false, renewal: { active: true, project: { businessUnitId: businessUnit.id } } }, include: { renewal: { include: { project: { include: { client: { select: { name: true } } } } } } }, orderBy: { dueDate: "asc" }, take: 8 }),
      this.prisma.user.findMany({ where: { organizationId: businessUnit.organizationId, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true, jobTitle: true, assignments: { where: { task: { status: { in: [...open] } } }, select: { task: { select: { dueDate: true } } } } }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }], take: 12 }),
    ]);
    const balance = (invoice: (typeof invoices)[number]) => Number(invoice.total) - invoice.payments.reduce((paid, payment) => paid + Number(payment.amount), 0);
    const overdueInvoices = invoices.filter((invoice) => invoice.status === "OVERDUE" || invoice.dueDate < now);
    return {
      businessUnit: { code: businessUnit.code, name: businessUnit.name, currency: businessUnit.currency },
      attention: { overdueTasks, overdueInvoices: overdueInvoices.length, pendingApprovals, pendingAcceptance, atRiskProjects },
      metrics: { activeProjects, tasksToday, activeUsers, outstandingLkr: invoices.reduce((sum, invoice) => sum + balance(invoice), 0), overdueLkr: overdueInvoices.reduce((sum, invoice) => sum + balance(invoice), 0), employeePayableLkr: Number(walletTotals._sum.balance ?? 0), clientReceivableLkr: Number(clientTotals._sum.balance ?? 0), accountBalanceLkr: Number(accountTotals._sum.balance ?? 0) },
      tasks: tasks.map((task) => ({ id: task.id, title: task.title, project: task.project?.name ?? "General", status: task.status, priority: task.priority, priorityScore: task.priorityScore, dueDate: task.dueDate })),
      renewals: renewalReminders.map((reminder) => ({ id: reminder.id, name: reminder.renewal.name, project: reminder.renewal.project.code, client: reminder.renewal.project.client?.name ?? "No client", amount: Number(reminder.renewal.amount), dueDate: reminder.dueDate, daysBefore: reminder.daysBefore })),
      team: team.map((user) => ({ id: user.id, name: `${user.firstName} ${user.lastName}`, jobTitle: user.jobTitle ?? "Team member", openTasks: user.assignments.length, overdueTasks: user.assignments.filter(({ task }) => task.dueDate && task.dueDate < start).length })),
      generatedAt: new Date().toISOString(),
    };
  }
}

@Module({ controllers: [DashboardController], providers: [PrismaService, JwtAuthGuard, RolesGuard] })
export class DashboardModule {}
