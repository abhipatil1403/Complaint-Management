import { useEffect, useState } from "react";

import { toApiError, type ApiError } from "./api";
import { publicApi } from "./intake";
import type { DemoInfo } from "../types";

/** Loads the public demo flags and the approved simulation notices. */
export function useDemoInfo() {
  const [info, setInfo] = useState<DemoInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const next = await publicApi.get<DemoInfo>("/demo/info");
        if (!cancelled) {
          setInfo(next);
          setError(null);
        }
      } catch (raw) {
        if (!cancelled) {
          setError(toApiError(raw));
          setInfo(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { info, loading, error };
}
