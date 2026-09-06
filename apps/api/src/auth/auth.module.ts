import dotenv from "dotenv";
import { BadRequestException, Body, Controller, Get, Inject, Logger, Module, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsEmail, IsString, MinLength } from "class-validator";
import { compare, hash } from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { PrismaService } from "../database/prisma.service.js";
import { JwtAuthGuard } from "./jwt-auth.guard.js";
import type { AuthRequest } from "./auth.types.js";

dotenv.config({ path: "../../.env" });

class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
}
class ForgotPasswordDto { @IsEmail() email!: string; }
class ResetPasswordDto { @IsString() @MinLength(32) token!: string; @IsString() @MinLength(8) password!: string; }

@ApiTags("auth")
@Controller("auth")
class AuthController {
  private readonly logger = new Logger(AuthController.name);
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(JwtService) private readonly jwt: JwtService) {}

  @Post("login")
  async login(@Body() dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() }, include: { roles: { include: { role: true } } } });
    if (!user || user.status !== "ACTIVE" || !(await compare(dto.password, user.passwordHash))) throw new UnauthorizedException("Email or password is incorrect");
    const roles = user.roles.map(({ role }) => role.name);
    const profile = { id: user.id, organizationId: user.organizationId, email: user.email, firstName: user.firstName, lastName: user.lastName, jobTitle: user.jobTitle, roles };
    return { accessToken: await this.jwt.signAsync(profile), user: profile, redirectTo: roles.includes("ADMIN") ? "/admin" : "/employee" };
  }

  @Get("me") @UseGuards(JwtAuthGuard) @ApiBearerAuth()
  me(@Req() request: AuthRequest) { return request.user; }

  @Post("forgot-password")
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (user?.status === "ACTIVE") {
      const token = randomBytes(32).toString("hex"), tokenHash = createHash("sha256").update(token).digest("hex"), expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await this.prisma.$transaction([this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }), this.prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } })]);
      const resetUrl = `${process.env.WEB_URL ?? "http://localhost:3000"}/reset-password?token=${token}`;
      if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: process.env.SMTP_SECURE === "true", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
        try { await transporter.sendMail({ from: process.env.MAIL_FROM ?? process.env.SMTP_USER, to: user.email, subject: "Reset your Aurilink password", text: `Use this secure link within one hour to reset your password: ${resetUrl}`, html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2 style="color:#176b5b">Reset your password</h2><p>We received a request to reset your Aurilink Business Platform password.</p><p><a href="${resetUrl}" style="display:inline-block;background:#176b5b;color:white;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Reset password</a></p><p>This link expires in one hour and can only be used once. If you did not request this, you can ignore this email.</p></div>` }); } catch (error) { this.logger.error("Password reset email delivery failed", error instanceof Error ? error.stack : undefined); }
      } else if (process.env.NODE_ENV !== "production") this.logger.warn(`SMTP is not configured. Development reset link: ${resetUrl}`);
    }
    return { message: "If that email belongs to an active account, a password reset link has been sent." };
  }

  @Post("reset-password")
  async resetPassword(@Body() dto: ResetPasswordDto) {
    const tokenHash = createHash("sha256").update(dto.token).digest("hex"), record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) throw new BadRequestException("This password reset link is invalid or has expired");
    await this.prisma.$transaction([this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await hash(dto.password, 12) } }), this.prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } })]);
    return { message: "Password updated successfully. You can now sign in." };
  }
}

@Module({
  imports: [JwtModule.register({ global: true, secret: process.env.JWT_SECRET ?? "development-only-change-this-secret", signOptions: { expiresIn: 28800 } })],
  controllers: [AuthController],
  providers: [JwtAuthGuard],
  exports: [JwtAuthGuard, JwtModule],
})
export class AuthModule {}
