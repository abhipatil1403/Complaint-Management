import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { IconChevronDown } from "./Icons";

function avatarStyle(backgroundColor: string) {
  const rgb = backgroundColor.replace("#", "");
  const brightness = [0.299, 0.587, 0.114].reduce(
    (sum, weight, index) =>
      sum + parseInt(rgb.slice(index * 2, index * 2 + 2), 16) * weight,
    0,
  );
  return { backgroundColor, color: brightness > 150 ? "#193725" : "#fff" };
}

export function RoleSwitcher() {
  const navigate = useNavigate();
  const { activePersona, personas, switchPersona, signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    const outside = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setIsOpen(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("mousedown", outside);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("mousedown", outside);
    };
  }, [isOpen]);

  return (
    <div ref={root} className="role-switcher-container">
      <button
        type="button"
        className="role-switcher-pill"
        aria-expanded={isOpen}
        onKeyDown={(e) => {
          if (e.key === "Escape") setIsOpen(false);
        }}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Account menu"
        title="Account menu"
      >
        <span
          className="persona-avatar-circle"
          style={avatarStyle(activePersona.avatarBg)}
        >
          {activePersona.name
            .split(" ")
            .map((n) => n[0])
            .slice(0, 2)
            .join("")}
        </span>
        <div className="role-switcher-text">
          <span className="role-user-name">{activePersona.name}</span>
          <span className="role-user-title">{activePersona.roleName}</span>
        </div>
        <IconChevronDown className="w-3.5 h-3.5 opacity-60 ml-1" />
      </button>

      {isOpen && (
        <div className="role-switcher-menu" onClick={() => setIsOpen(false)}>
          <div className="role-menu-header">
            <strong>Switch account</strong>
            <p className="small muted">
              Choose an account to open its workspace.
            </p>
          </div>
          <button
            className="button button-quiet"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
          <ul className="role-persona-list">
            {Object.values(personas).map((p) => {
              const isSelected = p.key === activePersona.key;
              return (
                <li key={p.key}>
                  <button
                    type="button"
                    className={`role-persona-item ${isSelected ? "selected" : ""}`}
                    onClick={() => {
                      switchPersona(p.key);
                      navigate("/", { replace: true });
                      setIsOpen(false);
                    }}
                  >
                    <span
                      className="persona-avatar-circle small"
                      style={avatarStyle(p.avatarBg)}
                    >
                      {p.name
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <div className="role-persona-details">
                      <strong className="persona-name">{p.name}</strong>
                      <span className="persona-role">{p.roleName}</span>
                      <small className="persona-bureau">{p.bureauName}</small>
                    </div>
                    {isSelected && <span className="active-check-dot" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
