# Node 26 runtime migration — 2026-10-26

Checkpoint **`chat-node26-runtime-20261026`**, execution-only (no commit/push, no
worktree/branch). Resumes the Node20-Alpine closure in
`release-readiness-20261003`. Chat source/runtime delta: dependency pins, the
production base image and CI node version; no application behavior change.

## Intent, boundary and oracle

Node 20 reached EOL 2026-04-30. Production images, CI and the documented local
prerequisite move to Node 26 (v26.12.1, ABI 147; LTS from 2026-10-28, EOL
2029-04-30). Preserved promises: same Next 16.1.7/React 19.2.4 app, same SQLite
schema and migrations, same native modules (`better-sqlite3`, `@node-rs/argon2`),
same Alpine runtime, no new dependencies, no lockfile churn outside the two
bumped packages.

Oracle: the existing deterministic gates are the contract, unchanged and
unlowered — `npm run typecheck` and `npm test` (147/147 on the baseline). A
migration is accepted only if both keep their baseline counts on Node 26 and the
production image still boots, migrates and serves `/login`. Nothing here is a
browser, model-quality or deployment claim.

## Changed files

- `Dockerfile` — all three stages `node:20-alpine` → `node:26-alpine` (repo's
  short-name style kept; the smoke build used fully qualified
  `docker.io/library/node:26-alpine` in a scratch copy only).
- `.github/workflows/ci.yml` — both `node-version: "20"` → `"26"`.
  `release.yml` has no `setup-node`, untouched.
- `package.json` / `package-lock.json` — `better-sqlite3` ^12.9.0 →
  **^12.11.1**, `@types/node` ^25.5.0 → ^26.6.5.
- `README.md` — prerequisite "Node.js 18+" → "Node.js 26+".
- `scripts/restore-consumer.mjs` — comment only: production builder stage is
  `node:26` (was `node:20`). The generic "a host Node 20 binary is glibc
  (bookworm)" libc illustrations (comment + receipt note string) describe an
  example `--app-node` host binary, not production, and were left byte-identical.
- `scripts/chat-{project,project-followup,project-continuity}-journey.ts` —
  `claimsNotSupported` string "production Node20/Alpine" → "production
  Node26/Alpine" (string only).
- `.claude/guides/operations-and-state.md` — the locked-packages caveat now names
  the Node 26/Alpine production runtime.
- `scripts/chat-shutdown-checks.ts` — `const text` at the partial-progress
  assertion is now annotated `: string` (see the TS7022 finding below).
- `docs/regeneration/index.md` — one dated current-checkpoint note; older
  Node20/Alpine evidence entries left untouched (historical, not replayed).

`bun.lock` is intentionally unchanged: it is only used by the one-off
`npm run import-users` script (`bun --env-file=scripts/.env run
scripts/import-users.ts`), not by build/test/runtime, so a Bun lock refresh is a
separate, unexercised decision.

## Version choice: 12.12.0 does not exist

The brief asked for `better-sqlite3` ^12.12.0. The registry has no 12.12.0:
12.x ends at **12.11.1** (then 13.0.0–13.0.3, `latest` = 13.0.3). Prebuild
availability was checked directly on the upstream release assets:

| Version | node-v147 assets |
|---|---|
| 12.9.0 | none |
| 12.10.0 | 10, incl. `linuxmusl-x64` |
| 12.11.1 | 10, incl. `linuxmusl-x64` |

So the pin is **^12.11.1** — latest 12.x, first-family version with Node 26/ABI
147 prebuilds for glibc and musl, staying on 12.x rather than 13.x as briefed.
`better-sqlite3@12.11.1` also declares `engines.node` up to `26.x` (12.9.0
stopped at `25.x`).

## Lockfile

`npm install --package-lock-only --no-audit --no-fund` (Node 26/npm 11.20.0 and
host Node 22/npm 10.9.8 produced the **identical** result): the intended hunks
(root dep strings, `@types/node` 25.5.0→26.6.5, `undici-types` 7.18.2→8.9.0,
`better-sqlite3` 12.9.0→12.11.1 incl. integrity and `engines`) plus 64 unrelated
lines adding `node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/*`
bundled-optional entries — pre-existing lock normalization, not caused by either
npm version. Those 64 lines were removed by hand; the resulting lock diff is
13 insertions/13 deletions and `npm ci` accepts it (see below), so no unrelated
churn ships.

The repo's own `node_modules/` (host Node 22 dev install, better-sqlite3 12.9.0)
was not reinstalled. npm's gitignored `node_modules/.package-lock.json` was
rewritten by `--package-lock-only`; its three version entries were restored to
the installed 12.9.0/25.5.0/7.18.2 so the host tree stays self-consistent.
`npm ls` therefore reports `invalid` for those two packages against the new
`package.json` ranges — expected until the next real install, and the gates below
were run against both the old (host) and new (scratch) trees.

## Commands and results

Baseline — repo, host **Node 22.22.3**, existing `node_modules` (read-only use):

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0, no output |
| `npm test` | **tests 147, pass 147, fail 0**, skipped 0, cancelled 0, todo 0 (~21 s) |

Node 26 — scratch copy `/tmp/opencode/verify/cortex-chat` (repo minus
`node_modules`, `.next`, `data`, `.env*`, `tsconfig.tsbuildinfo`), PATH pinned to
`/tmp/opencode/node26/node-v26.12.1-linux-x64/bin` (node v26.12.1, npm 11.20.0):

| Command | Result |
|---|---|
| `flock ~/.local/state/agent-orchestration/heavy.lock npm ci --no-audit --no-fund` | exit 0, added 435 packages, lock accepted (no out-of-sync error) |
| `node -e "const D=require('better-sqlite3'); …"` | `{ v: '3.53.2' } v26.12.1` |
| `npm run typecheck` | exit 0 (after the annotation below; before it, exit 2) |
| `npm test` | **tests 147, pass 147, fail 0**, skipped 0, cancelled 0, todo 0 (~14 s) |
| `flock … npm run build` (`SENTRY_AUTH_TOKEN` unset) | exit 0; `[glitchtip] SENTRY_AUTH_TOKEN not set — skipping source map upload` |

Post-edit re-check in the repo itself (host Node 22.22.3, old dev install):
`npm run typecheck` exit 0 and `npm test` 147/147 — the annotation and doc/string
edits do not disturb the existing dev tree.

Pre-existing, unchanged build warnings (present before this migration, build
still exit 0): `middleware` file-convention deprecation, and Turbopack's two
"Ecmascript file had an error / Node.js module loaded in the Edge Runtime"
warnings traced from `src/lib/db/client.ts` (`node:fs`).

### TS7022 finding

With `@types/node` 26.6.5 the type gate failed at
`scripts/chat-shutdown-checks.ts(142,19)`: `'text' implicitly has type 'any'
because it does not have a type annotation and is referenced directly or
indirectly in its own initializer`. Discriminated by experiment in the scratch:
`@types/node` 25.5.0 → exit 0; 26.6.5 → the error; 26.6.5 with the enclosing
`assert.ok(await f.visible(s, text))` temporarily removed → exit 0. The new node
typings' assertion signature makes the local `text` inference circular through
the asserted expression. Fix: annotate that `const text: string` (keeps the
assertion, no runtime change). `assert` semantics and the gate are untouched.

## Container smoke (production image shape)

Scratch `Dockerfile` FROM lines rewritten to `docker.io/library/node:26-alpine`
(rootless Podman via the docker CLI shim, fully qualified names), then
`flock … docker build -t localhost/cortex-chat-node26-smoke:test .` → **exit 0**,
image 286 MB.

Run: `docker run -d --name cortex-chat-node26-smoke -p 127.0.0.1:18080:3000` with
throwaway generated env (`APP_ENCRYPTION_KEY` = fresh base64 of 32 bytes,
`BACKEND_ADMIN_API_KEY` = random `moca_admin_…`, `SUPERADMIN_EMAIL` =
`smoke@example.invalid`, random `SUPERADMIN_PASSWORD`, `CORTEX_API_URL` =
`http://127.0.0.1:9` unreachable, `APP_BASE_URL` = the mapped origin).
`--tmpfs /app/data:rw,uid=1001,gid=1001,mode=0770` was rejected by Podman 5.4.2
(`unknown mount option "uid=1001"`), so the image's declared `VOLUME ["/app/data"]`
was used as an anonymous volume instead (removed with the container).

Observed:

- `docker exec … node --version` → **v26.12.1**; `process.versions.modules` =
  **147**, glibc runtime absent → **musl**.
- Boot: `▲ Next.js 16.1.7 … ✓ Ready in 343ms`; only expected
  `[bootstrap] Default group not created yet (fetch failed); retrying…` lines
  (the unreachable `CORTEX_API_URL`, non-blocking fire-and-forget). No error,
  throw or refusal lines in the log.
- `/app/data` created by the app: `cortex-chat.db` + `-shm` + `-wal`, `avatars/`,
  `branding/`, owned by uid 1001 (`nextjs`), container runs `uid=1001(nextjs)`.
- Read-only probe through the image's own traced deps:
  `sqlite 3.53.2`, `15` tables, `__drizzle_migrations` = `11` rows, and the
  bootstrapped superadmin row `{ email: smoke@example.invalid, role: superadmin,
  hashlen: 97 }` — i.e. musl ABI-147 `better-sqlite3` migrations **and** the
  `@node-rs/argon2` musl binding both work.
- HTTP: `GET /login` → **200**, 13244 bytes of real login HTML (dark theme);
  `GET /` → **307** `→ /login?next=%2F`; `GET /manifest.webmanifest` → **200**.

Cleanup: container, image (12 layers) and its anonymous volume removed; only
resources created for this smoke were touched.

## Limitations

- The image was built in a scratch copy, not from the committed tree; the only
  difference is the fully qualified FROM name. No push, no registry, no
  deployment.
- CI was not executed: `.github/workflows/ci.yml` now requests Node 26, but the
  workflow run itself is unobserved. `actions/setup-node@v4` resolving a Node 26
  release is unverified from here.
- `CORTEX_API_URL` was deliberately unreachable, so no backend integration,
  group-key minting or ask/model journey is claimed; the login page render is an
  HTTP status/bytes observation, not a browser journey.
- The container used an anonymous volume rather than a tmpfs mount because of the
  Podman mount-option rejection; migration/boot behavior is the same, persistence
  semantics of a real tmpfs were not exercised.
- `bun.lock` still pins the old `better-sqlite3`; only `scripts/import-users.ts`
  (Bun, one-off) is affected and it was not run.
- Host dev `node_modules` remains the Node 22/12.9.0 install; `npm ls` flags the
  two bumped packages as `invalid` until the next install. Node 22 local gates
  still pass, but Node 22 is no longer the documented prerequisite.
- The two Turbopack edge-runtime warnings are pre-existing and unrelated; they
  were not investigated here.

## Next action

Fresh CI run on Node 26 for the first PR/main push (typecheck + contract suite),
then a source-built release image smoke of the unchanged tree with the real
`NEXT_PUBLIC_SENTRY_DISABLED` parity setting from the recorded source-built
closeout, before the next tagged release. `bun.lock` refresh (or dropping Bun
from the one-off import script) stays a separate small decision.
