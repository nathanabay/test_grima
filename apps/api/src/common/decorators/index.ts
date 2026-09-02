import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** Marks a route as reachable without authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'requiredPermissions';
/**
 * Server-side authorization (§73: never trust client-side authorization).
 * All listed permissions must be held.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string;
  fullName: string;
  roles: string[];
  permissions: string[];
  /** Empty array means organization-wide access. */
  branchIds: string[];
  warehouseIds: string[];
  sessionId: string;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;
    return data ? user?.[data] : user;
  },
);

/** Client IP and user-agent, for audit rows. */
export const RequestContext = createParamDecorator((_data, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return {
    ipAddress: req.ip ?? req.headers['x-forwarded-for'] ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
});
