import { Controller, Get, Inject, Module, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { Roles, RolesGuard } from "../../auth/roles.guard.js";
import type { AuthRequest } from "../../auth/auth.types.js";
import { PrismaService } from "../../database/prisma.service.js";

@ApiTags("sales") @ApiBearerAuth() @UseGuards(JwtAuthGuard, RolesGuard) @Roles("ADMIN") @Controller("sales")
class SalesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get("summary") async summary(@Req() request: AuthRequest) {
    const organizationId=request.user.organizationId,now=new Date(),sixMonthsAgo=new Date(now.getFullYear(),now.getMonth()-5,1);
    const [quotations,invoices,payments,clients]=await Promise.all([
      this.prisma.quotation.findMany({where:{organizationId},include:{client:{select:{name:true}},project:{select:{code:true}}},orderBy:{createdAt:"desc"}}),
      this.prisma.invoice.findMany({where:{organizationId,status:{not:"VOID"}},include:{client:{select:{name:true}},payments:true},orderBy:{createdAt:"desc"}}),
      this.prisma.payment.findMany({where:{invoice:{organizationId},paidAt:{gte:sixMonthsAgo}},include:{invoice:{select:{client:{select:{name:true}},invoiceNumber:true}}},orderBy:{paidAt:"desc"}}),
      this.prisma.client.count({where:{organizationId,status:"ACTIVE"}}),
    ]);
    const invoiceValue=invoices.reduce((sum,item)=>sum+Number(item.total),0),paid=invoices.reduce((sum,item)=>sum+item.payments.reduce((value,payment)=>value+Number(payment.amount),0),0);
    const pipelineStatuses=["DRAFT","SENT","ACCEPTED","REJECTED","EXPIRED","CONVERTED"] as const;
    const months=Array.from({length:6},(_,index)=>{const date=new Date(now.getFullYear(),now.getMonth()-5+index,1);return{key:`${date.getFullYear()}-${date.getMonth()}`,label:date.toLocaleDateString("en-US",{month:"short"}),quoted:0,invoiced:0,received:0};});
    for(const quote of quotations){const row=months.find(item=>item.key===`${quote.issueDate.getFullYear()}-${quote.issueDate.getMonth()}`);if(row)row.quoted+=Number(quote.total);} for(const invoice of invoices){const row=months.find(item=>item.key===`${invoice.issueDate.getFullYear()}-${invoice.issueDate.getMonth()}`);if(row)row.invoiced+=Number(invoice.total);} for(const payment of payments){const row=months.find(item=>item.key===`${payment.paidAt.getFullYear()}-${payment.paidAt.getMonth()}`);if(row)row.received+=Number(payment.amount);}
    return{summary:{activeClients:clients,quotations:quotations.length,quotationValue:quotations.reduce((sum,item)=>sum+Number(item.total),0),acceptedValue:quotations.filter(item=>["ACCEPTED","CONVERTED"].includes(item.status)).reduce((sum,item)=>sum+Number(item.total),0),invoiceValue,received:paid,outstanding:Math.max(0,invoiceValue-paid),overdue:invoices.filter(item=>item.status==="OVERDUE"||(item.dueDate<now&&item.status!=="PAID")).reduce((sum,item)=>sum+Math.max(0,Number(item.total)-item.payments.reduce((value,payment)=>value+Number(payment.amount),0)),0)},pipeline:pipelineStatuses.map(status=>({status,count:quotations.filter(item=>item.status===status).length,value:quotations.filter(item=>item.status===status).reduce((sum,item)=>sum+Number(item.total),0)})),months,recentQuotations:quotations.slice(0,6).map(item=>({id:item.id,number:item.quotationNumber,client:item.client.name,project:item.project?.code,status:item.status,total:Number(item.total),validUntil:item.validUntil})),recentInvoices:invoices.slice(0,6).map(item=>{const received=item.payments.reduce((sum,payment)=>sum+Number(payment.amount),0);return{id:item.id,number:item.invoiceNumber,client:item.client.name,status:item.status,total:Number(item.total),received,due:Math.max(0,Number(item.total)-received),dueDate:item.dueDate};}),recentPayments:payments.slice(0,6).map(item=>({id:item.id,invoice:item.invoice.invoiceNumber,client:item.invoice.client.name,amount:Number(item.amount),paidAt:item.paidAt,method:item.method}))};
  }
}
@Module({controllers:[SalesController],providers:[JwtAuthGuard,RolesGuard]}) export class SalesModule{}
