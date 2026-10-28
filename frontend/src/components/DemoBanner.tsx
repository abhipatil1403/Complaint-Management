import { useAuth } from "../auth/AuthProvider";

export function DemoBanner() {
  const { me } = useAuth();
  if (!me?.demo_mode) {
    return null;
  }
  return (
    <div className="demo-banner" role="status">
      <strong>Demo</strong>
      <span>{me.demo_notice}</span>
      <span className="demo-banner-note">
        Not an official AICTE system; no real complaint is filed or tracked.
      </span>
    </div>
  );
}
