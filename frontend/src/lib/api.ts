/** Typed client for the FastAPI service.
 *
 * The browser never talks to PostgreSQL and never holds a service-role key.
 * Every call sends the Supabase access token, plus the selected bureau context
 * when one is active. The API and PostgreSQL both re-check authorization.
 */

export interface ApiErrorDetail {
  field?: string;
  issue?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[];
  readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    details: ApiErrorDetail[] = [],
    requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  if (error instanceof Error) {
    return new ApiError(0, "NETWORK_ERROR", error.message || "The API could not be reached.");
  }
  return new ApiError(0, "NETWORK_ERROR", "The API could not be reached.");
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  signal?: AbortSignal;
  /** Explicit override: undefined uses the active bureau, null omits the header. */
  bureauId?: string | null;
}

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  getActiveBureau: () => string | null;
}

function buildQuery(params?: QueryParams): string {
  if (!params) {
    return "";
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getAccessToken: () => Promise<string | null>;
  private readonly getActiveBureau: () => string | null;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.getAccessToken = options.getAccessToken;
    this.getActiveBureau = options.getActiveBureau;
  }

  get<T>(path: string, params?: QueryParams, bureauId?: string | null): Promise<T> {
    return this.request<T>(`${path}${buildQuery(params)}`, { bureauId });
  }

  post<T>(path: string, body?: unknown, bureauId?: string | null): Promise<T> {
    return this.request<T>(path, { method: "POST", body, bureauId });
  }

  patch<T>(path: string, body?: unknown, bureauId?: string | null): Promise<T> {
    return this.request<T>(path, { method: "PATCH", body, bureauId });
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const token = await this.getAccessToken();
    if (!token) {
      throw new ApiError(401, "MISSING_TOKEN", "Please sign in to continue.");
    }

    const bureau = options.bureauId === undefined ? this.getActiveBureau() : options.bureauId;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (bureau) {
      headers["X-Active-Bureau"] = bureau;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      throw new ApiError(0, "NETWORK_ERROR", "The API could not be reached.");
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const raw = await response.text();
    let payload: unknown = null;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const envelope = payload as
        | { error?: { code?: string; message?: string; details?: ApiErrorDetail[]; request_id?: string } }
        | null;
      const apiError = envelope?.error;
      throw new ApiError(
        response.status,
        apiError?.code ?? "HTTP_ERROR",
        apiError?.message ?? `The request failed (HTTP ${response.status}).`,
        apiError?.details ?? [],
        apiError?.request_id,
      );
    }

    return payload as T;
  }
}

export function describeError(error: ApiError): string {
  switch (error.code) {
    case "NETWORK_ERROR":
      return "The API could not be reached. Check that the backend is running and the API URL is correct.";
    case "MISSING_TOKEN":
      return "Your session is no longer valid. Please sign in again.";
    case "ACCOUNT_NOT_PROVISIONED":
      return "No AICTE OneDesk profile is linked to this sign-in. Contact an administrator.";
    case "ACCOUNT_INACTIVE":
      return "This AICTE OneDesk account is not active. Contact an administrator.";
    case "BUREAU_CONTEXT_DENIED":
      return "The selected bureau context is not an active membership of your account.";
    case "GLOBAL_CAPABILITY_REQUIRED":
      return "This administration area requires an organisation-wide capability.";
    default:
      return error.message;
  }
}
