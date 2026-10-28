import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import { type ApiError, type QueryParams, toApiError } from "./api";
import type { Page } from "../types";

interface PagedResource<T> {
  items: T[];
  loading: boolean;
  error: ApiError | null;
  hasMore: boolean;
  reload: () => Promise<void>;
  loadMore: () => Promise<void>;
}

interface ResourceOptions {
  /** Skips the request when the caller's capability is not granted. */
  enabled?: boolean;
}

/** Cursor-paginated list with explicit "load more" semantics. */
export function usePagedResource<T>(
  path: string,
  params: QueryParams = {},
  options: ResourceOptions = {},
): PagedResource<T> {
  const { api } = useAuth();
  const enabled = options.enabled ?? true;
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<ApiError | null>(null);
  const generation = useRef(0);
  const paramsKey = JSON.stringify(params);

  const fetchPage = useCallback(
    async (nextCursor: string | null, append: boolean) => {
      if (!enabled) {
        setItems([]);
        setCursor(null);
        setLoading(false);
        return;
      }
      const run = ++generation.current;
      setLoading(true);
      setError(null);
      try {
        const page = await api.get<Page<T>>(path, {
          ...params,
          cursor: nextCursor ?? undefined,
          limit: 25,
        });
        if (run !== generation.current) {
          return;
        }
        setItems((previous) => (append ? [...previous, ...page.data] : page.data));
        setCursor(page.page.next_cursor);
      } catch (raw) {
        if (run !== generation.current) {
          return;
        }
        setError(toApiError(raw));
      } finally {
        if (run === generation.current) {
          setLoading(false);
        }
      }
    },
    // paramsKey captures the parameter object for dependency purposes.
    [api, enabled, path, paramsKey],
  );

  useEffect(() => {
    void fetchPage(null, false);
  }, [fetchPage]);

  return {
    items,
    loading,
    error,
    hasMore: cursor !== null,
    reload: () => fetchPage(null, false),
    loadMore: () => fetchPage(cursor, true),
  };
}

interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => Promise<void>;
}

/** Single resource fetched from a path such as `/institutions/<id>`. */
export function useResource<T>(path: string | null): Resource<T> {
  const { api } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<ApiError | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    const run = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<T>(path);
      if (run !== generation.current) {
        return;
      }
      setData(result);
    } catch (raw) {
      if (run !== generation.current) {
        return;
      }
      setError(toApiError(raw));
      setData(null);
    } finally {
      if (run === generation.current) {
        setLoading(false);
      }
    }
  }, [api, path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: load };
}
