import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClient, ApiError } from "../lib/api";

function client(options: { token?: string | null; bureau?: string | null } = {}) {
  return new ApiClient({
    baseUrl: "https://api.demo.invalid/api/v1/",
    getAccessToken: async () => options.token === undefined ? "token-123" : options.token,
    getActiveBureau: () => options.bureau ?? null,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiClient", () => {
  it("refuses to call the API without a session token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const api = client({ token: null });

    await expect(api.get("/me")).rejects.toMatchObject({
      code: "MISSING_TOKEN",
      status: 401,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the bearer token and omits the bureau header without a context", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await client().get("/regions", { limit: 25 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.demo.invalid/api/v1/regions?limit=25");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-123");
    expect(headers["X-Active-Bureau"]).toBeUndefined();
  });

  it("publishes the selected bureau context as a header", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await client({ bureau: "22222222-2222-2222-2222-222222222222" }).get("/me");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Active-Bureau"]).toBe(
      "22222222-2222-2222-2222-222222222222",
    );
  });

  it("allows a caller to omit the bureau context explicitly", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await client({ bureau: "22222222-2222-2222-2222-222222222222" }).get("/me", undefined, null);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Active-Bureau"]).toBeUndefined();
  });

  it("maps the API error envelope and keeps the request id", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "FORBIDDEN",
              message: "Not allowed.",
              details: [{ field: "bureau_id", issue: "Not a membership" }],
              request_id: "req-42",
            },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await client().get("/bureaus").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "Not allowed.",
      requestId: "req-42",
    });
    expect((error as ApiError).details).toEqual([
      { field: "bureau_id", issue: "Not a membership" },
    ]);
  });

  it("turns a transport failure into a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await expect(client().get("/me")).rejects.toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
    });
  });

  it("returns undefined for a 204 response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

    await expect(client().patch("/regions/1", { is_active: false })).resolves.toBeUndefined();
  });
});
