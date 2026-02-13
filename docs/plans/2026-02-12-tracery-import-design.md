# Tracery Grammar Import for Textubes

## Overview

One-way import of Tracery grammar JSON files into Textubes node graphs. Compiles Tracery rules into existing Textubes node types, with four new modifier nodes.

## Scope

**Supported:**
- Rule arrays with string options
- `#key#` references between rules
- Modifiers: `.capitalize`, `.s` (pluralize), `.a` (article), `.ed` (past tense)
- `origin` as the entry point (connected to Result node)

**Not supported:**
- Actions/memory (`[variable:#rule#]`) — detected and warned on import
- Recursive rules — detected via cycle detection, fails with error
- Custom modifiers — unsupported modifiers are warned and stripped
- Export (Textubes → Tracery)

## Compilation Model

### Rule → Nodes

Each Tracery rule becomes 2 nodes:
1. **Source node** — all options joined by newlines
2. **RandomSelection node** (line mode) — picks one option randomly

Example: `"animal": ["cat", "dog", "fish"]` →
```
[Source: "cat\ndog\nfish"] → [RandomSelection (line mode)]
```

Single-string values (`"rule": "value"`) are normalized to single-element arrays.

### References → Template Nodes

Rules whose options contain `#key#` references get an additional Template node. The compiler converts `#key#` → `__KEY__` syntax.

Example: `"origin": ["The #adjective# #animal#"]` →
```
[Source: "The __ADJECTIVE__ __ANIMAL__"] → [RandomSelection (line)] → [Template]
                                                                         ↑ ↑
                                                    adjective rule output ┘ └ animal rule output
```

When a rule has multiple options with different references, the Template node exposes inputs for the **union of all unique keys** across all options. If a selected option doesn't use a particular token, the Template node leaves it unreplaced (existing Template behavior).

### Modifiers → Modifier Nodes

`#key.modifier#` inserts a modifier node between the rule's RandomSelection output and the Template input. Modified references use distinct placeholder names to avoid collisions:

- `#animal#` → `__ANIMAL__`
- `#animal.capitalize#` → `__ANIMAL_CAPITALIZE__`
- `#animal.capitalize.s#` → `__ANIMAL_CAPITALIZE_S__`

This ensures a template containing both `#animal#` and `#animal.capitalize#` gets two separate Template inputs wired correctly.

Example: `#animal.capitalize#` →
```
[animal RandomSelection] → [CapitalizeNode] → [Template __ANIMAL_CAPITALIZE__ input]
```

Chained modifiers (`#animal.capitalize.s#`) insert nodes in series:
```
[animal RandomSelection] → [CapitalizeNode] → [PluralizeNode] → [Template __ANIMAL_CAPITALIZE_S__ input]
```

### Known Limitation: Repeated References

Multiple references to the same rule in one template (e.g., `"#animal# met #animal#"`) will produce the **same value** for both occurrences. This is inherent to Textubes' DAG model where each node has a single output value at a time. In Tracery, each `#key#` expansion is independent.

Users who need independent values can duplicate the rule's nodes in the editor after import.

## New Node Types

### CapitalizeNode (transformer)
- Input: text string
- Output: first character uppercased, rest unchanged
- Category: transformer

### PluralizeNode (transformer)
- Input: text string
- Output: simple English pluralization
- Rules: words ending in "s", "sh", "ch", "x", "z" → append "es"; words ending in consonant + "y" → replace "y" with "ies"; otherwise → append "s"
- Category: transformer

### ArticleNode (transformer)
- Input: text string
- Output: prepend "a " or "an " based on whether the first character is a vowel
- Category: transformer

### PastTenseNode (transformer)
- Input: text string
- Output: simple English past tense
- Rules: words ending in "e" → append "d"; words ending in consonant + "y" → replace "y" with "ied"; otherwise → append "ed"
- Category: transformer

All four nodes are registered in `nodeRegistry.ts` under the "transformer" category.

## Validation & Error Handling

### Grammar Validation
A valid Tracery grammar is a JSON object where:
- Every key is a string
- Every value is either a string or an array of strings
- It is not a Textubes flow file (no top-level `version` + `nodes` + `edges` together)

### Pre-compilation Checks
1. **`origin` key required** — if missing, show error: "Tracery grammar must have an 'origin' rule"
2. **Cycle detection** — build dependency graph and check for cycles before topological sort. If found, show error listing the cyclic rules
3. **Missing references** — validate all `#key#` references resolve to existing rules. Show error listing unresolved references
4. **Unsupported features** — scan for `[action]` syntax and unknown modifiers. Show warning (non-blocking) listing what was stripped

### Import Warnings Dialog
If unsupported features are detected, show a warning listing them before proceeding:
```
Warning: The following Tracery features are not supported and were ignored:
- Actions: [hero:#name#] (line 3)
- Unknown modifier: .toUpperCase (line 7)
Import anyway?  [Cancel] [Import]
```

## Layout Algorithm

1. Build dependency graph from edges
2. Detect cycles (fail with error if found)
3. Topological sort to determine depth of each node
4. Assign x-position based on depth (leftmost = leaf rules, rightmost = origin/result)
5. Within each depth column, assign y-position incrementally with even spacing
6. Call `fitView()` after placement

Constants:
- Horizontal spacing: 300px between depth columns
- Vertical spacing: 150px between nodes in same column

## UI

### Import Button
- Location: NodePicker toolbar, next to the existing Load button
- Label: "Import Tracery"
- Behavior:
  1. Opens file picker for `.json` files
  2. Parses JSON and validates it as a Tracery grammar
  3. Runs pre-compilation checks (origin, cycles, missing refs)
  4. Shows warnings for unsupported features if any
  5. If canvas is not empty, shows confirmation dialog
  6. Compiles grammar to nodes + edges
  7. Sets nodes and edges, calls `fitView()`

## Compiler Pipeline

```
Parse JSON
  → Validate structure (keys → string | string[])
  → Normalize single strings to arrays
  → Check for 'origin' key
  → Build reference graph, detect cycles
  → Validate all references resolve
  → Scan for unsupported features, collect warnings
  → For each rule:
      → Create Source node (options joined by \n)
      → Create RandomSelection node (line mode)
      → Connect Source → RandomSelection
  → For each rule with #key# or #key.modifier# references:
      → Convert references to __KEY__ or __KEY_MODIFIER__ placeholders
      → Create Template node
      → Connect RandomSelection → Template (template text input)
      → For each unique reference:
          → If modifier(s) present:
              → Create modifier node chain
              → Connect rule output → modifier chain → Template
          → If no modifier:
              → Connect rule output → Template
  → Create Result node connected to origin rule's final output
  → Compute layout positions via topological sort
  → Return { nodes, edges }
```

## Example

Input Tracery grammar:
```json
{
  "origin": "#name# went to the #place# and found a #adjective.capitalize# #animal#.",
  "name": ["Alice", "Bob", "Charlie"],
  "place": ["store", "park", "beach"],
  "adjective": ["mysterious", "tiny", "golden"],
  "animal": ["cat", "dog", "phoenix"]
}
```

Compiled nodes (12 nodes):
- 4 Source nodes (one per rule including origin)
- 4 RandomSelection nodes
- 1 Template node (for origin)
- 1 CapitalizeNode (for #adjective.capitalize#)
- 1 Result node
- Note: origin has only one option so its Source has one line, RandomSelection passes it through

Compiled edges (11 edges):
- 4× Source → RandomSelection
- 1× origin RandomSelection → Template (template text input)
- 1× name RandomSelection → Template (__NAME__ input)
- 1× place RandomSelection → Template (__PLACE__ input)
- 1× adjective RandomSelection → CapitalizeNode
- 1× CapitalizeNode → Template (__ADJECTIVE_CAPITALIZE__ input)
- 1× animal RandomSelection → Template (__ANIMAL__ input)
- 1× Template → Result
