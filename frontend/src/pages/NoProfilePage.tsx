import { useAuth } from "../auth/AuthProvider";
import { DemoBanner } from "../components/DemoBanner";
import { ErrorPanel } from "../components/ui";

export function NoProfilePage() {
  const { error, signOut, me } = useAuth();
  return (
    <div className="gate">
      <DemoBanner />
      <div className="card narrow">
        <h1>Access not available</h1>
        <ErrorPanel error={error} title="Your sign-in could not be linked to an active profile" />
        <p className="muted">
          A valid Supabase Auth session is not enough. An AICTE OneDesk administrator must create
          your profile and grant a role before any reference data or case information is visible.
        </p>
        {me ? <p className="muted">Signed in as {me.user.official_email}</p> : null}
        <button type="button" className="button button-primary" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
