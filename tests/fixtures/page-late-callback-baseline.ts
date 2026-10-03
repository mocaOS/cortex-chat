// FROZEN BASELINE (negative-control evidence; playbook §9.5) — NOT a candidate.
// Retains the page.tsx late-callback expressions (finalize / onMemoryUpdate /
// onDone) extracted verbatim from the accepted browser-baseline runtime, with
// page hash + immutable git-blob provenance, plus a pure executor that runs
// them under a synchronous state adapter with injected persistence. No HTTP,
// no React: extraction/transport failure can never masquerade as an intended
// oracle rejection (the expressions are embedded; only the oracles assert).
//
// This file must not be mutated for a candidate; the positive gates that judge
// the fix live in scripts/chat-page-callback-probe.ts and
// tests/chat-page-callback-oracle.test.ts and run the SAME oracles against the
// LIVE candidate extraction. The baseline here proves gate sensitivity.
import ts from "typescript";
import { isRefusalText } from "../../src/lib/answer-flags";

export const PAGE_LATE_CALLBACK_BASELINE_PROVENANCE = {
  pageTsSha256: "6e5fbf5ab5d240662cd8f40ed02814124dd6918fde1c5e8c6ef6aa4d84eb9bb2",
  pageTsGitBlob: "3e0926bc37824f0070161cf6426f9fd0a42602c8",
  chatGitHead: "40fe79799c4729c4b695890566ef3a51746b3b5e",
  extractedFrom: "src/app/page.tsx",
  retainedBrowserCopy:
    "../cortex-app/output/chat-browser-baseline-20261002/chat-journey-chat-browser-baseline-20261002-i-2026-10-02T09-12-02-299Z/browser/baseline-page.tsx",
  note:
    "Expressions below are the verbatim initializer texts extracted from page.tsx " +
    "at the hash/blob above (the frozen browser-baseline runtime input, digest " +
    "recorded in browser-run-manifest.json). The git blob is the immutable in-repo " +
    "provenance; tests/chat-page-callback-oracle.test.ts re-extracts from it and " +
    "byte-compares. isRefusalText is the real shared helper (pure module), bound " +
    "to keep onDone fidelity.",
} as const;

export const PAGE_LATE_CALLBACK_BASELINE_EXPRESSIONS = {
  finalize:
    "(finalMessages: ChatMessage[]) => {\n        if (sessionId) {\n          updateChatMessages(sessionId, finalMessages, memoryRef.current)\n            .then(refreshSessions)\n            .catch(() => {});\n        }\n      }",
  onMemoryUpdate:
    "(memory) => {\n              // Store verbatim; replayed as conversation_memory next turn.\n              memoryRef.current = memory;\n              // New event order: when the blob lands after `done`, the turn was\n              // already persisted with the stale blob — persist again with the\n              // fresh one. (Old order — memory before done — leaves doneSeen\n              // false here and the finalize in onDone picks the blob up.)\n              if (doneSeen) {\n                setMessages((prev) => {\n                  finalize(prev);\n                  return prev;\n                });\n              }\n            }",
  onDone:
    "(flags) => {\n              doneSeen = true;\n              setMessages((prev) => {\n                const updated = prev.map((m) => {\n                  if (m.id !== assistantId) return m;\n                  // Older backends send no flag — recognise the canned\n                  // refusal text so the notice shows there too.\n                  const refused = flags.refused || isRefusalText(m.content);\n                  return {\n                    ...m,\n                    isStreaming: false,\n                    ...(refused ? { refused: true } : {}),\n                    ...(refused && flags.refusalSource\n                      ? { refusalSource: flags.refusalSource }\n                      : {}),\n                    ...(flags.truncated ? { truncated: true } : {}),\n                  };\n                });\n                finalize(updated);\n                return updated;\n              });\n              setIsLoading(false);\n            }",
} as const;

export interface PageLateCallbackBindings {
  sessionId: string;
  assistantId: string;
  memoryRef: { current: unknown };
  // Synchronous setMessages adapter (test driver); may replace the array
  // object, never mutate it in place — recorded persistence snapshots must
  // stay stable.
  setMessages: (fn: (prev: any) => any) => void;
  // Injected persistence boundary; must record and return the write.
  updateChatMessages: (
    sessionId: string,
    messages: unknown,
    memory: unknown
  ) => Promise<unknown>;
  refreshSessions?: () => void;
  setIsLoading?: (v: boolean) => void;
}

export interface BaselinePageLateCallbacks {
  finalize: (finalMessages: any) => Promise<unknown>;
  onMemoryUpdate: (memory: unknown) => void;
  onDone: (flags: unknown) => void;
}

function transpiled(expr: string): string {
  return ts.transpileModule(`(${expr})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}

function scopedFn(params: string[], expr: string): (...args: unknown[]) => any {
  const factory = new Function(...params, `return ${transpiled(expr)}`);
  return (...args: unknown[]) => factory(...args);
}

/**
 * Builds the retained baseline callbacks under the given bindings.
 *
 * Explicit adapter assumption: `doneSeen` is a mutable local of the real
 * streaming closure; the retained expressions receive its CURRENT value per
 * call and `doneSeen = true` inside onDone is applied by the driver right
 * after the call (the extracted text cannot mutate the caller's holder).
 * Extraction identity and this scheduling assumption are part of the
 * recorded evidence boundary — the driver owns the done timeline.
 */
export function buildBaselinePageLateCallbacks(
  bindings: PageLateCallbackBindings
): BaselinePageLateCallbacks {
  const expr = PAGE_LATE_CALLBACK_BASELINE_EXPRESSIONS;
  let doneSeen = false;
  const finalizeImpl = scopedFn(
    ["sessionId", "memoryRef", "updateChatMessages", "refreshSessions"],
    expr.finalize
  );
  const onMemoryUpdateImpl = scopedFn(
    ["memoryRef", "setMessages", "finalize", "doneSeen"],
    expr.onMemoryUpdate
  );
  const onDoneImpl = scopedFn(
    ["setMessages", "finalize", "assistantId", "isRefusalText", "setIsLoading", "doneSeen", "flags"],
    expr.onDone
  );
  const refreshSessions = bindings.refreshSessions ?? (() => {});
  const setIsLoading = bindings.setIsLoading ?? (() => {});
  const finalize = (finalMessages: unknown) =>
    finalizeImpl(
      bindings.sessionId,
      bindings.memoryRef,
      bindings.updateChatMessages,
      refreshSessions
    )(finalMessages);
  return {
    finalize,
    onMemoryUpdate: (memory: unknown) =>
      onMemoryUpdateImpl(bindings.memoryRef, bindings.setMessages, finalize, doneSeen)(memory),
    onDone: (flags: unknown) => {
      onDoneImpl(
        bindings.setMessages,
        finalize,
        bindings.assistantId,
        isRefusalText,
        setIsLoading,
        doneSeen
      )(flags);
      doneSeen = true;
    },
  };
}
