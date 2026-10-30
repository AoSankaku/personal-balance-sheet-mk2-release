import { useLocalStorage } from "@mantine/hooks";
import {
  KOTORA_AUTO_MASK_STORAGE_KEY,
  parseKotoraAutoMaskPreference,
} from "../lib/csvTransferPrivacy";

/** This is a browser preference, shared by CSV import and CSV settings. */
export function useKotoraAutoMask() {
  return useLocalStorage<boolean>({
    key: KOTORA_AUTO_MASK_STORAGE_KEY,
    defaultValue: false,
    getInitialValueInEffect: false,
    deserialize: parseKotoraAutoMaskPreference,
    serialize: (value) => String(value === true),
  });
}
