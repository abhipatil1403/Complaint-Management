import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { BrandLogo } from "../components/BrandLogo";

export function SignInPage() {
  const { status, signInPersona, personas } = useAuth();
  const location = useLocation();

  if (status === "ready") {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== "/sign-in" ? from : "/"} replace />;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-canvas)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
      }}
    >
      <div
        style={{
          width: "900px",
          maxWidth: "100%",
          background: "var(--color-surface-white)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-2xl)",
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
        }}
      >
        {/* Top Header Banner */}
        <div
          style={{
            background: "linear-gradient(135deg, #155a37 0%, #0d3a23 100%)",
            color: "white",
            padding: "2.25rem 2.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "1.5rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
            <div
              style={{
                width: "48px",
                overflow: "hidden",
                height: "48px",
                borderRadius: "var(--radius-lg)",
                background: "rgba(255, 255, 255, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <BrandLogo size={36} fallbackIconClass="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 style={{ color: "white", fontSize: "1.5rem", marginBottom: "0.25rem" }}>
                AICTE OneDesk
              </h1>
              <p style={{ color: "rgba(255, 255, 255, 0.85)", margin: 0, fontSize: "0.9rem" }}>
                Integrated Institution Complaint Monitoring and Status Dashboard
              </p>
            </div>
          </div>

        </div>

        {/* Content Body */}
        <div style={{ padding: "2.25rem 2.5rem" }}>
          <div style={{ marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1.25rem", marginBottom: "0.35rem" }}>
              Choose your workspace
            </h2>
            <p className="small muted">
              Select an account to continue to its assigned workspace.
            </p>
          </div>

          {/* 7 Personas Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: "1rem",
              marginBottom: "2rem",
            }}
          >
            {Object.values(personas).map((p) => (
              <div
                key={p.key}
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-xl)",
                  padding: "1.25rem",
                  background: "var(--color-surface)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  transition: "all var(--duration-base)",
                  gap: "1rem",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.6rem" }}>
                    <span
                      className="persona-avatar-circle"
                      style={{ backgroundColor: p.avatarBg }}
                    >
                      {p.name
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <div>
                      <strong style={{ fontSize: "0.92rem", display: "block" }}>{p.name}</strong>
                      <span className="small muted">{p.roleName}</span>
                    </div>
                  </div>
                  <div className="small muted" style={{ fontSize: "0.78rem" }}>
                    {p.designation} · <strong>{p.bureauName}</strong>
                  </div>
                </div>

                <button
                  type="button"
                  className="button button-primary"
                  style={{ width: "100%", padding: "0.45rem", fontSize: "0.82rem" }}
                  onClick={() => void signInPersona(p.key)}
                >
                  Enter as {p.roleName.split(" ")[0]} &rarr;
                </button>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
