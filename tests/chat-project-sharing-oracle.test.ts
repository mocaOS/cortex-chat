import { test } from "node:test";
import assert from "node:assert/strict";
import { assertGrants } from "../scripts/chat-project-sharing-checks";

// Comparator self-controls; no shared-source mutation or browser fault claim.
test("sharing grant oracle accepts empty, direct, group and unordered union sets", () => {
  assertGrants([], []);
  assertGrants([{ userId: "fx-member", groupId: null }], ["u:fx-member"]);
  assertGrants([{ groupId: "fx-group", userId: null }], ["g:fx-group"]);
  assertGrants([{ groupId: "fx-group" }, { userId: "fx-member" }], ["u:fx-member", "g:fx-group"]);
});

test("sharing grant oracle rejects missing, spurious, duplicate and malformed stored principals", () => {
  for (const [actual, expected] of [
    [[], ["u:fx-member"]],
    [[{ userId: "fx-member" }, { groupId: "fx-group" }], ["u:fx-member"]],
    [[{ userId: "fx-member" }, { userId: "fx-member" }], ["u:fx-member", "u:fx-member"]],
    [[{ userId: "fx-member", groupId: "fx-group" }], ["g:fx-group"]],
    [[{ userId: null, groupId: null }], []],
  ] as [any[], string[]][]) assert.throws(() => assertGrants(actual, expected), e => e instanceof assert.AssertionError);
});
