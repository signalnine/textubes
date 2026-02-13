import { test, expect, describe } from "bun:test";
import {
  validateTraceryGrammar,
  parseTraceryReferences,
  compileTraceryGrammar,
  preprocessTraceryInput,
} from "./traceryCompiler";

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
      {
        key: "animal",
        modifiers: ["capitalize", "s"],
        raw: "#animal.capitalize.s#",
      },
    ]);
  });

  test("returns empty for no references", () => {
    expect(parseTraceryReferences("plain text")).toEqual([]);
  });
});

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
    expect(result.errors[0]).toContain("ycle");
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

  test("warns on unsupported modifiers", () => {
    const grammar = {
      origin: "#animal.toUpperCase#",
      animal: ["cat"],
    };
    const result = validateTraceryGrammar(grammar);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("toUpperCase");
  });
});

describe("compileTraceryGrammar", () => {
  test("compiles simple grammar with no references", () => {
    const grammar = {
      origin: ["hello", "world"],
    };
    const { nodes, edges } = compileTraceryGrammar(grammar, false);
    expect(nodes.filter((n) => n.type === "source")).toHaveLength(1);
    expect(nodes.filter((n) => n.type === "randomselection")).toHaveLength(1);
    expect(nodes.filter((n) => n.type === "result")).toHaveLength(1);
    const sourceNode = nodes.find((n) => n.type === "source");
    expect(sourceNode?.data.value).toBe("hello\nworld");
    const rsNode = nodes.find((n) => n.type === "randomselection");
    expect((rsNode?.data as any).mode).toBe("line");
  });

  test("compiles grammar with references using Template nodes", () => {
    const grammar = {
      origin: "Hello, #name#!",
      name: ["Alice", "Bob"],
    };
    const { nodes } = compileTraceryGrammar(grammar, false);
    expect(nodes.filter((n) => n.type === "template")).toHaveLength(1);
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
    const { nodes } = compileTraceryGrammar(grammar, false);
    expect(nodes.filter((n) => n.type === "capitalize")).toHaveLength(1);
    const originSource = nodes.find(
      (n) =>
        n.type === "source" && n.data.value?.includes("__ANIMAL_CAPITALIZE__")
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
      (n) =>
        n.type === "randomselection" && n.id.startsWith("randomselection-animal")
    );
    const tokenEdge = edges.find(
      (e) => e.source === animalRS?.id && e.targetHandle === "token-ANIMAL"
    );
    expect(tokenEdge).toBeDefined();
  });

  test("handles the devops suggestions grammar", () => {
    const grammar = {
      origin: "#suggestion#",
      suggestion: ["#refactor#", "#database#"],
      refactor: "Have you tried #rewriting# it in #language#?",
      rewriting: ["refactoring", "rewriting"],
      language: ["haskell", "rust"],
      database: "Let's migrate to #datastore#",
      datastore: ["postgres", "mongo"],
    };
    const { nodes } = compileTraceryGrammar(grammar, false);
    expect(nodes.filter((n) => n.type === "source")).toHaveLength(7);
    expect(nodes.filter((n) => n.type === "randomselection")).toHaveLength(7);
    // Rules with refs: origin, suggestion, refactor, database -> 4 templates
    expect(nodes.filter((n) => n.type === "template")).toHaveLength(4);
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
    expect(nameSource?.data.value).toBe("Alice\nBob");
  });

  test("positions nodes in layered layout", () => {
    const grammar = {
      origin: "#animal#",
      animal: ["cat", "dog"],
    };
    const { nodes } = compileTraceryGrammar(grammar, false);
    const animalSource = nodes.find(
      (n) => n.type === "source" && n.id.startsWith("source-animal")
    );
    const resultNode = nodes.find((n) => n.type === "result");
    expect(animalSource!.position.x).toBeLessThan(resultNode!.position.x);
  });

  test("source nodes are locked in published view", () => {
    const grammar = {
      origin: ["hello"],
    };
    const { nodes } = compileTraceryGrammar(grammar, false);
    const sourceNode = nodes.find((n) => n.type === "source");
    expect(sourceNode?.data.lockedInPublished).toBe(true);
  });

  test("passes isDarkMode to all nodes", () => {
    const grammar = {
      origin: ["hello"],
    };
    const { nodes } = compileTraceryGrammar(grammar, true);
    for (const node of nodes) {
      expect(node.data.isDarkMode).toBe(true);
    }
  });

  test("handles chained modifiers with multiple nodes", () => {
    const grammar = {
      origin: "#animal.capitalize.s#",
      animal: ["cat", "dog"],
    };
    const { nodes, edges } = compileTraceryGrammar(grammar, false);
    expect(nodes.filter((n) => n.type === "capitalize")).toHaveLength(1);
    expect(nodes.filter((n) => n.type === "pluralize")).toHaveLength(1);

    // Verify chain: animal RS -> capitalize -> pluralize -> template
    const capitalizeNode = nodes.find((n) => n.type === "capitalize");
    const pluralizeNode = nodes.find((n) => n.type === "pluralize");
    const animalRS = nodes.find(
      (n) =>
        n.type === "randomselection" && n.id.startsWith("randomselection-animal")
    );

    const edge1 = edges.find(
      (e) => e.source === animalRS?.id && e.target === capitalizeNode?.id
    );
    const edge2 = edges.find(
      (e) => e.source === capitalizeNode?.id && e.target === pluralizeNode?.id
    );
    expect(edge1).toBeDefined();
    expect(edge2).toBeDefined();
  });
});

describe("preprocessTraceryInput", () => {
  test("returns valid JSON unchanged", () => {
    const json = '{"origin": "#name#", "name": ["Alice", "Bob"]}';
    const result = preprocessTraceryInput(json);
    expect(JSON.parse(result)).toEqual({ origin: "#name#", name: ["Alice", "Bob"] });
  });

  test("strips Python variable assignment", () => {
    const input = 'rules = {"origin": "hello"}';
    const result = preprocessTraceryInput(input);
    expect(JSON.parse(result)).toEqual({ origin: "hello" });
  });

  test("converts single quotes to double quotes", () => {
    const input = "{'origin': '#name#', 'name': ['Alice', 'Bob']}";
    const result = preprocessTraceryInput(input);
    expect(JSON.parse(result)).toEqual({ origin: "#name#", name: ["Alice", "Bob"] });
  });

  test("handles escaped single quotes in Python strings", () => {
    const input = "{'origin': 'it\\'s a #thing#'}";
    const result = preprocessTraceryInput(input);
    expect(JSON.parse(result)).toEqual({ origin: "it's a #thing#" });
  });

  test("handles double quotes inside single-quoted strings", () => {
    const input = `{'origin': 'She said "hello"'}`;
    const result = preprocessTraceryInput(input);
    expect(JSON.parse(result)).toEqual({ origin: 'She said "hello"' });
  });

  test("removes trailing commas", () => {
    const input = "{'origin': 'hello', 'name': ['a', 'b',],}";
    const result = preprocessTraceryInput(input);
    expect(JSON.parse(result)).toEqual({ origin: "hello", name: ["a", "b"] });
  });

  test("handles full Python dict with assignment and escapes", () => {
    const input = `rules = {
    'origin': '#suggestion#',
    'suggestion': ['Let\\'s try #thing#', 'How about #thing#'],
    'thing': ['this', 'that'],
}`;
    const result = preprocessTraceryInput(input);
    const parsed = JSON.parse(result);
    expect(parsed.origin).toBe("#suggestion#");
    expect(parsed.suggestion).toEqual(["Let's try #thing#", "How about #thing#"]);
    expect(parsed.thing).toEqual(["this", "that"]);
  });
});
