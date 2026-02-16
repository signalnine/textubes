# Tracery Grammar Import — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use conclave:executing-plans to implement this plan task-by-task.

**Goal:** Import Tracery grammar JSON files and compile them into Textubes node graphs.

**Architecture:** A pure-function compiler (`utils/traceryCompiler.ts`) parses Tracery JSON, validates it, and produces Textubes nodes + edges. Four new simple transformer nodes handle Tracery modifiers. The UI adds an "Import Tracery" button to the existing NodePicker toolbar. The compiler is fully testable without React.

**Tech Stack:** TypeScript, React, @xyflow/react, Bun test runner

---

### Task 1: Tracery Compiler — Core Parser + Validator

**Files:**
- Create: `utils/traceryCompiler.ts`
- Create: `utils/traceryCompiler.test.ts`

**Dependencies:** none

**Step 1: Write failing tests for validation and basic parsing**

```ts
// utils/traceryCompiler.test.ts
import { test, expect, describe } from "bun:test";
import { validateTraceryGrammar, parseTraceryReferences } from "../utils/traceryCompiler";

describe("validateTraceryGrammar", () => {
  test("accepts valid grammar with string arrays", () => {
    const grammar = {
      origin: "#animal#",
      animal: ["cat", "dog", "fish"],
    };
    const result = validateTraceryGrammar(grammar);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("accepts single-string values", () => {
    const grammar = {
      origin: "#greeting#",
      greeting: "hello",
    };
    const result = validateTraceryGrammar(grammar);
    expect(result.valid).toBe(true);
  });

  test("rejects grammar without origin", () => {
    const grammar = { animal: ["cat", "dog"] };
    const result = validateTraceryGrammar(grammar);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("origin");
  });

  test("rejects non-object input", () => {
    const result = validateTraceryGrammar("not an object");
    expect(result.valid).toBe(false);
  });

  test("rejects Textubes flow files", () => {
    const result = validateTraceryGrammar({
      version: 1,
      nodes: [],
      edges: [],
    });
    expect(result.valid).toBe(false);
  });

  test("rejects values that are not strings or string arrays", () => {
    const result = validateTraceryGrammar({
      origin: "#a#",
      a: 42,
    });
    expect(result.valid).toBe(false);
  });

  test("detects missing rule references", () => {
    const grammar = {
      origin: "#animal# and #color#",
      animal: ["cat"],
    };
    const result = validateTraceryGrammar(grammar);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("color");
  });

  test("detects cycles", () => {
    const grammar = {
      origin: "#a#",
      a: "#b#",
      b: "#a#",
    };
    const result = validateTraceryGrammar(grammar);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("cycle");
  });

  test("collects warnings for unsupported features", () => {
    const grammar = {
      origin: "#name#",
      name: ["[hero:#animal#]Alice", "Bob"],
      animal: ["cat"],
    };
    const result = validateTraceryGrammar(grammar);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("action");
  });
});

describe("parseTraceryReferences", () => {
  test("extracts simple references", () => {
    const refs = parseTraceryReferences("Hello #name#, meet #animal#");
    expect(refs).toEqual([
      { key: "name", modifiers: [], raw: "#name#" },
      { key: "animal", modifiers: [], raw: "#animal#" },
    ]);
  });

  test("extracts references with modifiers", () => {
    const refs = parseTraceryReferences("#animal.capitalize#");
    expect(refs).toEqual([
      { key: "animal", modifiers: ["capitalize"], raw: "#animal.capitalize#" },
    ]);
  });

  test("extracts chained modifiers", () => {
    const refs = parseTraceryReferences("#animal.capitalize.s#");
    expect(refs).toEqual([
      { key: "animal", modifiers: ["capitalize", "s"], raw: "#animal.capitalize.s#" },
    ]);
  });

  test("returns empty for no references", () => {
    expect(parseTraceryReferences("plain text")).toEqual([]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/gabe/textubes && bun test utils/traceryCompiler.test.ts`
Expected: FAIL — module not found

**Step 3: Implement validation and reference parsing**

```ts
// utils/traceryCompiler.ts

export type TraceryReference = {
  key: string;
  modifiers: string[];
  raw: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

const SUPPORTED_MODIFIERS = new Set(["capitalize", "s", "a", "ed"]);

/**
 * Parse all #key# and #key.modifier# references from a string
 */
export function parseTraceryReferences(text: string): TraceryReference[] {
  const refs: TraceryReference[] = [];
  const regex = /#([^#]+)#/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const inner = match[1];
    const parts = inner.split(".");
    refs.push({
      key: parts[0],
      modifiers: parts.slice(1),
      raw: match[0],
    });
  }
  return refs;
}

/**
 * Validate a Tracery grammar object
 */
export function validateTraceryGrammar(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, errors: ["Input must be a JSON object"], warnings };
  }

  const grammar = input as Record<string, unknown>;

  // Reject Textubes flow files
  if ("version" in grammar && "nodes" in grammar && "edges" in grammar) {
    return {
      valid: false,
      errors: ["This looks like a Textubes flow file, not a Tracery grammar"],
      warnings,
    };
  }

  // Check origin exists
  if (!("origin" in grammar)) {
    errors.push("Tracery grammar must have an 'origin' rule");
  }

  // Validate all values are strings or string arrays
  const ruleKeys = new Set<string>();
  for (const [key, value] of Object.entries(grammar)) {
    ruleKeys.add(key);
    if (typeof value === "string") continue;
    if (
      Array.isArray(value) &&
      value.every((v) => typeof v === "string")
    )
      continue;
    errors.push(`Rule "${key}" must be a string or array of strings`);
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // Normalize values to arrays for analysis
  const normalized = new Map<string, string[]>();
  for (const [key, value] of Object.entries(grammar)) {
    normalized.set(key, typeof value === "string" ? [value] : (value as string[]));
  }

  // Check for missing references and build dependency graph
  const deps = new Map<string, Set<string>>();
  for (const [key, options] of normalized) {
    const keyDeps = new Set<string>();
    for (const option of options) {
      // Check for action syntax [variable:#rule#]
      if (/\[[^\]]*#[^#]+#[^\]]*\]/.test(option)) {
        warnings.push(`Rule "${key}": actions (e.g. [var:#rule#]) are not supported and will be stripped`);
      }
      const refs = parseTraceryReferences(option);
      for (const ref of refs) {
        keyDeps.add(ref.key);
        if (!ruleKeys.has(ref.key)) {
          errors.push(`Rule "${key}" references undefined rule "${ref.key}"`);
        }
        for (const mod of ref.modifiers) {
          if (!SUPPORTED_MODIFIERS.has(mod)) {
            warnings.push(`Rule "${key}": unsupported modifier ".${mod}" will be ignored`);
          }
        }
      }
    }
    deps.set(key, keyDeps);
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // Cycle detection via DFS
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function hasCycle(node: string): boolean {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const dep of deps.get(node) ?? []) {
      if (hasCycle(dep)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }

  for (const key of ruleKeys) {
    if (hasCycle(key)) {
      errors.push(`Cycle detected involving rule "${key}"`);
      return { valid: false, errors, warnings };
    }
  }

  return { valid: true, errors, warnings };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /home/gabe/textubes && bun test utils/traceryCompiler.test.ts`
Expected: all PASS

**Step 5: Commit**

```bash
git add utils/traceryCompiler.ts utils/traceryCompiler.test.ts
git commit -m "feat: add Tracery grammar validator and reference parser"
```

---

### Task 2: Tracery Compiler — Node/Edge Generation

**Files:**
- Modify: `utils/traceryCompiler.ts`
- Modify: `utils/traceryCompiler.test.ts`

**Dependencies:** Task 1

**Step 1: Write failing tests for compilation**

Append to the test file:

```ts
import { compileTraceryGrammar } from "../utils/traceryCompiler";

describe("compileTraceryGrammar", () => {
  test("compiles simple grammar with no references", () => {
    const grammar = {
      origin: ["hello", "world"],
    };
    const { nodes, edges } = compileTraceryGrammar(grammar, false);
    // origin: Source + RandomSelection, plus Result
    expect(nodes.filter((n) => n.type === "source")).toHaveLength(1);
    expect(nodes.filter((n) => n.type === "randomselection")).toHaveLength(1);
    expect(nodes.filter((n) => n.type === "result")).toHaveLength(1);
    // Source text should be newline-joined
    const sourceNode = nodes.find((n) => n.type === "source");
    expect(sourceNode?.data.value).toBe("hello\nworld");
    // RandomSelection should be in line mode
    const rsNode = nodes.find((n) => n.type === "randomselection");
    expect(rsNode?.data.mode).toBe("line");
  });

  test("compiles grammar with references using Template nodes", () => {
    const grammar = {
      origin: "Hello, #name#!",
      name: ["Alice", "Bob"],
    };
    const { nodes, edges } = compileTraceryGrammar(grammar, false);
    // origin gets: Source + RandomSelection + Template
    expect(nodes.filter((n) => n.type === "template")).toHaveLength(1);
    // Template's source text should use __KEY__ syntax
    const originSource = nodes.find(
      (n) => n.type === "source" && n.data.value?.includes("__NAME__")
    );
    expect(originSource).toBeDefined();
    expect(originSource?.data.value).toBe("Hello, __NAME__!");
  });

  test("compiles grammar with modifier references", () => {
    const grammar = {
      origin: "#animal.capitalize#",
      animal: ["cat", "dog"],
    };
    const { nodes, edges } = compileTraceryGrammar(grammar, false);
    expect(nodes.filter((n) => n.type === "capitalize")).toHaveLength(1);
    // Template placeholder should be __ANIMAL_CAPITALIZE__
    const originSource = nodes.find(
      (n) => n.type === "source" && n.data.value?.includes("__ANIMAL_CAPITALIZE__")
    );
    expect(originSource).toBeDefined();
  });

  test("normalizes single strings to arrays", () => {
    const grammar = {
      origin: "just one option",
    };
    const { nodes } = compileTraceryGrammar(grammar, false);
    const sourceNode = nodes.find((n) => n.type === "source");
    expect(sourceNode?.data.value).toBe("just one option");
  });

  test("connects edges correctly for simple reference", () => {
    const grammar = {
      origin: "#animal#",
      animal: ["cat", "dog"],
    };
    const { nodes, edges } = compileTraceryGrammar(grammar, false);
    const animalRS = nodes.find(
      (n) => n.type === "randomselection" && n.id.startsWith("randomselection-animal")
    );
    const template = nodes.find((n) => n.type === "template");
    // There should be an edge from animal's RS to the template's token handle
    const tokenEdge = edges.find(
      (e) => e.source === animalRS?.id && e.targetHandle === "token-ANIMAL"
    );
    expect(tokenEdge).toBeDefined();
  });

  test("handles the devops suggestions grammar", () => {
    const grammar = {
      origin: "#suggestion#",
      suggestion: ["#refactor#", "#database#"],
      refactor: 'Have you tried #rewriting# it in #language#?',
      rewriting: ["refactoring", "rewriting"],
      language: ["haskell", "rust"],
      database: "Let's migrate to #datastore#",
      datastore: ["postgres", "mongo"],
    };
    const { nodes, edges } = compileTraceryGrammar(grammar, false);
    // 7 rules -> 7 Source + 7 RandomSelection
    expect(nodes.filter((n) => n.type === "source")).toHaveLength(7);
    expect(nodes.filter((n) => n.type === "randomselection")).toHaveLength(7);
    // Rules with refs: origin, suggestion, refactor, database -> 4 templates
    expect(nodes.filter((n) => n.type === "template")).toHaveLength(4);
    // 1 result
    expect(nodes.filter((n) => n.type === "result")).toHaveLength(1);
  });

  test("strips action syntax from options", () => {
    const grammar = {
      origin: "#name#",
      name: ["[hero:#animal#]Alice", "Bob"],
      animal: ["cat"],
    };
    const { nodes } = compileTraceryGrammar(grammar, false);
    const nameSource = nodes.find(
      (n) => n.type === "source" && n.id.startsWith("source-name")
    );
    // Actions should be stripped
    expect(nameSource?.data.value).toBe("Alice\nBob");
  });

  test("positions nodes in layered layout", () => {
    const grammar = {
      origin: "#animal#",
      animal: ["cat", "dog"],
    };
    const { nodes } = compileTraceryGrammar(grammar, false);
    // Leaf nodes (animal Source/RS) should be to the left of origin nodes
    const animalSource = nodes.find(
      (n) => n.type === "source" && n.id.startsWith("source-animal")
    );
    const resultNode = nodes.find((n) => n.type === "result");
    expect(animalSource!.position.x).toBeLessThan(resultNode!.position.x);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/gabe/textubes && bun test utils/traceryCompiler.test.ts`
Expected: FAIL — compileTraceryGrammar not found

**Step 3: Implement the compiler**

Add to `utils/traceryCompiler.ts`:

```ts
import type { Node, Edge } from "@xyflow/react";
import type { NodeData } from "../App";

const H_SPACING = 300;
const V_SPACING = 150;

/**
 * Strip Tracery action syntax [var:#rule#] from a string
 */
function stripActions(text: string): string {
  return text.replace(/\[[^\]]*\]/g, "");
}

/**
 * Convert a Tracery reference to a Template placeholder name.
 * #key# -> __KEY__
 * #key.capitalize# -> __KEY_CAPITALIZE__
 * #key.capitalize.s# -> __KEY_CAPITALIZE_S__
 */
function refToPlaceholder(ref: TraceryReference): string {
  const parts = [ref.key, ...ref.modifiers.filter(m => SUPPORTED_MODIFIERS.has(m))];
  return `__${parts.join("_").toUpperCase()}__`;
}

/**
 * Convert a Tracery option string to Template syntax.
 * Replaces #key# and #key.modifier# with __KEY__ / __KEY_MODIFIER__ placeholders.
 * Also strips action syntax.
 */
function convertToTemplateSyntax(text: string): string {
  let result = stripActions(text);
  const refs = parseTraceryReferences(result);
  // Replace in reverse order to preserve indices
  const sortedRefs = [...refs].sort((a, b) => {
    const aIdx = result.indexOf(a.raw);
    const bIdx = result.indexOf(b.raw);
    return bIdx - aIdx;
  });
  for (const ref of sortedRefs) {
    const placeholder = refToPlaceholder(ref);
    const idx = result.indexOf(ref.raw);
    if (idx >= 0) {
      result = result.slice(0, idx) + placeholder + result.slice(idx + ref.raw.length);
    }
  }
  return result;
}

const MODIFIER_NODE_TYPES: Record<string, string> = {
  capitalize: "capitalize",
  s: "pluralize",
  a: "article",
  ed: "pasttense",
};

/**
 * Compile a validated Tracery grammar into Textubes nodes and edges.
 */
export function compileTraceryGrammar(
  grammar: Record<string, string | string[]>,
  isDarkMode: boolean
): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const nodes: Node<NodeData>[] = [];
  const edges: Edge[] = [];

  // Normalize all values to arrays
  const rules = new Map<string, string[]>();
  for (const [key, value] of Object.entries(grammar)) {
    rules.set(key, typeof value === "string" ? [value] : value);
  }

  // Track node IDs for each rule's output (the RandomSelection node)
  const ruleOutputNodeId = new Map<string, string>();

  // Build dependency graph for topological sort
  const deps = new Map<string, Set<string>>();
  for (const [key, options] of rules) {
    const keyDeps = new Set<string>();
    for (const option of options) {
      for (const ref of parseTraceryReferences(option)) {
        if (rules.has(ref.key)) keyDeps.add(ref.key);
      }
    }
    deps.set(key, keyDeps);
  }

  // Topological sort to get depth of each rule
  const depth = new Map<string, number>();

  function getDepth(key: string, stack = new Set<string>()): number {
    if (depth.has(key)) return depth.get(key)!;
    if (stack.has(key)) return 0; // cycle guard
    stack.add(key);
    const ruleDeps = deps.get(key) ?? new Set();
    const maxDep = ruleDeps.size > 0
      ? Math.max(...[...ruleDeps].map((d) => getDepth(d, stack)))
      : -1;
    const d = maxDep + 1;
    depth.set(key, d);
    return d;
  }

  for (const key of rules.keys()) {
    getDepth(key);
  }

  // Determine which rules have references (need Template nodes)
  const rulesWithRefs = new Map<string, TraceryReference[]>();
  for (const [key, options] of rules) {
    const allRefs: TraceryReference[] = [];
    for (const option of options) {
      allRefs.push(...parseTraceryReferences(option));
    }
    if (allRefs.length > 0) {
      rulesWithRefs.set(key, allRefs);
    }
  }

  // Group rules by depth for layout
  const depthGroups = new Map<number, string[]>();
  for (const [key, d] of depth) {
    if (!depthGroups.has(d)) depthGroups.set(d, []);
    depthGroups.get(d)!.push(key);
  }

  // Create nodes for each rule
  const now = Date.now();
  let nodeCounter = 0;

  function makeId(type: string, label: string): string {
    return `${type}-${label}-${now}-${nodeCounter++}`;
  }

  // For rules with refs, we need extra depth columns for Template (and modifiers)
  // Layout: each rule's Source+RS at its depth, Template at depth+0.5
  // We'll compute final x from depth, with extra offset for template nodes

  for (const [key, options] of rules) {
    const d = depth.get(key)!;

    // Create Source node
    const convertedOptions = options.map((opt) => {
      const stripped = stripActions(opt);
      return rulesWithRefs.has(key) ? convertToTemplateSyntax(stripped) : stripped;
    });
    const sourceId = makeId("source", key);
    const rsId = makeId("randomselection", key);

    nodes.push({
      id: sourceId,
      type: "source",
      position: { x: 0, y: 0 }, // positioned later
      data: {
        value: convertedOptions.join("\n"),
        isDarkMode,
        lockedInPublished: true,
      },
    });

    // Create RandomSelection node
    nodes.push({
      id: rsId,
      type: "randomselection",
      position: { x: 0, y: 0 },
      data: { value: "", mode: "line", isDarkMode },
    });

    edges.push({
      id: `e-${sourceId}-${rsId}`,
      source: sourceId,
      target: rsId,
    });

    ruleOutputNodeId.set(key, rsId);
  }

  // Create Template nodes and modifier chains for rules with references
  for (const [key, refs] of rulesWithRefs) {
    const rsId = ruleOutputNodeId.get(key)!;
    const templateId = makeId("template", key);

    nodes.push({
      id: templateId,
      type: "template",
      position: { x: 0, y: 0 },
      data: { value: "", isDarkMode },
    });

    // Connect RS -> Template (template text input)
    edges.push({
      id: `e-${rsId}-${templateId}`,
      source: rsId,
      target: templateId,
      targetHandle: "template",
    });

    // For each unique reference, connect the referenced rule's output to the template
    const processedPlaceholders = new Set<string>();
    for (const ref of refs) {
      const placeholder = refToPlaceholder(ref);
      if (processedPlaceholders.has(placeholder)) continue;
      processedPlaceholders.add(placeholder);

      const refRSId = ruleOutputNodeId.get(ref.key);
      if (!refRSId) continue;

      // The handle ID matches what TemplateNode creates: "token-{TOKEN_NAME}"
      // Token name is the text between __ __, which is KEY or KEY_MODIFIER
      const tokenName = placeholder.slice(2, -2); // remove __ prefix/suffix
      const tokenHandleId = `token-${tokenName}`;

      if (ref.modifiers.length > 0) {
        // Create modifier chain: refRS -> mod1 -> mod2 -> template
        let prevNodeId = refRSId;
        const supportedMods = ref.modifiers.filter((m) =>
          SUPPORTED_MODIFIERS.has(m)
        );
        for (const mod of supportedMods) {
          const modType = MODIFIER_NODE_TYPES[mod];
          if (!modType) continue;
          const modId = makeId(modType, `${ref.key}-${mod}`);
          nodes.push({
            id: modId,
            type: modType,
            position: { x: 0, y: 0 },
            data: { value: "", isDarkMode },
          });
          edges.push({
            id: `e-${prevNodeId}-${modId}`,
            source: prevNodeId,
            target: modId,
          });
          prevNodeId = modId;
        }
        // Connect last modifier to template token handle
        edges.push({
          id: `e-${prevNodeId}-${templateId}-${tokenHandleId}`,
          source: prevNodeId,
          target: templateId,
          targetHandle: tokenHandleId,
        });
      } else {
        // Direct connection: refRS -> template token handle
        edges.push({
          id: `e-${refRSId}-${templateId}-${tokenHandleId}`,
          source: refRSId,
          target: templateId,
          targetHandle: tokenHandleId,
        });
      }
    }

    // The template's output becomes this rule's output
    ruleOutputNodeId.set(key, templateId);
  }

  // Create Result node connected to origin's output
  const originOutputId = ruleOutputNodeId.get("origin")!;
  const resultId = makeId("result", "output");
  nodes.push({
    id: resultId,
    type: "result",
    position: { x: 0, y: 0 },
    data: { value: "", isDarkMode },
  });
  edges.push({
    id: `e-${originOutputId}-${resultId}`,
    source: originOutputId,
    target: resultId,
  });

  // --- Layout ---
  // Compute layout depth for each node based on edges
  const nodeDepth = new Map<string, number>();
  const nodeIds = new Set(nodes.map((n) => n.id));
  const inEdges = new Map<string, string[]>();
  for (const edge of edges) {
    if (!inEdges.has(edge.target)) inEdges.set(edge.target, []);
    inEdges.get(edge.target)!.push(edge.source);
  }

  function getNodeDepth(nodeId: string, stack = new Set<string>()): number {
    if (nodeDepth.has(nodeId)) return nodeDepth.get(nodeId)!;
    if (stack.has(nodeId)) return 0;
    stack.add(nodeId);
    const sources = inEdges.get(nodeId) ?? [];
    const maxSrc = sources.length > 0
      ? Math.max(...sources.map((s) => getNodeDepth(s, stack)))
      : -1;
    const d = maxSrc + 1;
    nodeDepth.set(nodeId, d);
    return d;
  }

  for (const node of nodes) {
    getNodeDepth(node.id);
  }

  // Group by depth and assign positions
  const layoutGroups = new Map<number, string[]>();
  for (const [nid, d] of nodeDepth) {
    if (!layoutGroups.has(d)) layoutGroups.set(d, []);
    layoutGroups.get(d)!.push(nid);
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  for (const [d, nids] of layoutGroups) {
    for (let i = 0; i < nids.length; i++) {
      const node = nodeMap.get(nids[i])!;
      node.position = {
        x: d * H_SPACING,
        y: i * V_SPACING,
      };
    }
  }

  return { nodes, edges };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /home/gabe/textubes && bun test utils/traceryCompiler.test.ts`
Expected: all PASS

**Step 5: Commit**

```bash
git add utils/traceryCompiler.ts utils/traceryCompiler.test.ts
git commit -m "feat: add Tracery-to-Textubes compiler with layout"
```

---

### Task 3: Capitalize Node

**Files:**
- Create: `components/CapitalizeNode.tsx`
- Modify: `nodeRegistry.ts` (add entry)

**Dependencies:** none

This is a minimal transformer: first letter uppercase, rest unchanged. We can reuse CapslockNode's "sentence" mode logic, but as a standalone node with no dropdown — it always capitalizes.

**Step 1: Write the node component**

```tsx
// components/CapitalizeNode.tsx
import { Position, useNodesData, useReactFlow, type NodeProps, type Node, useNodeConnections } from '@xyflow/react';
import { useEffect } from 'react';
import type { NodeData } from '../App';
import NodeContainer from './NodeContainer';
import HelpLabel from './HelpLabel';
import { getNodeCategory, getNodeHelp } from '../nodeRegistry';
import { getSourceValue } from '../utils/nodeUtils';

export default function CapitalizeNode({ id, data, selected, type }: NodeProps<Node<NodeData>>) {
  const { updateNodeData } = useReactFlow();
  const connections = useNodeConnections({ handleType: 'target' });
  const sourceIds = connections.map((c) => c.source);
  const nodesData = useNodesData(sourceIds);
  const helpInfo = getNodeHelp(type);

  useEffect(() => {
    if (sourceIds.length === 0) {
      if (data.value !== '') updateNodeData(id, { value: '' });
      return;
    }
    const inputValue = getSourceValue(nodesData[0], connections[0]);
    const outputValue = inputValue.charAt(0).toUpperCase() + inputValue.slice(1);
    if (data.value !== outputValue) {
      updateNodeData(id, { value: outputValue });
    }
  }, [nodesData, sourceIds.length, id, updateNodeData, data.value]);

  const toggleHelp = () => updateNodeData(id, { helpActive: !data.helpActive });

  return (
    <div className={`node-help-wrapper ${data.helpActive ? 'help-active' : ''}`}>
      {data.helpActive && helpInfo && (
        <div className="node-help-frame">
          <div className="help-description" dangerouslySetInnerHTML={{ __html: helpInfo.description }} />
        </div>
      )}
      <NodeContainer
        id={id} selected={selected} title="Capitalize"
        isDarkMode={data.isDarkMode} category={getNodeCategory(type)}
        onHelpToggle={toggleHelp} helpActive={data.helpActive}
      >
        <HelpLabel type="target" position={Position.Left}
          helpActive={data.helpActive}
          helpLabel={helpInfo?.inputs?.[0]?.label}
          helpDescription={helpInfo?.inputs?.[0]?.description} />
        <div className="node-description">First letter uppercase</div>
        <HelpLabel type="source" position={Position.Right}
          helpActive={data.helpActive}
          helpLabel={helpInfo?.outputs?.[0]?.label}
          helpDescription={helpInfo?.outputs?.[0]?.description} />
      </NodeContainer>
    </div>
  );
}
```

**Step 2: Register in nodeRegistry.ts**

Add import at top of `nodeRegistry.ts`:
```ts
import CapitalizeNode from "./components/CapitalizeNode";
```

Add entry in `NODE_REGISTRY` after the `capslock` entry:
```ts
capitalize: {
  component: CapitalizeNode,
  label: "Capitalize",
  category: 'transformer',
  help: {
    description: "Capitalizes the first letter of the input text.",
    inputs: [{ label: "Input", description: "Text to capitalize" }],
    outputs: [{ label: "Output", description: "Text with first letter capitalized" }],
  },
},
```

**Step 3: Verify it renders**

Run: `cd /home/gabe/textubes && bun run dev`
Add a "Capitalize" node from the dropdown. Connect a Source to it. Verify first letter is capitalized.

**Step 4: Commit**

```bash
git add components/CapitalizeNode.tsx nodeRegistry.ts
git commit -m "feat: add Capitalize node"
```

---

### Task 4: Pluralize Node

**Files:**
- Create: `components/PluralizeNode.tsx`
- Modify: `nodeRegistry.ts`

**Dependencies:** none

**Step 1: Write the node component**

```tsx
// components/PluralizeNode.tsx
import { Position, useNodesData, useReactFlow, type NodeProps, type Node, useNodeConnections } from '@xyflow/react';
import { useEffect } from 'react';
import type { NodeData } from '../App';
import NodeContainer from './NodeContainer';
import HelpLabel from './HelpLabel';
import { getNodeCategory, getNodeHelp } from '../nodeRegistry';
import { getSourceValue } from '../utils/nodeUtils';

function pluralize(word: string): string {
  if (!word) return word;
  const lower = word.toLowerCase();
  if (lower.endsWith('s') || lower.endsWith('sh') || lower.endsWith('ch') || lower.endsWith('x') || lower.endsWith('z')) {
    return word + 'es';
  }
  if (lower.endsWith('y') && word.length > 1 && !/[aeiou]/.test(lower[lower.length - 2])) {
    return word.slice(0, -1) + 'ies';
  }
  return word + 's';
}

export default function PluralizeNode({ id, data, selected, type }: NodeProps<Node<NodeData>>) {
  const { updateNodeData } = useReactFlow();
  const connections = useNodeConnections({ handleType: 'target' });
  const sourceIds = connections.map((c) => c.source);
  const nodesData = useNodesData(sourceIds);
  const helpInfo = getNodeHelp(type);

  useEffect(() => {
    if (sourceIds.length === 0) {
      if (data.value !== '') updateNodeData(id, { value: '' });
      return;
    }
    const inputValue = getSourceValue(nodesData[0], connections[0]);
    const outputValue = pluralize(inputValue);
    if (data.value !== outputValue) {
      updateNodeData(id, { value: outputValue });
    }
  }, [nodesData, sourceIds.length, id, updateNodeData, data.value]);

  const toggleHelp = () => updateNodeData(id, { helpActive: !data.helpActive });

  return (
    <div className={`node-help-wrapper ${data.helpActive ? 'help-active' : ''}`}>
      {data.helpActive && helpInfo && (
        <div className="node-help-frame">
          <div className="help-description" dangerouslySetInnerHTML={{ __html: helpInfo.description }} />
        </div>
      )}
      <NodeContainer
        id={id} selected={selected} title="Pluralize"
        isDarkMode={data.isDarkMode} category={getNodeCategory(type)}
        onHelpToggle={toggleHelp} helpActive={data.helpActive}
      >
        <HelpLabel type="target" position={Position.Left}
          helpActive={data.helpActive}
          helpLabel={helpInfo?.inputs?.[0]?.label}
          helpDescription={helpInfo?.inputs?.[0]?.description} />
        <div className="node-description">Simple English pluralization</div>
        <HelpLabel type="source" position={Position.Right}
          helpActive={data.helpActive}
          helpLabel={helpInfo?.outputs?.[0]?.label}
          helpDescription={helpInfo?.outputs?.[0]?.description} />
      </NodeContainer>
    </div>
  );
}
```

**Step 2: Register in nodeRegistry.ts**

Import + registry entry:
```ts
import PluralizeNode from "./components/PluralizeNode";

// In NODE_REGISTRY after capitalize:
pluralize: {
  component: PluralizeNode,
  label: "Pluralize",
  category: 'transformer',
  help: {
    description: "Applies simple English pluralization rules. Handles common patterns: -s, -es, -ies.",
    inputs: [{ label: "Input", description: "Word to pluralize" }],
    outputs: [{ label: "Output", description: "Pluralized word" }],
  },
},
```

**Step 3: Commit**

```bash
git add components/PluralizeNode.tsx nodeRegistry.ts
git commit -m "feat: add Pluralize node"
```

---

### Task 5: Article Node

**Files:**
- Create: `components/ArticleNode.tsx`
- Modify: `nodeRegistry.ts`

**Dependencies:** none

**Step 1: Write the node component**

```tsx
// components/ArticleNode.tsx
import { Position, useNodesData, useReactFlow, type NodeProps, type Node, useNodeConnections } from '@xyflow/react';
import { useEffect } from 'react';
import type { NodeData } from '../App';
import NodeContainer from './NodeContainer';
import HelpLabel from './HelpLabel';
import { getNodeCategory, getNodeHelp } from '../nodeRegistry';
import { getSourceValue } from '../utils/nodeUtils';

function addArticle(word: string): string {
  if (!word) return word;
  const firstChar = word[0].toLowerCase();
  const article = 'aeiou'.includes(firstChar) ? 'an' : 'a';
  return `${article} ${word}`;
}

export default function ArticleNode({ id, data, selected, type }: NodeProps<Node<NodeData>>) {
  const { updateNodeData } = useReactFlow();
  const connections = useNodeConnections({ handleType: 'target' });
  const sourceIds = connections.map((c) => c.source);
  const nodesData = useNodesData(sourceIds);
  const helpInfo = getNodeHelp(type);

  useEffect(() => {
    if (sourceIds.length === 0) {
      if (data.value !== '') updateNodeData(id, { value: '' });
      return;
    }
    const inputValue = getSourceValue(nodesData[0], connections[0]);
    const outputValue = addArticle(inputValue);
    if (data.value !== outputValue) {
      updateNodeData(id, { value: outputValue });
    }
  }, [nodesData, sourceIds.length, id, updateNodeData, data.value]);

  const toggleHelp = () => updateNodeData(id, { helpActive: !data.helpActive });

  return (
    <div className={`node-help-wrapper ${data.helpActive ? 'help-active' : ''}`}>
      {data.helpActive && helpInfo && (
        <div className="node-help-frame">
          <div className="help-description" dangerouslySetInnerHTML={{ __html: helpInfo.description }} />
        </div>
      )}
      <NodeContainer
        id={id} selected={selected} title="Article"
        isDarkMode={data.isDarkMode} category={getNodeCategory(type)}
        onHelpToggle={toggleHelp} helpActive={data.helpActive}
      >
        <HelpLabel type="target" position={Position.Left}
          helpActive={data.helpActive}
          helpLabel={helpInfo?.inputs?.[0]?.label}
          helpDescription={helpInfo?.inputs?.[0]?.description} />
        <div className="node-description">Prepend a/an</div>
        <HelpLabel type="source" position={Position.Right}
          helpActive={data.helpActive}
          helpLabel={helpInfo?.outputs?.[0]?.label}
          helpDescription={helpInfo?.outputs?.[0]?.description} />
      </NodeContainer>
    </div>
  );
}
```

**Step 2: Register in nodeRegistry.ts**

```ts
import ArticleNode from "./components/ArticleNode";

article: {
  component: ArticleNode,
  label: "Article (a/an)",
  category: 'transformer',
  help: {
    description: "Prepends 'a' or 'an' based on whether the word starts with a vowel.",
    inputs: [{ label: "Input", description: "Word to add article to" }],
    outputs: [{ label: "Output", description: "Word with article prepended" }],
  },
},
```

**Step 3: Commit**

```bash
git add components/ArticleNode.tsx nodeRegistry.ts
git commit -m "feat: add Article (a/an) node"
```

---

### Task 6: Past Tense Node

**Files:**
- Create: `components/PastTenseNode.tsx`
- Modify: `nodeRegistry.ts`

**Dependencies:** none

**Step 1: Write the node component**

```tsx
// components/PastTenseNode.tsx
import { Position, useNodesData, useReactFlow, type NodeProps, type Node, useNodeConnections } from '@xyflow/react';
import { useEffect } from 'react';
import type { NodeData } from '../App';
import NodeContainer from './NodeContainer';
import HelpLabel from './HelpLabel';
import { getNodeCategory, getNodeHelp } from '../nodeRegistry';
import { getSourceValue } from '../utils/nodeUtils';

function pastTense(word: string): string {
  if (!word) return word;
  const lower = word.toLowerCase();
  if (lower.endsWith('e')) return word + 'd';
  if (lower.endsWith('y') && word.length > 1 && !/[aeiou]/.test(lower[lower.length - 2])) {
    return word.slice(0, -1) + 'ied';
  }
  return word + 'ed';
}

export default function PastTenseNode({ id, data, selected, type }: NodeProps<Node<NodeData>>) {
  const { updateNodeData } = useReactFlow();
  const connections = useNodeConnections({ handleType: 'target' });
  const sourceIds = connections.map((c) => c.source);
  const nodesData = useNodesData(sourceIds);
  const helpInfo = getNodeHelp(type);

  useEffect(() => {
    if (sourceIds.length === 0) {
      if (data.value !== '') updateNodeData(id, { value: '' });
      return;
    }
    const inputValue = getSourceValue(nodesData[0], connections[0]);
    const outputValue = pastTense(inputValue);
    if (data.value !== outputValue) {
      updateNodeData(id, { value: outputValue });
    }
  }, [nodesData, sourceIds.length, id, updateNodeData, data.value]);

  const toggleHelp = () => updateNodeData(id, { helpActive: !data.helpActive });

  return (
    <div className={`node-help-wrapper ${data.helpActive ? 'help-active' : ''}`}>
      {data.helpActive && helpInfo && (
        <div className="node-help-frame">
          <div className="help-description" dangerouslySetInnerHTML={{ __html: helpInfo.description }} />
        </div>
      )}
      <NodeContainer
        id={id} selected={selected} title="Past Tense"
        isDarkMode={data.isDarkMode} category={getNodeCategory(type)}
        onHelpToggle={toggleHelp} helpActive={data.helpActive}
      >
        <HelpLabel type="target" position={Position.Left}
          helpActive={data.helpActive}
          helpLabel={helpInfo?.inputs?.[0]?.label}
          helpDescription={helpInfo?.inputs?.[0]?.description} />
        <div className="node-description">Simple past tense (-ed)</div>
        <HelpLabel type="source" position={Position.Right}
          helpActive={data.helpActive}
          helpLabel={helpInfo?.outputs?.[0]?.label}
          helpDescription={helpInfo?.outputs?.[0]?.description} />
      </NodeContainer>
    </div>
  );
}
```

**Step 2: Register in nodeRegistry.ts**

```ts
import PastTenseNode from "./components/PastTenseNode";

pasttense: {
  component: PastTenseNode,
  label: "Past Tense",
  category: 'transformer',
  help: {
    description: "Applies simple English past tense rules: -ed, -d, or -ied.",
    inputs: [{ label: "Input", description: "Word to convert" }],
    outputs: [{ label: "Output", description: "Word in past tense" }],
  },
},
```

**Step 3: Commit**

```bash
git add components/PastTenseNode.tsx nodeRegistry.ts
git commit -m "feat: add Past Tense node"
```

---

### Task 7: Import Tracery UI — Button + Handler

**Files:**
- Modify: `components/NodePicker.tsx` (add button + file input)
- Modify: `App.tsx` (add importTracery callback, pass to NodePicker)

**Dependencies:** Task 1, Task 2

**Step 1: Add onImportTracery prop to NodePicker**

In `NodePicker.tsx`, add to the props type:
```ts
onImportTracery: (event: React.ChangeEvent<HTMLInputElement>) => void;
```

Add a second hidden file input and button next to the Load button:
```tsx
<button
  className="node-picker-button"
  onClick={() => traceryInputRef.current?.click()}
  title="Import Tracery grammar"
>
  Import Tracery
</button>
<input
  ref={traceryInputRef}
  type="file"
  accept=".json"
  onChange={onImportTracery}
  style={{ display: 'none' }}
/>
```

Add `const traceryInputRef = useRef<HTMLInputElement>(null);`

**Step 2: Add importTracery handler in App.tsx**

Import the compiler:
```ts
import { validateTraceryGrammar, compileTraceryGrammar } from "./utils/traceryCompiler";
```

Add callback:
```ts
const importTracery = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target?.result as string;
      const parsed = JSON.parse(content);

      const validation = validateTraceryGrammar(parsed);

      if (!validation.valid) {
        alert("Invalid Tracery grammar:\n" + validation.errors.join("\n"));
        return;
      }

      if (validation.warnings.length > 0) {
        const proceed = confirm(
          "Warning — some features are not supported and will be ignored:\n\n" +
          validation.warnings.join("\n") +
          "\n\nImport anyway?"
        );
        if (!proceed) return;
      }

      if (nodes.length > 0) {
        if (!confirm("Replace current canvas with imported Tracery grammar?")) return;
      }

      const { nodes: newNodes, edges: newEdges } = compileTraceryGrammar(parsed, isDarkMode);
      setNodes(newNodes);
      setEdges(newEdges);
      setTitle(file.name.replace(/\.json$/, ""));

      requestAnimationFrame(() => {
        reactFlowInstanceRef.current?.fitView();
      });
    } catch (error) {
      console.error("Error importing Tracery grammar:", error);
      alert("Error parsing file. Make sure it's valid JSON.");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}, [isDarkMode, nodes.length]);
```

Pass to NodePicker:
```tsx
<NodePicker
  ...existing props...
  onImportTracery={importTracery}
/>
```

**Step 3: Verify manually**

Run: `cd /home/gabe/textubes && bun run dev`
Click "Import Tracery", load a test grammar JSON, verify nodes appear.

**Step 4: Commit**

```bash
git add components/NodePicker.tsx App.tsx
git commit -m "feat: add Import Tracery button and handler"
```

---

### Task 8: End-to-End Manual Test with DevOps Grammar

**Files:** none (manual verification)

**Dependencies:** Task 1, Task 2, Task 3, Task 4, Task 5, Task 6, Task 7

**Step 1: Create test grammar file**

Save the user's devops grammar as `/tmp/devops-suggestions.json`:
```json
{
  "origin": "#suggestion#",
  "suggestion": ["#refactor#", "#database#", "#replatform#", "#troubleshooting#"],
  "troubleshooting": ["Are you sure we're not running out of #units#?", "Try bumping up the #resource#", "I bet we're hitting #problem#"],
  "resource": ["allocated vCPU", "PIOPs", "disk space", "allocated memory", "cache size", "heap size"],
  "problem": ["a race condition", "api limits", "hardware issues", "service limits", "a permissions issue", "a bug in the upstream sdk", "the limitations of our own intelligence"],
  "units": ["file descriptors", "inodes", "disk", "cpu credits", "IOPs"],
  "replatform": "We should probably try #migrating# the #component# to #host#",
  "migrating": ["migrating", "porting", "replatforming", "moving"],
  "component": ["task workers", "ETL pipeline", "load balancers", "business logic", "queuing system", "datastore"],
  "host": ["kubernetes", "ECS", "several lambda functions", "bare metal", "a bunch of raspberry pis in a closet", "*gestures vaguely* .. the cloud"],
  "database": "Let's migrate the datastore to #datastore#",
  "datastore": ["cassandra", "couchdb", "mongo", "redis", "elasticsearch", "riak", "postgres", "dynamodb", "punchcards", "aurora", "redshift"],
  "refactor": "Have you tried #rewriting# it as a #function# in #language#?",
  "rewriting": ["refactoring", "rewriting", "replatorming"],
  "function": ["lambda", "cloud function", "unikernel", "docker container", "cronjob"],
  "language": ["haskell", "erlang", "golang", "elixir", "ocaml", "nodejs", "rust", "php", "perl"]
}
```

**Step 2: Import and verify**

1. Run `bun run dev`
2. Click "Import Tracery"
3. Select `/tmp/devops-suggestions.json`
4. Verify: ~39 nodes appear, laid out left-to-right
5. Verify: Result node shows a randomly generated suggestion
6. Verify: Clicking Regenerate on Result produces a new suggestion
7. Verify: Publishing works and the published view shows the result

**Step 3: Run all tests**

Run: `cd /home/gabe/textubes && bun test`
Expected: all pass

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: Tracery grammar import — complete feature"
```
