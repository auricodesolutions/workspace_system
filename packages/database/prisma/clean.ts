import dotenv from "dotenv";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../../../apps/api/src/generated/prisma/client.js";
dotenv.config({path:"../../.env"});
function connectionOptions(){const value=process.env.DATABASE_URL;if(!value)throw new Error("DATABASE_URL is not set");const url=new URL(value);return{host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:url.pathname.replace(/^\//,""),connectionLimit:5};}
const prisma=new PrismaClient({adapter:new PrismaMariaDb(connectionOptions())});
async function main(){
 const email=process.env.CLEAN_KEEP_ADMIN_EMAIL??"admin@aurilink.local";
 const admin=await prisma.user.findUnique({where:{email},include:{roles:{include:{role:true}}}});
 if(!admin||admin.status!=="ACTIVE"||!admin.roles.some(item=>item.role.name==="ADMIN"))throw new Error(`Refusing to clean: ${email} is not an active administrator`);
 await prisma.$transaction(async tx=>{
  await tx.renewalReminder.deleteMany(); await tx.clientTransaction.deleteMany(); await tx.projectRenewal.deleteMany();
  await tx.assetEvent.deleteMany(); await tx.asset.deleteMany(); await tx.accountTransaction.deleteMany();
  await tx.walletTransaction.deleteMany(); await tx.wallet.deleteMany();
  await tx.payment.deleteMany(); await tx.quotationItem.deleteMany(); await tx.quotation.deleteMany(); await tx.invoiceItem.deleteMany(); await tx.invoice.deleteMany();
  await tx.taskRevision.deleteMany(); await tx.taskAssignment.deleteMany(); await tx.personalTodo.deleteMany(); await tx.task.deleteMany(); await tx.approval.deleteMany();
  await tx.project.deleteMany(); await tx.clientAccount.deleteMany(); await tx.client.deleteMany(); await tx.financialAccount.deleteMany();
  await tx.auditLog.deleteMany(); await tx.passwordResetToken.deleteMany();
  await tx.businessUnitMember.deleteMany({where:{userId:{not:admin.id}}}); await tx.userRole.deleteMany({where:{userId:{not:admin.id}}}); await tx.user.deleteMany({where:{id:{not:admin.id}}});
 });
 const retained=await prisma.user.findMany({select:{email:true,firstName:true,lastName:true,status:true,roles:{select:{role:{select:{name:true}}}}}});
 console.log(JSON.stringify({cleaned:true,retainedUsers:retained},null,2));
}
main().finally(()=>prisma.$disconnect());
