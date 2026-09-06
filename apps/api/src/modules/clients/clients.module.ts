import { BadRequestException, Body, Controller, Get, Inject, Module, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsEmail, IsIn, IsNumber, IsOptional, IsString, Min, MinLength } from "class-validator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { Roles, RolesGuard } from "../../auth/roles.guard.js";
import type { AuthRequest } from "../../auth/auth.types.js";
import { PrismaService } from "../../database/prisma.service.js";

class CreateClientDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsString() businessUnitId?: string;
}
class ClientPaymentDto {
  @IsNumber() @Min(0.01) amount!: number;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() note?: string;
}
class UpdateClientDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsIn(["LEAD", "ACTIVE", "INACTIVE", "ARCHIVED"]) status?: "LEAD" | "ACTIVE" | "INACTIVE" | "ARCHIVED";
}

@ApiTags("clients") @ApiBearerAuth() @UseGuards(JwtAuthGuard, RolesGuard) @Roles("ADMIN")
@Controller("clients")
class ClientsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() request: AuthRequest) {
    const clients = await this.prisma.client.findMany({ where: { organizationId: request.user.organizationId }, include: { account: { include: { transactions: { include: { task: { select: { title: true, revisionCount: true } }, project: { select: { code: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 100 } } }, _count: { select: { projects: true } } }, orderBy: { name: "asc" } });
    return clients.map((client) => ({ ...client, account: client.account ?? { balance: 0, currency: "LKR", transactions: [] } }));
  }

  @Post()
  async create(@Req() request: AuthRequest, @Body() dto: CreateClientDto) {
    const unit = dto.businessUnitId
      ? await this.prisma.businessUnit.findFirstOrThrow({ where: { id: dto.businessUnitId, organizationId: request.user.organizationId } })
      : await this.prisma.businessUnit.findFirstOrThrow({ where: { organizationId: request.user.organizationId }, orderBy: { createdAt: "asc" } });
    const client = await this.prisma.client.create({ data: { organizationId: request.user.organizationId, businessUnitId: unit.id, name: dto.name, legalName: dto.legalName, email: dto.email || undefined, phone: dto.phone, address: dto.address, industry: dto.industry, status: "ACTIVE", account: { create: {} } }, include: { account: true } });
    await this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "CREATE", entityType: "CLIENT", entityId: client.id, summary: `Created client ${client.name}` } });
    return client;
  }

  @Patch(":id")
  async update(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: UpdateClientDto) {
    await this.prisma.client.findFirstOrThrow({ where: { id, organizationId: request.user.organizationId } });
    const client = await this.prisma.client.update({ where: { id }, data: dto });
    await this.prisma.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "UPDATE", entityType: "CLIENT", entityId: id, summary: `Updated client ${client.name}`, metadata: { name: dto.name ?? null, status: dto.status ?? null } } });
    return client;
  }

  @Post(":id/payments")
  async recordPayment(@Req() request: AuthRequest, @Param("id") id: string, @Body() dto: ClientPaymentDto) {
    await this.prisma.client.findFirstOrThrow({ where: { id, organizationId: request.user.organizationId } });
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.clientAccount.upsert({ where: { clientId: id }, update: {}, create: { clientId: id } });
      if (Number(account.balance) < dto.amount) throw new BadRequestException("Payment cannot exceed the client's outstanding balance");
      const updated = await tx.clientAccount.update({ where: { id: account.id }, data: { balance: { decrement: dto.amount } } });
      const transaction = await tx.clientTransaction.create({ data: { accountId: account.id, type: "PAYMENT", status: "PAID", amount: -dto.amount, balanceAfter: updated.balance, description: dto.note || "Client payment received", reference: dto.reference } });
      await tx.auditLog.create({ data: { organizationId: request.user.organizationId, actorId: request.user.id, action: "PAYMENT", entityType: "CLIENT", entityId: id, summary: `Recorded client payment of LKR ${dto.amount}`, metadata: { amount: dto.amount, reference: dto.reference } } });
      return { account: updated, transaction };
    });
  }
}

@Module({ controllers: [ClientsController], providers: [JwtAuthGuard, RolesGuard] })
export class ClientsModule {}
