import { BrowserRouter, Route, Routes } from "react-router-dom";

import { DialogAccessibility } from "./components/DialogAccessibility";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth } from "./auth/RequireAuth";
import { AppShell } from "./components/AppShell";
import { AdministrationPage } from "./pages/AdministrationPage";
import { BureauDetailPage } from "./pages/BureauDetailPage";
import { BureausPage } from "./pages/BureausPage";
import { HelpPage } from "./pages/HelpPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { CaseDetailPage } from "./pages/CaseDetailPage";
import { CasesPage } from "./pages/CasesPage";
import { DemoHomePage } from "./pages/DemoHomePage";
import { DemoIntakePage } from "./pages/DemoIntakePage";
import { DuplicateReviewDetailPage } from "./pages/DuplicateReviewDetailPage";
import { DuplicateReviewQueuePage } from "./pages/DuplicateReviewQueuePage";
import {
  RoleLandingPage,
  ReviewWorkspace,
  DecisionsPage,
  EscalationWorkspace,
  AuditDashboard,
} from "./pages/RoleLandingPage";
import { ComplainantPage } from "./pages/ComplainantPage";
import { InstitutionDetailPage } from "./pages/InstitutionDetailPage";
import { InstitutionsPage } from "./pages/InstitutionsPage";
import { IntakeDetailPage } from "./pages/IntakeDetailPage";
import { IntakePage } from "./pages/IntakePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { RegionsPage } from "./pages/RegionsPage";
import { SignInPage } from "./pages/SignInPage";
import { UserDetailPage } from "./pages/UserDetailPage";
import { VerificationDetailPage } from "./pages/VerificationDetailPage";
import { VerificationPage } from "./pages/VerificationPage";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <DialogAccessibility />
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/demo" element={<DemoHomePage />} />
          <Route
            path="/demo/aicte"
            element={<DemoIntakePage key="aicte" portal="aicte" />}
          />
          <Route
            path="/demo/cpgrams"
            element={<DemoIntakePage key="cpgrams" portal="cpgrams" />}
          />
          <Route element={<RequireAuth />}>
            <Route path="portal" element={<ComplainantPage />} />
            <Route element={<AppShell />}>
              <Route index element={<RoleLandingPage />} />
              <Route
                path="workspaces/verification"
                element={<ReviewWorkspace kind="verification" />}
              />
              <Route
                path="workspaces/duplicate-review"
                element={<ReviewWorkspace kind="duplicates" />}
              />
              <Route path="decisions" element={<DecisionsPage />} />
              <Route
                path="access-requests"
                element={<DecisionsPage accessOnly />}
              />
              <Route path="escalations" element={<EscalationWorkspace />} />
              <Route path="audit-log" element={<AuditDashboard />} />
              <Route path="verification" element={<VerificationPage />} />
              <Route
                path="verification/tasks/:taskId"
                element={<VerificationDetailPage />}
              />
              <Route
                path="duplicate-review"
                element={<DuplicateReviewQueuePage />}
              />
              <Route
                path="duplicate-review/candidates/:candidateId"
                element={<DuplicateReviewDetailPage />}
              />
              <Route path="cases" element={<CasesPage />} />
              <Route path="cases/:caseId" element={<CaseDetailPage />} />
              <Route path="help" element={<HelpPage />} />
              <Route
                path="settings"
                element={<SettingsPage key={window.location.pathname} />}
              />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route
                path="track"
                element={<DemoIntakePage key="aicte" portal="aicte" />}
              />
              <Route path="intake" element={<IntakePage />} />
              <Route
                path="intake/:submissionId"
                element={<IntakeDetailPage />}
              />
              <Route path="institutions" element={<InstitutionsPage />} />
              <Route
                path="institutions/:institutionId"
                element={<InstitutionDetailPage />}
              />
              <Route path="bureaus" element={<BureausPage />} />
              <Route path="bureaus/:bureauId" element={<BureauDetailPage />} />
              <Route path="regions" element={<RegionsPage />} />
              <Route path="administration" element={<AdministrationPage />} />
              <Route
                path="administration/users/:userId"
                element={<UserDetailPage />}
              />
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
