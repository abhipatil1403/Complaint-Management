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

  const generation = useRef(0);
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
      const run = ++generation.current;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const fetchLimit = append
          ? 25
          : Math.min(Math.max(itemsRef.current.length, 25), 100);

        const page = await api.get<Page<T>>(path, {
          ...params,
          cursor: nextCursor ?? undefined,
          limit: fetchLimit,
        });

        if (run !== generation.current) {
          return;
        }

        // Pre-populate individual detail items into resourceCache so navigating to any detail page is instant
        const cleanPath = path.split("?")[0].replace(/\/+$/, "");
        for (const rawItem of page.data) {
          if (
            rawItem &&
            typeof rawItem === "object" &&
            "id" in rawItem &&
            typeof (rawItem as { id: unknown }).id === "string"
          ) {
            const itemId = (rawItem as { id: string }).id;
            resourceCache.set(`${cleanPath}/${itemId}`, rawItem);
          }
        }

        if (append) {
          setItems((prev) => [...prev, ...page.data]);
          setCursor(page.page.next_cursor);
        } else {
          const currentStr = JSON.stringify(itemsRef.current);
          const newStr = JSON.stringify(page.data);
          if (currentStr !== newStr) {
            setItems(page.data);
          }
          setCursor(page.page.next_cursor);
          pagedCache.set(cacheKey, { items: page.data, cursor: page.page.next_cursor });
        }
      } catch (raw) {
        if (run !== generation.current) {
          return;
        }
        if (!silent) {
          setError(toApiError(raw));
        }
      } finally {
        if (run === generation.current && !silent) {
          setLoading(false);
        }
      }
    },
    [api, enabled, path, paramsKey, cacheKey],
  );

  useEffect(() => {
    void fetchPage(null, false, Boolean(cached));
  }, [fetchPage]);

  // Realtime background refresh every 1 second (silent, no visible spinner)
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const timer = setInterval(() => {
      void fetchPage(null, false, true);
    }, 1000);
    return () => clearInterval(timer);
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

  const generation = useRef(0);
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
      const run = ++generation.current;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const result = await api.get<T>(path);
        if (run !== generation.current) {
          return;
        }
        const currentStr = JSON.stringify(dataRef.current);
        const newStr = JSON.stringify(result);
        if (currentStr !== newStr) {
          setData(result);
        }
        resourceCache.set(path, result);
      } catch (raw) {
        if (run !== generation.current) {
          return;
        }
        if (!silent) {
          setError(toApiError(raw));
          setData(null);
        }
      } finally {
        if (run === generation.current && !silent) {
          setLoading(false);
        }
      }
    },
    [api, path],
  );

  useEffect(() => {
    void load(Boolean(cached));
  }, [load]);

  // Realtime background refresh every 1 second (silent, no visible spinner)
  useEffect(() => {
    if (!path) {
      return;
    }
    const timer = setInterval(() => {
      void load(true);
    }, 1000);
    return () => clearInterval(timer);
  }, [path, load]);

  return { data, loading, error, reload: () => load(false) };
}
