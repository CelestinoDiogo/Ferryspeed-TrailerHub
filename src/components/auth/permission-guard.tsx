"use client";

import type { ReactNode } from "react";
import { canPerformAction, type PermissionAction, type PermissionModuleKey } from "@/lib/auth/permissions";
import type { RoleKey } from "@/lib/auth/roles";

type PermissionGuardProps = {
  roleKey: RoleKey | null;
  moduleKey: PermissionModuleKey;
  action?: PermissionAction;
  children: ReactNode;
  fallback?: ReactNode;
  allowWhenRoleMissing?: boolean;
};

function DefaultAccessDenied() {
  return (
    <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-rose-800 shadow-sm">
      <h2 className="text-xl font-semibold">Access denied</h2>
      <p className="mt-2 text-sm">You do not have permission to access this area.</p>
    </div>
  );
}

export function PermissionGuard({
  roleKey,
  moduleKey,
  action = "view",
  children,
  fallback,
  allowWhenRoleMissing = true,
}: PermissionGuardProps) {
  if (!roleKey) {
    return allowWhenRoleMissing ? <>{children}</> : (fallback ?? <DefaultAccessDenied />);
  }

  const allowed = canPerformAction(roleKey, moduleKey, action);

  if (!allowed) {
    return fallback ?? <DefaultAccessDenied />;
  }

  return <>{children}</>;
}
