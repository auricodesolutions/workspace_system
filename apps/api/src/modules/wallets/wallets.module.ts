import { BadRequestException, Body, Controller, Get, Inject, Module, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsNumber, IsOptional, IsString, Min } from "class-validator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { Roles, RolesGuard } from "../../auth/roles.guard.js";
import type { AuthRequest } from "../../auth/auth.types.js";
import { PrismaService } from "../../database/prisma.service.js";

class PayWalletDto { @IsNumber() @Min(0.01) amount!: number; @IsString() financialAccountId!: string; @IsOptional() @IsString() reference?: string; @IsOptional() @IsString() note?: string; }

@ApiTags("wallets") @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller()
class WalletsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("wallet/my")
  async myWallet(@Req() request: AuthRequest) {
    const wallet = await this.prisma.wallet.upsert({ where: { userId: request.user.id }, update: {}, create: { userId: request.user.id } });
    return this.prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id }, include: { transactions: { include: { task: { select: { id: true, title: true, revisionCount: true } }, project: { select: { id: true, code: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 100 } } });
  }

  @Get("wallets") @Roles("ADMIN") @UseGuards(RolesGuard)
  async allWallets(@Req() request: AuthRequest) {
    const users = await this.prisma.user.findMany({ where: { organizationId: request.user.organizationId }, select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, status: true, wallet: { include: { transactions: { include: { task: { select: { id: true, title: true, revisionCount: true } }, project: { select: { id: true, code: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 100 } } } }, orderBy: { firstName: "asc" } });
    return users.map((user) => ({ ...user, wallet: user.wallet ?? { balance: 0, currency: "LKR", transactions: [] } }));
  }

  @Get("wallets/:userId") @Roles("ADMIN") @UseGuards(RolesGuard)
  async wallet(@Req() request: AuthRequest, @Param("userId") userId: string) {
    await this.prisma.user.findFirstOrThrow({ where: { id: userId, organizationId: request.user.organizationId } });
    const wallet = await this.prisma.wallet.upsert({ where: { userId }, update: {}, create: { userId } });
    return this.prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id }, include: { transactions: { include: { task: { select: { title: true } }, project: { select: { code: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 100 } } });
  }

  @Post("wallets/:userId/pay") @Roles("ADMIN") @UseGuards(RolesGuard)
  async pay(@Req() request: AuthRequest, @Param("userId") userId: string, @Body() dto: PayWalletDto) {
    await this.prisma.user.findFirstOrThrow({ where: { id: userId, organizationId: request.user.organizationId } });
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({ where: { userId }, update: {}, create: { userId } });
      if (Number(wallet.balance) < dto.amount) throw new BadRequestException("Payment cannot exceed the wallet balance");
      const account = await tx.financialAccount.findFirstOrThrow({ where: { id: dto.financialAccountId, organizationId: request.user.organizationId, active: true } });
      if (Number(account.balance) < dto.amount) throw new BadRequestException("The selected payment account has insufficient balance");
      const updated = await tx.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: dto.amount } } });
      const updatedAccount = await tx.financialAccount.update({ where: { id: account.id }, data: { balance: { decrement: dto.amount } } });
      await tx.accountTransaction.create({ data: { financialAccountId: account.id, type: "EMPLOYEE_PAYMENT", amount: -dto.amount, balanceAfter: updatedAccount.balance, description: dto.note || `Payment to employee ${userId}`, reference: dto.reference } });
      const transaction = await tx.walletTransaction.create({ data: { walletId: wallet.id, financialAccountId: account.id, type: "PAYMENT", status: "PAID", amount: -dto.amount, balanceAfter: updated.balance, description: dto.note || "Wallet payment", reference: dto.reference } });
      await tx.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "PAYMENT", entityType: "WALLET", entityId: wallet.id, summary: `Recorded employee wallet payment of LKR ${dto.amount}`, metadata: { userId, amount: dto.amount, reference: dto.reference } } });
      return { wallet: updated, transaction };
    });
  }
}

@Module({ controllers: [WalletsController], providers: [JwtAuthGuard, RolesGuard] })
export class WalletsModule {}
