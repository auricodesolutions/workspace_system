import { BadRequestException, Body, Controller, Get, Inject, Module, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsArray, IsISO8601, IsIn, IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";
import PDFDocument from "pdfkit";
import type { Response } from "express";
import { fileURLToPath } from "node:url";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { Roles, RolesGuard } from "../../auth/roles.guard.js";
import type { AuthRequest } from "../../auth/auth.types.js";
import { PrismaService } from "../../database/prisma.service.js";

const invoiceStatuses = ["DRAFT", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"] as const;
class CreateInvoiceDto {
  @IsString() clientId!: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() paymentAccountId?: string;
  @IsISO8601() issueDate!: string;
  @IsISO8601() dueDate!: string;
  @IsArray() items!: { description: string; unitPrice: number; quantity: number; discount: number }[];
  @IsOptional() @IsNumber() @Min(0) discount?: number;
  @IsOptional() @IsNumber() @Min(0) tax?: number;
  @IsOptional() @IsString() notes?: string;
}
class InvoiceStatusDto { @IsIn(invoiceStatuses) status!: typeof invoiceStatuses[number]; }
class InvoicePaymentDto { @IsNumber() @Min(0.01) amount!: number; @IsISO8601() paidAt!: string; @IsOptional() @IsString() method?: string; @IsOptional() @IsString() reference?: string; }

@ApiTags("invoices") @ApiBearerAuth() @UseGuards(JwtAuthGuard, RolesGuard) @Roles("ADMIN")
@Controller("invoices")
class InvoicesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  list(@Req() request: AuthRequest) {
    return this.prisma.invoice.findMany({ where: { organizationId: request.user.organizationId }, include: { client: true, project: { select: { id: true, code: true, name: true } }, paymentAccount: true, items: { orderBy: { sortOrder: "asc" } }, payments: { orderBy: { paidAt: "desc" } } }, orderBy: { createdAt: "desc" } });
  }

  @Post()
  async create(@Req() request: AuthRequest, @Body() dto: CreateInvoiceDto) {
    const client = await this.prisma.client.findFirstOrThrow({ where: { id: dto.clientId, organizationId: request.user.organizationId }, include: { businessUnit: true } });
    if (dto.projectId) await this.prisma.project.findFirstOrThrow({ where: { id: dto.projectId, clientId: client.id } });
    const count = await this.prisma.invoice.count({ where: { businessUnitId: client.businessUnitId } });
    const invoiceNumber = `${client.businessUnit.invoicePrefix}-${String(count + 1).padStart(5, "0")}`;
    if (!dto.items.length) throw new BadRequestException("Add at least one invoice item");
    const items = dto.items.map((item, index) => { if (!item.description?.trim() || Number(item.unitPrice) < 0 || Number(item.quantity) <= 0 || Number(item.discount) < 0) throw new BadRequestException(`Invoice item ${index + 1} is invalid`); const gross = Number(item.unitPrice) * Number(item.quantity); if (Number(item.discount) > gross) throw new BadRequestException(`Discount exceeds item ${index + 1} value`); return { description: item.description.trim(), unitPrice: Number(item.unitPrice), quantity: Number(item.quantity), discount: Number(item.discount || 0), total: gross - Number(item.discount || 0), sortOrder: index }; });
    const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0); const itemDiscount = items.reduce((sum, item) => sum + item.discount, 0); const invoiceDiscount = dto.discount ?? 0; const discount = itemDiscount + invoiceDiscount; if (discount > subtotal) throw new BadRequestException("Total discount cannot exceed subtotal");
    const tax = dto.tax ?? 0; const total = subtotal - discount + tax;
    if (dto.paymentAccountId) await this.prisma.financialAccount.findFirstOrThrow({ where: { id: dto.paymentAccountId, organizationId: request.user.organizationId } });
    const invoice = await this.prisma.invoice.create({ data: { organizationId: request.user.organizationId, businessUnitId: client.businessUnitId, clientId: client.id, projectId: dto.projectId || undefined, paymentAccountId: dto.paymentAccountId || undefined, invoiceNumber, issueDate: new Date(dto.issueDate), dueDate: new Date(dto.dueDate), subtotal, discount, tax, total, notes: dto.notes, status: "DRAFT", items: { create: items } }, include: { client: true, project: true, paymentAccount: true, items: true, payments: true } });
    await this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "CREATE", entityType: "INVOICE", entityId: invoice.id, summary: `Created invoice ${invoice.invoiceNumber} for ${client.name}`, metadata: { total } } });
    return invoice;
  }

  @Get(":id/pdf")
  async pdf(@Req() request: AuthRequest, @Param("id") id: string, @Res() response: Response) {
    const invoice = await this.prisma.invoice.findFirstOrThrow({ where: { id, organizationId: request.user.organizationId }, include: { client: true, businessUnit: true, project: true, paymentAccount: true, items: { orderBy: { sortOrder: "asc" } }, payments: true } });
    const paid = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0); const due = Math.max(0, Number(invoice.total) - paid); const discountValue = Number(invoice.discount); const totalDiscount = discountValue === 0 ? 0 : Math.abs(discountValue);
    response.setHeader("Content-Type", "application/pdf"); response.setHeader("Content-Disposition", `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    const doc = new PDFDocument({ size: "LETTER", margin: 36, info: { Title: `Invoice ${invoice.invoiceNumber}`, Author: "Aurilink Digital" } }); doc.pipe(response);
    const blue = "#0d477f", cyan = "#08b7d5", ink = "#182231", gray = "#657080"; const right = 576;
    try { doc.image(fileURLToPath(new URL("../../../assets/aurilink-logo.jpeg", import.meta.url)), 36, 35, { fit: [95, 95] }); } catch { doc.fontSize(18).fillColor(blue).text("AURILINK DIGITAL", 36, 60); }
    doc.rect(135, 35, 441, 26).fill(cyan); doc.fillColor(gray).fontSize(10).text("Invoice Date", 285, 82).fillColor(ink).text(invoice.issueDate.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }), 365, 82);
    doc.fillColor(gray).text("Status", 285, 99).fillColor(ink).text(invoice.status.replaceAll("_", " "), 365, 99); doc.fillColor(gray).text("Currency", 285, 116).fillColor(ink).text(invoice.businessUnit.currency, 365, 116);
    doc.fillColor(gray).text("Invoice to", 36, 154).fillColor(ink).font("Helvetica-Bold").text(invoice.client.name, 105, 154).font("Helvetica"); doc.fillColor(gray).text("Phone", 36, 172).fillColor(ink).text(invoice.client.phone ?? "-", 105, 172); doc.fillColor(gray).text("Address", 36, 190).fillColor(ink).text(invoice.client.address ?? "-", 105, 190, { width: 155 }); doc.fillColor(gray).text("Email", 36, 218).fillColor(blue).text(invoice.client.email ?? "-", 105, 218, { width: 160 });
    doc.fillColor(gray).text("Invoice #", 285, 154).fillColor(ink).font("Helvetica-Bold").text(invoice.invoiceNumber, 365, 154).font("Helvetica"); doc.fillColor(gray).text("Due Date", 285, 172).fillColor(ink).text(invoice.dueDate.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }), 365, 172); doc.fillColor(gray).text("Prepared By", 285, 190).fillColor(ink).text("Aurilink Digital", 365, 190); doc.fillColor(gray).text("Contact", 285, 208).fillColor(blue).text(invoice.businessUnit.email ?? "auricodesolutions@gmail.com", 365, 208);
    doc.rect(36, 242, 540, 5).fill(cyan); doc.rect(36, 252, 540, 30).fill(blue); doc.fillColor("white").font("Helvetica-Bold").fontSize(10).text("Description", 48, 262).text("Unit Price", 292, 262).text("Qty", 382, 262).text("Discount", 428, 262).text("Total", 520, 262);
    let y = 294; doc.font("Helvetica").fillColor(ink); for (const item of invoice.items) { if (y > 555) { doc.addPage(); y = 50; } doc.fontSize(9).text(item.description, 48, y, { width: 230 }).text(Number(item.unitPrice).toLocaleString(undefined, { minimumFractionDigits: 2 }), 286, y, { width: 70, align: "right" }).text(Number(item.quantity).toLocaleString(), 370, y, { width: 40, align: "right" }).text(Number(item.discount).toLocaleString(undefined, { minimumFractionDigits: 2 }), 420, y, { width: 60, align: "right" }).text(Number(item.total).toLocaleString(undefined, { minimumFractionDigits: 2 }), 500, y, { width: 70, align: "right" }); y += 22; }
    y = Math.max(y + 20, 470); doc.fillColor(ink).font("Helvetica-Bold").fontSize(12).text("Payment Method", 38, y); doc.font("Helvetica").fontSize(9).text(invoice.paymentAccount ? `${invoice.paymentAccount.bankName ?? invoice.paymentAccount.type}: ${invoice.paymentAccount.name}` : "Contact Aurilink Digital for payment details", 38, y + 20, { width: 220 }); if (invoice.paymentAccount?.accountNumber) doc.text(`A/C Number: ${invoice.paymentAccount.accountNumber}`, 38, y + 36); doc.text(`Reference: ${invoice.invoiceNumber}`, 38, y + 52);
    const totalX = 330; doc.font("Helvetica-Bold").text("Sub Total", totalX, y).font("Helvetica").text(Number(invoice.subtotal).toLocaleString(undefined, { minimumFractionDigits: 2 }), 490, y, { width: 80, align: "right" }); doc.font("Helvetica-Bold").text("Total Discount", totalX, y + 20).font("Helvetica").fillColor("#d04b42").text(`${totalDiscount > 0 ? "-" : ""}${totalDiscount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 490, y + 20, { width: 80, align: "right" }); doc.fillColor(ink).font("Helvetica-Bold").text("Paid", totalX, y + 40).font("Helvetica").text(paid.toLocaleString(undefined, { minimumFractionDigits: 2 }), 490, y + 40, { width: 80, align: "right" }); doc.font("Helvetica-Bold").text("Tax / Other", totalX, y + 60).font("Helvetica").text(Number(invoice.tax).toLocaleString(undefined, { minimumFractionDigits: 2 }), 490, y + 60, { width: 80, align: "right" }); doc.rect(totalX - 3, y + 78, 243, 25).fill(blue); doc.fillColor("white").font("Helvetica-Bold").fontSize(13).text("Total Due", totalX, y + 84).text(due.toLocaleString(undefined, { minimumFractionDigits: 2 }), 485, y + 84, { width: 80, align: "right" });
    const termsY = y + 125; doc.fillColor(ink).font("Helvetica-Bold").fontSize(12).text("Terms & Conditions", 38, termsY); doc.font("Helvetica").fontSize(8).text(invoice.notes || "All payments must be settled by the due date. Third-party advertising costs are not included unless shown in the item list. Aurilink Digital may pause ongoing services when payments are overdue.", 38, termsY + 18, { width: 530, lineGap: 2 }); doc.rect(36, 718, 540, 20).fill("#d9f3f8"); doc.fillColor(blue).font("Helvetica-Bold").fontSize(9).text("Aurilink Digital - Digital Marketing - Branding - Web & Creative Solutions", 36, 724, { width: 540, align: "center", lineBreak: false }); doc.end();
  }

  @Patch(":id/status")
  async status(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: InvoiceStatusDto) {
    const current = await this.prisma.invoice.findFirstOrThrow({ where: { id, organizationId: request.user.organizationId } });
    if (current.status === "PAID" && dto.status !== "PAID") throw new BadRequestException("A paid invoice cannot be reopened");
    const invoice = await this.prisma.invoice.update({ where: { id }, data: { status: dto.status } });
    await this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "STATUS_CHANGE", entityType: "INVOICE", entityId: id, summary: `Changed ${invoice.invoiceNumber} status to ${dto.status}` } });
    return invoice;
  }

  @Post(":id/payments")
  async payment(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: InvoicePaymentDto) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirstOrThrow({ where: { id, organizationId: request.user.organizationId }, include: { payments: true } });
      if (invoice.status === "VOID") throw new BadRequestException("Payments cannot be added to a void invoice");
      const paid = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      if (paid + dto.amount > Number(invoice.total)) throw new BadRequestException("Payment cannot exceed the invoice balance");
      const payment = await tx.payment.create({ data: { invoiceId: id, amount: dto.amount, paidAt: new Date(dto.paidAt), method: dto.method, reference: dto.reference } });
      const newPaid = paid + dto.amount; const status = newPaid >= Number(invoice.total) ? "PAID" : "PARTIALLY_PAID";
      await tx.invoice.update({ where: { id }, data: { status } });
      await tx.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "PAYMENT", entityType: "INVOICE", entityId: id, summary: `Recorded LKR ${dto.amount} against ${invoice.invoiceNumber}`, metadata: { amount: dto.amount, reference: dto.reference } } });
      return payment;
    });
  }
}

@Module({ controllers: [InvoicesController], providers: [JwtAuthGuard, RolesGuard] })
export class InvoicesModule {}
