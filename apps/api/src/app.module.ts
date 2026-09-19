import { Module } from "@nestjs/common";
import { HealthModule } from "./modules/health/health.module.js";
import { DashboardModule } from "./modules/dashboard/dashboard.module.js";
import { PrismaService } from "./database/prisma.service.js";
import { DatabaseModule } from "./database/database.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { TasksModule } from "./modules/tasks/tasks.module.js";
import { ProjectsModule } from "./modules/projects/projects.module.js";
import { PlannerModule } from "./modules/planner/planner.module.js";
import { UsersModule } from "./modules/users/users.module.js";
import { WalletsModule } from "./modules/wallets/wallets.module.js";
import { ClientsModule } from "./modules/clients/clients.module.js";
import { InvoicesModule } from "./modules/invoices/invoices.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { AccountsModule } from "./modules/accounts/accounts.module.js";
import { ReportsModule } from "./modules/reports/reports.module.js";
import { QuotationsModule } from "./modules/quotations/quotations.module.js";
import { RenewalsModule } from "./modules/renewals/renewals.module.js";
import { AssetsModule } from "./modules/assets/assets.module.js";
import { SalesModule } from "./modules/sales/sales.module.js";
import { SettingsModule } from "./modules/settings/settings.module.js";
import { MeetingsModule } from "./modules/meetings/meetings.module.js";
import { TaskTypesModule } from "./modules/task-types/task-types.module.js";

@Module({ imports: [DatabaseModule, AuthModule, HealthModule, DashboardModule, TasksModule, ProjectsModule, PlannerModule, UsersModule, WalletsModule, ClientsModule, InvoicesModule, AuditModule, AccountsModule, ReportsModule, QuotationsModule, RenewalsModule, AssetsModule, SalesModule, SettingsModule, MeetingsModule, TaskTypesModule], providers: [PrismaService], exports: [PrismaService] })
export class AppModule {}
