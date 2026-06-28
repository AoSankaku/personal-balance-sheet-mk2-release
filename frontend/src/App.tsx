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
import LanguageSetupPage from "./pages/LanguageSetupPage";
import { FeedbackHost } from "./components/FeedbackHost";
import { HardReloadPrompt } from "./components/HardReloadPrompt";
import { PageTitle } from "./components/PageTitle";
import { useAppData } from "./context/AppDataContext";
import { useVersionUpdateMonitor } from "./hooks/useVersionUpdateMonitor";
import { useLang } from "./i18n";
import { usePrivacy } from "./context/PrivacyContext";
import { PrivacyModeBlocked } from "./components/PrivacyModeBlocked";
export default function App() {
  useVersionUpdateMonitor();
  const { enabledCurrencies, enabledCurrenciesLoaded } = useAppData();
  const { hasExplicitLocale } = useLang();
  const { privacyMode } = usePrivacy();
  const needsCurrencySetup =
    enabledCurrenciesLoaded && enabledCurrencies.length === 0;
  const needsLanguageSetup = needsCurrencySetup && !hasExplicitLocale;
  const inInitialSetupFlow = needsLanguageSetup || needsCurrencySetup;
  const overrideTitleKey = needsLanguageSetup
    ? "languageLabel"
    : needsCurrencySetup
      ? "currencySettingsInitialSetupTitle"
      : null;

  return (
    <AppShell
      header={{ height: 60 }}
      footer={{ height: { base: 64, md: 0 } }}
      padding="md"
    >
      <AppShell.Header>
        <TopNav
          disableNavigation={inInitialSetupFlow}
          disableTasks={inInitialSetupFlow}
        />
      </AppShell.Header>

      <AppShell.Main>
        <PageTitle overrideTitleKey={overrideTitleKey} />
        <FeedbackHost />
        <HardReloadPrompt />
        {!enabledCurrenciesLoaded ? null : needsLanguageSetup ? (
          <LanguageSetupPage />
        ) : needsCurrencySetup ? (
          <CurrencySettingsPage initialSetup />
        ) : (
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route
              path="/input"
              element={privacyMode ? <PrivacyModeBlocked /> : <InputPage />}
            />
            <Route path="/fs" element={<AssetsPage />} />
            <Route path="/fs/bs" element={<BsPage />} />
            <Route path="/fs/pl" element={<PlPage />} />
            <Route path="/fs/crypto" element={<CryptoPage />} />
            <Route
              path="/fs/tt"
              element={privacyMode ? <PrivacyModeBlocked /> : <TtPage />}
            />
            <Route
              path="/fs/db"
              element={privacyMode ? <PrivacyModeBlocked /> : <DbPage />}
            />
            <Route
              path="/fs/db/long-term-loan/:id"
              element={
                privacyMode ? (
                  <PrivacyModeBlocked />
                ) : (
                  <LongTermLoanDetailPage kind="loan" />
                )
              }
            />
            <Route
              path="/fs/db/long-term-lend/:id"
              element={
                privacyMode ? (
                  <PrivacyModeBlocked />
                ) : (
                  <LongTermLoanDetailPage kind="lend" />
                )
              }
            />
            <Route path="/fs/sv" element={<SvPage />} />
            <Route path="/ledger" element={<LedgerPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route
              path="/settings/budget"
              element={
                privacyMode ? <PrivacyModeBlocked /> : <BudgetSettingsPage />
              }
            />
            <Route
              path="/settings/bulk_edit"
              element={privacyMode ? <PrivacyModeBlocked /> : <BulkEditPage />}
            />
            <Route
              path="/settings/initial_balance"
              element={
                privacyMode ? <PrivacyModeBlocked /> : <InitialBalancePage />
              }
            />
            <Route
              path="/settings/csv"
              element={
                privacyMode ? <PrivacyModeBlocked /> : <CsvSettingsPage />
              }
            />
            <Route
              path="/settings/business"
              element={
                privacyMode ? <PrivacyModeBlocked /> : <BusinessSettingsPage />
              }
            />
            <Route
              path="/settings/danger"
              element={
                privacyMode ? <PrivacyModeBlocked /> : <DangerZonePage />
              }
            />
            <Route path="/settings/guides" element={<GuidesPage />} />
            <Route
              path="/settings/export"
              element={privacyMode ? <PrivacyModeBlocked /> : <ExportPage />}
            />
            <Route
              path="/settings/currencies"
              element={
                privacyMode ? <PrivacyModeBlocked /> : <CurrencySettingsPage />
              }
            />
          </Routes>
        )}
      </AppShell.Main>

      <AppShell.Footer hiddenFrom="md">
        <BottomNav disableNavigation={inInitialSetupFlow} />
      </AppShell.Footer>
    </AppShell>
  );
}
