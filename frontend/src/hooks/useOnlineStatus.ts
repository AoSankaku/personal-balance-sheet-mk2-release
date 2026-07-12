import { useEffect, useState } from "react";

function getOnlineStatus() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(getOnlineStatus);

  useEffect(() => {
    const update = () => setIsOnline(getOnlineStatus());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return isOnline;
}
