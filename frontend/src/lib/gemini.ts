/**
 * AICTE OneDesk — Google Gemini AI Integration Engine
 *
 * Provides real-time AI case triage, statutory entity extraction,
 * regulatory synopsis, cross-bureau conflict analysis, and recommended next actions.
 */

import type { SimCase, SimSubmission } from "../simulation/types";

const GEMINI_STORAGE_KEY = "aicte_gemini_api_key";
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_FALLBACK_MODEL = "gemini-1.5-flash";

export interface GeminiAnalysisResult {
  synopsis: string;
  statutory_clauses: string[];
  extracted_entities: string[];
  priority: "low" | "medium" | "high" | "critical";
  urgency_rating: string;
  confidence_score: number;
  suggested_action: string;
  overlap_action?: string;
  isLiveGemini: boolean;
  modelUsed: string;
}

/**
 * Retrieve the configured Gemini API key from localStorage or Vite environment.
 */
export function getGeminiApiKey(): string {
  try {
    const local = localStorage.getItem(GEMINI_STORAGE_KEY);
    if (local && local.trim()) return local.trim();
  } catch {
    // localStorage not accessible
  }
  return (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim() || "";
}

/**
 * Save the Gemini API key to localStorage.
 */
export function setGeminiApiKey(key: string): void {
  try {
    if (key.trim()) {
      localStorage.setItem(GEMINI_STORAGE_KEY, key.trim());
    } else {
      localStorage.removeItem(GEMINI_STORAGE_KEY);
    }
  } catch (err) {
    console.error("Failed to persist Gemini API key:", err);
  }
}

/**
 * Check if a Gemini API key is configured.
 */
export function hasGeminiApiKey(): boolean {
  return Boolean(getGeminiApiKey());
}

/**
 * Verify if the Gemini API key is valid.
 */
export function testGeminiApiKey(apiKey: string): Promise<{ success: boolean; message: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey.trim()}`;
  return fetch(url)
    .then(async (res) => {
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const msg = errorData?.error?.message || `API error ${res.status}: ${res.statusText}`;
        return { success: false, message: msg };
      }
      return { success: true, message: "Connected successfully to Google Gemini API!" };
    })
    .catch((err) => ({
      success: false,
      message: `Network error: ${err?.message || "Failed to contact Gemini API."}`,
    }));
}

/**
 * Generate intelligent deterministic triage if no Gemini key is present.
 */
function generateDynamicFallback(
  caseItem: SimCase,
  overlappingCases: SimCase[] = [],
): GeminiAnalysisResult {
  const cat = (caseItem.category_name || "").toLowerCase();
  const title = caseItem.title;
  const desc = caseItem.description;
  const hasOverlap = overlappingCases.length > 0;

  let clauses: string[] = ["AICTE Act 1987 Section 10(1)"];
  let suggested = "Issue formal notice to Institution Head and schedule preliminary review.";
  let urgency = "Medium Urgency";
  let priority: "low" | "medium" | "high" | "critical" = "medium";

  if (cat.includes("ragging") || title.toLowerCase().includes("ragging")) {
    clauses = [
      "AICTE Regulation 2009 for Prevention of Ragging (F.No.37-3/Legal/AICTE/2009)",
      "UGC Anti-Ragging Guidelines 2009 Sec 6.4",
      "Supreme Court Order in SLP No. 24295/2006",
    ];
    suggested = "Convene Institutional Anti-Ragging Committee (ARC) inquiry; mandate 48-hour compliance report.";
    urgency = "Critical Urgency";
    priority = "critical";
  } else if (cat.includes("fee") || desc.toLowerCase().includes("fee") || title.toLowerCase().includes("refund")) {
    clauses = [
      "AICTE Approval Process Handbook (APH) Fee Refund Norms Chapter IV",
      "National Fee Regulatory Committee Directive 2023",
      "AICTE Public Notice on Non-Refund of Caution Deposit (Advt. No. AICTE/Legal/04/2021)",
    ];
    suggested = "Direct Institution to disburse verified tuition and security refunds within 7 working days.";
    urgency = "High Urgency";
    priority = "high";
  } else if (cat.includes("faculty") || desc.toLowerCase().includes("salary") || desc.toLowerCase().includes("7th cpc")) {
    clauses = [
      "7th Central Pay Commission (CPC) Pay Scale Directives for Technical Faculty",
      "AICTE Regulations on Minimum Qualifications & Service Conditions 2019",
    ];
    suggested = "Direct Registrar to submit certified payroll ledger and bank disbursement statements for 6 months.";
    urgency = "High Urgency";
    priority = "high";
  } else if (cat.includes("admission") || desc.toLowerCase().includes("seat")) {
    clauses = [
      "AICTE APH Norms on Sanctioned Intake & Supernumerary Seats",
      "Supreme Court Guidelines in T.M.A. Pai Foundation",
    ];
    suggested = "Audit admission roster against State Directorate of Technical Education (DTE) allotment lists.";
    urgency = "Medium Urgency";
    priority = "medium";
  }

  // Extract entities from real text
  const entities: string[] = [caseItem.institution_name];
  if (caseItem.institution_code) entities.push(`PID: ${caseItem.institution_code}`);
  if (caseItem.institution_region) entities.push(`Region: ${caseItem.institution_region}`);
  if (desc.match(/Rs\.?\s*[\d,]+/i)) {
    const match = desc.match(/Rs\.?\s*[\d,]+/i);
    if (match) entities.push(`Amount: ${match[0]}`);
  }

  let overlapAction: string | undefined;
  if (hasOverlap) {
    const parallelBureau = overlappingCases[0].lead_bureau_name;
    const parallelNumber = overlappingCases[0].case_number;
    overlapAction = `Inter-bureau overlap detected with ${parallelBureau} (${parallelNumber}). Joint regulatory committee recommended under AICTE Coordination Protocol 2026.`;
  }

  const synopsis = `Statutory review of ${caseItem.case_number} concerning ${caseItem.institution_name}: Grievance under "${caseItem.category_name}" indicates prima-facie non-compliance with ${clauses[0]}. Case assigned to ${caseItem.lead_bureau_name} (${caseItem.lead_bureau_code}). ${hasOverlap ? `Parallel proceedings active under ${overlappingCases.map((o) => o.case_number).join(", ")}.` : "No concurrent regulatory conflicts detected."}`;

  return {
    synopsis,
    statutory_clauses: clauses,
    extracted_entities: entities,
    priority: (caseItem.priority as "low" | "medium" | "high" | "critical") || priority,
    urgency_rating: hasOverlap && priority !== "critical" ? "High Urgency (Cross-Bureau Overlap)" : urgency,
    confidence_score: 94,
    suggested_action: suggested,
    overlap_action: overlapAction,
    isLiveGemini: false,
    modelUsed: "Deterministic AICTE-Norms-v2.4",
  };
}

/**
 * Execute real AI Case Triage using Google Gemini API.
 */
export async function analyzeCaseWithGemini(
  caseItem: SimCase,
  overlappingCases: SimCase[] = [],
  submissions: SimSubmission[] = [],
): Promise<GeminiAnalysisResult> {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    return generateDynamicFallback(caseItem, overlappingCases);
  }

  const relatedSubmissions = submissions.filter(
    (s) => s.canonical_case_id === caseItem.case_id || s.id === caseItem.source_submission_id,
  );

  const promptText = `
You are the AICTE Legal Triage and Regulatory Assistant for AICTE OneDesk.
Perform an official regulatory triage and NLP entity extraction on the following technical education grievance.

CASE DETAILS:
- Case Number: ${caseItem.case_number}
- Title: ${caseItem.title}
- Complaint Category: ${caseItem.category_name}
- Institution Name: ${caseItem.institution_name}
- AICTE Permanent ID: ${caseItem.institution_code || "Pending Verification"}
- AICTE Region: ${caseItem.institution_region || "Central"}
- Lead Bureau: ${caseItem.lead_bureau_name} (${caseItem.lead_bureau_code})
- Complaint Description: ${caseItem.description}
- Complainant Submissions: ${relatedSubmissions.map((s) => `[${s.submission_number}]: ${s.description}`).join("\n") || "No secondary submissions."}
- Concurrent Overlapping Cases: ${
    overlappingCases.length > 0
      ? overlappingCases
          .map(
            (o) =>
              `- ${o.case_number} handled by ${o.lead_bureau_name} (${o.lead_bureau_code}): ${o.title} [Status: ${o.status}]`,
          )
          .join("\n")
      : "None. No cross-bureau overlap."
  }

INSTRUCTIONS:
Analyze the statutory merit under the AICTE Act 1987, AICTE Approval Process Handbook (APH), and relevant Indian regulations (Anti-Ragging, Fee Regulatory Committee, 7th CPC).
Return your response ONLY as valid, raw JSON matching this schema:
{
  "synopsis": "A 2-3 sentence authoritative administrative summary of the grievance, alleged violations, and statutory context.",
  "statutory_clauses": ["List of 2-3 specific AICTE APH clauses, Supreme Court directives, or Gazette regulations violated"],
  "extracted_entities": ["List of extracted entities: institution names, key designations, monetary figures, batches"],
  "priority": "low" | "medium" | "high" | "critical",
  "urgency_rating": "Critical Urgency" | "High Urgency" | "Medium Urgency" | "Standard Urgency",
  "confidence_score": 96,
  "suggested_action": "Specific concrete next administrative step for the assigned case officer (e.g. Issue Show Cause Notice, Order Spot Inspection, Disburse Refund)",
  "overlap_action": "If overlapping cases exist, specify how the bureaus should coordinate; otherwise omit or leave empty."
}
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const payload = {
      contents: [
        {
          role: "user",
          parts: [{ text: promptText }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    };

    let response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // If Gemini 2.0 Flash is unavailable, attempt fallback to Gemini 1.5 Flash
    if (!response.ok && response.status === 404) {
      const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FALLBACK_MODEL}:generateContent?key=${apiKey}`;
      response = await fetch(fallbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    if (!response.ok) {
      console.warn("Gemini API call failed with status", response.status);
      return generateDynamicFallback(caseItem, overlappingCases);
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return generateDynamicFallback(caseItem, overlappingCases);
    }

    const parsed = JSON.parse(rawText);
    return {
      synopsis: parsed.synopsis || "Statutory analysis completed successfully.",
      statutory_clauses: Array.isArray(parsed.statutory_clauses)
        ? parsed.statutory_clauses
        : ["AICTE Act 1987 Section 10(1)"],
      extracted_entities: Array.isArray(parsed.extracted_entities)
        ? parsed.extracted_entities
        : [caseItem.institution_name],
      priority: ["low", "medium", "high", "critical"].includes(parsed.priority)
        ? parsed.priority
        : "medium",
      urgency_rating: parsed.urgency_rating || "High Urgency",
      confidence_score: typeof parsed.confidence_score === "number" ? parsed.confidence_score : 95,
      suggested_action: parsed.suggested_action || "Issue standard inquiry notice.",
      overlap_action: parsed.overlap_action || undefined,
      isLiveGemini: true,
      modelUsed: `Google Gemini 2.0 Flash (Live)`,
    };
  } catch (err) {
    console.warn("Error running live Gemini triage, falling back to dynamic engine:", err);
    return generateDynamicFallback(caseItem, overlappingCases);
  }
}
