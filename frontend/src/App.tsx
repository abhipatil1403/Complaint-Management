import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth } from "./auth/RequireAuth";
import { AppShell } from "./components/AppShell";
import { AdministrationPage } from "./pages/AdministrationPage";
import { BureauDetailPage } from "./pages/BureauDetailPage";
import { BureausPage } from "./pages/BureausPage";
import { HomePage } from "./pages/HomePage";
import { InstitutionDetailPage } from "./pages/InstitutionDetailPage";
import { InstitutionsPage } from "./pages/InstitutionsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { RegionsPage } from "./pages/RegionsPage";
import { SignInPage } from "./pages/SignInPage";
import { UserDetailPage } from "./pages/UserDetailPage";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<HomePage />} />
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
