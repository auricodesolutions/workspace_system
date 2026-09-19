import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../../../apps/api/src/generated/prisma/client.js";

dotenv.config({ path: "../../.env" });

function connectionOptions() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not set");
  const url = new URL(value);
  return { host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.replace(/^\//, ""), connectionLimit: 5 };
}

function splitSqlList(value: string) {
  const parts: string[] = [];
  let current = "", quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "'" && value[index - 1] !== "\\") {
      if (quoted && value[index + 1] === "'") { current += "''"; index += 1; continue; }
      quoted = !quoted;
    }
    if (character === "," && !quoted) { parts.push(current.trim()); current = ""; }
    else current += character;
  }
  parts.push(current.trim());
  return parts;
}

function decodeSqlValue(value: string) {
  if (value.toUpperCase() === "NULL") return null;
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'").replace(/\\'/g, "'").trim();
  return value.trim();
}

function parseClientRows(sql: string) {
  const insert = sql.match(/INSERT INTO `Client`\s*\(([^;]+?)\)\s*VALUES\s*([\s\S]+?);/i);
  if (!insert) throw new Error("No Client INSERT statement was found");
  const columns = [...insert[1].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const rows: string[] = [];
  let current = "", depth = 0, quoted = false;
  for (let index = 0; index < insert[2].length; index += 1) {
    const character = insert[2][index];
    if (character === "'" && insert[2][index - 1] !== "\\") {
      if (quoted && insert[2][index + 1] === "'") { current += "''"; index += 1; continue; }
      quoted = !quoted;
    }
    if (!quoted && character === "(") { if (depth++ === 0) { current = ""; continue; } }
    if (!quoted && character === ")" && --depth === 0) { rows.push(current); current = ""; continue; }
    if (depth > 0) current += character;
  }
  return rows.map((row) => Object.fromEntries(splitSqlList(row).map((value, index) => [columns[index], decodeSqlValue(value)])));
}

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(connectionOptions()) });

async function main() {
  const file = process.argv[2];
  const businessUnitCode = process.argv[3] ?? "ALD";
  const adminEmail = process.env.CLEAN_KEEP_ADMIN_EMAIL ?? "admin@aurilink.local";
  if (!file) throw new Error("Usage: npm run import:clients -w @aurilink/database -- <Client.sql> [business-unit-code]");
  const admin = await prisma.user.findUnique({ where: { email: adminEmail }, include: { roles: { include: { role: true } } } });
  if (!admin?.roles.some(({ role }) => role.name === "ADMIN")) throw new Error(`${adminEmail} is not an administrator`);
  const unit = await prisma.businessUnit.findFirstOrThrow({ where: { organizationId: admin.organizationId, code: businessUnitCode } });
  const rows = parseClientRows(readFileSync(file, "utf8"));
  let created = 0, updated = 0;
  const names: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const name = String(row.name ?? "").trim();
      if (!name) throw new Error("A client row has no name");
      const email = row.email ? String(row.email).trim().toLowerCase() : null;
      const existing = await tx.client.findFirst({ where: { organizationId: admin.organizationId, OR: [{ id: String(row.id) }, ...(email ? [{ email }] : []), { name }] } });
      const data = {
        organizationId: admin.organizationId,
        businessUnitId: unit.id,
        name,
        legalName: row.legalName ? String(row.legalName).trim() : null,
        email,
        phone: row.phone ? String(row.phone).trim() : null,
        address: row.address ? String(row.address).trim() : null,
        industry: row.industry ? String(row.industry).trim() : null,
        status: (["LEAD", "ACTIVE", "INACTIVE", "ARCHIVED"].includes(String(row.status)) ? String(row.status) : "ACTIVE") as "LEAD" | "ACTIVE" | "INACTIVE" | "ARCHIVED",
      };
      const client = existing
        ? await tx.client.update({ where: { id: existing.id }, data })
        : await tx.client.create({ data: { id: String(row.id), ...data, createdAt: row.createdAt ? new Date(String(row.createdAt) + "Z") : undefined, account: { create: {} } } });
      if (existing) { updated += 1; await tx.clientAccount.upsert({ where: { clientId: client.id }, update: {}, create: { clientId: client.id } }); }
      else created += 1;
      names.push(client.name);
    }
    await tx.auditLog.create({ data: { organizationId: admin.organizationId, actorId: admin.id, action: "IMPORT", entityType: "CLIENT", summary: `Imported ${rows.length} clients into ${unit.code}`, metadata: { created, updated, source: file } } });
  });
  console.log(JSON.stringify({ imported: rows.length, created, updated, businessUnit: unit.code, clients: names }, null, 2));
}

main().finally(() => prisma.$disconnect());
