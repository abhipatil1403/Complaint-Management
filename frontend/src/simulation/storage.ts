/**
 * AICTE OneDesk — Browser Persistence Layer
 *
 * Persists the entire simulation state to localStorage with fallback.
 * Also provides an IndexedDB store for binary attachments so large PDFs and images
 * remain preserved across full page reloads without exhausting storage quotas.
 */

import { sampleEvidencePdf } from "./evidenceFixture";
import {
  INITIAL_SIMULATED_CLOCK,
  SEED_ACCESS_GRANTS,
  SEED_BUREAU_MEMBERS,
  SEED_BUREAUS,
  SEED_CASES,
  SEED_CATEGORIES,
  SEED_DUPLICATE_CANDIDATES,
  SEED_ESCALATIONS,
  SEED_INSTITUTIONS,
  SEED_NOTIFICATIONS,
  SEED_PERSONAS,
  SEED_REGIONS,
  SEED_SUBMISSIONS,
  SEED_TRANSFERS,
  SEED_VERIFICATION_TASKS,
} from "./seedData";
import type { SimState } from "./types";

const STORAGE_KEY = "aicte_onedesk_simulation_v1";

/** Complete only missing fictional seed history; never replace a real submission. */
function completeSeedHistory(state: SimState): SimState {
  const ownSeed = state.submissions.find(
    (s) =>
      s.id === "sub-001" && s.complainant_email === "rahul.verma@example.com",
  );
  if (ownSeed && !ownSeed.submitter_reference)
    ownSeed.submitter_reference = "usr-007-complainant";
  for (const c of state.cases) {
    for (const attachment of c.attachments) {
      if (attachment.data_url === sampleEvidencePdf())
        attachment.file_size = atob(attachment.data_url.split(",")[1]).length;
    }
    if (state.submissions.some((s) => s.id === c.source_submission_id))
      continue;
    state.submissions.push({
      id: c.source_submission_id,
      submission_number: `ARCHIVE-${c.case_number}`,
      tracking_code: c.source_tracking_code || `ARCH-${c.case_number}`,
      channel: "aicte_portal",
      complainant_name: "Archived institution complainant",
      complainant_email: "archive@example.test",
      complainant_phone: "",
      complainant_category: "Citizen",
      institution_name_submitted: c.institution_name,
      institution_permanent_id_submitted: c.institution_code,
      matched_institution_id: c.institution_id,
      institution_verified: true,
      category_id: c.category_id,
      category_name: c.category_name,
      subject: c.title,
      description: c.description,
      language: "en",
      status: "canonical_case_created",
      canonical_case_id: c.case_id,
      canonical_case_number: c.case_number,
      attachments: [],
      received_at: c.opened_at,
      updated_at: c.updated_at,
    });
  }
  return state;
}

export function getInitialState(): SimState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SimState;
      if (parsed && parsed.cases && parsed.personas && parsed.institutions) {
        parsed.cases.forEach((c) =>
          c.attachments.forEach((a) => {
            if (a.data_url?.endsWith("...")) a.data_url = sampleEvidencePdf();
          }),
        );
        return completeSeedHistory(parsed);
      }
    }
  } catch (err) {
    console.warn(
      "Could not read simulation state from localStorage, using seeds.",
      err,
    );
  }

  return getPristineSeedState();
}

export function getPristineSeedState(): SimState {
  return completeSeedHistory({
    simulatedClock: INITIAL_SIMULATED_CLOCK,
    activePersonaKey: "super_admin",
    personas: JSON.parse(JSON.stringify(SEED_PERSONAS)),
    regions: JSON.parse(JSON.stringify(SEED_REGIONS)),
    bureaus: JSON.parse(JSON.stringify(SEED_BUREAUS)),
    bureauMembers: JSON.parse(JSON.stringify(SEED_BUREAU_MEMBERS)),
    institutions: JSON.parse(JSON.stringify(SEED_INSTITUTIONS)),
    categories: JSON.parse(JSON.stringify(SEED_CATEGORIES)),
    submissions: JSON.parse(JSON.stringify(SEED_SUBMISSIONS)),
    verificationTasks: JSON.parse(JSON.stringify(SEED_VERIFICATION_TASKS)),
    duplicateCandidates: JSON.parse(JSON.stringify(SEED_DUPLICATE_CANDIDATES)),
    cases: JSON.parse(JSON.stringify(SEED_CASES)),
    accessGrants: JSON.parse(JSON.stringify(SEED_ACCESS_GRANTS)),
    transfers: JSON.parse(JSON.stringify(SEED_TRANSFERS)),
    escalations: JSON.parse(JSON.stringify(SEED_ESCALATIONS)),
    notifications: JSON.parse(JSON.stringify(SEED_NOTIFICATIONS)),
  });
}

export function saveState(state: SimState): void {
  try {
    const snapshot = {
      ...state,
      cases: state.cases.map((c) => ({
        ...c,
        attachments: c.attachments.map((a) => ({
          ...a,
          data_url: a.attachment_id.startsWith("att-bin-") ? "" : a.data_url,
        })),
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (err) {
    console.warn("Failed to save simulation state to localStorage:", err);
  }
}

export function clearStoredState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn("Failed to clear simulation state:", err);
  }
}

// Simple IndexedDB wrapper for binary file payloads
const DB_NAME = "aicte_onedesk_files_db";
const STORE_NAME = "attachments";

function openFileDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function storeBinaryFile(
  id: string,
  dataUrl: string,
): Promise<void> {
  const db = await openFileDb();
  if (!db) {
    try {
      sessionStorage.setItem(`file_${id}`, dataUrl);
    } catch {
      // ignore
    }
    return;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put({ id, dataUrl, storedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getBinaryFile(id: string): Promise<string | null> {
  const db = await openFileDb();
  if (!db) {
    return sessionStorage.getItem(`file_${id}`) ?? null;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        resolve(
          req.result
            ? req.result.dataUrl
            : (sessionStorage.getItem(`file_${id}`) ?? null),
        );
      };
      req.onerror = () => {
        resolve(sessionStorage.getItem(`file_${id}`) ?? null);
      };
    } catch {
      resolve(sessionStorage.getItem(`file_${id}`) ?? null);
    }
  });
}
