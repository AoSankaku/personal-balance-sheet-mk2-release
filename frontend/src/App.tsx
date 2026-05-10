import { AppShell } from "@mantine/core";
import { Routes, Route } from "react-router-dom";
import { TopNav } from "./components/TopNav";
import { BottomNav } from "./components/BottomNav";
import OverviewPage from "./pages/OverviewPage";
import InputPage from "./pages/InputPage";
import AssetsPage from "./pages/AssetsPage";
import BsPage from "./pages/BsPage";
import PlPage from "./pages/PlPage";
import CryptoPage from "./pages/CryptoPage";
import LedgerPage from "./pages/LedgerPage";
import SettingsPage from "./pages/SettingsPage";
import BudgetSettingsPage from "./pages/BudgetSettingsPage";
import BulkEditPage from "./pages/BulkEditPage";
import InitialBalancePage from "./pages/InitialBalancePage";
import CsvSettingsPage from "./pages/CsvSettingsPage";
import BusinessSettingsPage from "./pages/BusinessSettingsPage";
import DangerZonePage from "./pages/DangerZonePage";
import GuidesPage from "./pages/GuidesPage";
import ExportPage from "./pages/ExportPage";
import CurrencySettingsPage from "./pages/CurrencySettingsPage";
import TtPage from "./pages/TtPage";
import DbPage from "./pages/DbPage";
import SvPage from "./pages/SvPage";
import LongTermLoanDetailPage from "./pages/LongTermLoanDetailPage";
import { FeedbackHost } from "./components/FeedbackHost";
import { useAppData } from "./context/AppDataContext";
export default function App() {
  const { enabledCurrencies, enabledCurrenciesLoaded } = useAppData();
  const needsCurrencySetup =
    enabledCurrenciesLoaded && enabledCurrencies.length === 0;

  return (
    <AppShell
      header={{ height: 60 }}
      footer={{ height: { base: 64, sm: 0 } }}
      padding="md"
    >
      <AppShell.Header>
        <TopNav />
      </AppShell.Header>

      <AppShell.Main>
        <FeedbackHost />
        {!enabledCurrenciesLoaded ? null : needsCurrencySetup ? (
          <CurrencySettingsPage initialSetup />
        ) : (
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/input" element={<InputPage />} />
            <Route path="/fs" element={<AssetsPage />} />
            <Route path="/fs/bs" element={<BsPage />} />
            <Route path="/fs/pl" element={<PlPage />} />
            <Route path="/fs/crypto" element={<CryptoPage />} />
            <Route path="/fs/tt" element={<TtPage />} />
            <Route path="/fs/db" element={<DbPage />} />
            <Route
              path="/fs/db/long-term-loan/:id"
              element={<LongTermLoanDetailPage kind="loan" />}
            />
            <Route
              path="/fs/db/long-term-lend/:id"
              element={<LongTermLoanDetailPage kind="lend" />}
            />
            <Route path="/fs/sv" element={<SvPage />} />
            <Route path="/ledger" element={<LedgerPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/budget" element={<BudgetSettingsPage />} />
            <Route path="/settings/bulk_edit" element={<BulkEditPage />} />
            <Route
              path="/settings/initial_balance"
              element={<InitialBalancePage />}
            />
            <Route path="/settings/csv" element={<CsvSettingsPage />} />
            <Route
              path="/settings/business"
              element={<BusinessSettingsPage />}
            />
            <Route path="/settings/danger" element={<DangerZonePage />} />
            <Route path="/settings/guides" element={<GuidesPage />} />
            <Route path="/settings/export" element={<ExportPage />} />
            <Route
              path="/settings/currencies"
              element={<CurrencySettingsPage />}
            />
          </Routes>
        )}
      </AppShell.Main>

      <AppShell.Footer hiddenFrom="sm">
        <BottomNav />
      </AppShell.Footer>
    </AppShell>
  );
}
