import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";

import { ApiClient, ApiError, toApiError } from "../lib/api";
import {
  apiBaseUrl,
  readStoredBureau,
  supabase,
  supabaseConfigured,
  writeStoredBureau,
} from "../lib/supabase";
import type { MeResponse } from "../types";

export type AuthStatus = "loading" | "signed_out" | "no_profile" | "ready" | "error";

export interface AuthContextValue {
  status: AuthStatus;
  me: MeResponse | null;
  error: ApiError | null;
  api: ApiClient;
  has: (permission: string) => boolean;
  isSuperAdmin: boolean;
  selectBureau: (bureauId: string | null) => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => void;
  configured: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [activeBureauId, setActiveBureauId] = useState<string | null>(() => readStoredBureau());
  const [reloadCounter, setReloadCounter] = useState(0);

  const bureauRef = useRef<string | null>(activeBureauId);
  bureauRef.current = activeBureauId;

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: apiBaseUrl,
        getAccessToken: async () => {
          if (!supabase) {
            return null;
          }
          const { data } = await supabase.auth.getSession();
          return data.session?.access_token ?? null;
        },
        getActiveBureau: () => bureauRef.current,
      }),
    [],
  );

  useEffect(() => {
    if (!supabase) {
      setBootstrapped(true);
      return;
    }
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) {
        return;
      }
      setSession(data.session ?? null);
      setBootstrapped(true);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!bootstrapped) {
      return;
    }
    if (!supabaseConfigured || !supabase) {
      setMe(null);
      setError(
        new ApiError(
          0,
          "CONFIGURATION_REQUIRED",
          "Supabase Auth is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
        ),
      );
      setStatus("error");
      return;
    }
    if (!session) {
      setMe(null);
      setError(null);
      setStatus("signed_out");
      return;
    }

    let cancelled = false;
    const requestedBureau = activeBureauId;

    async function loadProfile() {
      setStatus("loading");
      try {
        const nextMe = await api.get<MeResponse>("/me", undefined, requestedBureau);
        if (cancelled) {
          return;
        }
        setMe(nextMe);
        setError(null);
        setStatus("ready");
        const normalizedBureau = nextMe.active_bureau_id;
        if (normalizedBureau !== requestedBureau) {
          writeStoredBureau(normalizedBureau);
          setActiveBureauId(normalizedBureau);
        }
      } catch (raw) {
        if (cancelled) {
          return;
        }
        const apiError = toApiError(raw);
        if (apiError.code === "BUREAU_CONTEXT_DENIED" && requestedBureau !== null) {
          // The stored bureau is no longer a membership: fall back to no context.
          writeStoredBureau(null);
          setActiveBureauId(null);
          return;
        }
        if (apiError.status === 401) {
          await supabase!.auth.signOut();
          return;
        }
        setMe(null);
        setError(apiError);
        setStatus(
          apiError.code === "ACCOUNT_NOT_PROVISIONED" || apiError.code === "ACCOUNT_INACTIVE"
            ? "no_profile"
            : "error",
        );
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [api, activeBureauId, bootstrapped, reloadCounter, session]);

  const has = useCallback(
    (permission: string) => me?.permissions.includes(permission) ?? false,
    [me],
  );

  const selectBureau = useCallback(async (bureauId: string | null) => {
    writeStoredBureau(bureauId);
    bureauRef.current = bureauId;
    setActiveBureauId(bureauId);
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    writeStoredBureau(null);
    bureauRef.current = null;
    setActiveBureauId(null);
    setMe(null);
    setError(null);
    setSession(null);
    setStatus("signed_out");
  }, []);

  const reload = useCallback(() => setReloadCounter((value) => value + 1), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      me,
      error,
      api,
      has,
      isSuperAdmin: me?.is_super_admin ?? false,
      selectBureau,
      signOut,
      reload,
      configured: supabaseConfigured,
    }),
    [api, error, has, me, reload, selectBureau, signOut, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
