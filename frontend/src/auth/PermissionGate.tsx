import type { ReactNode } from "react";

import { useAuth } from "./AuthProvider";
import { PermissionDeniedPage } from "../pages/PermissionDeniedPage";

export function PermissionGate({
  permission,
  children,
  fallback,
}: {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { has } = useAuth();
  if (!has(permission)) {
    return <>{fallback ?? <PermissionDeniedPage />}</>;
  }
  return <>{children}</>;
}
