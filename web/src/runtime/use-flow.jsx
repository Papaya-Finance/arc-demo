import { useEffect, useRef, useState } from "react";
import { browserStorage, writeStored } from "./storage.mjs";

/** Callers key the component by wallet scope, so a session cannot leak across accounts. */
export function usePersistedFlow(key, restore, progress, rows) {
  const [flow, setFlow] = useState(() => {
    const saved = restore(browserStorage(), key);
    if (saved && progress(saved, rows).phase !== "success") return saved;
    writeStored(browserStorage(), key, null);
    return null;
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const save = (next) => {
    writeStored(browserStorage(), key, next);
    if (mounted.current) setFlow(next);
  };
  return { flow, save, mounted };
}
