export type AuthUser = { id: string; organizationId: string; email: string; firstName: string; lastName: string; roles: string[] };
export type AuthRequest = { headers: { authorization?: string }; user: AuthUser };
