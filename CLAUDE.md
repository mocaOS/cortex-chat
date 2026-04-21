# CLAUDE.md

## Project Overview

Next.js 16 chat frontend for a RAG-based AI knowledge assistant (library-backend).

**Key features:**
- Streaming SSE responses from backend (`/api/ask/stream`)
- Chat and Deep Research modes
- Collection-scoped search (defaults to "All Collections" — searches entire knowledge base)
- Source citations with modal viewer
- Graph context (entities/relationships)
- Thinking steps display
- i18n (EN/DE), locale set via config
- localStorage-based chat history with sidebar
- Auto-generated chat titles via LLM after first response
- Configurable accent color, logo, locale via `/api/config` endpoint

No user management yet — chat persistence is local-only via localStorage. Sessions are keyed by UUID under `chat_sessions`.

## Collection Scoping

By default, Chat and Deep Research search across **all collections** (no `collection_id` sent to the API). Users can scope to a specific collection via the settings panel (gear icon). The active scope is always visible below the chat input as a persistent indicator.

- `settings.collectionId = null` → all collections (default)
- `settings.collectionId = "<id>"` → single collection
- The `collection_id` param on `/api/ask/stream`, `/api/ask`, and `/api/search` is optional; omitting it searches everything
- Collections are fetched on mount via `GET /api/collections`
- The scope indicator in `ChatInput` shows the resolved collection name or "Searching across all collections"

## Tech Stack

- Next.js 16.1.7 (Turbopack)
- React 19.2.4
- TypeScript 5.9.3
- Tailwind CSS 4.2.1
- react-markdown 10.1.0 + remark-gfm
- Dark theme using CSS custom properties (--bg-primary, --bg-secondary, --bg-tertiary, --border, --text-primary, --text-secondary, --accent)
- Backend: `NEXT_PUBLIC_API_URL` (currently example.invalid), auth via `NEXT_PUBLIC_API_KEY` header

Use CSS variables for all colors. No light mode. Styling is inline Tailwind + CSS vars.

## Conventions

- Hex color values must be quoted in `.env` files (e.g. `"#ff9500"`) because `#` is treated as a comment by dotenv
- `NEXT_PUBLIC_` vars are compile-time inlined by Next.js — runtime config uses `/api/config` endpoint instead
- German UI uses du-form; keep product terms (Deep Research, etc.) in English even in German locale
