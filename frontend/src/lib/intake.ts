/** Helpers and the anonymous client for the simulated intake portals. */

import { PublicApiClient } from "./api";
import { apiBaseUrl } from "./supabase";
import type { DemoChannel, DemoPortal, IntakeLanguage } from "../types";

/** No token is ever attached to these calls; the routes are public by design. */
export const publicApi = new PublicApiClient(apiBaseUrl);

export const INTAKE_STATUS_LABELS: Record<string, string> = {
  received: "Received",
  awaiting_institution_verification: "Awaiting institution verification",
  awaiting_duplicate_review: "Awaiting duplicate review",
  ready_for_case_creation: "Ready for case creation",
  associated_with_case: "Associated with a case",
  rejected: "Rejected",
};

export function intakeStatusLabel(value: string): string {
  return INTAKE_STATUS_LABELS[value] ?? value.replace(/_/g, " ");
}

export function languageLabel(value: string): string {
  return value === "hi" ? "Hindi" : value === "en" ? "English" : value;
}

export const PORTAL_PATHS: Record<DemoPortal, string> = {
  aicte: "/demo/aicte",
  cpgrams: "/demo/cpgrams",
};

export function channelForPortal(
  channels: DemoChannel[],
  portal: DemoPortal,
): DemoChannel | undefined {
  return channels.find((channel) => channel.portal === portal);
}

export function portalLabel(portal: DemoPortal): string {
  return portal === "aicte" ? "Simulated AICTE portal" : "Simulated CPGRAMS intake";
}

/** One key per form session, so an unchanged resubmission is a replay. */
export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function currentSourceTimestamp(now: Date = new Date()): string {
  return now.toISOString();
}

export function formatDateTime(value: string | null | undefined): string {
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
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function noticeForLanguage(
  language: IntakeLanguage,
  notices: { en: string | null; hi: string | null },
): string {
  return (language === "hi" ? notices.hi : notices.en) ?? "";
}
