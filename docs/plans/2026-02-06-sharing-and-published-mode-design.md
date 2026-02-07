# Sharing & Published Mode

Share flows via URL. Optionally present them as simple input/output forms for end users.

## Backend: Storage & API

Switch from `bun ./index.html` to a `Bun.serve()` entry point that serves both the static frontend and a tiny API.

**Database**: Single SQLite table.

```sql
CREATE TABLE flows (
  id TEXT PRIMARY KEY,
  flow_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

No auth, no users, no updates. Flows are immutable snapshots. IDs are short random strings.

**API**:

- `POST /api/flows` — accepts `{ nodes, edges, darkMode }`, stores it, returns `{ id }`. Rejects payloads over 500KB.
- `GET /api/flows/:id` — returns the stored JSON blob.

**Server entry point** (`server.ts`): `Bun.serve()` with API routes and the HTML import for everything else. Static frontend and API in one process.

## Frontend: Routing

Minimal client-side routing via `window.location.pathname` (no library).

**Routes**:

- `/` — current editor, loads from localStorage
- `/s/:id` — published mode (end-user view)
- `/edit/:id` — fork into editor (loads flow from API into full React Flow editor as a local copy; changes are not saved back)

## Published Mode

When someone opens `/s/:id`, they see a form — no nodes, no edges, no canvas.

- Fetch flow JSON from API
- Load nodes/edges into a hidden React Flow instance (reuses all existing transformation logic and data propagation via React Flow's reactivity)
- Find all SourceNodes — render as labeled text inputs, using saved `data.value` as placeholder text
- Find all ResultNodes — render as read-only outputs with copy button
- User types into inputs, values propagate through the hidden graph, outputs update live

Layout: simple vertical stack. Inputs at top, outputs at bottom.

**Why hidden React Flow?** The transformation logic lives inside node components via React Flow hooks (`useNodeConnections`, `useNodesData`, `updateNodeData`). Extracting it would mean reimplementing data propagation or duplicating logic. React Flow is already in the bundle for the editor/fork route. The expensive parts (SVG canvas, drag handlers, zoom) are skipped when hidden.

## Sharing Flow

- **Publish button** in toolbar: sends current flow to `POST /api/flows`, returns `/s/:id` URL
- **Fork button** in published view: navigates to `/edit/:id`, loads flow into normal editor as a local copy

Shared flows are read-only snapshots. The original never changes. Forking creates an independent local copy.

## Guardrails

- **Flow size limit**: API rejects POST bodies over 500KB
- **Source node text limit**: 10,000 character cap on SourceNode textarea

No rate limiting, expiration, or cleanup for v1.

## Changes

**New files**:

- `server.ts` — `Bun.serve()` entry point with API routes + static serving
- `db.ts` — SQLite setup and query helpers
- `components/PublishedView.tsx` — end-user form view
- `components/Router.tsx` — minimal pathname-based router

**Modified files**:

- `App.tsx` — add Publish button, accept flow data from router for fork mode
- `components/SourceNode.tsx` — add 10,000 character limit
- `package.json` — update `dev` script to `bun --hot server.ts`

**No new dependencies.** SQLite via `bun:sqlite`, IDs via `crypto.randomUUID()` or simple random string helper.
