import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-code';
import { AuthRequest, IS_PUBLIC_KEY, ROLES_KEY } from './auth.decorators';

interface TokenClaims {
  sub: string;
  username: string;
  role: UserRole;
}

const unauthenticated = (message: string) =>
  new AppError(ErrorCode.UNAUTHENTICATED, 401, message);

/** Global: every route needs a valid bearer token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw unauthenticated('Authentication required');
    }
    let claims: TokenClaims;
    try {
      claims = await this.jwt.verifyAsync<TokenClaims>(token);
    } catch {
      throw unauthenticated('Invalid or expired token');
    }
    req.user = { id: claims.sub, username: claims.username, role: claims.role };
    return true;
  }
}

/** Global: a handler with @Roles(...) only admits those roles; without it any authenticated user. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!roles?.length) return true;
    const { user } = ctx.switchToHttp().getRequest<AuthRequest>();
    if (!user || !roles.includes(user.role)) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        403,
        'You do not have permission to perform this action',
      );
    }
    return true;
  }
}
