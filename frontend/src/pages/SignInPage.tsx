import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider";
import { Loading } from "../components/ui";
import { supabase, supabaseConfigured } from "../lib/supabase";

export function SignInPage() {
  const { status } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "ready" || status === "no_profile" || status === "error") {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== "/sign-in" ? from : "/"} replace />;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      return;
    }
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      setError(
        signInError.message.toLowerCase().includes("invalid login")
          ? "The email or password is not correct."
          : signInError.message,
      );
    }
    setBusy(false);
  }

  return (
    <div className="signin-layout">
      <section className="signin-intro">
        <span className="badge badge-global">Phase 1</span>
        <h1>AICTE OneDesk</h1>
        <p>
          A monitoring and status interface for AICTE institution complaints. Access is limited to
          authorized officials and is enforced by the API and PostgreSQL row level security.
        </p>
        <ul>
          <li>Illustrative demo data only — no real complaint is filed or tracked.</li>
          <li>Supabase Auth is the only identity system.</li>
          <li>Every action is scoped to your role and active bureau context.</li>
        </ul>
      </section>

      <section className="signin-card card">
        <h2>Sign in</h2>
        {!supabaseConfigured ? (
          <div className="error-panel" role="alert">
            <strong>Authentication is not configured</strong>
            <p>
              Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in
              <code> frontend/.env.local</code>, then restart the dev server.
            </p>
          </div>
        ) : status === "loading" ? (
          <Loading label="Checking your session..." />
        ) : (
          <form onSubmit={submit} className="form">
            <label>
              Official email
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@demo.invalid"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? "Signing in..." : "Sign in"}
            </button>
            <p className="muted small">
              There is no self-registration. An administrator provisions accounts and role grants.
            </p>
          </form>
        )}
      </section>
    </div>
  );
}
