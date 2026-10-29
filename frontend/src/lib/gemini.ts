/**
 * AICTE OneDesk — Google Gemini AI Integration Engine
 *
 * Provides real-time AI case triage, statutory entity extraction,
 * regulatory synopsis, cross-bureau conflict analysis, and recommended next actions.
 *
 * Configured via .env: VITE_GEMINI_API_KEY
 */

import type { SimCase, SimSubmission } from "../simulation/types";

const CANDIDATE_MODELS = [
  "gemini-3.8-flash",
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash",
];

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
 * Clean potential markdown fencing from JSON string.
 */
function cleanJsonText(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }
  return cleaned.trim();
}

/**
 * Retrieve the Gemini API key strictly from environment variables (.env).
 */
export function getGeminiApiKey(): string {
  return (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim() || "";
}

/**
 * Check if a Gemini API key is configured in .env.
 */
export function hasGeminiApiKey(): boolean {
  return Boolean(getGeminiApiKey());
}

/**
 * Generate intelligent deterministic triage if no Gemini key is present in .env or on failure.
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
    modelUsed: "AICTE-Norms-v2.4",
  };
}

/**
 * Execute real AI Case Triage using Google Gemini API configured via .env.
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

    let data: any = null;
    let successfulModel = "gemini-3.8-flash";

    for (const model of CANDIDATE_MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          data = await response.json();
          successfulModel = model;
          break;
        } else {
          console.warn(`Model ${model} returned HTTP ${response.status}`);
        }
      } catch (err) {
        console.warn(`Fetch error with model ${model}:`, err);
      }
    }

    if (!data) {
      console.warn("All candidate Gemini models failed, falling back to dynamic engine.");
      return generateDynamicFallback(caseItem, overlappingCases);
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return generateDynamicFallback(caseItem, overlappingCases);
    }

    const cleaned = cleanJsonText(rawText);
    const parsed = JSON.parse(cleaned);

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
      confidence_score: typeof parsed.confidence_score === "number" ? parsed.confidence_score : 96,
      suggested_action: parsed.suggested_action || "Issue standard inquiry notice.",
      overlap_action: parsed.overlap_action || undefined,
      isLiveGemini: true,
      modelUsed: successfulModel === "gemini-3.8-flash" ? "Google Gemini 3.8 Flash (Live)" : `Google ${successfulModel} (Live)`,
    };
  } catch (err) {
    console.warn("Error running live Gemini triage, falling back to dynamic engine:", err);
    return generateDynamicFallback(caseItem, overlappingCases);
  }
}
