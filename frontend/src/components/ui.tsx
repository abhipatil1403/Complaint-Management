import type { ReactNode } from "react";

import { describeError, type ApiError } from "../lib/api";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Loading({ label = "Loading..." }: { label?: string }) {
  return (
    <p className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  );
}

export function ErrorPanel({
  error,
  title = "Something went wrong",
}: {
  error: ApiError | null;
  title?: string;
}) {
  if (!error) {
    return null;
  }
  return (
    <div className="error-panel" role="alert">
      <strong>{title}</strong>
      <p>{describeError(error)}</p>
      <p className="error-meta">
        <span className="code">{error.code}</span>
        {error.requestId ? <span>Request {error.requestId}</span> : null}
      </p>
      {error.details.length > 0 ? (
        <ul>
          {error.details.map((detail, index) => (
            <li key={`${detail.field ?? "field"}-${index}`}>
              {detail.field ? <strong>{detail.field}: </strong> : null}
              {detail.issue ?? "Invalid value"}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

const KNOWN_BADGES = new Set([
  "active",
  "inactive",
  "suspended",
  "verified",
  "pending",
  "rejected",
  "revoked",
  "expired",
  "global",
  "bureau",
]);

export function StatusBadge({ value, label }: { value: string; label?: string }) {
  const tone = KNOWN_BADGES.has(value) ? value : "neutral";
  return <span className={`badge badge-${tone}`}>{label ?? value.replace(/_/g, " ")}</span>;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
}
