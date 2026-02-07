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
