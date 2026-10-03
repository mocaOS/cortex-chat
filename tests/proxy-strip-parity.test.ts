import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// STRUCTURAL GATE (explicitly not behavioral): both ask proxies must strip the
// three chat-local identifiers (`session_id`, `assistant_id`, `project_id`)
// before forwarding upstream. Since backend 1.2.0 a leaked `session_id` gets
// 403 (ENABLE_SESSIONS off) or 400 session_conflict (with client-carried
// history/memory), so the two strip lists must stay in sync. Behavioral
// route-level tests need a Next request context and are recorded as a gap in
// docs/regeneration/index.md; this gate catches the documented failure mode
// of editing one list without the other.

const REPO = process.cwd();
const STREAM_ROUTE = readFileSync(
  resolve(REPO, "src/app/api/ask/stream/route.ts"),
  "utf8"
);
const GENERIC_PROXY = readFileSync(
  resolve(REPO, "src/app/api/proxy/[...path]/route.ts"),
  "utf8"
);

const IDS = ["session_id", "assistant_id", "project_id"];

test("structural: the streaming route deletes all three chat-local identifiers from the forwarded body", () => {
  for (const id of IDS) {
    assert.ok(
      STREAM_ROUTE.includes(`delete parsedBody.${id}`),
      `stream route must delete ${id} before forwarding`
    );
  }
});

test("structural: the generic proxy deletes all three chat-local identifiers from the forwarded body", () => {
  for (const id of IDS) {
    assert.ok(
      GENERIC_PROXY.includes(`delete parsed.${id}`),
      `generic proxy must delete ${id} before forwarding`
    );
  }
});

test("structural: upstream retry helper is wired into the streaming route", () => {
  assert.ok(
    STREAM_ROUTE.includes("fetchUpstreamWithRetry"),
    "the SSE proxy must retry transient upstream failures before streaming"
  );
});
