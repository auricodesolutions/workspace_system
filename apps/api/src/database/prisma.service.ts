import dotenv from "dotenv";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client.js";

dotenv.config({ path: "../../.env" });

function connectionOptions() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not set in the root .env file");
  const url = new URL(value);
  return { host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.replace(/^\//, ""), connectionLimit: 10 };
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() { super({ adapter: new PrismaMariaDb(connectionOptions()) }); }
  async onModuleDestroy() { await this.$disconnect(); }
}
