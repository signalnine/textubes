import type { Node, Edge } from "@xyflow/react";
import type { NodeData } from "../App";

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

const MODIFIER_NODE_TYPES: Record<string, string> = {
  capitalize: "capitalize",
  s: "pluralize",
  a: "article",
  ed: "pasttense",
};

const H_SPACING = 300;
const V_SPACING = 150;

/**
 * Parse all #key# and #key.modifier# references from a string.
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
 * Validate a Tracery grammar object.
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
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) continue;
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
        warnings.push(
          `Rule "${key}": actions (e.g. [var:#rule#]) are not supported and will be stripped`
        );
      }
      const refs = parseTraceryReferences(option);
      for (const ref of refs) {
        keyDeps.add(ref.key);
        if (!ruleKeys.has(ref.key)) {
          errors.push(`Rule "${key}" references undefined rule "${ref.key}"`);
        }
        for (const mod of ref.modifiers) {
          if (!SUPPORTED_MODIFIERS.has(mod)) {
            warnings.push(
              `Rule "${key}": unsupported modifier ".${mod}" will be ignored`
            );
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
      errors.push(
        `Cycle detected involving rule "${key}" — Textubes does not support recursive grammars`
      );
      return { valid: false, errors, warnings };
    }
  }

  return { valid: true, errors, warnings };
}

/**
 * Strip Tracery action syntax [var:#rule#] from a string.
 */
function stripActions(text: string): string {
  return text.replace(/\[[^\]]*\]/g, "");
}

/**
 * Convert a Tracery reference to a Template placeholder name.
 * #key# -> __KEY__
 * #key.capitalize# -> __KEY_CAPITALIZE__
 */
function refToPlaceholder(ref: TraceryReference): string {
  const parts = [ref.key, ...ref.modifiers.filter((m) => SUPPORTED_MODIFIERS.has(m))];
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
  // Replace in reverse order by position to preserve indices
  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i];
    const placeholder = refToPlaceholder(ref);
    const idx = result.lastIndexOf(ref.raw);
    if (idx >= 0) {
      result = result.slice(0, idx) + placeholder + result.slice(idx + ref.raw.length);
    }
  }
  return result;
}

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

  // Compute depth of each rule (leaf = 0, origin = deepest)
  const depth = new Map<string, number>();

  function getDepth(key: string, stack = new Set<string>()): number {
    if (depth.has(key)) return depth.get(key)!;
    if (stack.has(key)) return 0;
    stack.add(key);
    const ruleDeps = deps.get(key) ?? new Set();
    const maxDep =
      ruleDeps.size > 0
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
      allRefs.push(...parseTraceryReferences(stripActions(option)));
    }
    if (allRefs.length > 0) {
      rulesWithRefs.set(key, allRefs);
    }
  }

  // Create nodes for each rule
  const now = Date.now();
  let nodeCounter = 0;

  function makeId(type: string, label: string): string {
    return `${type}-${label}-${now}-${nodeCounter++}`;
  }

  // Track template node IDs for rules with references
  const ruleTemplateNodeId = new Map<string, string>();

  for (const [key, options] of rules) {
    // Convert options to template syntax if this rule has references
    const convertedOptions = options.map((opt) => {
      const stripped = stripActions(opt);
      return rulesWithRefs.has(key) ? convertToTemplateSyntax(stripped) : stripped;
    });

    const sourceId = makeId("source", key);

    nodes.push({
      id: sourceId,
      type: "source",
      position: { x: 0, y: 0 },
      data: {
        value: convertedOptions.join("\n"),
        isDarkMode,
        lockedInPublished: true,
      },
    });

    if (rulesWithRefs.has(key)) {
      // Rules with references: Source → Template → RS
      // Template sees the full source text (all options), creating handles for ALL tokens.
      // After token replacement, RS picks one random resolved line.
      const templateId = makeId("template", key);
      const rsId = makeId("randomselection", key);

      nodes.push({
        id: templateId,
        type: "template",
        position: { x: 0, y: 0 },
        data: { value: "", isDarkMode },
      });

      nodes.push({
        id: rsId,
        type: "randomselection",
        position: { x: 0, y: 0 },
        data: { value: "", mode: "line", isDarkMode },
      });

      // Source → Template (template handle)
      edges.push({
        id: `e-${sourceId}-${templateId}`,
        source: sourceId,
        target: templateId,
        targetHandle: "template",
      });

      // Template → RS
      edges.push({
        id: `e-${templateId}-${rsId}`,
        source: templateId,
        target: rsId,
      });

      ruleTemplateNodeId.set(key, templateId);
      ruleOutputNodeId.set(key, rsId);
    } else {
      // Simple rules without references: Source → RS
      const rsId = makeId("randomselection", key);

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
  }

  // Wire up token connections for rules with references
  for (const [key, refs] of rulesWithRefs) {
    const templateId = ruleTemplateNodeId.get(key)!;

    const processedPlaceholders = new Set<string>();
    for (const ref of refs) {
      const placeholder = refToPlaceholder(ref);
      if (processedPlaceholders.has(placeholder)) continue;
      processedPlaceholders.add(placeholder);

      const refOutputId = ruleOutputNodeId.get(ref.key);
      if (!refOutputId) continue;

      const tokenName = placeholder.slice(2, -2); // remove __ prefix/suffix
      const tokenHandleId = `token-${tokenName}`;

      if (ref.modifiers.length > 0 && ref.modifiers.some((m) => SUPPORTED_MODIFIERS.has(m))) {
        // Create modifier chain: refOutput -> mod1 -> mod2 -> template
        let prevNodeId = refOutputId;
        const supportedMods = ref.modifiers.filter((m) => SUPPORTED_MODIFIERS.has(m));
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
        // Direct connection: refOutput -> template token handle
        edges.push({
          id: `e-${refOutputId}-${templateId}-${tokenHandleId}`,
          source: refOutputId,
          target: templateId,
          targetHandle: tokenHandleId,
        });
      }
    }
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
    const maxSrc =
      sources.length > 0
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
