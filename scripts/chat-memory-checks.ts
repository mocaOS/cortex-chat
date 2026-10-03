/*
 * Chat memory & history journey checks — evaluation module (playbook §9).
 *
 * Owns the ASK SCENARIOS + ASSERTIONS only. The runtime process/server
 * lifecycle, isolated SQLite (ctx.dataDir), the loopback upstream and the
 * entry runner belong to scripts/chat-journey-runtime.mjs and the lead's
 * scripts/chat-journey-checks.ts; this module must not duplicate that
 * infrastructure and must not boot servers. Run through the lead's runner:
 *
 *   node --import tsx scripts/chat-journey-checks.ts   # runner supplies ctx
 *
 * ctx contract consumed here (per scripts/chat-journey-runtime.mjs):
 *   baseUrl : string                    — loopback http base of the real Next server
 *   dataDir : string                    — isolated SQLite dir backing that server
 *   workDir : string                    — scratch dir for this run
 *   ids     : Record<string, string>    — fixture/augment ids (prefilled)
 *   users   : { owner|member|foreign|noGroup: {id,email,password} } — pre-provisioned
 *   request(path, {method?, cookie?, body?, headers?, timeoutMs?}) => Response
 *       same-origin paths only; body is a JSON-serializable OBJECT (or a
 *       string sent verbatim); the runtime serializes objects, sets
 *       Content-Type application/json, sets Cookie, and bounds every request
 *       with AbortSignal.timeout(timeoutMs ?? requestTimeoutMs).
 *   requestTimeoutMs : number           — runtime-configurable operation bound
 *   upstream.requests : record[]        — EVERY upstream hit; record.body is
 *       the PARSED JSON object (or null) — never a string.
 *   upstream.setHandler(fn(req,res,record))  — function ONLY (null is refused
 *       by the runtime); a handler that returns without ending the response
 *       is HELD in upstream.pending keyed by record.id.
 *   upstream.release(id, frames)        — writes `frames` (objects or raw
 *       strings) to the held response, ends it, and clears the pending
 *       entry. Held late memory MUST be delivered this way — never by
 *       calling res.end() manually (that would leave the pending entry set
 *       and fail run finalization).
 *
 * EVIDENCE CLASS (explicit): the client callback wiring below (memoryRef /
 * doneSeen / persist-on-done / re-persist-on-late-memory) is a TEST DRIVER
 * that replicates the documented page.tsx wiring (src/app/page.tsx:499-615).
 * It is NOT the actual page or a browser. These checks prove HTTP persistence
 * + parser + driver-wiring behavior; they establish no browser/render
 * evidence, no production-build claim (runtime is `next dev`), and no
 * model-quality claim.
 *
 * Returns [{id, ok, detail}] (the runtime also accepts ctx.check) plus
 * population of the findings array via the outcome object returned from
 * runMemoryChecks. Individual assertions are caught by the local `add`
 * helper so one failure never erases the remaining obligation evidence.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { askQuestionStream, type StreamCallbacks } from "../src/lib/api";
import type { AskRequest, Source } from "../src/types";
import {
  createChat,
  setChatStorageMode,
  updateChatMessages,
} from "../src/lib/chatHistory";

type Cookie = string;

// The ask route accepts chat-local identifiers (session_id for the live-turn
// relay) that are intentionally NOT part of the public AskRequest shape — the
// page builds the request object untyped. Scenarios below do the same.
type AskRequestWithChatIds = AskRequest & { session_id?: string };

function baseCallbacks(overrides: Partial<StreamCallbacks>): StreamCallbacks {
  return {
    onContent: () => {},
    onSources: () => {},
    onGraphContext: () => {},
    onThinking: () => {},
    onSubQuestions: () => {},
    onRetrieval: () => {},
    onRetrievalStats: () => {},
    onStatus: () => {},
    onMemoryUpdate: () => {},
    onDone: () => {},
    onError: () => {},
    ...overrides,
  };
}

export interface CheckUser {
  id: string;
  email: string;
  password: string;
}

export interface UpstreamRequestRecord {
  seq: number;
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  // PARSED JSON body (or null) — the runtime parses; consumers must not
  // JSON.parse this again.
  body: unknown;
  rawBodyLength: number;
  receivedAt: string;
  handled: string | null;
  released: boolean;
}

export interface MemoryCheckResult {
  id: string;
  ok: boolean;
  detail: string;
}

export interface MemoryFinding {
  id: string;
  severity: "defect" | "characterization" | "observation";
  title: string;
  detail: string;
  evidence?: string;
}

export interface MemoryChecksCtx {
  baseUrl: string;
  dataDir: string;
  workDir: string;
  ids: Record<string, string>;
  users: {
    owner: CheckUser;
    member: CheckUser;
    foreign: CheckUser;
    noGroup: CheckUser;
    superadmin?: { email: string; password: string };
  };
  request(
    path: string,
    init?: {
      method?: string;
      cookie?: string;
      body?: unknown;
      headers?: Record<string, string>;
      timeoutMs?: number;
    }
  ): Promise<Response>;
  requestTimeoutMs?: number;
  upstream: {
    requests: UpstreamRequestRecord[];
    setHandler(
      fn: (
        req: IncomingMessage,
        res: ServerResponse,
        record: UpstreamRequestRecord
      ) => void | Promise<void>
    ): void;
    release(id: string, frames?: Array<object | string>): boolean;
  };
}

export interface MemoryChecksOutcome {
  checks: MemoryCheckResult[];
  findings: MemoryFinding[];
}

// ---------------------------------------------------------------------------
// local helpers
// ---------------------------------------------------------------------------

const LATE_BLOB = {
  v: 1,
  turns: [{ q: "eval-question-1", a: "Hello world", salience: 0.73 }],
  ledger: ["opaque-marker-never-constructed-by-clients"],
};

const BLOB_LEGACY = {
  v: 1,
  turns: [{ q: "legacy-question", a: "Legacy answer" }],
};

const BLOB_TURN2 = {
  v: 1,
  turns: [
    { q: "eval-question-1", a: "Hello world", salience: 0.73 },
    { q: "eval-question-2", a: "Answer two", salience: 0.81 },
  ],
};

const QUESTION_1 = "eval-question-1";
const QUESTION_2 = "eval-question-2";
const FORGED_AUTHOR_ID = "forged-author-id-must-be-dropped";
const STABLE_SID = "sid-stable-1";

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${what}`)), ms);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
}

interface AdapterCapture {
  path: string;
  method: string;
  body: string | null;
  requestHeaders: Record<string, string>;
  responseRequestId: string | null;
}

/*
 * Bounded temporary fetch adapter: while installed, globalThis.fetch maps
 * RELATIVE urls to ctx.baseUrl, attaches the given user's cookie (the browser
 * would carry it), and REFUSES any non-loopback absolute target. Every
 * operation is bounded with AbortSignal.timeout(timeoutMs) combined with any
 * caller-provided signal (AbortSignal.any). Always restored in finally.
 */
async function withUserFetchAdapter<T>(
  baseUrl: string,
  cookie: Cookie,
  capture: AdapterCapture[],
  timeoutMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const abs = new URL(raw, baseUrl);
    assert.ok(
      isLoopbackHost(abs.hostname),
      `fetch adapter refused non-loopback target: ${abs.origin}`
    );
    const headers = new Headers(init?.headers ?? {});
    if (cookie && !headers.has("cookie")) headers.set("cookie", cookie);
    const method = (
      init?.method ??
      (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET") ??
      "GET"
    ).toUpperCase();
    const record: AdapterCapture = {
      path: abs.pathname + abs.search,
      method,
      body: typeof init?.body === "string" ? init.body : null,
      requestHeaders: Object.fromEntries(headers.entries()),
      responseRequestId: null,
    };
    capture.push(record);
    const signals = [init?.signal, AbortSignal.timeout(timeoutMs)].filter(
      (s): s is AbortSignal => !!s
    );
    const signal =
      signals.length === 0
        ? undefined
        : signals.length === 1
          ? signals[0]
          : typeof AbortSignal.any === "function"
            ? AbortSignal.any(signals)
            : signals[0];
    const res = await realFetch(abs, { ...init, headers, signal });
    record.responseRequestId = res.headers.get("x-request-id");
    return res;
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function login(ctx: MemoryChecksCtx, user: CheckUser, warmMs: number): Promise<Cookie> {
  // First-hit route compilation on `next dev` can exceed a default request
  // timeout — the runner configures requestTimeoutMs (60k) for this allowance.
  const res = await ctx.request("/api/auth/login", {
    method: "POST",
    body: { email: user.email, password: user.password },
    timeoutMs: warmMs,
  });
  assert.equal(res.status, 200, `login failed for ${user.email}`);
  const setCookie =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
  const session = setCookie.find((c) => c.startsWith("cortex_session="));
  assert.ok(session, `no cortex_session cookie in login response for ${user.email}`);
  return session.split(";")[0];
}

async function httpJson(
  ctx: MemoryChecksCtx,
  cookie: Cookie | undefined,
  path: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> }
): Promise<{ status: number; json: any; res: Response }> {
  const res = await ctx.request(path, {
    method: init?.method,
    body: init?.body,
    cookie,
    headers: init?.headers,
    timeoutMs: ctx.requestTimeoutMs,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON body (e.g. plain-text upstream error) — keep null
  }
  return { status: res.status, json, res };
}

/* The runtime bounds ctx.request itself; this wrapper only exists to assert
 * HTTP success explicitly where the contract requires it. */
async function assertOk(
  ctx: MemoryChecksCtx,
  cookie: Cookie | undefined,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<{ status: number; json: any }> {
  const { status, json } = await httpJson(ctx, cookie, path, init);
  assert.ok(
    status >= 200 && status < 300,
    `${init?.method ?? "GET"} ${path} must succeed, got ${status}`
  );
  return { status, json };
}

function frame(payload: object): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/* Persist-on-done / re-persist-on-late-memory are fire-and-forget like
 * page.tsx — poll the observable state instead of sleeping a fixed amount. */
async function pollUntil<T>(
  fn: () => T | Promise<T>,
  ok: (v: T) => boolean,
  ms: number,
  what: string
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/*
 * Test driver replicating the documented page.tsx persistence wiring:
 * memoryRef held across turns, persist on done with the memory AS OF done
 * (the stale/old blob), one re-persist when a late memory_update lands after
 * done (doneSeen flag). `persist(memory)` is supplied by the scenario — it is
 * the page.tsx `finalize` analogue.
 */
function makeDriver(
  trace: { kind: string; value?: unknown }[],
  persist: (memory: unknown) => void
) {
  let memoryRef: unknown = undefined;
  let doneSeen = false;
  return {
    get memory() {
      return memoryRef;
    },
    onMemoryUpdate(memory: unknown) {
      trace.push({ kind: "memory_update", value: memory });
      memoryRef = memory;
      if (doneSeen) persist(memory);
    },
    onDone() {
      trace.push({ kind: "done" });
      doneSeen = true;
      persist(memoryRef);
    },
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export async function runMemoryChecks(ctx: MemoryChecksCtx): Promise<MemoryChecksOutcome> {
  const checks: MemoryCheckResult[] = [];
  const findings: MemoryFinding[] = [];

  const add = async (
    id: string,
    fn: () => Promise<string | void> | string | void
  ): Promise<void> => {
    try {
      const detail = await fn();
      checks.push({ id, ok: true, detail: detail ?? "ok" });
    } catch (err) {
      checks.push({
        id,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const warmMs = ctx.requestTimeoutMs ?? 60_000;
  const driverEvents: { kind: string; value?: unknown }[] = [];
  const captures: AdapterCapture[] = [];
  const asUser = <T>(cookie: Cookie, fn: () => Promise<T>): Promise<T> =>
    withUserFetchAdapter(ctx.baseUrl, cookie, captures, warmMs, fn);

  let ownerCookie: Cookie | undefined;
  let memberCookie: Cookie | undefined;
  let foreignCookie: Cookie | undefined;
  let noGroupCookie: Cookie | undefined;

  setChatStorageMode("server");

  // -- environment ----------------------------------------------------------

  await add("env.login.owner", async () => {
    ownerCookie = await login(ctx, ctx.users.owner, warmMs);
    return "owner session established";
  });
  await add("env.login.member", async () => {
    memberCookie = await login(ctx, ctx.users.member, warmMs);
    return "member session established";
  });
  await add("env.login.foreign", async () => {
    foreignCookie = await login(ctx, ctx.users.foreign, warmMs);
    return "foreign session established";
  });
  await add("env.login.noGroup", async () => {
    noGroupCookie = await login(ctx, ctx.users.noGroup, warmMs);
    return "noGroup session established";
  });

  // -- turn 1: done -> persist(memory old) -> held late memory -> re-persist -

  const upstreamBefore = ctx.upstream.requests.length;
  let chatId = "";
  let heldRecordId: string | null = null;
  const controller = new AbortController();
  let doneSeenPromise: Promise<void> = Promise.resolve();
  let turn1Error: string | null = null;
  let turn1Running: Promise<void> | null = null;

  await add("turn1.setup-chat-and-handler", async () => {
    assert.ok(ownerCookie, "owner login missing");
    ctx.upstream.setHandler((req, res, record) => {
      void req;
      // Write the early frames but DO NOT end the response: the runtime holds
      // it in upstream.pending keyed by record.id; the late memory_update is
      // delivered later via upstream.release(record.id, frames).
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
      res.write(frame({ status: { stage: "retrieval", message: "Searching collections" } }));
      res.write(frame({ content: "Hello " }));
      res.write(frame({ content: "world" }));
      const sources = [
        {
          document_id: "doc-1",
          chunk_id: "c1",
          content: "snippet text",
          score: 0.9,
          metadata: { filename: "handbook.md" },
          sid: STABLE_SID,
        },
      ] as unknown as Source[];
      res.write(frame({ sources }));
      res.write(
        frame({ done: true, pending_memory: true, refused: false, truncated: false })
      );
      heldRecordId = record.id;
    });
    const created = await asUser(ownerCookie, () =>
      createChat(undefined, "eval-chat-memory", undefined, undefined)
    );
    assert.ok(created?.id, "chat creation returned no id");
    chatId = created.id;
    ctx.ids["evalChat"] = chatId;
    return `chat ${chatId} created via real createChat; handler armed (held via upstream.pending)`;
  });

  // Fire the turn without awaiting its completion: the stream stays held at
  // the handler until upstream.release(heldRecordId) is invoked by a later
  // check. doneSeenPromise gives a DETERMINISTIC done-before-release point.
  const startTurn1 = async (): Promise<void> => {
    assert.ok(ownerCookie, "owner login missing");
    let doneResolve!: () => void;
    doneSeenPromise = new Promise<void>((resolve) => {
      doneResolve = resolve;
    });
    const request: AskRequestWithChatIds = {
      question: QUESTION_1,
      use_graph: true,
      conversation_history: [],
      collection_id: null,
      session_id: chatId,
      conversation_memory: {},
    };
    let flags: Record<string, unknown> = {};
    const driver = makeDriver(driverEvents, (memory) => {
      // page.tsx finalize analogue: full replace with memoryRef AS OF NOW
      const messages = [
        {
          id: "msg-user-1",
          role: "user",
          content: QUESTION_1,
          // malicious/buggy client echo — must be dropped by the server
          authorId: FORGED_AUTHOR_ID,
        },
        {
          id: "msg-assist-1",
          role: "assistant",
          content: assembled,
          sources,
          isStreaming: false,
          ...flags,
        },
      ];
      void updateChatMessages(
        chatId,
        messages as never,
        memory === undefined ? undefined : memory
      ).catch((e: unknown) => {
        turn1Error = `persist failed: ${String(e)}`;
      });
    });
    let assembled = "";
    let sources: Source[] = [];
    await withUserFetchAdapter(ctx.baseUrl, ownerCookie!, captures, warmMs, () =>
      askQuestionStream(
        request,
        baseCallbacks({
          onContent: (t) => {
            assembled += t;
            driverEvents.push({ kind: "content", value: t });
          },
          onSources: (s) => {
            sources = s;
            driverEvents.push({ kind: "sources", value: s });
          },
          onStatus: (s) => driverEvents.push({ kind: "status", value: s }),
          onMemoryUpdate: (m) => driver.onMemoryUpdate(m),
          onDone: (f) => {
            flags = {
              ...(f.refused ? { refused: true } : {}),
              ...(f.truncated ? { truncated: true } : {}),
            };
            driver.onDone();
            doneResolve();
          },
          onError: (e) => {
            turn1Error = `onError: ${e}`;
            doneResolve();
          },
        }),
        controller.signal
      )
    );
  };

  if (ownerCookie !== undefined) {
    turn1Running = startTurn1().catch((e: unknown) => {
      turn1Error = turn1Error ?? String(e);
    });
  }

  await add("turn1.persist-memory-old-before-late", async () => {
    assert.ok(turn1Running, "turn 1 stream not started");
    // deterministic: wait until the done frame was dispatched (the persist
    // capture exists by then — it is initiated before doneResolve) — no sleep.
    await withTimeout(doneSeenPromise, warmMs, "waiting for the done frame");
    assert.equal(turn1Error, null, `turn 1 driver error: ${turn1Error}`);
    const donePersist = await pollUntil(
      () => captures.find((c) => c.path === `/api/me/chats/${chatId}` && c.method === "PATCH"),
      (c) => !!c,
      warmMs,
      "done-time persist PATCH to be captured"
    );
    const body = JSON.parse(donePersist?.body ?? "{}");
    assert.ok(
      !("memory" in body),
      "done-time persist must NOT carry a memory key (memory is still old/absent)"
    );
    const { json } = await pollUntil(
      () => httpJson(ctx, ownerCookie, `/api/me/chats/${chatId}`),
      (r) => (r.json.messages?.length ?? 0) >= 2,
      warmMs,
      "done-time persist to become visible via GET"
    );
    assert.equal(json.memory, undefined,
      "before the late memory lands, the stored session must have no memory blob"
    );
    assert.equal(json.messages[1].content, "Hello world");
    assert.equal(json.messages[1].sources?.[0]?.sid, STABLE_SID, "streamed sid persisted");
    return "done-time persist stored the answer with NO memory key; GET shows no memory yet (stream still held)";
  });

  await add("turn1.late-memory-repersisted", async () => {
    assert.ok(heldRecordId, "held upstream record id missing");
    assert.ok(turn1Running, "turn 1 stream not started");
    // Release the held late memory THROUGH the runtime's pending mechanism —
    // a manual res.end() would leave upstream.pending non-empty and fail
    // run finalization.
    ctx.upstream.release(heldRecordId, [{ memory_update: LATE_BLOB }]);
    await withTimeout(turn1Running, warmMs, "turn 1 stream end after release");
    const patchCount = await pollUntil(
      () => captures.filter((c) => c.path === `/api/me/chats/${chatId}` && c.method === "PATCH").length,
      (n) => n >= 2,
      warmMs,
      "late-memory re-persist PATCH to be captured"
    );
    assert.equal(patchCount, 2, "expected exactly two persists (done + late memory)");
    const patches = captures.filter(
      (c) => c.path === `/api/me/chats/${chatId}` && c.method === "PATCH"
    );
    const lateBody = JSON.parse(patches[1].body ?? "{}");
    assert.ok("memory" in lateBody, "late persist must carry the memory key");
    assert.deepEqual(
      lateBody.memory,
      LATE_BLOB,
      "late memory blob must be re-persisted verbatim (opaque, never reconstructed)"
    );
    assert.equal(turn1Error, null, `turn 1 driver error: ${turn1Error}`);
    const kinds = driverEvents.map((e) => e.kind);
    assert.ok(
      kinds.indexOf("done") < kinds.indexOf("memory_update"),
      `expected done before memory_update, got: ${kinds.join(",")}`
    );
    const { json } = await pollUntil(
      () => httpJson(ctx, ownerCookie, `/api/me/chats/${chatId}`),
      (r) => r.json.memory !== undefined,
      warmMs,
      "late-memory re-persist to become visible via GET"
    );
    assert.deepEqual(json.memory, LATE_BLOB, "stored memory must be the late blob verbatim");
    return "late memory_update dispatched after done and re-persisted verbatim (released via upstream.release)";
  });

  await add("turn1.reload-verbatim-memory-and-sources", async () => {
    const { status, json } = await httpJson(ctx, ownerCookie, `/api/me/chats/${chatId}`);
    assert.equal(status, 200);
    assert.deepEqual(json.memory, LATE_BLOB, "GET after reload must return the late blob verbatim");
    const assist = json.messages?.find((m: { id: string }) => m.id === "msg-assist-1");
    assert.ok(assist, "assistant message missing after reload");
    assert.equal(assist.sources?.[0]?.sid, STABLE_SID, "sid must be stable across reload");
    assert.equal(assist.content, "Hello world");
    return "reload: memory verbatim, sources carry the conversation-stable sid";
  });

  await add("turn1.upstream-stripped-and-keyed", async () => {
    const records = ctx.upstream.requests
      .slice(upstreamBefore)
      .filter((r) => r.path.startsWith("/api/ask/stream"));
    assert.equal(records.length, 1, `expected 1 upstream ask/stream request, saw ${records.length}`);
    const rec = records[0];
    assert.equal(rec.method, "POST");
    assert.ok(rec.path.endsWith("/api/ask/stream"), `unexpected upstream path ${rec.path}`);
    // record.body is ALREADY the parsed object — never JSON.parse it here.
    const body = rec.body as Record<string, unknown> | null;
    assert.ok(body && typeof body === "object", "upstream body must be a parsed JSON object");
    assert.ok(!("session_id" in body), "session_id must be stripped before forwarding");
    assert.ok(!("assistant_id" in body), "assistant_id must be stripped before forwarding");
    assert.ok(!("project_id" in body), "project_id must be stripped before forwarding");
    assert.deepEqual(body.conversation_memory, {}, "turn 1 must replay the empty memory blob");
    assert.ok(
      (rec.headers["x-api-key"] ?? "").length > 0,
      "group chat key (X-API-Key) must be injected upstream"
    );
    assert.equal(
      (rec.headers["accept-encoding"] ?? "").toLowerCase(),
      "identity",
      "SSE proxy must request Accept-Encoding: identity"
    );
    assert.ok(rec.headers["x-request-id"], "X-Request-ID must be forwarded upstream");
    const streamCapture = captures.find((c) => c.path === "/api/ask/stream");
    assert.equal(
      streamCapture?.responseRequestId,
      rec.headers["x-request-id"],
      "the SSE response must echo the forwarded X-Request-ID"
    );
    return "upstream saw stripped body, injected X-API-Key, identity encoding, stable request id";
  });

  // -- turn 2: exact verbatim replay + full retained history -----------------

  await add("turn2.replays-late-blob-verbatim", async () => {
    assert.ok(ownerCookie, "owner login missing");
    const before = ctx.upstream.requests.length;
    ctx.upstream.setHandler((req, res) => {
      void req;
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
      res.write(frame({ content: "Answer two" }));
      res.write(frame({ done: true, pending_memory: true }));
      res.write(frame({ memory_update: BLOB_TURN2 }));
      res.end();
    });
    const request: AskRequestWithChatIds = {
      question: QUESTION_2,
      use_graph: true,
      conversation_history: [
        { role: "user", content: QUESTION_1 },
        { role: "assistant", content: "Hello world" },
      ],
      collection_id: null,
      session_id: chatId,
      conversation_memory: LATE_BLOB, // the driver replays memoryRef verbatim
    };
    let sawLate: unknown;
    await withUserFetchAdapter(ctx.baseUrl, ownerCookie!, captures, warmMs, () =>
      askQuestionStream(
        request,
        baseCallbacks({
          onMemoryUpdate: (m) => {
            sawLate = m;
          },
          onError: (e) => {
            throw new Error(`onError: ${e}`);
          },
        })
      )
    );
    const records = ctx.upstream.requests
      .slice(before)
      .filter((r) => r.path.startsWith("/api/ask/stream"));
    assert.equal(records.length, 1, `expected 1 upstream request, saw ${records.length}`);
    const body = records[0].body as Record<string, unknown> | null;
    assert.ok(body && typeof body === "object", "upstream body must be a parsed JSON object");
    assert.deepEqual(
      body.conversation_memory,
      LATE_BLOB,
      "turn 2 must replay the late blob EXACTLY (verbatim, opaque)"
    );
    assert.ok(!("session_id" in body), "session_id stripped on turn 2 as well");
    assert.deepEqual(sawLate, BLOB_TURN2, "turn 2 memory_update must reach the driver verbatim");
    // Settled turn-2 persist: FULL history (turn 1 + turn 2) so the thread is
    // retained across the replace; the NEW message id carries a forged echo
    // that the server must drop and stamp with the caller.
    await asUser(ownerCookie!, () =>
      updateChatMessages(
        chatId,
        [
          { id: "msg-user-1", role: "user", content: QUESTION_1 },
          { id: "msg-assist-1", role: "assistant", content: "Hello world", isStreaming: false },
          { id: "msg-user-2", role: "user", content: QUESTION_2, authorId: FORGED_AUTHOR_ID },
          { id: "msg-assist-2", role: "assistant", content: "Answer two", isStreaming: false },
        ] as never,
        sawLate
      )
    );
    const { json } = await pollUntil(
      () => httpJson(ctx, ownerCookie, `/api/me/chats/${chatId}`),
      (r) => (r.json.messages?.length ?? 0) >= 4,
      warmMs,
      "turn-2 full-history persist to become visible via GET"
    );
    assert.deepEqual(json.memory, BLOB_TURN2, "turn-2 memory persisted verbatim");
    assert.equal(json.messages?.length, 4, "full turn1+turn2 history retained across the replace");
    return "turn-2 request carried the exact late blob; full history + turn-2 memory round-tripped";
  });

  // -- legacy order (memory_update BEFORE done) ------------------------------

  await add("legacy.memory-before-done-single-persist", async () => {
    assert.ok(ownerCookie, "owner login missing");
    const created = await asUser(ownerCookie!, () =>
      createChat(undefined, "eval-chat-legacy", undefined, undefined)
    );
    const legacyChatId = created.id;
    ctx.ids["legacyChat"] = legacyChatId;
    ctx.upstream.setHandler((req, res) => {
      void req;
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
      res.write(frame({ content: "Legacy answer" }));
      res.write(
        frame({
          sources: [{ sid: "sid-legacy", document_id: "d", chunk_id: "c", content: "x", score: 1 }],
        })
      );
      res.write(frame({ memory_update: BLOB_LEGACY }));
      res.write(frame({ done: true }));
      res.end();
    });
    let memoryLegacy: unknown = undefined;
    let doneSeenLegacy = false;
    const localPersists: { at: string; memory: unknown }[] = [];
    const persistPromises: Promise<void>[] = [];
    await withUserFetchAdapter(ctx.baseUrl, ownerCookie!, captures, warmMs, () =>
      askQuestionStream(
        { question: "legacy-question", conversation_memory: {} },
        baseCallbacks({
          onMemoryUpdate: (m) => {
            memoryLegacy = m;
            if (doneSeenLegacy) localPersists.push({ at: "late-memory", memory: m });
          },
          onDone: () => {
            doneSeenLegacy = true;
            localPersists.push({ at: "done", memory: memoryLegacy });
            // REAL awaited persistence (page.tsx finalize analogue): full
            // healthy snapshot with the memory that arrived before done.
            persistPromises.push(
              updateChatMessages(
                legacyChatId,
                [
                  { id: "msg-legacy-user", role: "user", content: "legacy-question" },
                  {
                    id: "msg-legacy-assist",
                    role: "assistant",
                    content: "Legacy answer",
                    isStreaming: false,
                  },
                ] as never,
                memoryLegacy
              )
            );
          },
          onError: (e) => {
            throw new Error(`onError: ${e}`);
          },
        })
      )
    );
    await Promise.all(persistPromises);
    const persistPatch = await pollUntil(
      () => captures.filter((c) => c.path === `/api/me/chats/${legacyChatId}` && c.method === "PATCH"),
      (list) => list.length >= 1,
      warmMs,
      "legacy onDone persist PATCH to be captured"
    );
    assert.equal(persistPatch.length, 1, "legacy order must produce exactly ONE persist (in onDone)");
    const persistedMemory = JSON.parse(persistPatch[0].body ?? "{}").memory;
    assert.deepEqual(
      persistedMemory,
      BLOB_LEGACY,
      "legacy order: the persist in onDone must carry the memory that arrived before it"
    );
    assert.deepEqual(
      localPersists,
      [{ at: "done", memory: BLOB_LEGACY }],
      "legacy order: doneSeen stays false in onMemoryUpdate — no duplicate re-persist"
    );
    const { json } = await pollUntil(
      () => httpJson(ctx, ownerCookie, `/api/me/chats/${legacyChatId}`),
      (r) => (r.json.messages?.length ?? 0) >= 2,
      warmMs,
      "legacy persist to become visible via GET"
    );
    assert.deepEqual(json.memory, BLOB_LEGACY, "legacy memory stored verbatim");
    assert.equal(json.messages?.length, 2, "legacy full snapshot persisted");
    return "legacy ordering persists once in onDone with the pre-done blob and a full healthy snapshot";
  });

  // -- answer flags round-trip -----------------------------------------------

  await add("flags.refused-truncated-source-persisted", async () => {
    assert.ok(ownerCookie, "owner login missing");
    const created = await asUser(ownerCookie!, () =>
      createChat(undefined, "eval-chat-flags", undefined, undefined)
    );
    const flagsChatId = created.id;
    ctx.ids["flagsChat"] = flagsChatId;
    ctx.upstream.setHandler((req, res) => {
      void req;
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
      res.write(frame({ content: "I cannot help with that." }));
      res.write(
        frame({ done: true, refused: true, refusal_source: "classifier", truncated: true })
      );
      res.end();
    });
    let flags: { refused?: boolean; refusalSource?: string; truncated?: boolean } = {};
    await withUserFetchAdapter(ctx.baseUrl, ownerCookie!, captures, warmMs, () =>
      askQuestionStream(
        { question: "flagged-question", conversation_memory: {} },
        baseCallbacks({
          onDone: (f) => {
            // page.tsx onDone stamps the flags onto the assistant message
            flags = {
              ...(f.refused ? { refused: true } : {}),
              ...(f.refused && f.refusalSource ? { refusalSource: f.refusalSource } : {}),
              ...(f.truncated ? { truncated: true } : {}),
            };
          },
          onError: (e) => {
            throw new Error(`onError: ${e}`);
          },
        })
      )
    );
    assert.equal(flags.refused, true, "done flags must reach onDone");
    assert.equal(flags.refusalSource, "classifier");
    await asUser(ownerCookie!, () =>
      updateChatMessages(
        flagsChatId,
        [
          { id: "msg-user-3", role: "user", content: "flagged-question" },
          {
            id: "msg-assist-3",
            role: "assistant",
            content: "I cannot help with that.",
            isStreaming: false,
            ...flags,
          },
        ] as never
      )
    );
    const { json } = await pollUntil(
      () => httpJson(ctx, ownerCookie, `/api/me/chats/${flagsChatId}`),
      (r) => (r.json.messages?.length ?? 0) >= 2,
      warmMs,
      "flags persist to become visible via GET"
    );
    const assist = json.messages?.find((m: { id: string }) => m.id === "msg-assist-3");
    assert.ok(assist, "flagged assistant message missing after reload");
    assert.equal(assist.refused, true, "refused flag must survive persistence/reload");
    assert.equal(assist.refusalSource, "classifier", "refusal_source must survive persistence/reload");
    assert.equal(assist.truncated, true, "truncated flag must survive persistence/reload");
    return "refused/truncated/refusalSource persisted in message metadata and reloaded";
  });

  // -- isolation: foreign access to a private chat ---------------------------

  let privateSnapshot: any;
  await add("isolation.foreign-404-and-no-changes", async () => {
    assert.ok(ownerCookie && foreignCookie, "owner/foreign login missing");
    ({ json: privateSnapshot } = await httpJson(ctx, ownerCookie, `/api/me/chats/${chatId}`));
    assert.ok(privateSnapshot.messages?.length, "snapshot must contain messages");
    const get = await httpJson(ctx, foreignCookie, `/api/me/chats/${chatId}`);
    assert.equal(get.status, 404, "foreign GET on a private chat must 404");
    const patch = await httpJson(ctx, foreignCookie, `/api/me/chats/${chatId}`, {
      method: "PATCH",
      body: {
        title: "hijacked-title",
        messages: [{ id: "msg-user-1", role: "user", content: "forged" }],
      },
    });
    assert.equal(patch.status, 404, "foreign PATCH on a private chat must 404");
    const del = await httpJson(ctx, foreignCookie, `/api/me/chats/${chatId}`, {
      method: "DELETE",
    });
    assert.equal(del.status, 404, "foreign DELETE on a private chat must 404");
    const after = await httpJson(ctx, ownerCookie, `/api/me/chats/${chatId}`);
    assert.equal(after.status, 200, "owner must still see the chat after foreign attempts");
    assert.deepEqual(after.json, privateSnapshot, "foreign 404 attempts must change nothing");
    return "foreign GET/PATCH/DELETE all 404 and the chat is identical afterwards";
  });

  await add("isolation.unauth-and-noGroup", async () => {
    const unauth = await httpJson(ctx, undefined, "/api/ask/stream", {
      method: "POST",
      body: { question: "q" },
    });
    assert.equal(unauth.status, 401, "unauthenticated ask/stream must 401");
    const noGroup = await httpJson(ctx, noGroupCookie, "/api/ask/stream", {
      method: "POST",
      body: { question: "q" },
    });
    assert.equal(noGroup.status, 403, "group-less user ask/stream must 403 (no chat access)");
    const noGroupList = await assertOk(ctx, noGroupCookie, "/api/me/chats");
    assert.equal(noGroupList.json.sessions?.length ?? 0, 0, "group-less user sees only their own (empty) chats");
    return "401 unauthenticated / 403 group-less at the real ask route";
  });

  await add("isolation.same-group-private-chat-denied", async () => {
    assert.ok(ownerCookie && memberCookie, "owner/member login missing");
    const before = await httpJson(ctx, ownerCookie, `/api/me/chats/${chatId}`);
    assert.equal(before.status, 200);
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const res = await httpJson(ctx, memberCookie, `/api/me/chats/${chatId}`, {
        method, ...(method === "PATCH" ? { body: { memory: { forged: "same-group" } } } : {}),
      });
      assert.equal(res.status, 404, `same group must not grant ${method} to another private chat`);
    }
    const after = await httpJson(ctx, ownerCookie, `/api/me/chats/${chatId}`);
    assert.deepEqual(after.json, before.json);
    return "same-group GET/PATCH/DELETE 404; private state unchanged (project grant is required)";
  });

  // -- shared project: member continues, cannot administer -------------------

  await add("project.member-continues-cannot-administer", async () => {
    assert.ok(ownerCookie && memberCookie, "owner/member login missing");
    const proj = await assertOk(ctx, ownerCookie, "/api/me/projects", {
      method: "POST",
      body: { name: "eval-project" },
    });
    const projectId = proj.json?.project?.id;
    assert.ok(projectId, "no project id");
    ctx.ids["evalProject"] = projectId;
    await assertOk(ctx, ownerCookie, `/api/me/projects/${projectId}/shares`, {
      method: "PUT",
      body: { shares: [{ userId: ctx.users.member.id }] },
    });
    const chat = await assertOk(ctx, ownerCookie, "/api/me/chats", {
      method: "POST",
      body: { title: "eval-project-chat", projectId },
    });
    const projectChatId = chat.json?.id;
    assert.ok(projectChatId, "no project chat id");
    ctx.ids["projectChat"] = projectChatId;
    // author seeds the thread (server-stamped with the owner id)
    await asUser(ownerCookie!, () =>
      updateChatMessages(projectChatId, [
        { id: "msg-owner-1", role: "user", content: "seed question" },
        { id: "msg-owner-2", role: "assistant", content: "seed answer", isStreaming: false },
      ] as never)
    );
    const memberGet = await assertOk(ctx, memberCookie, `/api/me/chats/${projectChatId}`);
    // member continues the thread — a FULL replace that echoes the owner's
    // messages back (authorId dropped/ignored; preserved by id server-side)
    const merged = [
      ...memberGet.json.messages,
      { id: "msg-member-1", role: "user", content: "member follow-up" },
      { id: "msg-member-2", role: "assistant", content: "member answer", isStreaming: false },
    ];
    await asUser(memberCookie, () => updateChatMessages(projectChatId, merged as never));
    const after = await pollUntil(
      () => httpJson(ctx, ownerCookie, `/api/me/chats/${projectChatId}`),
      (r) => (r.json.messages?.length ?? 0) >= 4,
      warmMs,
      "member thread continuation to become visible via GET"
    );
    const byId = new Map<string, any>((after.json.messages ?? []).map((m: any) => [m.id, m]));
    assert.equal(
      byId.get("msg-owner-1")?.authorId,
      ctx.users.owner.id,
      "owner's prior non-null author must be preserved across the member's full replace"
    );
    assert.notEqual(
      byId.get("msg-owner-1")?.authorId,
      FORGED_AUTHOR_ID,
      "echoed/forged authorId must never be stored"
    );
    assert.equal(
      byId.get("msg-member-2")?.authorId,
      ctx.users.member.id,
      "member's new message must be stamped with the member id"
    );
    // administration stays author-only — each attempt is asserted individually
    const title = await httpJson(ctx, memberCookie, `/api/me/chats/${projectChatId}`, {
      method: "PATCH",
      body: { title: "member-title" },
    });
    assert.equal(title.status, 404, "member must not retitle a shared chat");
    const pin = await httpJson(ctx, memberCookie, `/api/me/chats/${projectChatId}`, {
      method: "PATCH",
      body: { pinned: true },
    });
    assert.equal(pin.status, 404, "member must not pin a shared chat");
    const move = await httpJson(ctx, memberCookie, `/api/me/chats/${projectChatId}`, {
      method: "PATCH",
      body: { projectId: null },
    });
    assert.equal(move.status, 404, "member must not move a shared chat");
    const del = await httpJson(ctx, memberCookie, `/api/me/chats/${projectChatId}`, {
      method: "DELETE",
    });
    assert.equal(del.status, 404, "member must not delete a shared chat");
    const ownerView = await httpJson(ctx, ownerCookie, `/api/me/chats/${projectChatId}`);
    assert.equal(ownerView.json.title, "eval-project-chat", "title unchanged after member admin attempts");
    assert.equal(ownerView.json.pinned, 0, "pin unchanged after member admin attempts");
    assert.equal(ownerView.json.projectId, projectId, "project binding unchanged");
    assert.equal(ownerView.json.messages?.length, 4, "member's thread continuation persisted");
    return "member continues the thread; title/pin/move/delete all 404; authors server-stamped and preserved";
  });

  // -- cross-session isolation: CONCURRENT writers on two sessions -----------

  await add("isolation.concurrent-sessions-never-cross", async () => {
    assert.ok(ownerCookie && memberCookie, "owner/member login missing");
    const chatA = (await asUser(ownerCookie!, () => createChat(undefined, "eval-cross-A")))?.id;
    const chatB = (await asUser(memberCookie!, () => createChat(undefined, "eval-cross-B")))?.id;
    assert.ok(chatA && chatB, "cross chats not created");
    ctx.ids["crossChatA"] = chatA;
    ctx.ids["crossChatB"] = chatB;
    const patchOwner = (path: string, body: object) =>
      httpJson(ctx, ownerCookie, path, { method: "PATCH", body });
    const patchMember = (path: string, body: object) =>
      httpJson(ctx, memberCookie, path, { method: "PATCH", body });
    // ACTUAL concurrent writers (Promise.all within each wave); every write
    // must individually report HTTP success.
    const wave1 = await Promise.all([
      patchOwner(`/api/me/chats/${chatA}`, { memory: { tag: "A-1" }, messages: [{ id: "msg-a1", role: "user", content: "A-1" }] }),
      patchMember(`/api/me/chats/${chatB}`, { memory: { tag: "B-1" }, messages: [{ id: "msg-b1", role: "user", content: "B-1" }] }),
    ]);
    assert.equal(wave1[0].status, 200, "chat A wave-1 write must succeed");
    assert.equal(wave1[1].status, 200, "chat B wave-1 write must succeed");
    const wave2 = await Promise.all([
      patchOwner(`/api/me/chats/${chatA}`, { memory: { tag: "A-2" }, messages: [{ id: "msg-a1", role: "user", content: "A-1" }, { id: "msg-a2", role: "user", content: "A-2" }] }),
      patchMember(`/api/me/chats/${chatB}`, { memory: { tag: "B-2" }, messages: [{ id: "msg-b1", role: "user", content: "B-1" }, { id: "msg-b2", role: "user", content: "B-2" }] }),
    ]);
    assert.equal(wave2[0].status, 200, "chat A wave-2 write must succeed");
    assert.equal(wave2[1].status, 200, "chat B wave-2 write must succeed");
    const a = await httpJson(ctx, ownerCookie, `/api/me/chats/${chatA}`);
    const b = await httpJson(ctx, memberCookie, `/api/me/chats/${chatB}`);
    assert.deepEqual(a.json.memory, { tag: "A-2" }, "chat A must hold only its own last write");
    assert.deepEqual(
      (a.json.messages ?? []).map((m: { id: string }) => m.id),
      ["msg-a1", "msg-a2"],
      "chat A must hold exactly its own message pair"
    );
    assert.deepEqual(b.json.memory, { tag: "B-2" }, "chat B must hold only its own last write");
    assert.deepEqual(
      (b.json.messages ?? []).map((m: { id: string }) => m.id),
      ["msg-b1", "msg-b2"],
      "chat B must hold exactly its own message pair"
    );
    return "concurrent writers across two sessions stayed strictly per-chat (all writes HTTP-verified)";
  });

  // -- same-chat concurrency: documented last-writer-wins characterization ----

  await add("concurrency.same-chat-last-writer-wins-paired", async () => {
    assert.ok(ownerCookie, "owner login missing");
    const created = await asUser(ownerCookie!, () => createChat(undefined, "eval-lww"));
    const chat = created.id;
    ctx.ids["lwwChat"] = chat;
    const messagesX = [{ id: "msg-x", role: "user", content: "writer X" }];
    const messagesY = [{ id: "msg-y", role: "user", content: "writer Y" }];
    // two CONCURRENT full-snapshot writers (messages + memory folded in one tx
    // each) — both HTTP outcomes asserted, not inferred
    const results = await Promise.all([
      httpJson(ctx, ownerCookie, `/api/me/chats/${chat}`, {
        method: "PATCH",
        body: { messages: messagesX, memory: { winner: "X" } },
      }),
      httpJson(ctx, ownerCookie, `/api/me/chats/${chat}`, {
        method: "PATCH",
        body: { messages: messagesY, memory: { winner: "Y" } },
      }),
    ]);
    assert.equal(results[0].status, 200, "writer X PATCH must succeed");
    assert.equal(results[1].status, 200, "writer Y PATCH must succeed");
    const final = await httpJson(ctx, ownerCookie, `/api/me/chats/${chat}`);
    const winner = final.json.memory?.winner;
    assert.ok(winner === "X" || winner === "Y", `memory winner must be X or Y, got ${winner}`);
    const msgIds = (final.json.messages ?? []).map((m: { id: string }) => m.id);
    assert.equal(msgIds.length, 1, "exactly one writer's message set survives");
    assert.equal(
      msgIds[0],
      winner === "X" ? "msg-x" : "msg-y",
      "messages and memory must come from the SAME writer (coherent pair, no interleaving)"
    );
    findings.push({
      id: "concurrency.lww.paired-characterization",
      severity: "characterization",
      title: "Same-chat concurrent writes resolve last-writer-wins with a coherent (messages, memory) pair",
      detail: `Two concurrent full-snapshot PATCHes both returned HTTP 200 and both committed; the settled state is writer ${winner}'s messages AND memory together (SQLite serializes the folded messages+memory transaction). This matches the documented same-chat last-writer-wins contract (chat-streaming-memory guide, live-turn section). No CAS/revision guarantee exists and none was invented.`,
      evidence: `chat ${chat}; final memory=${JSON.stringify(final.json.memory)}, messages=${msgIds.join(",")}`,
    });
    return `paired writers resolved coherently to writer ${winner} (both PATCHes HTTP 200)`;
  });

  await add("concurrency.stale-full-snapshot-replay-characterized", async () => {
    assert.ok(ownerCookie, "owner login missing");
    const created = await asUser(ownerCookie!, () => createChat(undefined, "eval-stale"));
    const chat = created.id;
    ctx.ids["staleChat"] = chat;
    // every step asserted individually — no inferred commits
    const p1 = await httpJson(ctx, ownerCookie, `/api/me/chats/${chat}`, {
      method: "PATCH",
      body: { messages: [{ id: "msg-v1", role: "user", content: "v1" }], memory: { v: 1 } },
    });
    assert.equal(p1.status, 200, "turn-1 (v1) settle must succeed");
    const p2 = await httpJson(ctx, ownerCookie, `/api/me/chats/${chat}`, {
      method: "PATCH",
      body: {
        messages: [
          { id: "msg-v1", role: "user", content: "v1" },
          { id: "msg-v2", role: "user", content: "v2" },
        ],
        memory: { v: 2 },
      },
    });
    assert.equal(p2.status, 200, "turn-2 (v2) settle must succeed");
    // a STALE full-snapshot replay (the HTTP shape of a late onMemoryUpdate
    // re-persist racing a newer turn) silently reverts the newer turn
    const pStale = await httpJson(ctx, ownerCookie, `/api/me/chats/${chat}`, {
      method: "PATCH",
      body: { messages: [{ id: "msg-v1", role: "user", content: "v1" }], memory: { v: 1 } },
    });
    assert.equal(pStale.status, 200, "stale replay PATCH must succeed");
    const final = await httpJson(ctx, ownerCookie, `/api/me/chats/${chat}`);
    assert.deepEqual(final.json.memory, { v: 1 }, "stale snapshot wins (documented LWW)");
    assert.equal(final.json.messages?.length, 1, "stale message snapshot wins (documented LWW)");
    findings.push({
      id: "concurrency.stale-snapshot-revert.characterization",
      severity: "characterization",
      title: "Stale full-snapshot replay silently reverts a newer settled turn (documented last-writer-wins)",
      detail:
        "PATCH is a full replace; a stale (messages, memory) snapshot replayed after a newer settled turn overwrites both (all three PATCHes returned HTTP 200). The contract documents same-chat last-writer-wins, so this is characterized, not fixed. The client-side page.tsx late-memory re-persist (setMessages(prev => { finalize(prev); return prev })) can emit exactly this stale shape when a new turn starts or a regenerate/edit is in flight before the previous turn's late memory_update lands — see findings page.tsx.race.*.",
      evidence: `chat ${chat}; final memory v1 after v2 had settled`,
    });
    return "stale replay reverts the newer turn — characterized, matching the documented LWW contract";
  });

  // -- transaction rollback negative control ---------------------------------

  await add("rollback.duplicate-message-ids-atomic", async () => {
    assert.ok(ownerCookie, "owner login missing");
    const created = await asUser(ownerCookie!, () => createChat(undefined, "eval-rollback"));
    const chat = created.id;
    ctx.ids["rollbackChat"] = chat;
    const seed = await assertOk(ctx, ownerCookie, `/api/me/chats/${chat}`, {
      method: "PATCH",
      body: {
        messages: [{ id: "msg-ok", role: "user", content: "before rollback" }],
        memory: { round: "before" },
      },
    });
    assert.equal(seed.status, 200);
    const before = await httpJson(ctx, ownerCookie, `/api/me/chats/${chat}`);
    // duplicate message ids violate the chat_messages PK on the second insert
    const dup = await httpJson(ctx, ownerCookie, `/api/me/chats/${chat}`, {
      method: "PATCH",
      body: {
        messages: [
          { id: "msg-dup", role: "user", content: "first" },
          { id: "msg-dup", role: "user", content: "second" },
        ],
        memory: { round: "after-failed-turn" },
      },
    });
    assert.ok(
      dup.status >= 500 || dup.status === 400,
      `expected a failure status for duplicate ids, got ${dup.status}`
    );
    const after = await httpJson(ctx, ownerCookie, `/api/me/chats/${chat}`);
    assert.deepEqual(
      { messages: after.json.messages, memory: after.json.memory },
      { messages: before.json.messages, memory: before.json.memory },
      "failed PATCH must roll back completely: messages AND memory unchanged"
    );
    // Read-only SQLite probe — the DB file is a PREREQUISITE of this runtime,
    // so a missing/unopenable store is a FAILURE, not a skipped advisory.
    // The connection is always closed in finally.
    const dbPath = `${ctx.dataDir}/cortex-chat.db`;
    assert.ok(existsSync(dbPath), `isolated SQLite store must exist at ${dbPath}`);
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const rows = db
        .prepare(
          "SELECT id, content FROM chat_messages WHERE chat_session_id = ? ORDER BY created_at"
        )
        .all(chat);
      const mem = db.prepare("SELECT memory FROM chat_sessions WHERE id = ?").get(chat);
      assert.deepEqual(
        {
          messages: rows.map((r: { id: string; content: string }) => ({
            id: r.id,
            content: r.content,
          })),
          memory: mem?.memory ? JSON.parse(mem.memory) : undefined,
        },
        {
          messages: before.json.messages.map((m: { id: string; content: string }) => ({
            id: m.id,
            content: m.content,
          })),
          memory: before.json.memory,
        },
        "read-only SQLite probe: rolled-back rows must be absent at the storage layer too"
      );
    } finally {
      db.close();
    }
    return "duplicate-id PATCH failed and left messages+memory untouched (HTTP + read-only SQLite)";
  });

  // -- forged author validation on the private chat (explicit negative) ------

  await add("authors.forged-echo-dropped-and-history-preserved", async () => {
    assert.ok(ownerCookie, "owner login missing");
    const { json } = await httpJson(ctx, ownerCookie, `/api/me/chats/${chatId}`);
    const byId = new Map<string, any>((json.messages ?? []).map((m: any) => [m.id, m]));
    // turn-1 message: echoed back through the turn-2 full replace — its
    // stored prior non-null author must be preserved by id.
    assert.ok(byId.get("msg-user-1"), "turn-1 user message missing (history must be retained)");
    assert.equal(
      byId.get("msg-user-1")?.authorId,
      ctx.users.owner.id,
      "turn-1 prior non-null author must be preserved across the turn-2 full replace"
    );
    // turn-2 message: the persist carried a forged echo on a NEW id — the
    // server must drop it and stamp the caller.
    assert.ok(byId.get("msg-user-2"), "turn-2 user message missing");
    assert.equal(
      byId.get("msg-user-2")?.authorId,
      ctx.users.owner.id,
      "new message must be stamped with the CALLER id"
    );
    assert.notEqual(
      byId.get("msg-user-2")?.authorId,
      FORGED_AUTHOR_ID,
      "echoed authorId must never be stored"
    );
    return "forged echo dropped on the new id; prior non-null author preserved across the replace";
  });

  // -- cleanup: leave the runtime a benign default handler (function only —
  //    the runtime refuses setHandler(null); this one ends responses itself
  //    so it never parks anything in upstream.pending).

  ctx.upstream.setHandler((req, res) => {
    void req;
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
    res.write(frame({ content: "ok" }));
    res.write(frame({ done: true }));
    res.end();
  });

  // -- code-level page.tsx race findings (preserved, NOT fixed) ---------------

  findings.push(...pageTsxFindings());

  return { checks, findings };
}

/*
 * Findings from reading the actual page.tsx late-memory callbacks. These are
 * CANDIDATE defects from code-path/event-order analysis — preserved as a
 * bounded reproduction for a separately scoped follow-up, not fixed here, and
 * NOT reproduced in a browser (no browser evidence exists in this slice).
 */
function pageTsxFindings(): MemoryFinding[] {
  return [
    {
      id: "page.tsx.race.late-memory-persists-next-turns-streaming-bubble",
      severity: "defect",
      title: "Late memory_update re-persist can snapshot the NEXT turn's in-flight state into the DB",
      detail:
        "Reproduction (event order, code refs): turn 1 done arrives -> onDone sets isLoading=false (page.tsx:637) and persists (doneSeen=true). isLoading=false admits a second send (guard at page.tsx:401). While turn 2 streams, turn 1's late memory_update fires its closure's onMemoryUpdate (page.tsx:602-615): it overwrites the SHARED memoryRef.current and calls setMessages(prev => { finalize(prev); return prev }) — finalize persists whatever is in state at that instant (page.tsx:499-505), i.e. turn 2's messages INCLUDING the streaming assistant bubble (isStreaming: true, partial content). If the user closes the tab before turn 2 settles, the DB keeps a phantom streaming assistant message; the next session load starts from that polluted base (fresh-merge at page.tsx:410-417 reads exactly this row for project chats). Self-heals only if turn 2 later settles a full replace.",
      evidence:
        "src/app/page.tsx:401, 410-417, 499-505, 523, 602-615, 637 — code-path analysis; no browser reproduction in this slice",
    },
    {
      id: "page.tsx.race.late-memory-clobbers-regenerate-snapshot",
      severity: "defect",
      title: "Late memory_update lands during regenerate/edit and defeats the memoryAtSend snapshot",
      detail:
        "Reproduction (event order, code refs): turn 1 done persists; user clicks regenerate BEFORE the late memory_update lands. Regenerate restores memoryRef.current = memoryAtSendRef.current (page.tsx:785) so the redo does not remember the answer it replaces (documented incident constraint, chat-streaming-memory guide). Then turn 1's late onMemoryUpdate fires: memoryRef.current = <turn-1 post-answer blob> unconditionally (page.tsx:604) and, doneSeen=true, triggers finalize(prev) — persisting the regenerate's in-flight thread TOGETHER WITH the pre-redo memory. The redo turn's own onDone finalize (page.tsx:634) then persists memoryRef.current — the answer the redo was meant to forget. Violates the documented regenerate constraint; same mechanism applies to edit-last.",
      evidence:
        "src/app/page.tsx:602-615, 785, 801, 634 vs. chat-streaming-memory guide 'Regenerate vs. the opaque memory blob' — code-path analysis; no browser reproduction in this slice",
    },
    {
      id: "page.tsx.observation.persist-inside-setmessages-updater",
      severity: "observation",
      title: "finalize() runs inside a setMessages updater (side effect in the updater path)",
      detail:
        "Both onDone and the late-memory path call finalize inside the setMessages updater callback (page.tsx:610-614, 618-636). React may invoke updaters more than once (StrictMode dev double-invocation), so the persistence PATCH can be emitted twice — benign today because PATCH is an idempotent full replace, but it couples a network side effect to render-phase code. Related to the two race findings; fold into the same follow-up.",
      evidence: "src/app/page.tsx:609-615, 616-638",
    },
  ];
}
