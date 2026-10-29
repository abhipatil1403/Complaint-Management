import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { IconCheck, IconClose } from "./Icons";

interface WalkthroughStep {
  step: number;
  title: string;
  personaKey: string;
  personaName: string;
  route: string;
  description: string;
}

const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    step: 1,
    title: "Complainant Login",
    personaKey: "complainant",
    personaName: "Rahul Verma (Public Complainant)",
    route: "/demo/aicte",
    description: "Switch to Complainant persona and open the AICTE Public Portal.",
  },
  {
    step: 2,
    title: "Submit Complaint",
    personaKey: "complainant",
    personaName: "Rahul Verma",
    route: "/demo/aicte",
    description: "Fill the complaint form against an institution (e.g. DTU or COEP) with an attachment.",
  },
  {
    step: 3,
    title: "Receive Tracking Code",
    personaKey: "complainant",
    personaName: "Rahul Verma",
    route: "/demo/aicte",
    description: "Receive submission reference and tracking code (e.g. AICTE-TRK-XXXX).",
  },
  {
    step: 4,
    title: "Intake Reviewer Context",
    personaKey: "super_admin",
    personaName: "Rajesh Sharma (Super Admin)",
    route: "/intake",
    description: "Switch to Super Admin and inspect the received submission in the Intake queue.",
  },
  {
    step: 5,
    title: "Institution Verification",
    personaKey: "super_admin",
    personaName: "Rajesh Sharma",
    route: "/verification",
    description: "Open the Verification queue and confirm or correct institution identification.",
  },
  {
    step: 6,
    title: "Duplicate Review",
    personaKey: "bureau_admin",
    personaName: "Dr. Anita Desai (Bureau Admin)",
    route: "/duplicate-review",
    description: "Review potential duplicate candidates with side-by-side signal comparison.",
  },
  {
    step: 7,
    title: "Create Canonical Case",
    personaKey: "bureau_admin",
    personaName: "Dr. Anita Desai",
    route: "/cases",
    description: "Formally create canonical case (e.g. CASE-2026-000088) with SLA deadline.",
  },
  {
    step: 8,
    title: "Bureau Admin Workspace",
    personaKey: "bureau_admin",
    personaName: "Dr. Anita Desai",
    route: "/cases",
    description: "Open the Approval Bureau case queue in table or Kanban view.",
  },
  {
    step: 9,
    title: "Assign Case to Officer",
    personaKey: "bureau_admin",
    personaName: "Dr. Anita Desai",
    route: "/cases/case-001",
    description: "Assign lead case officer Vikram Singh to the case.",
  },
  {
    step: 10,
    title: "Switch to Case Officer",
    personaKey: "case_officer",
    personaName: "Vikram Singh (Case Officer)",
    route: "/cases/case-001",
    description: "Switch to assigned case officer Vikram Singh to inspect the work queue.",
  },
  {
    step: 11,
    title: "Review Case & Attachments",
    personaKey: "case_officer",
    personaName: "Vikram Singh",
    route: "/cases/case-001",
    description: "Examine intake details, download attachment, and inspect audit timeline.",
  },
  {
    step: 12,
    title: "Add Notes & Evidence",
    personaKey: "case_officer",
    personaName: "Vikram Singh",
    route: "/cases/case-001",
    description: "Add a shared note or bureau-private internal review note and upload evidence.",
  },
  {
    step: 13,
    title: "Transition Case Status",
    personaKey: "case_officer",
    personaName: "Vikram Singh",
    route: "/cases/case-001",
    description: "Change status to 'Under Review' or 'In Progress' with verified justification.",
  },
  {
    step: 14,
    title: "Request Cross-Bureau Access",
    personaKey: "collaborator",
    personaName: "Priya Nair (Policy Bureau)",
    route: "/cases/case-001",
    description: "Switch to Policy Bureau and request cross-bureau collaborate access.",
  },
  {
    step: 15,
    title: "Approve Access Grant",
    personaKey: "bureau_admin",
    personaName: "Dr. Anita Desai",
    route: "/cases/case-001",
    description: "Switch back to Bureau Admin to approve the 30-day cross-bureau grant.",
  },
  {
    step: 16,
    title: "Case Transfer Workflow",
    personaKey: "bureau_admin",
    personaName: "Dr. Anita Desai",
    route: "/cases/case-002",
    description: "Request case transfer to Vigilance Cell with penal inquiry reason.",
  },
  {
    step: 17,
    title: "Trigger SLA Breach (Time Machine)",
    personaKey: "bureau_admin",
    personaName: "Dr. Anita Desai",
    route: "/",
    description: "Use Simulated Clock controller to fast-forward +15 days and cause SLA breach.",
  },
  {
    step: 18,
    title: "Escalation & Notification Alert",
    personaKey: "senior_mgmt",
    personaName: "Prof. T. G. Sitharam (Chairman)",
    route: "/analytics",
    description: "Inspect generated notifications and Level 2/3 breach escalations.",
  },
  {
    step: 19,
    title: "Resolve Case",
    personaKey: "case_officer",
    personaName: "Vikram Singh",
    route: "/cases/case-001",
    description: "Transition case to 'Resolved' with resolution documentation and evidence.",
  },
  {
    step: 20,
    title: "Review Dashboard & Reports",
    personaKey: "super_admin",
    personaName: "Rajesh Sharma",
    route: "/",
    description: "Inspect updated KPI counters, Kanban columns, charts, and export CSV.",
  },
  {
    step: 21,
    title: "Complainant Verification",
    personaKey: "complainant",
    personaName: "Rahul Verma",
    route: "/demo/aicte",
    description: "Switch to Complainant and verify real-time updated complaint tracking status.",
  },
];

export function PresentationGuide() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const { switchPersona } = useAuth();
  const navigate = useNavigate();

  const activeStepObj = WALKTHROUGH_STEPS[currentStep - 1];

  const handleExecuteStep = (stepObj: WalkthroughStep) => {
    switchPersona(stepObj.personaKey);
    navigate(stepObj.route);
    setCurrentStep(stepObj.step);
  };

  return (
    <div className="presentation-guide-wrap">
      <button
        type="button"
        className="btn-presentation-guide"
        onClick={() => setIsOpen(!isOpen)}
        title="SIH 2026 Jury Presentation Flow (21 Steps)"
      >
        <span className="guide-dot" />
        <strong>SIH 21-Step Demo Guide</strong>
        <span className="guide-step-pill">Step {currentStep} of 21</span>
      </button>

      {isOpen && (
        <div className="presentation-guide-modal" onClick={(e) => e.stopPropagation()}>
          <div className="guide-header">
            <div>
              <h3>SIH Jury Walkthrough Guide</h3>
              <p className="small muted">
                Interactive step-by-step walkthrough demonstrating the full complaint lifecycle without backend dependencies.
              </p>
            </div>
            <button
              type="button"
              className="btn-icon-close"
              onClick={() => setIsOpen(false)}
            >
              <IconClose className="w-4 h-4" />
            </button>
          </div>

          <div className="guide-active-card">
            <div className="guide-step-num">Step {activeStepObj.step} of 21</div>
            <h4>{activeStepObj.title}</h4>
            <p>{activeStepObj.description}</p>
            <div className="guide-meta-row">
              <span className="badge badge-persona">Persona: {activeStepObj.personaName}</span>
              <span className="badge badge-route">Route: {activeStepObj.route}</span>
            </div>
            <div className="guide-btn-row">
              <button
                type="button"
                className="button button-primary"
                onClick={() => handleExecuteStep(activeStepObj)}
              >
                Go to Step {activeStepObj.step} (Switch Persona &amp; Route)
              </button>
              {currentStep < 21 && (
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => {
                    const next = currentStep + 1;
                    setCurrentStep(next);
                    handleExecuteStep(WALKTHROUGH_STEPS[next - 1]);
                  }}
                >
                  Next Step &rarr;
                </button>
              )}
            </div>
          </div>

          <div className="guide-steps-scroll">
            <ol className="guide-stepper">
              {WALKTHROUGH_STEPS.map((s) => (
                <li
                  key={s.step}
                  className={`stepper-item ${s.step === currentStep ? "active" : ""} ${s.step < currentStep ? "completed" : ""}`}
                  onClick={() => handleExecuteStep(s)}
                >
                  <span className="stepper-bubble">
                    {s.step < currentStep ? <IconCheck className="w-3 h-3" /> : s.step}
                  </span>
                  <div className="stepper-info">
                    <strong>{s.title}</strong>
                    <small>{s.personaName}</small>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
