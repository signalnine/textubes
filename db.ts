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
