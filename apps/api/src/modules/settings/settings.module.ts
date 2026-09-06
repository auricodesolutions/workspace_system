import { Body, Controller, Get, Inject, Module, Patch, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard.js";
import { Roles, RolesGuard } from "../../auth/roles.guard.js";
import type { AuthRequest } from "../../auth/auth.types.js";
import { PrismaService } from "../../database/prisma.service.js";
class UpdateSettingsDto{@IsString() @MinLength(2) @MaxLength(100) organizationName!:string;@IsString() @MinLength(2) @MaxLength(100) businessUnitName!:string;@IsString() @Matches(/^[A-Z0-9-]{2,12}$/) code!:string;@IsString() @Matches(/^[A-Z0-9-]{2,20}$/) quotationPrefix!:string;@IsString() @Matches(/^[A-Z0-9-]{2,20}$/) invoicePrefix!:string;@IsIn(["LKR","USD","EUR","GBP","AUD"]) currency!:string;@IsOptional() @IsString() @MaxLength(160) email?:string;@IsOptional() @IsString() @MaxLength(40) phone?:string;@IsOptional() @IsString() @MaxLength(500) address?:string;}
@ApiTags("settings") @ApiBearerAuth() @UseGuards(JwtAuthGuard,RolesGuard) @Roles("ADMIN") @Controller("settings")
class SettingsController{
 constructor(@Inject(PrismaService) private readonly prisma:PrismaService){}
 @Get() async get(@Req() request:AuthRequest){const organization=await this.prisma.organization.findUniqueOrThrow({where:{id:request.user.organizationId},include:{businessUnits:{orderBy:{createdAt:"asc"}}}});return{organization:{id:organization.id,name:organization.name,slug:organization.slug},businessUnits:organization.businessUnits};}
 @Patch() async update(@Req() request:AuthRequest,@Body() dto:UpdateSettingsDto){const unit=await this.prisma.businessUnit.findFirstOrThrow({where:{organizationId:request.user.organizationId}});return this.prisma.$transaction(async tx=>{const organization=await tx.organization.update({where:{id:request.user.organizationId},data:{name:dto.organizationName.trim()}});const businessUnit=await tx.businessUnit.update({where:{id:unit.id},data:{name:dto.businessUnitName.trim(),code:dto.code.trim().toUpperCase(),quotationPrefix:dto.quotationPrefix.trim().toUpperCase(),invoicePrefix:dto.invoicePrefix.trim().toUpperCase(),currency:dto.currency,email:dto.email?.trim()||null,phone:dto.phone?.trim()||null,address:dto.address?.trim()||null}});await tx.auditLog.create({data:{organizationId:request.user.organizationId,actorId:request.user.id,action:"UPDATE",entityType:"SETTINGS",entityId:businessUnit.id,summary:`Updated organization and ${businessUnit.name} settings`}});return{organization,businessUnit};});}
}
@Module({controllers:[SettingsController],providers:[JwtAuthGuard,RolesGuard]}) export class SettingsModule{}
