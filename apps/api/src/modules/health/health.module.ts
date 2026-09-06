import { Controller, Get, Module } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";

@ApiTags("health")
@Controller("health")
class HealthController {
  @Get() status() { return { status: "ok", service: "aurilink-api", timestamp: new Date().toISOString() }; }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
