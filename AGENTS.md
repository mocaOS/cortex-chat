# AGENTS.md — read fallback for non-Claude harnesses

This file is an explicit fallback for harnesses that do not auto-load `CLAUDE.md`
(e.g. opencode, Codex-style agents). It is **not** verified to be auto-loaded by
any harness in this repository — treat it as an instruction to read, not an
autoload contract. Whether a given harness delivered this file into context is
unobserved unless recorded otherwise in `docs/regeneration/`.

**Before editing anything in this repository, read `CLAUDE.md` fully, then the
scoped guide under `.claude/guides/` for the area you touch.** `CLAUDE.md` is the
canonical session contract (seven-primitive operating loop, hard constraints,
gates, command map). The scoped guides own the detailed per-area rules; the
root file deliberately stays under ~80 lines.

Do not duplicate rules here or in any other file — this is a pointer, not a copy.
