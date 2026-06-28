import { AppShell, Skeleton, Stack } from "@mantine/core";
import { Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import { TopNav } from "./components/TopNav";
import { BottomNav } from "./components/BottomNav";
import { FeedbackHost } from "./components/FeedbackHost";
import { HardReloadPrompt } from "./components/HardReloadPrompt";
import { PageTitle } from "./components/PageTitle";
import { useAppData } from "./context/AppDataContext";
import { useVersionUpdateMonitor } from "./hooks/useVersionUpdateMonitor";
import { useLang } from "./i18n";
import { usePrivacy } from "./context/PrivacyContext";
import { PrivacyModeBlocked } from "./components/PrivacyModeBlocked";

const OverviewPage = lazy(() => import("./pages/OverviewPage"));
const InputPage = lazy(() => import("./pages/InputPage"));
const AssetsPage = lazy(() => import("./pages/AssetsPage"));
const BsPage = lazy(() => import("./pages/BsPage"));
const PlPage = lazy(() => import("./pages/PlPage"));
const CryptoPage = lazy(() => import("./pages/CryptoPage"));
const LedgerPage = lazy(() => import("./pages/LedgerPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const BudgetSettingsPage = lazy(() => import("./pages/BudgetSettingsPage"));
const BulkEditPage = lazy(() => import("./pages/BulkEditPage"));
const InitialBalancePage = lazy(() => import("./pages/InitialBalancePage"));
const CsvSettingsPage = lazy(() => import("./pages/CsvSettingsPage"));
const BusinessSettingsPage = lazy(() => import("./pages/BusinessSettingsPage"));
const DangerZonePage = lazy(() => import("./pages/DangerZonePage"));
const GuidesPage = lazy(() => import("./pages/GuidesPage"));
const ExportPage = lazy(() => import("./pages/ExportPage"));
const CurrencySettingsPage = lazy(() => import("./pages/CurrencySettingsPage"));
const TtPage = lazy(() => import("./pages/TtPage"));
const DbPage = lazy(() => import("./pages/DbPage"));
const SvPage = lazy(() => import("./pages/SvPage"));
const LongTermLoanDetailPage = lazy(
  () => import("./pages/LongTermLoanDetailPage"),
);
const LanguageSetupPage = lazy(() => import("./pages/LanguageSetupPage"));

function PageFallback() {
  return (
    <Stack gap="md">
      <Skeleton height={36} width={220} radius="sm" />
      <Skeleton height={120} radius="md" />
      <Skeleton height={240} radius="md" />
    </Stack>
  );
}

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
        <Suspense fallback={<PageFallback />}>
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
                element={
                  privacyMode ? <PrivacyModeBlocked /> : <BulkEditPage />
                }
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
                  privacyMode ? (
                    <PrivacyModeBlocked />
                  ) : (
                    <BusinessSettingsPage />
                  )
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
                  privacyMode ? (
                    <PrivacyModeBlocked />
                  ) : (
                    <CurrencySettingsPage />
                  )
                }
              />
            </Routes>
          )}
        </Suspense>
      </AppShell.Main>

      <AppShell.Footer hiddenFrom="md">
        <BottomNav disableNavigation={inInitialSetupFlow} />
      </AppShell.Footer>
    </AppShell>
  );
}
