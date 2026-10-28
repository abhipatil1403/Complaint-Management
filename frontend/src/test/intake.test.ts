import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicApiClient } from "../lib/api";
import {
  channelForPortal,
  createIdempotencyKey,
  currentSourceTimestamp,
  intakeStatusLabel,
  languageLabel,
  noticeForLanguage,
  PORTAL_PATHS,
} from "../lib/intake";
import type { DemoChannel } from "../types";

const CHANNELS: DemoChannel[] = [
  {
    code: "AICTE_SIM",
    name: "Simulated AICTE portal",
    channel_type: "portal",
    portal: "aicte",
    is_simulated: true,
  },
  {
    code: "CPGRAMS_SIM",
    name: "Simulated CPGRAMS intake",
    channel_type: "cpgrams",
    portal: "cpgrams",
    is_simulated: true,
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PublicApiClient", () => {
  it("never sends an Authorization header", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const api = new PublicApiClient("https://api.demo.invalid/api/v1/");
    await api.get("/demo/info");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.demo.invalid/api/v1/demo/info");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Accept).toBe("application/json");
    expect(init.method).toBe("GET");
  });

  it("forwards the Idempotency-Key and JSON body", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("{}", { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const api = new PublicApiClient("https://api.demo.invalid/api/v1");
    await api.post(
      "/demo/intake/AICTE_SIM/submissions",
      { subject: "s", description: "d" },
      { "Idempotency-Key": "idem-1" },
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.demo.invalid/api/v1/demo/intake/AICTE_SIM/submissions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("idem-1");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ subject: "s", description: "d" });
  });

  it("maps the public API error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "RATE_LIMITED",
                message: "Too many simulated submissions.",
                details: [],
                request_id: "req-public",
              },
            }),
            { status: 429 },
          ),
      ),
    );

    await expect(
      new PublicApiClient("https://api.demo.invalid").get("/demo/info"),
    ).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      requestId: "req-public",
    });
  });

  it("surfaces a transport failure as a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await expect(
      new PublicApiClient("https://api.demo.invalid").post("/demo/intake/X/submissions", {}),
    ).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });
});

describe("intake helpers", () => {
  it("maps both portals to their routes and channels", () => {
    expect(PORTAL_PATHS.aicte).toBe("/demo/aicte");
    expect(PORTAL_PATHS.cpgrams).toBe("/demo/cpgrams");
    expect(channelForPortal(CHANNELS, "aicte")?.code).toBe("AICTE_SIM");
    expect(channelForPortal(CHANNELS, "cpgrams")?.code).toBe("CPGRAMS_SIM");
  });

  it("labels the intake states without exposing raw snake_case", () => {
    expect(intakeStatusLabel("awaiting_institution_verification")).toBe(
      "Awaiting institution verification",
    );
    expect(intakeStatusLabel("something_new")).toBe("something new");
    expect(languageLabel("hi")).toBe("Hindi");
    expect(languageLabel("en")).toBe("English");
  });

  it("reuses a form session key but generates distinct ones", () => {
    const first = createIdempotencyKey();
    const second = createIdempotencyKey();
    expect(first).not.toHaveLength(0);
    expect(first).not.toBe(second);
  });

  it("emits a UTC ISO timestamp the API accepts", () => {
    const value = currentSourceTimestamp(new Date("2026-10-20T04:55:00.000Z"));
    expect(value).toBe("2026-10-20T04:55:00.000Z");
    expect(value.endsWith("Z")).toBe(true);
  });

  it("selects the notice in the complaint language", () => {
    const notices = { en: "English notice", hi: "हिन्दी सूचना" };
    expect(noticeForLanguage("en", notices)).toBe("English notice");
    expect(noticeForLanguage("hi", notices)).toBe("हिन्दी सूचना");
    expect(noticeForLanguage("hi", { en: null, hi: null })).toBe("");
  });
});
