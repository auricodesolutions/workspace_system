import dotenv from "dotenv";
import { hash } from "bcryptjs";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../../../apps/api/src/generated/prisma/client.js";

dotenv.config({ path: "../../.env" });

function connectionOptions() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not set in the root .env file");
  const url = new URL(value);
  return { host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.replace(/^\//, ""), connectionLimit: 5 };
}

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(connectionOptions()) });

async function main() {
  const [adminPassword, employeePassword] = await Promise.all([hash("ChangeMe123!", 12), hash("Employee123!", 12)]);
  const organization = await prisma.organization.upsert({ where: { slug: "aurilink" }, update: { name: "Aurilink" }, create: { name: "Aurilink", slug: "aurilink" } });
  const digital = await prisma.businessUnit.upsert({ where: { organizationId_code: { organizationId: organization.id, code: "ALD" } }, update: {}, create: { organizationId: organization.id, name: "Aurilink Digital", code: "ALD", quotationPrefix: "ALD-QT", invoicePrefix: "ALD-INV" } });
  await prisma.businessUnit.upsert({ where: { organizationId_code: { organizationId: organization.id, code: "ACS" } }, update: {}, create: { organizationId: organization.id, name: "Auricode Solutions", code: "ACS", quotationPrefix: "ACS-QT", invoicePrefix: "ACS-INV" } });
  const user = await prisma.user.upsert({ where: { email: "admin@aurilink.local" }, update: { passwordHash: adminPassword, status: "ACTIVE" }, create: { organizationId: organization.id, email: "admin@aurilink.local", passwordHash: adminPassword, firstName: "Sandul", lastName: "Karunarathna", jobTitle: "Director", status: "ACTIVE" } });
  const employee = await prisma.user.upsert({ where: { email: "employee@aurilink.local" }, update: { passwordHash: employeePassword, status: "ACTIVE" }, create: { organizationId: organization.id, email: "employee@aurilink.local", passwordHash: employeePassword, firstName: "Kasun", lastName: "Perera", jobTitle: "Developer", status: "ACTIVE" } });
  await prisma.businessUnitMember.upsert({ where: { businessUnitId_userId: { businessUnitId: digital.id, userId: user.id } }, update: { isDefault: true }, create: { businessUnitId: digital.id, userId: user.id, isDefault: true } });
  await prisma.businessUnitMember.upsert({ where: { businessUnitId_userId: { businessUnitId: digital.id, userId: employee.id } }, update: { isDefault: true }, create: { businessUnitId: digital.id, userId: employee.id, isDefault: true } });

  const permissionKeys = ["dashboard.admin", "task.view_all", "task.create", "task.assign", "task.update_status", "task.view_own"];
  const permissions = await Promise.all(permissionKeys.map((key) => prisma.permission.upsert({ where: { key }, update: {}, create: { key } })));
  const adminRole = await prisma.role.upsert({ where: { organizationId_name: { organizationId: organization.id, name: "ADMIN" } }, update: {}, create: { organizationId: organization.id, name: "ADMIN", description: "Full administrative access", isSystem: true } });
  const employeeRole = await prisma.role.upsert({ where: { organizationId_name: { organizationId: organization.id, name: "EMPLOYEE" } }, update: {}, create: { organizationId: organization.id, name: "EMPLOYEE", description: "Employee self-service access", isSystem: true } });
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: adminRole.id } }, update: {}, create: { userId: user.id, roleId: adminRole.id } });
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: employee.id, roleId: employeeRole.id } }, update: {}, create: { userId: employee.id, roleId: employeeRole.id } });
  for (const permission of permissions) await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permission.id } }, update: {}, create: { roleId: adminRole.id, permissionId: permission.id } });
  for (const permission of permissions.filter((item) => ["task.update_status", "task.view_own"].includes(item.key))) await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: employeeRole.id, permissionId: permission.id } }, update: {}, create: { roleId: employeeRole.id, permissionId: permission.id } });
  const client = await prisma.client.upsert({ where: { id: "seed-client-abc-hotel" }, update: {}, create: { id: "seed-client-abc-hotel", organizationId: organization.id, businessUnitId: digital.id, name: "ABC Hotel", email: "accounts@example.com", industry: "Hospitality", status: "ACTIVE" } });
  const project = await prisma.project.upsert({ where: { businessUnitId_code: { businessUnitId: digital.id, code: "ALD-PRJ-0001" } }, update: {}, create: { businessUnitId: digital.id, clientId: client.id, code: "ALD-PRJ-0001", name: "ABC Hotel Website Redesign", status: "ACTIVE", priority: "HIGH", dueDate: new Date(Date.now() + 14 * 86400000), budget: 180000, estimatedHours: 120 } });
  const taskSeeds = [["Review homepage design — ABC Hotel", "HIGH", 82, 0], ["Send September invoice — ABC Hotel", "CRITICAL", 94, 0], ["Resolve mobile navigation feedback", "HIGH", 88, -2], ["Prepare client progress update", "MEDIUM", 61, 1]] as const;
  for (const [title, priority, priorityScore, dayOffset] of taskSeeds) {
    let task = await prisma.task.findFirst({ where: { projectId: project.id, title } });
    if (!task) task = await prisma.task.create({ data: { projectId: project.id, createdById: user.id, title, priority, priorityScore, status: "TODO", dueDate: new Date(Date.now() + dayOffset * 86400000) } });
    await prisma.taskAssignment.upsert({ where: { taskId_userId: { taskId: task.id, userId: user.id } }, update: {}, create: { taskId: task.id, userId: user.id } });
    await prisma.taskAssignment.upsert({ where: { taskId_userId: { taskId: task.id, userId: employee.id } }, update: {}, create: { taskId: task.id, userId: employee.id } });
  }
  await prisma.invoice.upsert({ where: { businessUnitId_invoiceNumber: { businessUnitId: digital.id, invoiceNumber: "ALD-INV-2026-0001" } }, update: {}, create: { organizationId: organization.id, businessUnitId: digital.id, clientId: client.id, projectId: project.id, invoiceNumber: "ALD-INV-2026-0001", status: "OVERDUE", issueDate: new Date(Date.now() - 45 * 86400000), dueDate: new Date(Date.now() - 15 * 86400000), subtotal: 125000, total: 125000 } });
  const approval = await prisma.approval.findFirst({ where: { organizationId: organization.id, title: "ABC Hotel website design approval" } });
  if (!approval) await prisma.approval.create({ data: { organizationId: organization.id, type: "PROJECT", referenceId: project.id, title: "ABC Hotel website design approval", requestedById: user.id } });
  console.log("Seed completed successfully.");
}

main().finally(() => prisma.$disconnect());
