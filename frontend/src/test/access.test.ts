import { describe, expect, it } from "vitest";

import {
  canAccessAdministration,
  formatResource,
  groupPermissionsByResource,
  hasPermission,
  membershipName,
  resolveStoredBureau,
  splitPermission,
} from "../lib/access";
import type { MeResponse } from "../types";

const ME: MeResponse = {
  user: {
    id: "11111111-1111-1111-1111-111111111111",
    full_name: "Demo Officer",
    display_name: null,
    official_email: "officer@demo.invalid",
    designation: "Officer",
    employee_code: "D-001",
    account_status: "active",
  },
  roles: [],
  memberships: [
    {
      bureau_id: "22222222-2222-2222-2222-222222222222",
      bureau_code: "RB",
      bureau_name: "Regional Bureau",
      membership_type: "member",
      is_primary: true,
    },
  ],
  active_bureau_id: "22222222-2222-2222-2222-222222222222",
  permissions: ["region.view", "institution.view"],
  global_permissions: [],
  is_super_admin: false,
  demo_mode: true,
  demo_notice: "Demo data",
};

describe("hasPermission", () => {
  it("matches exact codes only", () => {
    expect(hasPermission(["region.view"], "region.view")).toBe(true);
    expect(hasPermission(["region.view"], "region.manage")).toBe(false);
    expect(hasPermission(["institution.alias.view"], "institution.view")).toBe(false);
  });

  it("fails closed for a missing permission list", () => {
    expect(hasPermission(undefined, "region.view")).toBe(false);
    expect(hasPermission(null, "region.view")).toBe(false);
  });
});

describe("resolveStoredBureau", () => {
  it("keeps a stored bureau that is still an active membership", () => {
    expect(resolveStoredBureau(ME.memberships, ME.memberships[0].bureau_id)).toBe(
      ME.memberships[0].bureau_id,
    );
  });

  it("drops a stored bureau that is not a membership", () => {
    expect(
      resolveStoredBureau(ME.memberships, "33333333-3333-3333-3333-333333333333"),
    ).toBeNull();
  });

  it("treats no stored selection as no bureau context", () => {
    expect(resolveStoredBureau(ME.memberships, null)).toBeNull();
  });
});

describe("membershipName", () => {
  it("renders the code and name of the active bureau", () => {
    expect(membershipName(ME, ME.active_bureau_id)).toBe("RB — Regional Bureau");
  });

  it("returns null when the bureau is not a membership", () => {
    expect(membershipName(ME, "33333333-3333-3333-3333-333333333333")).toBeNull();
  });
});

describe("permission grouping", () => {
  it("splits a code at the final dot", () => {
    expect(splitPermission("institution.alias.view")).toEqual({
      resource: "institution.alias",
      action: "view",
    });
    expect(splitPermission("region.manage")).toEqual({ resource: "region", action: "manage" });
  });

  it("groups and sorts actions per resource", () => {
    expect(
      groupPermissionsByResource([
        "institution.view",
        "region.view",
        "institution.manage",
        "institution.alias.view",
      ]),
    ).toEqual([
      { resource: "institution", actions: ["manage", "view"] },
      { resource: "institution.alias", actions: ["view"] },
      { resource: "region", actions: ["view"] },
    ]);
  });

  it("ignores empty entries", () => {
    expect(groupPermissionsByResource(["", "  "])).toEqual([]);
  });

  it("formats a resource for display", () => {
    expect(formatResource("institution.alias")).toBe("Institution Alias");
  });
});

describe("canAccessAdministration", () => {
  it("requires a user or role capability", () => {
    expect(canAccessAdministration(["region.view"])).toBe(false);
    expect(canAccessAdministration(["user.view"])).toBe(true);
    expect(canAccessAdministration(["role.view"])).toBe(true);
  });
});
