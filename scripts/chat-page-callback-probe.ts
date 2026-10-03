// Source-extracted page late-callback evaluation. Two layers:
//
// 1. Reusable POSITIVE deterministic oracles (implementation-independent, over
//    recorded client-side persistence writes + final replay memory). They are
//    the intended-behavior gates for the authorized fix and are shared with
//    tests/chat-page-callback-oracle.test.ts, which runs the SAME oracles
//    against the retained defective baseline fixture to prove gate
//    sensitivity (assertion rejection, never extraction/transport error).
// 2. HTTP scenarios that execute the ACTUAL finalize/onMemoryUpdate/onDone —
//    and the turn-wiring helpers (isTurnVisible/updateTurn/finishLoading) —
//    extracted from the live src/app/page.tsx, bound per LocalTurn with a
//    synchronous state adapter and real PATCH/GET persistence. Extraction is
//    unambiguous and fails loudly; it can never masquerade as an oracle
//    rejection. The retained baseline fixture (old callback shape, frozen
//    expressions + provenance) is exercised separately in the pure test.
//
// This is source-assisted callback + HTTP evidence, NOT React/browser
// evidence. Scenarios are positive gates: ok means the intended behavior was
// observed, not that a defect was reproduced.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { isRefusalText } from "../src/lib/answer-flags";
import type { MemoryChecksCtx } from "./chat-memory-checks";

const PAGE = fileURLToPath(new URL("../src/app/page.tsx", import.meta.url));

export type PageCallbackName =
  | "finalize" | "onMemoryUpdate" | "onDone"
  | "updateTurn" | "isTurnVisible" | "finishLoading";

/** Verbatim initializer texts extracted from a page.tsx source. */
export function extractPageCallbackExpressions(
  pageSource: string,
  requested: PageCallbackName[],
  pagePath = "src/app/page.tsx"
): Partial<Record<PageCallbackName, string>> {
  const file = ts.createSourceFile(pagePath, pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Partial<Record<PageCallbackName, string[]>> = {};
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) && node.initializer &&
      ["finalize", "updateTurn", "isTurnVisible", "finishLoading"].includes(node.name.getText(file))
    ) (found[node.name.getText(file) as PageCallbackName] ??= []).push(node.initializer.getText(file));
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(file);
      if (name === "onMemoryUpdate") (found.onMemoryUpdate ??= []).push(node.initializer.getText(file));
      if (name === "onDone") (found.onDone ??= []).push(node.initializer.getText(file));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  const out: Partial<Record<PageCallbackName, string>> = {};
  for (const name of requested) {
    const matches = found[name] ?? [];
    assert.equal(
      matches.length, 1,
      `source extraction of ${name} must be unambiguous (got ${matches.length})`
    );
    out[name] = matches[0];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reusable positive deterministic oracles (§9.2: derived from the intended
// rule — late state belongs to its originating turn/session; preserve
// regenerate/edit-last snapshots; never persist another in-flight turn via a
// prior callback — not from the defective baseline's behavior).
// ---------------------------------------------------------------------------

export interface PageLateWrite {
  sessionId: string;
  messages: unknown[];
  memory: unknown;
}

export interface PageLateOutcome {
  writes: PageLateWrite[];
  finalMemoryRef: unknown;
}

/** Obligation 1 — no later in-flight turn content persisted by a prior turn's callback. */
export function assertNoLaterInflightPersisted(
  originSessionId: string,
  outcome: PageLateOutcome,
  laterInflightIds: string[]
): void {
  const originWrites = outcome.writes.filter(w => w.sessionId === originSessionId);
  assert.ok(
    originWrites.length > 0,
    "late callback must persist its originating turn's own state"
  );
  for (const w of originWrites) {
    for (const lateId of laterInflightIds) {
      const leaked = (w.messages as Array<{ id?: unknown }>).some(m => m && m.id === lateId);
      assert.ok(
        !leaked,
        `late prior-turn callback must not persist a later turn's in-flight answer (message ${lateId} persisted to session ${originSessionId})`
      );
    }
  }
}

/** Obligation 2 — a restored regenerate/edit-last memory snapshot stays untouched. */
export function assertRestoredSnapshotUntouched(
  outcome: PageLateOutcome,
  snapshot: unknown
): void {
  assert.deepEqual(
    outcome.finalMemoryRef, snapshot,
    "late superseded callback must not clobber the restored regenerate/edit snapshot (turn replay memory)"
  );
  for (const w of outcome.writes) {
    assert.deepEqual(
      w.memory, snapshot,
      "late superseded callback must not persist over the restored regenerate/edit snapshot (session write memory)"
    );
  }
}

export interface SessionBoundLateExpectation {
  lateOriginMemory: unknown;
  originMessageIds: string[];
  foreignMessageIds?: string[];
}

/** Obligation 3 — late callback is bound to its own session and retains its own turn's state. */
export function assertSessionBoundLateRetention(
  originSessionId: string,
  outcome: PageLateOutcome,
  expected: SessionBoundLateExpectation
): void {
  const originWrites = outcome.writes.filter(w => w.sessionId === originSessionId);
  assert.ok(originWrites.length > 0, "late callback must persist its originating session");
  assert.equal(
    outcome.writes.length, originWrites.length,
    "late callback must write only its originating session (bound to the originating turn/session, not the active view)"
  );
  const last = originWrites[originWrites.length - 1];
  assert.deepEqual(
    last.memory, expected.lateOriginMemory,
    "late callback must retain and persist the originating turn's own memory blob"
  );
  const persistedIds = (last.messages as Array<{ id?: unknown }>).map(m => m?.id);
  assert.deepEqual(
    persistedIds, expected.originMessageIds,
    "late callback must persist the originating turn's own settled snapshot, not the currently active session's messages"
  );
  if (expected.foreignMessageIds?.length) {
    const foreign = (last.messages as Array<{ id?: unknown }>)
      .some(m => expected.foreignMessageIds!.includes(m.id as string));
    assert.ok(
      !foreign,
      "late callback must not persist another session's messages into its originating session"
    );
  }
}

export interface HealthySettledExpectation {
  settledMessageIds: string[];
  lateBlob: unknown;
}

/** Healthy control — settled turn keeps history and the late blob, verbatim. */
export function assertHealthySettledRetention(
  originSessionId: string,
  outcome: PageLateOutcome,
  expected: HealthySettledExpectation
): void {
  const originWrites = outcome.writes.filter(w => w.sessionId === originSessionId);
  assert.ok(originWrites.length > 0, "settled turn must be persisted at least once");
  for (const w of originWrites) {
    const ids = (w.messages as Array<{ id?: unknown }>).map(m => m?.id);
    assert.deepEqual(
      ids, expected.settledMessageIds,
      "settled persist must carry the settled history in order"
    );
  }
  assert.deepEqual(
    outcome.finalMemoryRef, expected.lateBlob,
    "late blob must be stored verbatim for next-turn replay"
  );
  assert.deepEqual(
    originWrites[originWrites.length - 1].memory, expected.lateBlob,
    "settled turn must be re-persisted with the late memory blob"
  );
}

export interface LegacyPersistExpectation {
  settledMessageIds: string[];
  freshBlob: unknown;
}

/** Healthy control — legacy memory-before-done order persists exactly once, already carrying the fresh blob. */
export function assertLegacySinglePersist(
  originSessionId: string,
  outcome: PageLateOutcome,
  expected: LegacyPersistExpectation
): void {
  const originWrites = outcome.writes.filter(w => w.sessionId === originSessionId);
  assert.equal(
    originWrites.length, 1,
    "legacy memory-before-done order must persist exactly once, in onDone"
  );
  assert.deepEqual(
    originWrites[0].memory, expected.freshBlob,
    "legacy persist must already carry the fresh memory blob"
  );
  const ids = (originWrites[0].messages as Array<{ id?: unknown }>).map(m => m?.id);
  assert.deepEqual(
    ids, expected.settledMessageIds,
    "legacy persist must carry the settled history in order"
  );
}

// ---------------------------------------------------------------------------
// Synchronous recording page-state adapter (shared by the HTTP scenarios and
// the pure fixture test). Writes are frozen at call time so later driver
// changes cannot alter recorded evidence.
// ---------------------------------------------------------------------------

export interface RecordingPageAdapter {
  messages: any[];
  readonly memoryRef: { current: unknown };
  readonly writes: PageLateWrite[];
  setMessages(fn: (prev: any) => any): void;
  updateChatMessages(sessionId: string, messages: unknown, memory: unknown): Promise<unknown>;
  /** Index of the next write — used to scope a schedule window. */
  mark(): number;
  outcome(from?: number): PageLateOutcome;
  drain(): Promise<void>;
}

export function createRecordingPageAdapter(opts?: {
  persist?: (sessionId: string, messages: unknown, memory: unknown) => Promise<unknown>;
}): RecordingPageAdapter {
  let messages: any[] = [];
  const memoryRef: { current: unknown } = { current: undefined };
  const writes: PageLateWrite[] = [];
  const pending: Promise<unknown>[] = [];
  const freeze = (v: unknown): unknown => (v === undefined ? v : structuredClone(v));
  return {
    get messages() { return messages; },
    set messages(v: any[]) { messages = v; },
    memoryRef,
    writes,
    setMessages(fn: (prev: any) => any) { messages = fn(messages); },
    updateChatMessages(sessionId: string, snapshot: unknown, memory: unknown) {
      const write: PageLateWrite = {
        sessionId,
        messages: (freeze(snapshot) ?? []) as unknown[],
        memory: freeze(memory),
      };
      writes.push(write);
      const done = (opts?.persist
        ? opts.persist(sessionId, snapshot, memory)
        : Promise.resolve()
      ).then(() => write);
      pending.push(done);
      return done;
    },
    mark() { return writes.length; },
    outcome(from = 0) {
      return { writes: writes.slice(from), finalMemoryRef: memoryRef.current };
    },
    async drain() { await Promise.all(pending); },
  };
}

// ---------------------------------------------------------------------------
// Live extraction + turn-bound candidate bindings + HTTP scenarios.
// ---------------------------------------------------------------------------

/** Structural mirror of the page's LocalTurn (interface is module-private there). */
export interface PageLocalTurn {
  sessionId: string;
  view: number;
  messages: any[];
  memory: unknown;
  memoryAtSend: unknown;
  hasMemoryUpdate: boolean;
  superseded: boolean;
  previous?: PageLocalTurn;
}

export interface PageTurnRefs {
  memoryRef: { current: unknown };
  memoryAtSendRef: { current: unknown };
  activeSessionRef: { current: string | null };
  viewRef: { current: number };
  latestTurnRef: { current: Map<string, PageLocalTurn> };
  /** Value-setter (updateTurn calls setMessages(turn.messages)). */
  setMessages: (value: any[]) => void;
  persistSession: (sessionId: string, messages: unknown, memory: unknown) => Promise<unknown>;
  setIsLoading?: (v: boolean) => void;
}

export interface CandidateTurnCallbacks {
  turn: PageLocalTurn;
  finalize: (finalMessages: any) => unknown;
  onMemoryUpdate: (memory: unknown) => void;
  onDone: (flags: unknown) => void;
}

let cachedRaw: Partial<Record<PageCallbackName, string>> | null = null;
function rawCandidateExpressions() {
  return (cachedRaw ??= extractPageCallbackExpressions(readFileSync(PAGE, "utf8"), [
    "finalize", "onMemoryUpdate", "onDone", "updateTurn", "isTurnVisible", "finishLoading",
  ]));
}

function transpiledExpression(raw: string): string {
  return ts.transpileModule(`(${raw})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}

function scopedFn(params: string[], raw: string): (...args: unknown[]) => any {
  const factory = new Function(...params, `return ${transpiledExpression(raw)}`);
  return (...args: unknown[]) => factory(...args);
}

const FREE_IDENTIFIER_ALLOWLIST = new Set(["undefined"]);

/**
 * Fails loudly if an extracted expression references a free identifier the
 * adapter does not bind — a page edit adding a new dependency (e.g. another
 * ref) can never silently ReferenceError deep inside a scenario run. The
 * expression's own parameters and local declarations are self-bound
 * (conservatively, without scope analysis); type annotations are ignored.
 */
function assertExpressionBound(raw: string, bound: string[], name: string): void {
  const file = ts.createSourceFile(
    "binding-check.ts", `(${raw})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS
  );
  const declared = new Set(bound);
  const collectDeclared = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      if ((ts.isParameter(parent) || ts.isVariableDeclaration(parent)) && parent.name === node)
        declared.add(node.text);
      if (ts.isCatchClause(parent) && parent.variableDeclaration?.name === node)
        declared.add(node.text);
    }
    ts.forEachChild(node, collectDeclared);
  };
  collectDeclared(file);
  const refs = new Set<string>();
  const collectRefs = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const skipped =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isMethodDeclaration(parent) && parent.name === node) ||
        (ts.isLabeledStatement(parent) && parent.label === node) ||
        (ts.isParameter(parent) || ts.isVariableDeclaration(parent))
          && parent.name === node ||
        (ts.isCatchClause(parent) && parent.variableDeclaration?.name === node);
      if (!skipped) refs.add(node.text);
      return;
    }
    ts.forEachChild(node, collectRefs);
  };
  collectRefs(file);
  const unbound = [...refs].filter(r => !declared.has(r) && !FREE_IDENTIFIER_ALLOWLIST.has(r));
  assert.equal(
    unbound.length, 0,
    `extraction binding check for ${name}: unbound free identifiers ${JSON.stringify(unbound)} — adapt the bindings before judging any scenario`
  );
}

/**
 * Creates one LocalTurn exactly as handleSend does (previous chain captured,
 * redo supersedes the entire previous chain before the new turn exists) and
 * binds the extracted expressions to it.
 *
 * Explicit adapter assumption (same as the baseline fixture): `doneSeen` is a
 * mutable local of the real streaming closure; the extracted expressions
 * receive its CURRENT value per call and `doneSeen = true` inside onDone is
 * applied by the driver right after the call. doneSeen is PER TURN.
 */
export function buildCandidateTurnCallbacks(
  refs: PageTurnRefs,
  init: { sessionId: string; assistantId: string; messages: any[]; baseOverride?: boolean }
): CandidateTurnCallbacks {
  const raw = rawCandidateExpressions();
  const bindingChecks: [PageCallbackName, string[]][] = [
    ["isTurnVisible", ["activeSessionRef", "sessionId", "viewRef", "view", "latestTurnRef", "turn"]],
    ["updateTurn", ["turn", "isTurnVisible", "setMessages"]],
    ["finishLoading", ["isTurnVisible", "setIsLoading"]],
    ["finalize", ["turn", "sessionId", "persistSession"]],
    ["onMemoryUpdate", ["turn", "latestTurnRef", "sessionId", "memoryRef", "memoryAtSendRef", "setMessages", "activeSessionRef", "viewRef", "doneSeen", "finalize"]],
    ["onDone", ["doneSeen", "updateTurn", "assistantId", "isRefusalText", "finalize", "finishLoading", "turn"]],
  ];
  for (const [name, bound] of bindingChecks) assertExpressionBound(raw[name]!, bound, name);

  const previousTurn = refs.latestTurnRef.current.get(init.sessionId);
  if (init.baseOverride) {
    for (let old = previousTurn; old; old = old.previous) old.superseded = true;
  }
  const turn: PageLocalTurn = {
    sessionId: init.sessionId, view: refs.viewRef.current, messages: init.messages,
    memory: refs.memoryRef.current, memoryAtSend: refs.memoryRef.current, hasMemoryUpdate: false, superseded: false,
    previous: previousTurn,
  };
  refs.latestTurnRef.current.set(init.sessionId, turn);
  refs.memoryAtSendRef.current = refs.memoryRef.current;
  let doneSeen = false;

  const isTurnVisibleImpl = scopedFn(
    ["activeSessionRef", "sessionId", "viewRef", "view", "latestTurnRef", "turn"], raw.isTurnVisible!);
  const isTurnVisible = () =>
    isTurnVisibleImpl(refs.activeSessionRef, init.sessionId, refs.viewRef, turn.view, refs.latestTurnRef, turn)();

  const updateTurnImpl = scopedFn(["turn", "isTurnVisible", "setMessages"], raw.updateTurn!);
  const updateTurn = (update: (prev: any) => any) =>
    updateTurnImpl(turn, isTurnVisible, refs.setMessages)(update);

  const finishLoadingImpl = scopedFn(["isTurnVisible", "setIsLoading"], raw.finishLoading!);
  const finishLoading = () => finishLoadingImpl(isTurnVisible, refs.setIsLoading ?? (() => {}))();

  const finalizeImpl = scopedFn(["turn", "sessionId", "persistSession"], raw.finalize!);
  const finalize = (finalMessages: unknown) =>
    finalizeImpl(turn, init.sessionId, refs.persistSession)(finalMessages);

  const onMemoryUpdateImpl = scopedFn(
    ["turn", "latestTurnRef", "sessionId", "memoryRef", "memoryAtSendRef", "setMessages", "activeSessionRef", "viewRef", "doneSeen", "finalize"],
    raw.onMemoryUpdate!);
  const onMemoryUpdate = (memory: unknown) =>
    onMemoryUpdateImpl(turn, refs.latestTurnRef, init.sessionId, refs.memoryRef, refs.memoryAtSendRef, refs.setMessages,
      refs.activeSessionRef, refs.viewRef, doneSeen, finalize)(memory);

  const onDoneImpl = scopedFn(
    ["doneSeen", "updateTurn", "assistantId", "isRefusalText", "finalize", "finishLoading", "turn", "flags"],
    raw.onDone!);
  const onDone = (flags: unknown) => {
    onDoneImpl(doneSeen, updateTurn, init.assistantId, isRefusalText, finalize, finishLoading, turn)(flags);
    doneSeen = true;
  };

  return { turn, finalize, onMemoryUpdate, onDone };
}

const u = (id: string) => ({ id, role: "user", content: `question ${id}` });
const a = (id: string, streaming: boolean) => ({
  id, role: "assistant", content: `answer ${id}`, isStreaming: streaming,
});

function gateRejection(rejection: unknown) {
  return rejection instanceof assert.AssertionError
    ? { assertion: true, message: rejection.message }
    : { assertion: false, message: String(rejection) };
}

function jsonEquals(x: unknown, y: unknown): boolean {
  try { assert.deepEqual(x, y); return true; } catch { return false; }
}

const assertTransport = (sts: { sessionId: string; status: number }[], what: string) =>
  assert.ok(sts.every(s => s.status === 200),
    `${what}: every persistence write must succeed (got ${JSON.stringify(sts)})`);

// Records transport status instead of asserting: a rejected persist (e.g. the
// server's globally-unique chat_messages PK rejecting another session's
// message ids) is itself durable defect evidence, judged per gate outcome.
// Dispatches are serialized per session (FIFO) to mirror the page's
// persistSession write-queue contract — raw concurrent fetches would let the
// server's LWW re-apply an older full snapshot after a newer one, an adapter
// artifact, not candidate behavior.
function persistPatch(
  ctx: MemoryChecksCtx,
  cookie: string,
  statuses: { sessionId: string; status: number }[]
) {
  const queues = new Map<string, Promise<unknown>>();
  const dispatch = (sessionId: string, messages: unknown, memory: unknown) =>
    ctx.request(`/api/me/chats/${sessionId}`, {
      method: "PATCH", cookie, body: { messages, memory },
    }).then(async res => {
      statuses.push({ sessionId, status: res.status });
      if (res.status === 200) return res.json();
      return { persistErrorStatus: res.status };
    });
  return (sessionId: string, messages: unknown, memory: unknown) => {
    const prev = queues.get(sessionId) ?? Promise.resolve();
    const write = prev.catch(() => {}).then(() => dispatch(sessionId, messages, memory));
    queues.set(sessionId, write.catch(() => {}));
    return write;
  };
}

async function reload(ctx: MemoryChecksCtx, cookie: string, id: string) {
  const res = await ctx.request(`/api/me/chats/${id}`, { cookie });
  assert.equal(res.status, 200);
  return res.json();
}

const LIMITATION = "source-extracted turn-bound callbacks + HTTP, synchronous state adapter; no React/browser";

function makeTurnDriver(adapter: RecordingPageAdapter, sessionId: string): PageTurnRefs {
  return {
    memoryRef: adapter.memoryRef,
    memoryAtSendRef: { current: undefined as unknown },
    activeSessionRef: { current: sessionId as string | null },
    viewRef: { current: 1 },
    latestTurnRef: { current: new Map<string, PageLocalTurn>() },
    setMessages: (value: any[]) => { adapter.messages = value; },
    persistSession: adapter.updateChatMessages,
  };
}

export async function runPageCallbackProbes(ctx: MemoryChecksCtx) {
  const login = await ctx.request("/api/auth/login", { method: "POST", body: ctx.users.owner });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const checks: { id: string; ok: boolean; detail: unknown }[] = [];

  for (const scenario of [
    "healthy-settled", "legacy-order", "next-turn-inflight",
    "regenerate-reset", "edit-last-reset", "session-switch",
  ]) {
    const created = await ctx.request("/api/me/chats", { method: "POST", cookie, body: { title: `probe-${scenario}` } });
    assert.equal(created.status, 200);
    const { id } = await created.json();
    const statuses: { sessionId: string; status: number }[] = [];
    const adapter = createRecordingPageAdapter({ persist: persistPatch(ctx, cookie, statuses) });
    const refs = makeTurnDriver(adapter, id);
    let ok = true;
    let rejection: unknown = null;
    const fail = (e: unknown) => { ok = false; rejection = e; };
    let intended: string;
    let gateId: string;
    let extra: Record<string, unknown> = {};

    if (scenario === "healthy-settled") {
      gateId = "page.healthy-settled-control";
      intended = "settled turn persists history in order and re-persists with the late blob verbatim";
      refs.memoryRef.current = { marker: "healthy-blob-as-of-done" };
      const origin = buildCandidateTurnCallbacks(refs, {
        sessionId: id, assistantId: "fx-healthy-a1",
        messages: [u("fx-healthy-u1"), a("fx-healthy-a1", true)],
      });
      origin.onDone({});
      const late = { marker: "healthy-late-blob" };
      origin.onMemoryUpdate(late);
      await adapter.drain();
      const stored = await reload(ctx, cookie, id);
      try {
        assertTransport(statuses, "healthy-settled");
        assertHealthySettledRetention(id, adapter.outcome(), {
          settledMessageIds: ["fx-healthy-u1", "fx-healthy-a1"], lateBlob: late,
        });
        assert.deepEqual(stored.memory, late, "reload must show the late blob verbatim");
        assert.equal(stored.messages.length, 2, "reload must show the settled history");
      } catch (e) { fail(e); }
    } else if (scenario === "legacy-order") {
      gateId = "page.legacy-preserved-control";
      intended = "legacy memory-before-done order persists exactly once, in onDone, already carrying the fresh blob";
      refs.memoryRef.current = { marker: "stale" };
      const origin = buildCandidateTurnCallbacks(refs, {
        sessionId: id, assistantId: "fx-legacy-a1",
        messages: [u("fx-legacy-u1"), a("fx-legacy-a1", true)],
      });
      origin.onMemoryUpdate({ marker: "fresh" }); // doneSeen false — no persist yet
      let preconditionError: unknown = null;
      try {
        assert.equal(adapter.writes.length, 0, "legacy order: nothing may persist before done");
      } catch (e) { preconditionError = e; }
      origin.onDone({});
      await adapter.drain();
      const stored = await reload(ctx, cookie, id);
      try {
        if (preconditionError) throw preconditionError;
        assertTransport(statuses, "legacy-order");
        assertLegacySinglePersist(id, adapter.outcome(), {
          settledMessageIds: ["fx-legacy-u1", "fx-legacy-a1"], freshBlob: { marker: "fresh" },
        });
        assert.deepEqual(stored.memory, { marker: "fresh" }, "reload must show the fresh blob");
        assert.equal(stored.messages.length, 2, "reload must show the settled history");
      } catch (e) { fail(e); }
    } else if (scenario === "next-turn-inflight") {
      gateId = "page.no-later-inflight-gate";
      intended = "a prior turn's late callback never persists a later turn's in-flight answer";
      refs.memoryRef.current = { marker: "pre-answer-snapshot" };
      const origin = buildCandidateTurnCallbacks(refs, {
        sessionId: id, assistantId: "fx-next-a1",
        messages: [u("fx-next-u1"), a("fx-next-a1", true)],
      });
      origin.onDone({});
      await adapter.drain();
      // Ordinary next send (no baseOverride): origin turn stays valid; the
      // new live turn is latest with previous=origin, still in-flight.
      const next = buildCandidateTurnCallbacks(refs, {
        sessionId: id, assistantId: "fx-next-a2",
        messages: [u("fx-next-u1"), a("fx-next-a1", false), u("fx-next-u2"),
          { id: "fx-next-a2", role: "assistant", content: "partial next answer", isStreaming: true }],
      });
      const windowStart = adapter.mark();
      origin.onMemoryUpdate({ marker: "turn-1-late-blob" });
      await adapter.drain();
      const stored = await reload(ctx, cookie, id);
      try {
        assertTransport(statuses, "next-turn-inflight");
        assertNoLaterInflightPersisted(id, adapter.outcome(windowStart), ["fx-next-a2"]);
      } catch (e) { fail(e); }
      if (ok) {
        try {
          assert.ok(!stored.messages.some((m: any) => m.id === "fx-next-a2"),
            "intended gate accepted but durable state still contains the later in-flight answer");
        } catch (e) { fail(e); }
      } else {
        assert.ok(stored.messages.some((m: any) => m.id === "fx-next-a2" && m.content === "partial next answer"),
          "gate rejected the outcome but durable state lacks the defect signature — diagnose before judging");
      }
      extra = { laterInflightId: "fx-next-a2", windowedFrom: windowStart, originTurnStillValid: true };
    } else if (scenario === "regenerate-reset" || scenario === "edit-last-reset") {
      const edit = scenario === "edit-last-reset";
      gateId = edit ? "page.edit-last-snapshot-gate" : "page.regenerate-snapshot-gate";
      intended = "late superseded callback leaves the restored pre-turn memory snapshot untouched (ref and persisted writes)";
      const p = edit ? "fx-edit" : "fx-regen";
      refs.memoryRef.current = { marker: "pre-answer-snapshot" };
      const origin = buildCandidateTurnCallbacks(refs, {
        sessionId: id, assistantId: `${p}-a1`,
        messages: [u(`${p}-u1`), a(`${p}-a1`, true)],
      });
      origin.onDone({});
      await adapter.drain();
      // Redo (regenerate or edit-last) restores the pre-turn snapshot and
      // supersedes the entire previous chain BEFORE the late blob lands.
      const snapshot = { marker: "pre-answer-snapshot" };
      const windowStart = adapter.mark();
      refs.memoryRef.current = refs.memoryAtSendRef.current;
      const redo = buildCandidateTurnCallbacks(refs, {
        sessionId: id, assistantId: `${p}-redo-a`, baseOverride: true,
        messages: [u(`${p}-redo-u`),
          { id: `${p}-redo-a`, role: "assistant", content: "partial redo", isStreaming: true }],
      });
      assert.equal(origin.turn.superseded, true,
        "redo must supersede the replaced turn before its late blob can land");
      const superseded = { marker: "superseded-post-answer" };
      origin.onMemoryUpdate(superseded);
      await adapter.drain();
      const stored = await reload(ctx, cookie, id);
      try {
        assertTransport(statuses, scenario);
        assertRestoredSnapshotUntouched(adapter.outcome(windowStart), snapshot);
      } catch (e) { fail(e); }
      if (ok) {
        try {
          assert.ok(!jsonEquals(stored.memory, superseded),
            "intended gate accepted but durable state carries the superseded blob");
        } catch (e) { fail(e); }
      } else {
        assert.deepEqual(stored.memory, superseded,
          "gate rejected the outcome but durable state lacks the defect signature — diagnose before judging");
      }
      extra = {
        snapshot, superseded, windowedFrom: windowStart,
        redoRequest: "already sent with the pre-turn blob; not retroactively changed",
      };
    } else {
      gateId = "page.session-isolation-gate";
      intended = "late callback writes only its originating session with its own turn snapshot + own blob; active session untouched";
      const createdB = await ctx.request("/api/me/chats", { method: "POST", cookie, body: { title: "probe-session-switch-other" } });
      assert.equal(createdB.status, 200);
      const { id: idB } = await createdB.json();
      const bMessages = [u("fx-switch-b-u1"), a("fx-switch-b-a1", false)];
      const bMemory = { marker: "foreign-session-memory" };
      const seedB = await ctx.request(`/api/me/chats/${idB}`, { method: "PATCH", cookie, body: { messages: bMessages, memory: bMemory } });
      assert.equal(seedB.status, 200);
      refs.memoryRef.current = { marker: "origin-blob-as-of-done" };
      const origin = buildCandidateTurnCallbacks(refs, {
        sessionId: id, assistantId: "fx-switch-a-a1",
        messages: [u("fx-switch-a-u1"), a("fx-switch-a-a1", true)],
      });
      origin.onDone({});
      await adapter.drain();
      // User switches to chat B: new view epoch, active session B, B's
      // memory/message view loaded; then A's late blob lands.
      const windowStart = adapter.mark();
      refs.viewRef.current += 1;
      refs.activeSessionRef.current = idB;
      refs.memoryRef.current = bMemory;
      refs.setMessages(bMessages);
      buildCandidateTurnCallbacks(refs, {
        sessionId: idB, assistantId: "fx-switch-b-a1", messages: bMessages,
      });
      const lateA = { marker: "origin-late-blob" };
      origin.onMemoryUpdate(lateA);
      await adapter.drain();
      const storedA = await reload(ctx, cookie, id);
      const storedB = await reload(ctx, cookie, idB);
      try {
        assertSessionBoundLateRetention(id, adapter.outcome(windowStart), {
          lateOriginMemory: lateA,
          originMessageIds: ["fx-switch-a-u1", "fx-switch-a-a1"],
          foreignMessageIds: ["fx-switch-b-u1", "fx-switch-b-a1"],
        });
        assertTransport(statuses, "session-switch");
        assert.deepEqual(storedB.memory, bMemory, "durable foreign session memory must be untouched");
        assert.deepEqual((storedB.messages as any[]).map((m: any) => m.id),
          ["fx-switch-b-u1", "fx-switch-b-a1"], "durable foreign session messages must be untouched");
        assert.ok(!storedA.messages.some((m: any) => String(m.id).startsWith("fx-switch-b-")),
          "originating session durable state must not contain the active session's messages");
        assert.deepEqual(storedA.memory, lateA, "origin session durable state must retain its own late blob");
      } catch (e) { fail(e); }
      if (!ok) {
        // Defect reality (also observed on the retained baseline): the late
        // write attempt carries the active session's message ids, which the
        // server's globally-unique chat_messages PK rejects — and the
        // callback chain swallows the failure, so the origin turn's late
        // memory is silently LOST.
        try {
          assert.ok(statuses.slice(0, -1).every(s => s.status === 200),
            `all writes except the rejected late one must succeed (got ${JSON.stringify(statuses)})`);
          assert.notEqual(statuses[statuses.length - 1].status, 200,
            "late origin write must not durably succeed while the gate rejects its content");
          assert.ok(!jsonEquals(storedA.memory, lateA),
            "origin late blob must not be durable when the gate rejects the late write");
        } catch (e) { fail(e); }
      }
      extra = { originChatId: id, activeChatId: idB };
    }

    checks.push({
      id: gateId, ok,
      detail: {
        claim: ok
          ? "positive intended-behavior gate passed"
          : "positive intended-behavior gate FAILED — intended runtime behavior not observed",
        scenario, intended, chatId: id,
        persistStatuses: statuses,
        ...(ok ? {} : { rejection: gateRejection(rejection) }),
        ...extra,
        limitation: LIMITATION,
      },
    });
  }
  return checks;
}
