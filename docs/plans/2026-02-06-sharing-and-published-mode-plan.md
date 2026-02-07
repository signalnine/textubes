# Sharing & Published Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a backend that stores flow snapshots by short ID, serve them at shareable URLs, and render a published end-user view that shows only inputs and outputs.

**Architecture:** `Bun.serve()` replaces the current `bun ./index.html` dev command, serving both the API and the static frontend. SQLite stores immutable flow snapshots. The frontend gains minimal pathname-based routing to dispatch between the editor (`/`), published view (`/s/:id`), and fork-into-editor (`/edit/:id`). The published view runs a hidden React Flow instance to reuse all existing node transformation logic.

**Tech Stack:** Bun (server, SQLite via `bun:sqlite`, bundler), React 19, @xyflow/react v12

**Design doc:** `docs/plans/2026-02-06-sharing-and-published-mode-design.md`

---

### Task 1: Database module

**Files:**
- Create: `db.ts`

**Step 1: Write the test**

Create `db.test.ts`:

```ts
import { test, expect, beforeEach } from "bun:test";
import { initDb, saveFlow, getFlow } from "./db";

let db: ReturnType<typeof initDb>;

beforeEach(() => {
  db = initDb(":memory:");
});

test("saveFlow returns a short string id", () => {
  const id = saveFlow(db, { nodes: [], edges: [], darkMode: false });
  expect(typeof id).toBe("string");
  expect(id.length).toBeGreaterThanOrEqual(6);
  expect(id.length).toBeLessThanOrEqual(12);
});

test("getFlow returns what was saved", () => {
  const flowData = { nodes: [{ id: "n1" }], edges: [], darkMode: true };
  const id = saveFlow(db, flowData);
  const result = getFlow(db, id);
  expect(result).toEqual(flowData);
});

test("getFlow returns null for unknown id", () => {
  const result = getFlow(db, "nonexistent");
  expect(result).toBeNull();
});
```

**Step 2: Run test to verify it fails**

Run: `bun test db.test.ts`
Expected: FAIL — cannot resolve `./db`

**Step 3: Write the implementation**

Create `db.ts`:

```ts
import { Database } from "bun:sqlite";

export function initDb(path: string = "textubes.db") {
  const db = new Database(path);
  db.run(`
    CREATE TABLE IF NOT EXISTS flows (
      id TEXT PRIMARY KEY,
      flow_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  return db;
}

function generateId(): string {
  // 8-char base36 from random bytes
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 8);
}

export function saveFlow(db: Database, flowData: unknown): string {
  const id = generateId();
  const json = JSON.stringify(flowData);
  db.run(
    "INSERT INTO flows (id, flow_json, created_at) VALUES (?, ?, ?)",
    [id, json, Date.now()]
  );
  return id;
}

export function getFlow(db: Database, id: string): unknown | null {
  const row = db.query("SELECT flow_json FROM flows WHERE id = ?").get(id) as
    | { flow_json: string }
    | null;
  if (!row) return null;
  return JSON.parse(row.flow_json);
}
```

**Step 4: Run test to verify it passes**

Run: `bun test db.test.ts`
Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add db.ts db.test.ts
git commit -m "feat: add SQLite database module for flow storage"
```

---

### Task 2: Server entry point

**Files:**
- Create: `server.ts`
- Modify: `package.json` (line 10, `dev` script)

**Step 1: Write the test**

Create `server.test.ts`:

```ts
import { test, expect, beforeAll, afterAll } from "bun:test";

let server: ReturnType<typeof import("./server").startServer>;

// Import and start server on a random port with in-memory DB
beforeAll(async () => {
  const { startServer } = await import("./server");
  server = startServer({ port: 0, dbPath: ":memory:" });
});

afterAll(() => {
  server.stop();
});

test("POST /api/flows stores a flow and returns id", async () => {
  const res = await fetch(`${server.url}api/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodes: [{ id: "s1" }], edges: [], darkMode: false }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(typeof body.id).toBe("string");
});

test("GET /api/flows/:id returns the stored flow", async () => {
  // First save
  const postRes = await fetch(`${server.url}api/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodes: [], edges: [], darkMode: true }),
  });
  const { id } = await postRes.json();

  // Then retrieve
  const getRes = await fetch(`${server.url}api/flows/${id}`);
  expect(getRes.status).toBe(200);
  const flow = await getRes.json();
  expect(flow.nodes).toEqual([]);
  expect(flow.darkMode).toBe(true);
});

test("GET /api/flows/:id returns 404 for unknown id", async () => {
  const res = await fetch(`${server.url}api/flows/nonexistent`);
  expect(res.status).toBe(404);
});

test("POST /api/flows rejects payloads over 500KB", async () => {
  const bigString = "x".repeat(600_000);
  const res = await fetch(`${server.url}api/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodes: [], edges: [], darkMode: false, junk: bigString }),
  });
  expect(res.status).toBe(413);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test server.test.ts`
Expected: FAIL — cannot resolve `./server`

**Step 3: Write the implementation**

Create `server.ts`:

```ts
import index from "./index.html";
import { initDb, saveFlow, getFlow } from "./db";

const MAX_BODY_SIZE = 500 * 1024; // 500KB

export function startServer(
  options: { port?: number; dbPath?: string } = {}
) {
  const db = initDb(options.dbPath ?? "textubes.db");

  return Bun.serve({
    port: options.port ?? 3000,
    routes: {
      "/api/flows": {
        POST: async (req) => {
          const contentLength = parseInt(
            req.headers.get("content-length") ?? "0"
          );
          if (contentLength > MAX_BODY_SIZE) {
            return new Response(
              JSON.stringify({ error: "Payload too large" }),
              { status: 413, headers: { "Content-Type": "application/json" } }
            );
          }

          const body = await req.text();
          if (body.length > MAX_BODY_SIZE) {
            return new Response(
              JSON.stringify({ error: "Payload too large" }),
              { status: 413, headers: { "Content-Type": "application/json" } }
            );
          }

          let flowData: unknown;
          try {
            flowData = JSON.parse(body);
          } catch {
            return new Response(
              JSON.stringify({ error: "Invalid JSON" }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          const id = saveFlow(db, flowData);
          return Response.json({ id });
        },
      },
      "/api/flows/:id": {
        GET: (req) => {
          const id = req.params.id;
          const flow = getFlow(db, id);
          if (!flow) {
            return new Response(
              JSON.stringify({ error: "Not found" }),
              { status: 404, headers: { "Content-Type": "application/json" } }
            );
          }
          return Response.json(flow);
        },
      },
      // All non-API routes serve the frontend HTML
      "/*": index,
    },
    development: {
      hmr: true,
      console: true,
    },
  });
}

// Start the server when run directly
startServer();
```

**Step 4: Run test to verify it passes**

Run: `bun test server.test.ts`
Expected: 4 tests PASS

**Step 5: Update package.json dev script**

In `package.json`, change line 10:
```json
"dev": "bun --hot ./server.ts",
```

**Step 6: Manually verify the dev server works**

Run: `bun run dev`
- Visit `http://localhost:3000` — should show the normal Textubes editor
- The app should work exactly as before (localStorage, node editing, etc.)

**Step 7: Commit**

```bash
git add server.ts server.test.ts package.json
git commit -m "feat: add Bun.serve() entry point with flow API"
```

---

### Task 3: Client-side router

**Files:**
- Create: `components/Router.tsx`
- Modify: `index.tsx` (replace direct `<App />` render with `<Router />`)

**Step 1: Write Router component**

The router is simple enough that it doesn't need its own test — its logic is just a `switch` on `pathname`. It will be integration-tested by the published view.

Create `components/Router.tsx`:

```tsx
import { useState, useEffect } from "react";
import App from "../App";

// Lazy-load PublishedView only when needed
const LazyPublishedView = () => {
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);
  useEffect(() => {
    import("./PublishedView").then((mod) => setComponent(() => mod.default));
  }, []);
  if (!Component) return <div style={{ padding: "2rem" }}>Loading...</div>;
  return <Component />;
};

type Route =
  | { type: "editor"; flowId?: string }
  | { type: "published"; flowId: string };

function matchRoute(pathname: string): Route {
  const publishedMatch = pathname.match(/^\/s\/([a-zA-Z0-9]+)$/);
  if (publishedMatch) {
    return { type: "published", flowId: publishedMatch[1]! };
  }

  const editMatch = pathname.match(/^\/edit\/([a-zA-Z0-9]+)$/);
  if (editMatch) {
    return { type: "editor", flowId: editMatch[1]! };
  }

  return { type: "editor" };
}

export default function Router() {
  const [route, setRoute] = useState<Route>(() =>
    matchRoute(window.location.pathname)
  );

  useEffect(() => {
    const handlePopState = () => {
      setRoute(matchRoute(window.location.pathname));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  switch (route.type) {
    case "published":
      return <LazyPublishedView />;
    case "editor":
      return <App initialFlowId={route.flowId} />;
  }
}
```

**Step 2: Update index.tsx**

Replace the contents of `index.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import Router from "./components/Router";

const root = createRoot(document.body);
root.render(<Router />);
```

**Step 3: Add `initialFlowId` prop to App.tsx**

At the top of `App.tsx`, update the component signature and add loading logic. The changes:

1. Add `initialFlowId?: string` prop
2. Add a `useEffect` that fetches the flow from the API when `initialFlowId` is provided
3. Load the fetched flow into the editor (same as importFlow but from API)

In `App.tsx`, change the function signature:

```tsx
export default function App({ initialFlowId }: { initialFlowId?: string } = {}) {
```

Add after the `isDarkMode` state declaration (around line 112):

```tsx
// Load flow from API when initialFlowId is provided (fork mode)
useEffect(() => {
  if (!initialFlowId) return;

  fetch(`/api/flows/${initialFlowId}`)
    .then((res) => {
      if (!res.ok) throw new Error("Flow not found");
      return res.json();
    })
    .then((flowData: any) => {
      if (!flowData.nodes || !flowData.edges) {
        alert("Invalid flow data");
        return;
      }
      const nodesWithDarkMode = flowData.nodes.map((node: any) => ({
        ...node,
        data: { ...node.data, isDarkMode: flowData.darkMode ?? isDarkMode },
      }));
      setNodes(nodesWithDarkMode);
      setEdges(flowData.edges);
      if (typeof flowData.darkMode === "boolean") {
        setIsDarkMode(flowData.darkMode);
      }
    })
    .catch((err: Error) => {
      console.error("Failed to load flow:", err);
      alert("Could not load shared flow. It may not exist.");
    });
}, [initialFlowId]);
```

**Step 4: Verify dev server still works**

Run: `bun run dev`
- Visit `http://localhost:3000` — should still show the editor
- Visit `http://localhost:3000/edit/nonexistent` — should show editor with alert "Could not load shared flow"
- Visit `http://localhost:3000/s/anything` — should show "Loading..." (PublishedView doesn't exist yet)

**Step 5: Commit**

```bash
git add components/Router.tsx index.tsx App.tsx
git commit -m "feat: add client-side router with editor and fork-mode support"
```

---

### Task 4: Publish button

**Files:**
- Modify: `components/NodePicker.tsx`
- Modify: `App.tsx`

**Step 1: Add `onPublish` prop to NodePicker**

In `App.tsx`, add a `publishFlow` callback:

```tsx
const publishFlow = useCallback(async () => {
  const flowData = {
    version: 1,
    nodes,
    edges,
    darkMode: isDarkMode,
  };

  try {
    const res = await fetch("/api/flows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(flowData),
    });

    if (!res.ok) {
      const err = await res.json();
      alert(`Failed to publish: ${err.error || "Unknown error"}`);
      return;
    }

    const { id } = await res.json();
    const url = `${window.location.origin}/s/${id}`;

    await navigator.clipboard.writeText(url);
    alert(`Published! Link copied to clipboard:\n${url}`);
  } catch (err) {
    console.error("Publish error:", err);
    alert("Failed to publish flow. Is the server running?");
  }
}, [nodes, edges, isDarkMode]);
```

Pass it to `NodePicker`:

```tsx
<NodePicker
  onAddNode={addNode}
  isDarkMode={isDarkMode}
  onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
  onExport={exportFlow}
  onImport={importFlow}
  onLoadPreset={loadPreset}
  onPublish={publishFlow}
/>
```

In `components/NodePicker.tsx`, add the prop and button:

Add `onPublish: () => void` to the `NodePickerProps` type.

Add the prop to the destructured params.

Add a Publish button next to the Save button:

```tsx
<button
  className="node-picker-button"
  onClick={onPublish}
  title="Publish flow and copy share link"
>
  Publish
</button>
```

**Step 2: Verify manually**

Run: `bun run dev`
- Click "Publish" — should POST to API, copy URL to clipboard, show alert with the URL
- Open the URL in a new tab — should show "Loading..." (PublishedView not built yet)

**Step 3: Commit**

```bash
git add App.tsx components/NodePicker.tsx
git commit -m "feat: add Publish button to toolbar"
```

---

### Task 5: Published view

This is the core of the feature. The published view renders a simple form with inputs (from SourceNodes) and outputs (from ResultNodes), with a hidden React Flow graph handling all transformations.

**Files:**
- Create: `components/PublishedView.tsx`

**Step 1: Write the component**

Create `components/PublishedView.tsx`:

```tsx
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { getNodeTypes } from "../nodeRegistry";
import type { NodeData } from "../App";

const nodeTypes = getNodeTypes();

export default function PublishedView() {
  const [nodes, setNodes] = useState<Node<NodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Extract flow ID from URL
  const flowId = useMemo(() => {
    const match = window.location.pathname.match(/^\/s\/([a-zA-Z0-9]+)$/);
    return match?.[1] ?? null;
  }, []);

  // Fetch flow data
  useEffect(() => {
    if (!flowId) {
      setError("Invalid URL");
      setLoading(false);
      return;
    }

    fetch(`/api/flows/${flowId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Flow not found");
        return res.json();
      })
      .then((flowData: any) => {
        if (!flowData.nodes || !flowData.edges) {
          throw new Error("Invalid flow data");
        }
        const dark = flowData.darkMode ?? false;
        setIsDarkMode(dark);
        const nodesWithDarkMode = flowData.nodes.map((node: any) => ({
          ...node,
          data: { ...node.data, isDarkMode: dark },
        }));
        setNodes(nodesWithDarkMode);
        setEdges(flowData.edges);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [flowId]);

  // Find source and result nodes
  const sourceNodes = useMemo(
    () => nodes.filter((n) => n.type === "source"),
    [nodes]
  );
  const resultNodes = useMemo(
    () => nodes.filter((n) => n.type === "result"),
    [nodes]
  );

  // Handle input changes — update the source node's data
  const handleInputChange = useCallback(
    (nodeId: string, value: string) => {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, value } } : n
        )
      );
    },
    []
  );

  // React Flow needs these to process internal node data updates
  const onNodesChange = useCallback(
    (changes: NodeChange<Node<NodeData>>[]) =>
      setNodes((prev) => applyNodeChanges(changes, prev)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) =>
      setEdges((prev) => applyEdgeChanges(changes, prev)),
    []
  );

  // Copy result to clipboard
  const copyResult = useCallback((value: string) => {
    navigator.clipboard.writeText(value);
  }, []);

  if (loading) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <h2>Error</h2>
        <p>{error}</p>
        <a href="/">Go to editor</a>
      </div>
    );
  }

  const bgColor = isDarkMode ? "#1a1a1a" : "#ffffff";
  const textColor = isDarkMode ? "#e0e0e0" : "#000000";
  const borderColor = isDarkMode ? "#555" : "#ccc";
  const inputBg = isDarkMode ? "#3a3a3a" : "#ffffff";
  const resultBg = isDarkMode ? "#333" : "#f9f9f9";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: bgColor,
        color: textColor,
        fontFamily:
          "Bahnschrift, 'DIN Alternate', 'Franklin Gothic Medium', 'Nimbus Sans Narrow', sans-serif-condensed, sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "1rem 2rem",
          borderBottom: `1px solid ${borderColor}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <a
          href="/"
          style={{
            fontSize: "1.25rem",
            fontWeight: "bold",
            textDecoration: "none",
            color: textColor,
          }}
        >
          Textubes
        </a>
        <a
          href={`/edit/${flowId}`}
          style={{
            padding: "0.5rem 1rem",
            border: `1px solid ${borderColor}`,
            borderRadius: "0.5rem",
            textDecoration: "none",
            color: textColor,
            background: inputBg,
            fontSize: "0.875rem",
          }}
        >
          Fork
        </a>
      </div>

      {/* Published form */}
      <div
        style={{
          maxWidth: "640px",
          margin: "0 auto",
          padding: "2rem",
        }}
      >
        {/* Inputs */}
        {sourceNodes.map((node) => (
          <div key={node.id} style={{ marginBottom: "1.5rem" }}>
            <label
              style={{
                display: "block",
                fontSize: "0.875rem",
                marginBottom: "0.5rem",
                color: isDarkMode ? "#aaa" : "#666",
              }}
            >
              Input
            </label>
            <textarea
              value={node.data.value || ""}
              onChange={(e) => handleInputChange(node.id, e.target.value)}
              placeholder={node.data.value || "Enter text..."}
              maxLength={10000}
              style={{
                width: "100%",
                minHeight: "100px",
                padding: "0.5rem",
                fontSize: "0.875rem",
                fontFamily:
                  "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace",
                border: `1px solid ${borderColor}`,
                borderRadius: "0.5rem",
                background: inputBg,
                color: textColor,
                resize: "vertical",
              }}
            />
          </div>
        ))}

        {/* Divider */}
        {sourceNodes.length > 0 && resultNodes.length > 0 && (
          <hr
            style={{
              border: "none",
              borderTop: `1px solid ${borderColor}`,
              margin: "2rem 0",
            }}
          />
        )}

        {/* Outputs */}
        {resultNodes.map((node) => {
          const value = node.data.value || "";
          return (
            <div key={node.id} style={{ marginBottom: "1.5rem" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "0.5rem",
                }}
              >
                <label
                  style={{
                    fontSize: "0.875rem",
                    color: isDarkMode ? "#aaa" : "#666",
                  }}
                >
                  Result
                </label>
                <button
                  onClick={() => copyResult(value)}
                  disabled={!value}
                  style={{
                    padding: "0.25rem 0.75rem",
                    fontSize: "0.75rem",
                    border: `1px solid ${borderColor}`,
                    borderRadius: "0.5rem",
                    background: inputBg,
                    color: textColor,
                    cursor: value ? "pointer" : "not-allowed",
                    opacity: value ? 1 : 0.5,
                  }}
                >
                  Copy
                </button>
              </div>
              <textarea
                readOnly
                value={value || "No output"}
                style={{
                  width: "100%",
                  minHeight: "100px",
                  padding: "0.5rem",
                  fontSize: "0.875rem",
                  fontFamily:
                    "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace",
                  border: `1px solid ${borderColor}`,
                  borderRadius: "0.5rem",
                  background: resultBg,
                  color: value ? textColor : isDarkMode ? "#777" : "#999",
                  whiteSpace: "pre-wrap",
                  resize: "vertical",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Hidden React Flow — drives all transformations */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "1px",
          height: "1px",
          overflow: "hidden",
          opacity: 0,
          pointerEvents: "none",
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          colorMode={isDarkMode ? "dark" : "light"}
        />
      </div>
    </div>
  );
}
```

**Step 2: Verify the full flow end-to-end**

Run: `bun run dev`

1. Open `http://localhost:3000` — the editor
2. Create a simple flow: SourceNode → CapslockNode → ResultNode
3. Type "hello" in the SourceNode
4. Verify ResultNode shows "HELLO"
5. Click "Publish" — get a URL like `http://localhost:3000/s/abc12345`
6. Open that URL in a new tab
7. Should see: one input field (pre-filled with "hello"), a divider, one result showing "HELLO"
8. Clear the input and type "world" — result should update to "WORLD"
9. Click "Fork" — should open `/edit/abc12345` with the full editor loaded with this flow
10. Click "Textubes" header link — should go back to `/` (your own editor with localStorage state)

**Step 3: Commit**

```bash
git add components/PublishedView.tsx
git commit -m "feat: add published view for shared flows"
```

---

### Task 6: SourceNode character limit

**Files:**
- Modify: `components/SourceNode.tsx`

**Step 1: Add maxLength to the textarea**

In `components/SourceNode.tsx`, add `maxLength={10000}` to the `<textarea>`:

```tsx
<textarea
  className="nodrag node-textarea"
  value={data.value || ''}
  onChange={handleChange}
  placeholder="Enter text here..."
  maxLength={10000}
/>
```

**Step 2: Verify manually**

The browser will silently enforce the limit. No visual indicator needed.

**Step 3: Commit**

```bash
git add components/SourceNode.tsx
git commit -m "feat: add 10,000 character limit to SourceNode"
```

---

### Task 7: End-to-end verification and cleanup

**Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass

**Step 2: Full manual walkthrough**

Run: `bun run dev`

1. **Editor (/)**: Create a flow, verify localStorage still works, verify all existing functionality (save, load, presets, dark mode, clear canvas)
2. **Publish**: Click Publish, verify URL is copied, verify the flow is stored
3. **Published view (/s/:id)**: Open the published URL, verify inputs/outputs render, verify live updates, verify dark mode matches
4. **Fork (/edit/:id)**: Click Fork from published view, verify flow loads in editor, verify changes are local-only
5. **Error handling**: Visit `/s/nonexistent` — should show error, Visit `/edit/nonexistent` — should show alert
6. **Size limit**: Try publishing a very large flow (if possible) — should be rejected at 500KB

**Step 3: Commit any fixes**

If any issues found, fix and commit individually.
