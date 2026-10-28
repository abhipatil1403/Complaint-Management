import { useAuth } from "../auth/AuthProvider";

/**
 * Switches the active bureau context. The API re-validates that the caller has
 * an active membership, and PostgreSQL only applies bureau-scoped grants for
 * the bureau published in that context.
 */
export function BureauSwitcher() {
  const { me, selectBureau } = useAuth();
  if (!me || me.memberships.length === 0) {
    return null;
  }

  return (
    <label className="bureau-switcher">
      <span>Bureau context</span>
      <select
        value={me.active_bureau_id ?? ""}
        onChange={(event) => {
          void selectBureau(event.target.value || null);
        }}
      >
        <option value="">No bureau context</option>
        {me.memberships.map((membership) => (
          <option key={membership.bureau_id} value={membership.bureau_id}>
            {membership.bureau_code} — {membership.bureau_name}
          </option>
        ))}
      </select>
    </label>
  );
}
