# Record: citation-content acceptance correction + fixture pack v2 — 2026-10-01

Decision by the lead (ACCEPTANCE-CORRECTION, approved; **no product behavior
change**, no runtime/source/deps/schema changes, no commits). Files touched:
`scripts/restore-fixture.mjs`, `scripts/restore-consumer.mjs`,
`tests/restore-fixture.test.ts`, `tests/restore-consumer.test.ts`, this
record, plus short addenda pointers in the two prior records. Root, index,
`src/`, deps untouched.

## The correction

The previous isolated-backend hard gate fetched
`GET /api/proxy/api/documents/fx-source-0001/file` and demanded byte-exact
file content. DiagF2 showed that route 404 **before the backend** — because
the chat proxy allowlist (`src/app/api/proxy/[...path]/route.ts:16-22`)
intentionally permits only `GET /api/documents/{id}/content` (plus
collections/features/tasks/ask), never `/file`. That was a **bad oracle**, not
a product bug; the UI itself (`SourceModal.tsx:28-34` → `fetchDocumentContent`
in `src/lib/api.ts:136`) loads `{id, filename, chunks:[{id, content,
chunk_index}]}` and renders `chunks.sort(chunk_index).map(content).join("\n\n")`.
The failure history of the `/file`-gate version is preserved (previous
records/attempts), and the old required id
`proxy-isolated-backend-citation-file-exact` is marked obsolete; the backend
raw-file byte gate remains the backend side's own check, unchanged.

New required gate (isolated-backend mode), id **`proxy-isolated-backend-citation-content-exact`**:

- The document id is **derived from the restored chat message's citation
  metadata** (`GET /api/me/chats/fx-chat-0001` → message `fx-msg-0002` →
  `sources[0].document_id`), asserted to be the fixture's
  `fx-source-0001` — the source↔source↔document linkage is proven through
  the restored state, not a manually hardcoded unrelated id.
- `GET /api/proxy/api/documents/{document_id}/content` must return 200 with
  document identity (`id` = derived id, `filename` = fixture-declared
  `fx-source-0001.txt`) and **nonempty chunks**; the `chunk_index`-sorted
  `"\n\n"` join (exactly the UI rule) must **exactly equal the UTF-8 text**
  of the independent `--document-file` app/oracle **v2** snapshot
  (`full_content`, if present, must equal it too). CLI stays
  `--document-file`.
- Chunk-index coverage must be contiguous (0..n-1) — a missing or duplicated
  chunk fails even before the text comparison.
- **Permission boundary retained**: authenticated
  `GET /api/proxy/api/documents/fx-source-0001/file` must 404 WITHOUT
  reaching the upstream (in sink mode proven via the recorded sink requests)
  — no proxy widening.
- Negative controls (unit gates on the pure comparator, now exported from the
  consumer CLI for the suite): corrupted chunk content, missing chunk (index
  gap and trailing loss), wrong document id / filename, a promised
  `full_content` mismatch, and the demonstration that a forged expected body
  copy only ever legitimizes itself — the gate always compares against the
  independent snapshot.

## Fixture pack v2 (temporarily expanded write scope, owned files only)

Fixture `FIXTURE_VERSION` **1 → 2** (v1 pack and its evidence stay recorded —
history not rewritten; the verifier/consumer take 2 as canonical, so an old
v1 sentinel is refused with a clear version message). **Correction after a
superseded first proposal:** this helper initially invented a two-chunk
`.txt` constant set claiming the app/oracle would generate from it — that is
retracted. The **accepted MAIN producer** (cortex-app source oracle,
`oracle.py` ~1565-71) is the authority: **ONE markdown chunk** for
`fx-source-0001`, filename **`fixture-source.md`**, and the chat side aligns
to it verbatim. The chat fixture now stores, in `fx-msg-0002`:

```
{ document_id: "fx-source-0001", chunk_id: "fx-source-0001-chunk-0",
  content: <accepted producer text, quoted verbatim incl. back\slash>,
  score: 0.42 (arbitrary synthetic fixture value), sid: "fx-source-0001",
  title: "Fixture Source",
  metadata: { filename: "fixture-source.md", chunk_index: 0 } }
```

and `fx-msg-0002.content` cites `fx-source-0001`. The exact accepted text
(fixed, lead-declared, single chunk):

```
Fixture Source content for the disposable restore rehearsal.
It's a "test" with escaping: back\slash and 'quotes'.
The fixture graph cites this document as fx-source-0001 (Fixture Source).
Mentions Rehearsal Alpha and Rehearsal Beta for graph linkage.
```

(with a trailing newline; the UI's `"\n\n"` join of the single chunk is the
text itself). The consumer's `--document-file` snapshot must equal this text
as UTF-8. The chat-side tests pin the constants verbatim in BOTH mirrors
(fixture test and consumer test) — escaping included — so no silent template
copy can normalize them; **main owns the cheap cross-repo fixture-consistency
check** (app-side oracle text vs these chat constants) before compiling.
The standalone fixture still seeds with zero external dependencies, and
`verify` gained the explicit named `citation(fx-msg-0002)` check (full shape,
accepted text verbatim, numeric score) on top of the unchanged exact row
comparison — no snapshot relaxation of actual data. Generic unit controls for
multi-chunk/gap logic use unit-only synthetic cases and do not alter the live
fixture cardinality (one chunk).

**Superseded attempt noted:** the earlier full sink-mode fresh run
(`journey/journey2`, 26/26 checks) validated the retracted two-chunk `.txt`
proposal end-to-end locally (source-fresh label only); it is recorded as an
attempt of the superseded pack, not of the accepted producer declaration.

**Integration honesty:** an integrated warm-fixture run against the OLD graph
fixture (v1 chat citations) is not meaningful — the backend/main oracle now
expects the v2 fields. The integrated gate therefore requires a **fresh v2
seed** (`restore-fixture.mjs seed`), and the helper-side full journey is
labeled *source-fresh*, not *actual-restore*, until main's new graph-side v2
fixture and runner complete the full fresh pass (main owns that final run).

## Verification evidence

| # | Command (cwd `/home/clippy/coding/cortex-chat`) | Result |
|---|---|---|
| 1 | `node scripts/restore-fixture.mjs seed <tmp>/fx && … verify <tmp>/fx` | exit 0, `ok:true`, `fixtureVersion: 2`, restored `sources[0]` = full v2 shape (verified in DB) |
| 2 | `node --import tsx --conditions=react-server --test tests/restore-fixture.test.ts` | **11/11 pass** (v2 citation oracle added: exact deep-equal of the restored source, sentinel version 2) |
| 3 | `node --import tsx --conditions=react-server --test tests/restore-consumer.test.ts` | **18/18 pass** (13 prior gate tests + 5 new citation-content unit controls incl. all negative controls) |
| 4 | `npm run typecheck` | **exit 0, 0 errors** |
| 5 | `npm test` (final tree) | **89/89 pass, 0 fail, ~12.1s** |
| 6 | `git diff --stat 40fe797 -- src/` | **empty** — no product behavior change |

## Contract deltas for the main/backend agents

- Backend/main writers must update the expected hard-gate id to
  **`proxy-isolated-backend-citation-content-exact`** before the integrated
  run; the raw receipt fields stay: `upstream.url`, `networkTripwire.clean`,
  `cleanup.stateDirUnchanged`, plus the still-required
  `proxy-isolated-backend-collections-200-scoped`.
- `--document-file` semantics unchanged as a flag; its content is now judged
  as the UTF-8 document text behind the content route: the ACCEPTED MAIN
  producer declaration — document id `fx-source-0001`, filename
  `fixture-source.md`, ONE markdown chunk, exact text as quoted above.
- The backend-side raw `/file` byte gate is unchanged and belongs to the
  backend; the chat proxy will 404 `/file` by design (no widening).
