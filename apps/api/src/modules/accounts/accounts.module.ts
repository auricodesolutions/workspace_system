import { BadRequestException, Body, Controller, Get, Inject, Module, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { Roles, RolesGuard } from "../../auth/roles.guard.js";
import type { AuthRequest } from "../../auth/auth.types.js";
import { PrismaService } from "../../database/prisma.service.js";

const accountTypes = ["BANK", "CASH", "MOBILE_WALLET", "OTHER"] as const;
class CreateAccountDto { @IsString() @MinLength(2) name!: string; @IsIn(accountTypes) type!: typeof accountTypes[number]; @IsOptional() @IsString() bankName?: string; @IsOptional() @IsString() accountNumber?: string; @IsOptional() @IsNumber() @Min(0) openingBalance?: number; }
class UpdateAccountDto { @IsOptional() @IsString() @MinLength(2) name?: string; @IsOptional() @IsBoolean() active?: boolean; }
class AccountMovementDto { @IsIn(["DEPOSIT", "WITHDRAWAL", "ADJUSTMENT"]) type!: "DEPOSIT" | "WITHDRAWAL" | "ADJUSTMENT"; @IsNumber() @Min(0.01) amount!: number; @IsOptional() @IsString() description?: string; @IsOptional() @IsString() reference?: string; }

@ApiTags("financial-accounts") @ApiBearerAuth() @UseGuards(JwtAuthGuard, RolesGuard) @Roles("ADMIN")
@Controller("financial-accounts")
class AccountsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get()
  list(@Req() request: AuthRequest) { return this.prisma.financialAccount.findMany({ where: { organizationId: request.user.organizationId }, include: { transactions: { orderBy: { createdAt: "desc" }, take: 100 }, _count: { select: { fundedTasks: true, walletTransactions: true } } }, orderBy: [{ active: "desc" }, { name: "asc" }] }); }
  @Post()
  async create(@Req() request: AuthRequest, @Body() dto: CreateAccountDto) {
    const opening = dto.openingBalance ?? 0;
    const account = await this.prisma.financialAccount.create({ data: { organizationId: request.user.organizationId, name: dto.name, type: dto.type, bankName: dto.bankName, accountNumber: dto.accountNumber, balance: opening, ...(opening > 0 ? { transactions: { create: { type: "DEPOSIT", amount: opening, balanceAfter: opening, description: "Opening balance" } } } : {}) } });
    await this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "CREATE", entityType: "FINANCIAL_ACCOUNT", entityId: account.id, summary: `Created account ${account.name}` } }); return account;
  }
  @Patch(":id")
  async update(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: UpdateAccountDto) { await this.prisma.financialAccount.findFirstOrThrow({ where: { id, organizationId: request.user.organizationId } }); const account = await this.prisma.financialAccount.update({ where: { id }, data: dto }); await this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "UPDATE", entityType: "FINANCIAL_ACCOUNT", entityId: id, summary: `Updated account ${account.name}` } }); return account; }
  @Post(":id/transactions")
  async movement(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: AccountMovementDto) {
    return this.prisma.$transaction(async (tx) => { const account = await tx.financialAccount.findFirstOrThrow({ where: { id, organizationId: request.user.organizationId } }); const decreases = dto.type === "WITHDRAWAL"; if (decreases && Number(account.balance) < dto.amount) throw new BadRequestException("Withdrawal cannot exceed the account balance"); const updated = await tx.financialAccount.update({ where: { id }, data: { balance: decreases ? { decrement: dto.amount } : { increment: dto.amount } } }); const transaction = await tx.accountTransaction.create({ data: { financialAccountId: id, type: dto.type, amount: decreases ? -dto.amount : dto.amount, balanceAfter: updated.balance, description: dto.description || (decreases ? "Account withdrawal" : "Account deposit"), reference: dto.reference } }); await tx.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: dto.type, entityType: "FINANCIAL_ACCOUNT", entityId: id, summary: `${dto.type} LKR ${dto.amount} — ${account.name}` } }); return transaction; });
  }
}
@Module({ controllers: [AccountsController], providers: [JwtAuthGuard, RolesGuard] }) export class AccountsModule {}
