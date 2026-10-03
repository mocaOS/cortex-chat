import test from "node:test";
import assert from "node:assert/strict";
import { assertForwarded } from "../scripts/chat-ask-checks";

const body = { question: "healthy", collection_id: null, conversation_memory: { opaque: [null, "✓"] }, depth: "standard" };
const expected = { body, key: "synthetic-read-key", requestId: "synthetic-correlation", streaming: true };
const healthy = () => ({ method: "POST", body: structuredClone(body), headers: {
  "x-api-key": expected.key, "x-request-id": expected.requestId, "accept-encoding": "identity",
} });
test("forwarding oracle accepts preserved opaque request and authority", () => assertForwarded(healthy(), expected));
test("forwarding oracle rejects each leaked Chat identifier", () => {
  for (const key of ["session_id", "assistant_id", "project_id"]) {
    const broken: any = healthy(); broken.body[key] = "local-chat-id";
    assert.throws(() => assertForwarded(broken, expected), new RegExp(`${key} leaked upstream`));
  }
});
test("forwarding oracle rejects caller-key authority and compression regressions", () => {
  const keyMutant = healthy(); keyMutant.headers["x-api-key"] = "forged-caller-key";
  assert.throws(() => assertForwarded(keyMutant, expected), /caller must use their group key/);
  const gzipMutant = healthy(); gzipMutant.headers["accept-encoding"] = "gzip";
  assert.throws(() => assertForwarded(gzipMutant, expected), /identity/);
});
test("forwarding oracle rejects opaque-memory loss", () => {
  const mutant = healthy(); mutant.body.conversation_memory = {} as any;
  assert.throws(() => assertForwarded(mutant, expected), /conversation_memory changed upstream/);
});
