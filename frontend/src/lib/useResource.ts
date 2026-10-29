import { useCallback, useEffect, useRef, useState } from "react";

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
  const { api } = useAuth();
  const enabled = options.enabled ?? true;
  const paramsKey = JSON.stringify(params);
  const cacheKey = `${path}?${paramsKey}`;

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

        // Pre-populate individual detail items into resourceCache so navigating to any detail page is instant
        const cleanPath = path.split("?")[0].replace(/\/+$/, "");
        for (const rawItem of pageData) {
          if (rawItem && typeof rawItem === "object") {
            const itemObj = rawItem as Record<string, unknown>;
            const itemId =
              (typeof itemObj.id === "string" && itemObj.id) ||
              (typeof itemObj.case_id === "string" && itemObj.case_id);
            if (itemId) {
              resourceCache.set(`${cleanPath}/${itemId}`, rawItem);
            }
          }
        }

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
      } catch (raw) {
        if (currentKeyRef.current !== targetKey) {
          return;
        }
        if (!silent) {
          setError(toApiError(raw));
        }
      } finally {
        inFlightRef.current = false;
        if (currentKeyRef.current === targetKey && !silent) {
          setLoading(false);
        }
      }
    },
    [api, enabled, path, paramsKey, cacheKey],
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
      await fetchPage(null, false, true);
      if (active) {
        timerId = window.setTimeout(poll, 1000);
      }
    }

    void fetchPage(null, false, Boolean(cached));
    timerId = window.setTimeout(poll, 1000);

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
    reload: () => fetchPage(null, false, false),
    loadMore: () => fetchPage(cursor, true, false),
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
  const { api } = useAuth();
  const cached = path ? (resourceCache.get(path) as T | undefined) : undefined;

  const [data, setData] = useState<T | null>(cached ?? null);
  const [loading, setLoading] = useState(Boolean(path) && !cached);
  const [error, setError] = useState<ApiError | null>(null);

  // Sync state synchronously if path changes
  const prevPathRef = useRef(path);
  if (prevPathRef.current !== path) {
    prevPathRef.current = path;
    const hit = path ? (resourceCache.get(path) as T | undefined) : undefined;
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
        resourceCache.set(targetPath, result);
        setError(null);
      } catch (raw) {
        if (currentPathRef.current !== targetPath) {
          return;
        }
        if (!silent) {
          setError(toApiError(raw));
          setData(null);
        }
      } finally {
        inFlightRef.current = false;
        if (currentPathRef.current === targetPath && !silent) {
          setLoading(false);
        }
      }
    },
    [api, path],
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
      await load(true);
      if (active) {
        timerId = window.setTimeout(poll, 1000);
      }
    }

    void load(Boolean(cached));
    timerId = window.setTimeout(poll, 1000);

    return () => {
      active = false;
      window.clearTimeout(timerId);
    };
  }, [path, load]);

  return { data, loading, error, reload: () => load(false) };
}
