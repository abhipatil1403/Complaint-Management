import { useCallback, useEffect, useRef, useState } from "react";

import { useSimulationRevision } from "../simulation/selectors";
import { useAuth } from "../auth/AuthProvider";
import { type ApiError, type QueryParams, toApiError } from "./api";
import type { Page } from "../types";

// In-memory cache across navigations to eliminate visible reloading spinners on revisit
export const resourceCache = new Map<string, unknown>();
export const pagedCache = new Map<string, { items: unknown[]; cursor: string | null }>();

export function seedResourceCache(path: string, item: unknown): void {
  resourceCache.set(path, item);
}

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

/** Cursor-paginated list with realtime background refresh and navigation caching. */
export function usePagedResource<T>(
  path: string,
  params: QueryParams = {},
  options: ResourceOptions = {},
): PagedResource<T> {
  const { api, activePersona } = useAuth();
  const revision = useSimulationRevision();
  const enabled = options.enabled ?? true;
  const paramsKey = JSON.stringify(params);
  const cacheKey = `${activePersona.key}:${path}?${paramsKey}`;

  const cached = pagedCache.get(cacheKey);
  const [items, setItems] = useState<T[]>(cached ? (cached.items as T[]) : []);
  const [cursor, setCursor] = useState<string | null>(cached ? cached.cursor : null);
  const [loading, setLoading] = useState(enabled && !cached);
  const [error, setError] = useState<ApiError | null>(null);

  // Sync state synchronously if cacheKey changes
  const prevKeyRef = useRef(cacheKey);
  if (prevKeyRef.current !== cacheKey) {
    prevKeyRef.current = cacheKey;
    const hit = pagedCache.get(cacheKey);
    setItems(hit ? (hit.items as T[]) : []);
    setCursor(hit ? hit.cursor : null);
    setLoading(enabled && !hit);
    setError(null);
  }

  const inFlightRef = useRef(false);
  const currentKeyRef = useRef(cacheKey);
  currentKeyRef.current = cacheKey;

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const fetchPage = useCallback(
    async (nextCursor: string | null, append: boolean, silent = false) => {
      if (!enabled) {
        setItems([]);
        setCursor(null);
        setLoading(false);
        return;
      }
      if (inFlightRef.current && silent) {
        return;
      }
      const targetKey = cacheKey;
      inFlightRef.current = true;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const fetchLimit = append
          ? 25
          : Math.min(Math.max(itemsRef.current.length, 25), 100);

        const rawPage = await api.get<Page<T> | T[]>(path, {
          ...params,
          cursor: nextCursor ?? undefined,
          limit: fetchLimit,
        });

        // Only discard if the user navigated to different filters/path
        if (currentKeyRef.current !== targetKey) {
          return;
        }

        // Support both enveloped { data: T[], page: { next_cursor: ... } } and raw array T[]
        const pageData: T[] = Array.isArray(rawPage)
          ? rawPage
          : Array.isArray((rawPage as Page<T>)?.data)
            ? (rawPage as Page<T>).data
            : [];

        const nextCursorVal: string | null = Array.isArray(rawPage)
          ? null
          : ((rawPage as Page<T>)?.page?.next_cursor ?? null);

        if (append) {
          setItems((prev) => [...prev, ...pageData]);
          setCursor(nextCursorVal);
        } else {
          const currentStr = JSON.stringify(itemsRef.current);
          const newStr = JSON.stringify(pageData);
          if (currentStr !== newStr) {
            setItems(pageData);
          }
          setCursor(nextCursorVal);
          pagedCache.set(targetKey, { items: pageData, cursor: nextCursorVal });
        }
        setError(null);
        return true;
      } catch (raw) {
        if (currentKeyRef.current !== targetKey) {
          return false;
        }
        if (!silent) {
          setError(toApiError(raw));
        }
        return false;
      } finally {
        inFlightRef.current = false;
        if (currentKeyRef.current === targetKey && !silent) {
          setLoading(false);
        }
      }
    },
    [api, enabled, path, paramsKey, cacheKey, revision],
  );

  // Background refresh sequenced with setTimeout so requests never race or overlap
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let timerId: number | undefined;
    let active = true;

    async function poll() {
      if (!active) return;
      const ok = await fetchPage(null, false, true);
      if (active && ok) {
        timerId = window.setTimeout(poll, 15000);
      }
    }

    void fetchPage(null, false, Boolean(cached)).then((ok) => {
      if (active && ok) {
        timerId = window.setTimeout(poll, 15000);
      }
    });

    return () => {
      active = false;
      window.clearTimeout(timerId);
    };
  }, [enabled, fetchPage]);

  return {
    items,
    loading,
    error,
    hasMore: cursor !== null,
    reload: async () => {
      await fetchPage(null, false, false);
    },
    loadMore: async () => {
      await fetchPage(cursor, true, false);
    },
  };
}

interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => Promise<void>;
}

/** Single resource fetched from a path such as `/institutions/<id>` with realtime background refresh. */
export function useResource<T>(path: string | null): Resource<T> {
  const { api, activePersona } = useAuth();
  const revision = useSimulationRevision();
  const cachePath = `${activePersona.key}:${path}`;
  const cached = path ? (resourceCache.get(cachePath) as T | undefined) : undefined;

  const [data, setData] = useState<T | null>(cached ?? null);
  const [loading, setLoading] = useState(Boolean(path) && !cached);
  const [error, setError] = useState<ApiError | null>(null);

  // Sync state synchronously if path changes
  const prevPathRef = useRef(cachePath);
  if (prevPathRef.current !== cachePath) {
    prevPathRef.current = cachePath;
    const hit = path ? (resourceCache.get(cachePath) as T | undefined) : undefined;
    setData(hit ?? null);
    setLoading(Boolean(path) && !hit);
    setError(null);
  }

  const inFlightRef = useRef(false);
  const currentPathRef = useRef(path);
  currentPathRef.current = path;

  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const load = useCallback(
    async (silent = false) => {
      if (!path) {
        setData(null);
        setLoading(false);
        return;
      }
      if (inFlightRef.current && silent) {
        return;
      }
      const targetPath = path;
      inFlightRef.current = true;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const result = await api.get<T>(path);
        if (currentPathRef.current !== targetPath) {
          return;
        }
        const currentStr = JSON.stringify(dataRef.current);
        const newStr = JSON.stringify(result);
        if (currentStr !== newStr) {
          setData(result);
        }
        resourceCache.set(cachePath, structuredClone(result));
        setError(null);
        return true;
      } catch (raw) {
        if (currentPathRef.current !== targetPath) {
          return false;
        }
        setError(toApiError(raw));
        setData(null);
        return false;
      } finally {
        inFlightRef.current = false;
        if (currentPathRef.current === targetPath && !silent) {
          setLoading(false);
        }
      }
    },
    [api, path, cachePath, revision],
  );

  // Background refresh sequenced with setTimeout so requests never race or overlap
  useEffect(() => {
    if (!path) {
      return;
    }
    let timerId: number | undefined;
    let active = true;

    async function poll() {
      if (!active) return;
      const ok = await load(true);
      if (active && ok) {
        timerId = window.setTimeout(poll, 15000);
      }
    }

    void load(Boolean(cached)).then((ok) => {
      if (active && ok) {
        timerId = window.setTimeout(poll, 15000);
      }
    });

    return () => {
      active = false;
      window.clearTimeout(timerId);
    };
  }, [path, load]);

  return {
    data,
    loading,
    error,
    reload: async () => {
      await load(false);
    },
  };
}
