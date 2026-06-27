import { useEffect } from "react";
import { checkForNewAppVersion } from "../lib/appVersion";

const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function useVersionUpdateMonitor() {
  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        if (!cancelled) await checkForNewAppVersion();
      } catch {
        // Version checks must never interrupt normal app usage.
      }
    }

    void check();
    const intervalId = window.setInterval(check, VERSION_CHECK_INTERVAL_MS);

    function checkWhenVisible() {
      if (document.visibilityState === "visible") void check();
    }

    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", checkWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, []);
}
