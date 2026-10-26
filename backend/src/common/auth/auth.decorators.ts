import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';

/** The authenticated user, taken from the token claims only (spec §8). */
export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
}

export type AuthRequest = Request & { user?: AuthUser };

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Opts a handler out of the global JwtAuthGuard (spec §8). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a handler to these roles; without it any authenticated user is allowed. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<AuthRequest>().user,
);
