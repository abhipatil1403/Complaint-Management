import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useSimulation, canReadCase } from "../simulation/selectors";
import { accessibleSubmissions } from "../simulation/scope";
import { IconSearch } from "./Icons";

export function GlobalSearch() {
  const { has, activePersona } = useAuth();
  const state = useSimulation();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const q = query.trim().toLowerCase();
  const results = [
    ...(has("case.view_index") || has("case.view_detail")
      ? state.cases.map((c) => ({
          label: canReadCase(c, activePersona, state)
            ? `${c.case_number} · ${c.title}`
            : c.case_number,
          type: "Case",
          path: `/cases/${c.case_id}`,
        }))
      : []),
    ...(has("institution.view")
      ? state.institutions.map((i) => ({
          label: `${i.official_name} · ${i.aicte_permanent_id}`,
          type: "Institution",
          path: `/institutions/${i.id}`,
        }))
      : []),
    ...(has("bureau.view")
      ? state.bureaus.map((b) => ({
          label: `${b.name} · ${b.code}`,
          type: "Bureau",
          path: `/bureaus/${b.id}`,
        }))
      : []),
    ...(has("submission.view")
      ? accessibleSubmissions(state, activePersona).map((s) => ({
          label: `${s.submission_number} · ${s.subject}`,
          type: "Submission",
          path: `/intake/${s.id}`,
        }))
      : []),
  ]
    .filter((r) => q && r.label.toLowerCase().includes(q))
    .slice(0, 8);
  function go(path: string) {
    setOpen(false);
    setQuery("");
    navigate(path);
  }
  return (
    <div
      className="global-search"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <form
        className="topbar-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (results[0]) go(results[0].path);
        }}
      >
        <IconSearch />
        <input
          ref={input}
          aria-label="Search cases, institutions and records"
          placeholder="Search cases, institutions…"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
        <kbd className="search-kbd-pill">Ctrl K</kbd>
      </form>
      {open && q && (
        <div className="search-results" aria-label="Search results">
          {results.length ? (
            results.map((r) => (
              <button key={r.path} onClick={() => go(r.path)}>
                <small>{r.type}</small>
                <span>{r.label}</span>
              </button>
            ))
          ) : (
            <p>No matching records. Try a case number or institution name.</p>
          )}
        </div>
      )}
    </div>
  );
}
