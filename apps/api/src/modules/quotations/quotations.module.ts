import { BadRequestException, Body, Controller, Get, Inject, Module, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsArray, IsISO8601, IsIn, IsNumber, IsOptional, IsString, Min } from "class-validator";
import PDFDocument from "pdfkit";
import type { Response } from "express";
import { fileURLToPath } from "node:url";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { Roles, RolesGuard } from "../../auth/roles.guard.js";
import type { AuthRequest } from "../../auth/auth.types.js";
import { PrismaService } from "../../database/prisma.service.js";

const statuses = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"] as const;
type QuotationItemInput = { description: string; unitPrice: number; quantity: number; discount: number };
class CreateQuotationDto { @IsString() clientId!: string; @IsOptional() @IsString() projectId?: string; @IsISO8601() issueDate!: string; @IsISO8601() validUntil!: string; @IsArray() items!: QuotationItemInput[]; @IsOptional() @IsNumber() @Min(0) discount?: number; @IsOptional() @IsNumber() @Min(0) tax?: number; @IsOptional() @IsString() notes?: string; }
class UpdateQuotationDto extends CreateQuotationDto {}
class QuotationStatusDto { @IsIn(statuses) status!: typeof statuses[number]; }
class ConvertQuotationDto { @IsISO8601() dueDate!: string; @IsOptional() @IsString() paymentAccountId?: string; }

@ApiTags("quotations") @ApiBearerAuth() @UseGuards(JwtAuthGuard, RolesGuard) @Roles("ADMIN")
@Controller("quotations")
class QuotationsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  private totals(dto: CreateQuotationDto) {
    if (!dto.items.length) throw new BadRequestException("Add at least one quotation item");
    const items = dto.items.map((item, index) => { const price = Number(item.unitPrice), quantity = Number(item.quantity), discount = Number(item.discount || 0), gross = price * quantity; if (!item.description?.trim() || price < 0 || quantity <= 0 || discount < 0 || discount > gross) throw new BadRequestException(`Quotation item ${index + 1} is invalid`); return { description: item.description.trim(), unitPrice: price, quantity, discount, total: gross - discount, sortOrder: index }; });
    const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0), discount = items.reduce((sum, item) => sum + item.discount, 0) + Number(dto.discount || 0), tax = Number(dto.tax || 0); if (discount > subtotal) throw new BadRequestException("Total discount cannot exceed subtotal");
    return { items, subtotal, discount, tax, total: subtotal - discount + tax };
  }
  @Get()
  list(@Req() request: AuthRequest) { return this.prisma.quotation.findMany({ where: { organizationId: request.user.organizationId }, include: { client: { select: { id: true, name: true } }, project: { select: { id: true, code: true, name: true } }, convertedInvoice: { select: { id: true, invoiceNumber: true } }, items: { orderBy: { sortOrder: "asc" } } }, orderBy: { createdAt: "desc" } }); }
  @Post()
  async create(@Req() request: AuthRequest, @Body() dto: CreateQuotationDto) {
    const client = await this.prisma.client.findFirstOrThrow({ where: { id: dto.clientId, organizationId: request.user.organizationId }, include: { businessUnit: true } });
    if (dto.projectId) await this.prisma.project.findFirstOrThrow({ where: { id: dto.projectId, clientId: client.id } });
    const { items, subtotal, discount, tax, total } = this.totals(dto);
    const count = await this.prisma.quotation.count({ where: { businessUnitId: client.businessUnitId } }); const quotationNumber = `${client.businessUnit.quotationPrefix}-${String(count + 1).padStart(5, "0")}`;
    const quotation = await this.prisma.quotation.create({ data: { organizationId: request.user.organizationId, businessUnitId: client.businessUnitId, clientId: client.id, projectId: dto.projectId || undefined, quotationNumber, issueDate: new Date(dto.issueDate), validUntil: new Date(dto.validUntil), subtotal, discount, tax, total, notes: dto.notes, items: { create: items } }, include: { client: true, project: true, items: true } });
    await this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "CREATE", entityType: "QUOTATION", entityId: quotation.id, summary: `Created quotation ${quotation.quotationNumber} for ${client.name}` } }); return quotation;
  }
  @Patch(":id")
  async update(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: UpdateQuotationDto) {
    const current = await this.prisma.quotation.findFirstOrThrow({ where: { id, organizationId: request.user.organizationId } });
    if (current.status === "CONVERTED") throw new BadRequestException("A converted quotation cannot be edited");
    const client = await this.prisma.client.findFirstOrThrow({ where: { id: dto.clientId, organizationId: request.user.organizationId } });
    if (dto.projectId) await this.prisma.project.findFirstOrThrow({ where: { id: dto.projectId, clientId: client.id } });
    const { items, subtotal, discount, tax, total } = this.totals(dto);
    const quotation = await this.prisma.$transaction(async (tx) => {
      await tx.quotationItem.deleteMany({ where: { quotationId: id } });
      return tx.quotation.update({ where: { id }, data: { businessUnitId: client.businessUnitId, clientId: client.id, projectId: dto.projectId || null, issueDate: new Date(dto.issueDate), validUntil: new Date(dto.validUntil), subtotal, discount, tax, total, notes: dto.notes || null, items: { create: items } }, include: { client: true, project: true, items: { orderBy: { sortOrder: "asc" } } } });
    });
    await this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "UPDATE", entityType: "QUOTATION", entityId: id, summary: `Updated quotation ${quotation.quotationNumber}`, metadata: { total } } });
    return quotation;
  }
  @Get(":id/pdf")
  async pdf(@Req() request: AuthRequest, @Param("id") id: string, @Res() response: Response) {
    const quote = await this.prisma.quotation.findFirstOrThrow({ where: { id, organizationId: request.user.organizationId }, include: { client: true, businessUnit: true, project: true, items: { orderBy: { sortOrder: "asc" } } } });
    response.setHeader("Content-Type", "application/pdf"); response.setHeader("Content-Disposition", `attachment; filename="${quote.quotationNumber}.pdf"`);
    const doc = new PDFDocument({ size: "LETTER", margin: 36, info: { Title: `Quotation ${quote.quotationNumber}`, Author: "Aurilink Digital" } }); doc.pipe(response);
    const blue = "#0d477f", cyan = "#08b7d5", ink = "#182231", gray = "#657080", money = (value: unknown) => Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    try { doc.image(fileURLToPath(new URL("../../../assets/aurilink-logo.jpeg", import.meta.url)), 36, 35, { fit: [95, 95] }); } catch { doc.fontSize(18).fillColor(blue).text("AURILINK DIGITAL", 36, 60); }
    doc.rect(135, 35, 441, 26).fill(cyan); doc.fillColor(blue).font("Helvetica-Bold").fontSize(24).text("QUOTATION", 365, 76, { width: 210, align: "right" });
    doc.fillColor(gray).font("Helvetica").fontSize(10).text("Quotation #", 285, 112).fillColor(ink).font("Helvetica-Bold").text(quote.quotationNumber, 365, 112).font("Helvetica"); doc.fillColor(gray).text("Issue date", 285, 130).fillColor(ink).text(quote.issueDate.toLocaleDateString("en-GB"), 365, 130); doc.fillColor(gray).text("Valid until", 285, 148).fillColor(ink).text(quote.validUntil.toLocaleDateString("en-GB"), 365, 148); doc.fillColor(gray).text("Status", 285, 166).fillColor(ink).text(quote.status, 365, 166);
    doc.fillColor(gray).text("Prepared for", 36, 154).fillColor(ink).font("Helvetica-Bold").text(quote.client.name, 108, 154).font("Helvetica"); doc.fillColor(gray).text("Phone", 36, 174).fillColor(ink).text(quote.client.phone ?? "-", 108, 174); doc.fillColor(gray).text("Email", 36, 194).fillColor(blue).text(quote.client.email ?? "-", 108, 194, { width: 150 }); if (quote.project) doc.fillColor(gray).text("Project", 36, 214).fillColor(ink).text(`${quote.project.code} - ${quote.project.name}`, 108, 214, { width: 160 });
    doc.rect(36, 242, 540, 5).fill(cyan); doc.rect(36, 252, 540, 30).fill(blue); doc.fillColor("white").font("Helvetica-Bold").fontSize(10).text("Description", 48, 262).text("Unit Price", 292, 262).text("Qty", 382, 262).text("Discount", 428, 262).text("Total", 520, 262);
    let y = 294; doc.font("Helvetica").fillColor(ink); for (const item of quote.items) { if (y > 560) { doc.addPage(); y = 50; } doc.fontSize(9).text(item.description, 48, y, { width: 230 }).text(money(item.unitPrice), 286, y, { width: 70, align: "right" }).text(Number(item.quantity).toLocaleString(), 370, y, { width: 40, align: "right" }).text(money(item.discount), 420, y, { width: 60, align: "right" }).text(money(item.total), 500, y, { width: 70, align: "right" }); y += 22; }
    y = Math.max(y + 18, 465); const totalX = 330; doc.font("Helvetica-Bold").text("Sub Total", totalX, y).font("Helvetica").text(money(quote.subtotal), 490, y, { width: 80, align: "right" }); doc.font("Helvetica-Bold").text("Total Discount", totalX, y + 20).font("Helvetica").fillColor("#d04b42").text(`-${money(quote.discount)}`, 490, y + 20, { width: 80, align: "right" }); doc.fillColor(ink).font("Helvetica-Bold").text("Tax / Other", totalX, y + 40).font("Helvetica").text(money(quote.tax), 490, y + 40, { width: 80, align: "right" }); doc.rect(totalX - 3, y + 60, 243, 28).fill(blue); doc.fillColor("white").font("Helvetica-Bold").fontSize(13).text(`Total (${quote.businessUnit.currency})`, totalX, y + 68).text(money(quote.total), 485, y + 68, { width: 80, align: "right" });
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(12).text("Terms & Notes", 38, y + 112); doc.font("Helvetica").fontSize(9).text(quote.notes || "This quotation is valid until the date shown above. Prices and availability may change after expiry.", 38, y + 130, { width: 530, lineGap: 2 }); doc.rect(36, 718, 540, 20).fill("#d9f3f8"); doc.fillColor(blue).font("Helvetica-Bold").fontSize(9).text("Aurilink Digital - Digital Marketing - Branding - Web & Creative Solutions", 36, 724, { width: 540, align: "center", lineBreak: false }); doc.end();
  }
  @Patch(":id/status")
  async status(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: QuotationStatusDto) { const current = await this.prisma.quotation.findFirstOrThrow({ where: { id, organizationId: request.user.organizationId } }); if (current.status === "CONVERTED") throw new BadRequestException("A converted quotation is final"); const quotation = await this.prisma.quotation.update({ where: { id }, data: { status: dto.status } }); await this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "STATUS_CHANGE", entityType: "QUOTATION", entityId: id, summary: `Changed ${quotation.quotationNumber} status to ${dto.status}` } }); return quotation; }
  @Post(":id/convert")
  async convert(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: ConvertQuotationDto) {
    return this.prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.findFirstOrThrow({ where: { id, organizationId: request.user.organizationId }, include: { items: true, client: { include: { businessUnit: true } } } });
      if (quotation.status !== "ACCEPTED") throw new BadRequestException("Only an accepted quotation can be converted");
      if (dto.paymentAccountId) await tx.financialAccount.findFirstOrThrow({ where: { id: dto.paymentAccountId, organizationId: request.user.organizationId } });
      const count = await tx.invoice.count({ where: { businessUnitId: quotation.businessUnitId } });
      const invoiceNumber = `${quotation.client.businessUnit.invoicePrefix}-${String(count + 1).padStart(5, "0")}`;
      const invoice = await tx.invoice.create({ data: { organizationId: quotation.organizationId, businessUnitId: quotation.businessUnitId, clientId: quotation.clientId, projectId: quotation.projectId, paymentAccountId: dto.paymentAccountId, invoiceNumber, status: "SENT", issueDate: new Date(), dueDate: new Date(dto.dueDate), subtotal: quotation.subtotal, discount: quotation.discount, tax: quotation.tax, total: quotation.total, notes: quotation.notes, items: { create: quotation.items.map((item) => ({ description: item.description, unitPrice: item.unitPrice, quantity: item.quantity, discount: item.discount, total: item.total, sortOrder: item.sortOrder })) } } });
      const account = await tx.clientAccount.upsert({ where: { clientId: quotation.clientId }, update: {}, create: { clientId: quotation.clientId } });
      const updatedAccount = await tx.clientAccount.update({ where: { id: account.id }, data: { balance: { increment: quotation.total } } });
      await tx.clientTransaction.create({ data: { accountId: account.id, invoiceId: invoice.id, invoiceChargeKey: invoice.id, projectId: quotation.projectId, type: "INVOICE_CHARGE", status: "CHARGED", amount: quotation.total, balanceAfter: updatedAccount.balance, description: `Invoice ${invoice.invoiceNumber}` } });
      await tx.quotation.update({ where: { id }, data: { status: "CONVERTED", convertedInvoiceId: invoice.id } });
      await tx.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "CONVERT", entityType: "QUOTATION", entityId: id, summary: `Converted ${quotation.quotationNumber} to ${invoice.invoiceNumber} and added it to client outstanding` } });
      return invoice;
    });
  }
}
@Module({ controllers: [QuotationsController], providers: [JwtAuthGuard, RolesGuard] }) export class QuotationsModule {}
