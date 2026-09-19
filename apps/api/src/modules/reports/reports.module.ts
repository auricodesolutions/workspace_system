import { BadRequestException, Controller, Get, Inject, Module, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { Roles, RolesGuard } from "../../auth/roles.guard.js";
import type { AuthRequest } from "../../auth/auth.types.js";
import { PrismaService } from "../../database/prisma.service.js";

@ApiTags("reports") @ApiBearerAuth() @UseGuards(JwtAuthGuard, RolesGuard) @Roles("ADMIN")
@Controller("reports")
class ReportsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async report(@Req() request: AuthRequest, @Query("from") fromValue?: string, @Query("to") toValue?: string) {
    const now = new Date(); const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    const from = fromValue ? new Date(`${fromValue}T00:00:00.000`) : defaultFrom;
    const to = toValue ? new Date(`${toValue}T23:59:59.999`) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new BadRequestException("Select a valid date range");
    const organizationId = request.user.organizationId; const period = { gte: from, lte: to };
    const [tasks, projects, clients, users, invoicePayments, employeePayments, invoices, acceptedTasks, clientTransactions] = await Promise.all([
      this.prisma.task.findMany({ where: { createdBy: { organizationId }, OR: [{ createdAt: period }, { dueDate: period }, { acceptedAt: period }] }, include: { project: { select: { code: true, name: true, client: { select: { name: true } } } }, assignments: { include: { user: { select: { id: true, firstName: true, lastName: true } } } } }, orderBy: { dueDate: "asc" } }),
      this.prisma.project.findMany({ where: { businessUnit: { organizationId }, OR: [{ createdAt: period }, { startDate: { lte: to }, dueDate: { gte: from } }] }, include: { client: { select: { name: true } }, _count: { select: { tasks: true } } }, orderBy: { createdAt: "desc" } }),
      this.prisma.client.findMany({ where: { organizationId }, include: { account: true, _count: { select: { projects: true } } }, orderBy: { name: "asc" } }),
      this.prisma.user.findMany({ where: { organizationId }, include: { assignments: { where: { task: { OR: [{ createdAt: period }, { dueDate: period }, { acceptedAt: period }] } }, include: { task: { select: { status: true, laborCost: true } } } }, wallet: true }, orderBy: { firstName: "asc" } }),
      this.prisma.payment.findMany({ where: { invoice: { organizationId }, paidAt: period }, include: { invoice: { select: { invoiceNumber: true, client: { select: { name: true } } } } }, orderBy: { paidAt: "desc" } }),
      this.prisma.walletTransaction.findMany({ where: { wallet: { user: { organizationId } }, type: "PAYMENT", createdAt: period }, include: { wallet: { select: { user: { select: { firstName: true, lastName: true } } } }, financialAccount: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
      this.prisma.invoice.findMany({ where: { organizationId, status: { not: "VOID" }, OR: [{ issueDate: period }, { dueDate: period }] }, include: { client: { select: { name: true } }, project: { select: { code: true } }, payments: true }, orderBy: { dueDate: "asc" } }),
      this.prisma.task.findMany({ where: { createdBy: { organizationId }, status: "ACCEPTED", acceptedAt: period }, select: { id: true, title: true, acceptedAt: true, laborCost: true, project: { select: { code: true, client: { select: { name: true } } } } }, orderBy: { acceptedAt: "desc" } }),
      this.prisma.clientTransaction.findMany({ where: { account: { client: { organizationId } }, createdAt: period }, include: { account: { select: { client: { select: { name: true } } } }, invoice: { select: { invoiceNumber: true } }, project: { select: { code: true } }, task: { select: { title: true } } }, orderBy: { createdAt: "desc" } }),
    ]);
    const revenue = invoicePayments.reduce((sum, item) => sum + Number(item.amount), 0);
    const laborCost = acceptedTasks.reduce((sum, item) => sum + Number(item.laborCost ?? 0), 0);
    const employeePaid = employeePayments.reduce((sum, item) => sum + Math.abs(Number(item.amount)), 0);
    const invoiceRows = invoices.map((invoice) => { const paid = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0); return { id: invoice.id, invoiceNumber: invoice.invoiceNumber, client: invoice.client.name, project: invoice.project?.code ?? "—", status: invoice.status, issueDate: invoice.issueDate, dueDate: invoice.dueDate, total: Number(invoice.total), paid, due: Number(invoice.total) - paid }; });
    return {
      range: { from: from.toISOString(), to: to.toISOString(), generatedAt: new Date().toISOString() },
      summary: { revenue, laborCost, grossProfit: revenue - laborCost, employeePaid, invoiceDue: invoiceRows.reduce((sum, row) => sum + row.due, 0), clientDue: clients.reduce((sum, client) => sum + Number(client.account?.balance ?? 0), 0), tasks: tasks.length, completedTasks: tasks.filter((task) => ["COMPLETED", "ACCEPTED"].includes(task.status)).length, pendingAcceptance: tasks.filter((task) => task.status === "COMPLETED").length, projects: projects.length, clients: clients.length, employees: users.length },
      tasks: tasks.map((task) => ({ id: task.id, title: task.title, project: task.project?.code ?? "General", client: task.project?.client?.name ?? "—", status: task.status, priority: task.priority, dueDate: task.dueDate, acceptedAt: task.acceptedAt, cost: Number(task.laborCost ?? 0), assignees: task.assignments.map(({ user }) => `${user.firstName} ${user.lastName}`).join(", ") })),
      projects: projects.map((project) => ({ id: project.id, code: project.code, name: project.name, client: project.client?.name ?? "Internal", status: project.status, tasks: project._count.tasks, taskCost: Number(project.taskCostTotal), budget: Number(project.budget ?? 0), dueDate: project.dueDate })),
      clients: clients.map((client) => ({ id: client.id, name: client.name, status: client.status, projects: client._count.projects, outstanding: Number(client.account?.balance ?? 0), email: client.email, phone: client.phone })),
      employees: users.map((user) => ({ id: user.id, name: `${user.firstName} ${user.lastName}`, status: user.status, assigned: user.assignments.length, completed: user.assignments.filter(({ task }) => ["COMPLETED", "ACCEPTED"].includes(task.status)).length, earned: user.assignments.reduce((sum, { task }) => sum + Number(task.laborCost ?? 0), 0), wallet: Number(user.wallet?.balance ?? 0) })),
      invoices: invoiceRows,
      payments: { received: invoicePayments.map((payment) => ({ id: payment.id, date: payment.paidAt, party: payment.invoice.client.name, description: payment.invoice.invoiceNumber, method: payment.method, reference: payment.reference, amount: Number(payment.amount) })), paid: employeePayments.map((payment) => ({ id: payment.id, date: payment.createdAt, party: `${payment.wallet.user.firstName} ${payment.wallet.user.lastName}`, description: payment.description, account: payment.financialAccount?.name, reference: payment.reference, amount: Math.abs(Number(payment.amount)) })) },
      clientTransactions: clientTransactions.map((item) => ({ id: item.id, date: item.createdAt, client: item.account.client.name, type: item.type, description: item.description, invoice: item.invoice?.invoiceNumber, project: item.project?.code, task: item.task?.title, amount: Number(item.amount), balanceAfter: Number(item.balanceAfter) })),
    };
  }
}
@Module({ controllers: [ReportsController], providers: [JwtAuthGuard, RolesGuard] }) export class ReportsModule {}
