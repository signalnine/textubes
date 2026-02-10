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

test("GET /s/:id includes flow title in OG meta tags", async () => {
  const postRes = await fetch(`${server.url}api/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: 1,
      title: "My Cool Flow",
      nodes: [
        { id: "s1", type: "source" },
        { id: "t1", type: "capslock" },
        { id: "r1", type: "result" },
      ],
      edges: [],
      darkMode: false,
    }),
  });
  const { id } = await postRes.json();

  const htmlRes = await fetch(`${server.url}s/${id}`);
  expect(htmlRes.status).toBe(200);
  const html = await htmlRes.text();
  expect(html).toContain('og:title" content="My Cool Flow"');
  expect(html).toContain('og:description" content="A text pipeline with 1 input, 1 transformation, and 1 output."');
});

test("GET /s/:id falls back to Textubes when flow has no title", async () => {
  const postRes = await fetch(`${server.url}api/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version: 1, nodes: [], edges: [], darkMode: false }),
  });
  const { id } = await postRes.json();

  const htmlRes = await fetch(`${server.url}s/${id}`);
  const html = await htmlRes.text();
  expect(html).toContain('og:title" content="Textubes"');
});

test("GET /s/:id serves HTML for unknown flow id", async () => {
  const htmlRes = await fetch(`${server.url}s/nonexistent`);
  expect(htmlRes.status).toBe(200);
  const html = await htmlRes.text();
  expect(html).toContain("<title>");
  expect(html).toContain("og:title");
});
