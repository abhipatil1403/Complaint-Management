/** Pure authorization and presentation helpers.
 *
 * These functions never decide access on the server; they only keep the
 * interface consistent with the capabilities the API already published. Every
 * decision is re-checked by FastAPI and by PostgreSQL row level security.
 */

import type { MeMembership, MeResponse } from "../types";

export function hasPermission(
  permissions: readonly string[] | null | undefined,
  permission: string,
): boolean {
  return Boolean(permissions?.includes(permission));
}

/** A stored bureau selection is only usable while an active membership exists. */
export function resolveStoredBureau(
  memberships: readonly Pick<MeMembership, "bureau_id">[],
  storedBureauId: string | null,
): string | null {
  if (!storedBureauId) {
    return null;
  }
  return memberships.some((membership) => membership.bureau_id === storedBureauId)
    ? storedBureauId
    : null;
}

export function membershipName(me: MeResponse | null, bureauId: string | null): string | null {
  if (!me || !bureauId) {
    return null;
  }
  const membership = me.memberships.find((item) => item.bureau_id === bureauId);
  return membership ? `${membership.bureau_code} — ${membership.bureau_name}` : null;
}

export function canAccessAdministration(permissions: readonly string[]): boolean {
  return hasPermission(permissions, "user.view") || hasPermission(permissions, "role.view");
}

export interface PermissionGroup {
  resource: string;
  action: string;
}

/** Splits dotted API codes at the final dot: `institution.alias.view`. */
export function splitPermission(permission: string): PermissionGroup {
  const normalized = permission.trim().toLowerCase();
  const index = normalized.lastIndexOf(".");
  if (index <= 0) {
    return { resource: normalized, action: "" };
  }
  return {
    resource: normalized.slice(0, index),
    action: normalized.slice(index + 1),
  };
}

/** Groups capabilities so the interface can show a readable capability list. */
export function groupPermissionsByResource(
  permissions: readonly string[],
): Array<{ resource: string; actions: string[] }> {
  const groups = new Map<string, Set<string>>();
  for (const permission of permissions) {
    const { resource, action } = splitPermission(permission);
    if (!resource) {
      continue;
    }
    const actions = groups.get(resource) ?? new Set<string>();
    if (action) {
      actions.add(action);
    }
    groups.set(resource, actions);
  }
  return [...groups.entries()]
    .map(([resource, actions]) => ({
      resource,
      actions: [...actions].sort(),
    }))
    .sort((left, right) => left.resource.localeCompare(right.resource));
}

export function formatResource(resource: string): string {
  return resource
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
