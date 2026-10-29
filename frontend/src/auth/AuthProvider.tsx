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

import { ApiClient, ApiError, IS_PROTOTYPE_MODE, toApiError } from "../lib/api";
import {
  apiBaseUrl,
  readStoredBureau,
  supabase,
  supabaseConfigured,
  writeStoredBureau,
} from "../lib/supabase";
import { simulationStore } from "../simulation/simulationStore";
import type { Persona } from "../simulation/types";
import type { MeResponse } from "../types";

export type AuthStatus =
  | "loading"
  | "signed_out"
  | "no_profile"
  | "ready"
  | "error";

export interface AuthContextValue {
  status: AuthStatus;
  me: MeResponse | null;
  error: ApiError | null;
  api: ApiClient;
  has: (permission: string) => boolean;
  isSuperAdmin: boolean;
  selectBureau: (bureauId: string | null) => Promise<void>;
  signOut: () => Promise<void>;
  signInPersona: (personaKey: string) => Promise<void>;
  switchPersona: (personaKey: string) => void;
  activePersona: Persona;
  personas: Record<string, Persona>;
  simulatedClock: string;
  advanceTime: (days: number) => void;
  resetTime: () => void;
  resetData: () => void;
  reload: () => void;
  configured: boolean;
  isPrototype: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [status, setStatus] = useState<AuthStatus>(() =>
    IS_PROTOTYPE_MODE && sessionStorage.getItem("onedesk-signed-out") === "true"
      ? "signed_out"
      : "loading",
  );
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [activeBureauId, setActiveBureauId] = useState<string | null>(() =>
    readStoredBureau(),
  );
  const [reloadCounter, setReloadCounter] = useState(0);
  const [simState, setSimState] = useState(() => simulationStore.getState());

  const bureauRef = useRef<string | null>(activeBureauId);
  bureauRef.current = activeBureauId;

  const sessionRef = useRef<Session | null>(session);
  sessionRef.current = session;

  // Listen to simulationStore updates
  useEffect(() => {
    if (!IS_PROTOTYPE_MODE) return;
    const unsub = simulationStore.subscribe(() => {
      setSimState({ ...simulationStore.getState() });
      setReloadCounter((v) => v + 1);
    });
    return unsub;
  }, []);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: apiBaseUrl,
        getAccessToken: async () => {
          if (IS_PROTOTYPE_MODE) {
            return "simulated-prototype-jwt-token";
          }
          if (sessionRef.current?.access_token) {
            return sessionRef.current.access_token;
          }
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
    if (IS_PROTOTYPE_MODE) {
      setBootstrapped(true);
      return;
    }
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
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession((current) => {
          if (
            current?.access_token === nextSession?.access_token &&
            current?.user?.id === nextSession?.user?.id
          ) {
            return current;
          }
          return nextSession;
        });
      },
    );
    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const meRef = useRef<MeResponse | null>(me);
  useEffect(() => {
    meRef.current = me;
  }, [me]);

  useEffect(() => {
    if (!bootstrapped) {
      return;
    }

    if (IS_PROTOTYPE_MODE) {
      if (status === "signed_out") {
        return;
      }
      let cancelled = false;
      async function loadSimulatedProfile() {
        try {
          const nextMe = await api.get<MeResponse>("/me");
          if (cancelled) return;
          setMe(nextMe);
          setError(null);
          setStatus("ready");
        } catch (raw) {
          if (cancelled) return;
          setError(toApiError(raw));
          setStatus("error");
        }
      }
      void loadSimulatedProfile();
      return () => {
        cancelled = true;
      };
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
      if (!meRef.current) {
        setStatus("loading");
      }
      try {
        const nextMe = await api.get<MeResponse>(
          "/me",
          undefined,
          requestedBureau,
        );
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
        if (
          apiError.code === "BUREAU_CONTEXT_DENIED" &&
          requestedBureau !== null
        ) {
          writeStoredBureau(null);
          setActiveBureauId(null);
          return;
        }
        if (apiError.status === 401) {
          await supabase!.auth.signOut();
          return;
        }
        if (!meRef.current) {
          setMe(null);
          setError(apiError);
          setStatus(
            apiError.code === "ACCOUNT_NOT_PROVISIONED" ||
              apiError.code === "ACCOUNT_INACTIVE"
              ? "no_profile"
              : "error",
          );
        }
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [
    api,
    activeBureauId,
    bootstrapped,
    reloadCounter,
    session,
    simState.activePersonaKey,
  ]);

  const has = useCallback(
    (permission: string) =>
      IS_PROTOTYPE_MODE
        ? simulationStore.getActivePersona().permissions.includes(permission)
        : (me?.permissions.includes(permission) ?? false),
    [me],
  );

  const selectBureau = useCallback(async (bureauId: string | null) => {
    writeStoredBureau(bureauId);
    bureauRef.current = bureauId;
    setActiveBureauId(bureauId);
  }, []);

  const switchPersona = useCallback((personaKey: string) => {
    sessionStorage.removeItem("onedesk-signed-out");
    simulationStore.switchPersona(personaKey);
    setStatus("ready");
    setReloadCounter((v) => v + 1);
  }, []);

  const signInPersona = useCallback(async (personaKey: string) => {
    sessionStorage.removeItem("onedesk-signed-out");
    simulationStore.switchPersona(personaKey);
    setStatus("ready");
    setReloadCounter((v) => v + 1);
  }, []);

  const signOut = useCallback(async () => {
    sessionStorage.setItem("onedesk-signed-out", "true");
    if (!IS_PROTOTYPE_MODE && supabase) {
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

  const advanceTime = useCallback((days: number) => {
    simulationStore.advanceSimulatedClock(days);
  }, []);

  const resetTime = useCallback(() => {
    simulationStore.resetSimulatedClock();
  }, []);

  const resetData = useCallback(() => {
    simulationStore.resetPresentationData();
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
      signInPersona,
      switchPersona,
      activePersona: simulationStore.getActivePersona(),
      personas: simState.personas,
      simulatedClock: simState.simulatedClock,
      advanceTime,
      resetTime,
      resetData,
      reload,
      configured: true,
      isPrototype: IS_PROTOTYPE_MODE,
    }),
    [
      api,
      error,
      has,
      me,
      reload,
      selectBureau,
      signOut,
      signInPersona,
      switchPersona,
      status,
      simState,
      advanceTime,
      resetTime,
      resetData,
    ],
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
