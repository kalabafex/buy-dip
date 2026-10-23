import { Navigate, Route, Routes } from "react-router-dom";
import { ElevationProvider } from "@/components/auth/ElevationProvider";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppLayout } from "@/components/layout/AppLayout";
import { BacktestPage } from "@/pages/Backtest";
import { DashboardPage } from "@/pages/Dashboard";
import { LoginPage } from "@/pages/Login";
import { PicksPage } from "@/pages/Picks";
import { PicksEnginePage } from "@/pages/PicksEngine";
import { PicksModelPage } from "@/pages/PicksModel";
import { PicksPerformancePage } from "@/pages/PicksPerformance";
import { RecommendationsPage } from "@/pages/Recommendations";
import { RuleDetailPage } from "@/pages/RuleDetail";
import { RuleEditPage } from "@/pages/RuleEdit";
import { RulesPage } from "@/pages/Rules";
import { SettingsPage } from "@/pages/Settings";

export function App() {
  return (
    <ElevationProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<PicksPage />} />
            <Route path="picks" element={<Navigate to="/" replace />} />
            <Route path="picks/performance" element={<PicksPerformancePage />} />
            <Route path="picks/model" element={<PicksModelPage />} />
            <Route path="picks/engine" element={<PicksEnginePage />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="rules" element={<RulesPage />} />
            <Route path="rules/new" element={<RuleEditPage />} />
            <Route path="rules/:id" element={<RuleDetailPage />} />
            <Route path="rules/:id/edit" element={<RuleEditPage />} />
            <Route path="recommendations" element={<RecommendationsPage />} />
            <Route path="backtest" element={<BacktestPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ElevationProvider>
  );
}
