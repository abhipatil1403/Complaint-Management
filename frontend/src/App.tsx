import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth } from "./auth/RequireAuth";
import { AppShell } from "./components/AppShell";
import { AdministrationPage } from "./pages/AdministrationPage";
import { BureauDetailPage } from "./pages/BureauDetailPage";
import { BureausPage } from "./pages/BureausPage";
import { CaseDetailPage } from "./pages/CaseDetailPage";
import { CasesPage } from "./pages/CasesPage";
import { DemoHomePage } from "./pages/DemoHomePage";
import { DemoIntakePage } from "./pages/DemoIntakePage";
import { DuplicateReviewDetailPage } from "./pages/DuplicateReviewDetailPage";
import { DuplicateReviewQueuePage } from "./pages/DuplicateReviewQueuePage";
import { HomePage } from "./pages/HomePage";
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
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/demo" element={<DemoHomePage />} />
          <Route path="/demo/aicte" element={<DemoIntakePage portal="aicte" />} />
          <Route path="/demo/cpgrams" element={<DemoIntakePage portal="cpgrams" />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<HomePage />} />
              <Route path="verification" element={<VerificationPage />} />
              <Route path="verification/tasks/:taskId" element={<VerificationDetailPage />} />
              <Route path="duplicate-review" element={<DuplicateReviewQueuePage />} />
              <Route
                path="duplicate-review/candidates/:candidateId"
                element={<DuplicateReviewDetailPage />}
              />
              <Route path="cases" element={<CasesPage />} />
              <Route path="cases/:caseId" element={<CaseDetailPage />} />
              <Route path="intake" element={<IntakePage />} />
              <Route path="intake/:submissionId" element={<IntakeDetailPage />} />
              <Route path="institutions" element={<InstitutionsPage />} />
              <Route path="institutions/:institutionId" element={<InstitutionDetailPage />} />
              <Route path="bureaus" element={<BureausPage />} />
              <Route path="bureaus/:bureauId" element={<BureauDetailPage />} />
              <Route path="regions" element={<RegionsPage />} />
              <Route path="administration" element={<AdministrationPage />} />
              <Route path="administration/users/:userId" element={<UserDetailPage />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
