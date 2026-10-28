import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const supabaseConfigured = Boolean(url && anonKey);

/** Supabase Auth is the only identity system. The anon key is public by design. */
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;

export const apiBaseUrl = (
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://127.0.0.1:8000/api/v1"
).replace(/\/$/, "");

export const ACTIVE_BUREAU_STORAGE_KEY = "aicte-onedesk.active-bureau";

export function readStoredBureau(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_BUREAU_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredBureau(bureauId: string | null): void {
  try {
    if (bureauId) {
      window.localStorage.setItem(ACTIVE_BUREAU_STORAGE_KEY, bureauId);
    } else {
      window.localStorage.removeItem(ACTIVE_BUREAU_STORAGE_KEY);
    }
  } catch {
    // Storage is optional; the in-memory context still works for this tab.
  }
}
