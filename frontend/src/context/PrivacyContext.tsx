import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  PRIVACY_MASK_ACCOUNT_NAMES_KEY,
  PRIVACY_MODE_KEY,
  readStoredBoolean,
  writeStoredBoolean,
} from "../lib/privacy";

type PrivacyContextValue = {
  privacyMode: boolean;
  maskAccountNames: boolean;
  setPrivacyMode: (enabled: boolean) => void;
  setMaskAccountNames: (enabled: boolean) => void;
};

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [privacyMode, setPrivacyModeState] = useState(() =>
    readStoredBoolean(PRIVACY_MODE_KEY, false),
  );
  const [maskAccountNames, setMaskAccountNamesState] = useState(() =>
    readStoredBoolean(PRIVACY_MASK_ACCOUNT_NAMES_KEY, false),
  );

  const setPrivacyMode = useCallback((enabled: boolean) => {
    setPrivacyModeState(enabled);
    writeStoredBoolean(PRIVACY_MODE_KEY, enabled);
  }, []);

  const setMaskAccountNames = useCallback((enabled: boolean) => {
    setMaskAccountNamesState(enabled);
    writeStoredBoolean(PRIVACY_MASK_ACCOUNT_NAMES_KEY, enabled);
  }, []);

  const value = useMemo(
    () => ({
      privacyMode,
      maskAccountNames,
      setPrivacyMode,
      setMaskAccountNames,
    }),
    [privacyMode, maskAccountNames, setPrivacyMode, setMaskAccountNames],
  );

  return (
    <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>
  );
}

export function usePrivacy() {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error("usePrivacy must be used inside PrivacyProvider");
  return ctx;
}
