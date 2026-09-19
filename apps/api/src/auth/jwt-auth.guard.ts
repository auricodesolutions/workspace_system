import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { AuthRequest, AuthUser } from "./auth.types.js";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(JwtService) private readonly jwt: JwtService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const bearerToken = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const cookieToken = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("aurilink_session="))?.slice("aurilink_session=".length);
    const token = bearerToken ?? cookieToken;
    if (!token) throw new UnauthorizedException("Login required");
    try {
      request.user = await this.jwt.verifyAsync<AuthUser>(token);
      return true;
    } catch {
      throw new UnauthorizedException("Session is invalid or expired");
    }
  }
}
