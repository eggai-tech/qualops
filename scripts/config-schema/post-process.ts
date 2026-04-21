/**
 * Post-processing utilities for Zod-generated JSON Schemas.
 *
 * Zod's toJSONSchema generates auto-named $defs (__schema0, __schema1, ...).
 * Each Zod schema tagged with `.meta({ defName: '...' })` gets that name
 * propagated into the JSON Schema output as a `defName` property, which these
 * utilities then use to rename, inline, and clean up the generated schema.
 */

type Defs = Record<string, Record<string, unknown>>;

export interface RefContext {
  renameMap: Record<string, string>;
  inlineSet: Set<string>;
  defs: Defs;
}

const DEFS_REF_RE = /^#\/\$defs\/(.+)$/;

export function postProcessDefs(schema: Record<string, unknown>): void {
  const defs = schema.$defs as Defs | undefined;
  if (!defs) return;

  extractNamedInlineDefs(schema, defs);

  const ctx: RefContext = {
    renameMap: buildRenameMap(defs),
    inlineSet: buildInlineSet(defs),
    defs,
  };

  rewriteRefs(schema, ctx);
  normalizeZodOutput(schema);
  applyRenamesAndPrune(defs, ctx);
  deduplicateRefDescriptions(schema, defs);
}

function applyRenamesAndPrune(defs: Defs, { renameMap, inlineSet }: RefContext): void {
  for (const key of inlineSet) {
    delete defs[key];
  }

  const kept = new Set<string>();
  for (const [oldName, newName] of Object.entries(renameMap)) {
    if (inlineSet.has(oldName)) continue;
    if (kept.has(newName)) {
      delete defs[oldName];
      continue;
    }
    kept.add(newName);
    if (oldName !== newName) {
      defs[newName] = defs[oldName];
      delete defs[oldName];
    }
  }
}

/**
 * If the child object has a `defName` and no existing `$ref`, extract it into
 * `$defs` and return a `$ref` + sibling properties replacement. Returns null
 * if the child should not be extracted.
 */
function liftToDef(child: Record<string, unknown>, defs: Defs): Record<string, unknown> | null {
  const defName = child.defName as string | undefined;
  if (!defName || child.$ref) return null;
  if (defs[defName]) return null;

  const extracted: Record<string, unknown> = {};
  const sibling: Record<string, unknown> = { $ref: `#/$defs/${defName}` };

  for (const [k, v] of Object.entries(child)) {
    if (k === 'defName') continue;
    if (k === 'description') {
      sibling[k] = v;
      extracted[k] = v;
    } else if (k === 'deprecated') {
      sibling[k] = v;
    } else {
      extracted[k] = v;
    }
  }

  extracted.defName = defName;
  defs[defName] = extracted;
  return sibling;
}

type NodeObject = Record<string, unknown>;
type NodeArray = unknown[];
type WalkNode = NodeObject | NodeArray;

/**
 * Visitor called once per object/array node during a walk. May mutate the
 * node in place. Returning a new object/array replaces the node at its
 * parent (the walker handles the reassignment). Returning void/undefined
 * keeps the original node.
 */
type Visitor = (node: WalkNode) => WalkNode | void;

/**
 * Depth-first tree walker for JSON Schema nodes. Recurses into every object
 * property and every array element. Primitives are returned as-is.
 *
 * - `order: 'pre'` (default) — visit parent, then recurse into children.
 * - `order: 'post'` — recurse into children, then visit parent.
 */
function walk(node: unknown, visit: Visitor, order: 'pre' | 'post' = 'pre'): unknown {
  if (node === null || typeof node !== 'object') return node;

  const recurseChildren = (current: WalkNode): void => {
    if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i++) {
        current[i] = walk(current[i], visit, order);
      }
    } else {
      for (const key of Object.keys(current)) {
        current[key] = walk(current[key], visit, order);
      }
    }
  };

  let current = node as WalkNode;

  if (order === 'pre') {
    const replaced = visit(current);
    if (replaced !== undefined) current = replaced;
    recurseChildren(current);
    return current;
  }

  recurseChildren(current);
  const replaced = visit(current);
  return replaced ?? current;
}

export function extractNamedInlineDefs(node: unknown, defs: Defs): void {
  walk(
    node,
    (n) => {
      if (Array.isArray(n)) return;
      return liftToDef(n, defs) ?? undefined;
    },
    'post',
  );
}

export function buildRenameMap(defs: Defs): Record<string, string> {
  const map: Record<string, string> = {};

  for (const [key, def] of Object.entries(defs)) {
    const name = (def.defName as string) ?? null;
    map[key] = name ?? key;
  }

  return map;
}

/**
 * $defs without a defName that are trivial primitives get inlined at usage sites.
 */
export function buildInlineSet(defs: Defs): Set<string> {
  const inlinable = new Set<string>();

  for (const [key, def] of Object.entries(defs)) {
    if (def.defName) continue;
    if (def.$ref) {
      inlinable.add(key);
      continue;
    }
    const type = def.type as string | undefined;
    const isPrimitive = type === 'boolean' || type === 'number' || type === 'string';
    const isConstrainedInt = type === 'integer' && !def.enum;
    if (isPrimitive || isConstrainedInt) {
      inlinable.add(key);
    }
    if (type === 'object' && !def.properties) {
      inlinable.add(key);
    }
    if (type === 'object' && def.additionalProperties === false) {
      inlinable.add(key);
    }
    if (type === 'array') {
      inlinable.add(key);
    }
    if (Object.keys(def).length === 0) {
      inlinable.add(key);
    }
  }

  return inlinable;
}

export function rewriteRefs(node: unknown, ctx: RefContext): void {
  walk(node, (n) => {
    if (Array.isArray(n)) return;
    // Loop handles the case where inlining merges in a new $ref
    // (e.g., chain resolution stops at a named def). After at most one
    // additional pass the ref is either fully inlined or canonicalized.
    while (typeof n.$ref === 'string') {
      const before = n.$ref;
      rewriteRefProperty(n, before, ctx);
      if (n.$ref === before) break;
    }
  });
}

function rewriteRefProperty(obj: Record<string, unknown>, ref: string, ctx: RefContext): void {
  const match = ref.match(DEFS_REF_RE);
  if (!match) return;

  const refName = match[1];
  const { renameMap, inlineSet, defs } = ctx;

  if (inlineSet.has(refName)) {
    const merged = resolveRefChain(defs, refName, ctx);
    delete obj.$ref;
    if (merged) {
      for (const [k, v] of Object.entries(merged)) {
        if (!(k in obj)) obj[k] = v;
      }
    }
  } else if (renameMap[refName] && renameMap[refName] !== refName) {
    obj.$ref = `#/$defs/${renameMap[refName]}`;
  }
}

/**
 * Follow a $ref chain, collecting non-$ref properties from each node.
 * Stops at named defs (those not in inlineSet) — preserving the $ref so the
 * named def stays referenced rather than being fully flattened.
 *
 * E.g. { deprecated: true, $ref: "#/$defs/__s0" } where __s0 = { type: "boolean" }
 * yields { deprecated: true, type: "boolean" }.
 *
 * But { description: "...", $ref: "#/$defs/__s0" } where __s0 refs a named def
 * yields { description: "...", $ref: "#/$defs/namedDef" }.
 */
export function resolveRefChain(
  defs: Defs,
  startName: string,
  ctx: RefContext,
): Record<string, unknown> | null {
  const merged: Record<string, unknown> = {};
  let current = defs[startName];

  while (current) {
    for (const [k, v] of Object.entries(current)) {
      if (k !== '$ref' && !(k in merged)) {
        merged[k] = v;
      }
    }
    const ref = current.$ref as string | undefined;
    if (!ref) break;

    const innerMatch = ref.match(DEFS_REF_RE);
    if (!innerMatch) break;

    const targetName = innerMatch[1];
    if (!ctx.inlineSet.has(targetName)) {
      merged.$ref = `#/$defs/${ctx.renameMap[targetName] ?? targetName}`;
      break;
    }
    current = defs[targetName];
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

/**
 * Normalize Zod-specific JSON Schema output quirks into conventional JSON Schema.
 */
export function normalizeZodOutput(node: unknown): void {
  walk(node, (n) => {
    if (!Array.isArray(n)) normalizeNode(n);
  });
}

function normalizeNode(obj: Record<string, unknown>): void {
  delete obj.defName;

  if ('const' in obj && typeof obj.const === 'string') {
    obj.enum = [obj.const];
    delete obj.const;
  }

  if (
    'additionalProperties' in obj &&
    typeof obj.additionalProperties === 'object' &&
    obj.additionalProperties !== null &&
    Object.keys(obj.additionalProperties as object).length === 0
  ) {
    obj.additionalProperties = true;
  }

  if (obj.type === 'integer' && obj.maximum === Number.MAX_SAFE_INTEGER) {
    delete obj.maximum;
  }

  if (Array.isArray(obj.anyOf) && !obj.oneOf) {
    obj.oneOf = obj.anyOf;
    delete obj.anyOf;
  }

  if (
    'propertyNames' in obj &&
    typeof obj.propertyNames === 'object' &&
    obj.propertyNames !== null
  ) {
    const pn = obj.propertyNames as Record<string, unknown>;
    if (Object.keys(pn).length === 1 && pn.type === 'string') {
      delete obj.propertyNames;
    }
  }
}

/**
 * Remove description siblings on $ref nodes when they duplicate the
 * referenced def's own description — avoids redundant text in the output.
 */
export function deduplicateRefDescriptions(node: unknown, defs: Defs): void {
  walk(node, (n) => {
    if (Array.isArray(n)) return;
    if (typeof n.$ref !== 'string' || typeof n.description !== 'string') return;
    const match = n.$ref.match(DEFS_REF_RE);
    if (!match) return;
    const def = defs[match[1]];
    if (def && def.description === n.description) {
      delete n.description;
    }
  });
}

/** Reorder JSON Schema properties so metadata comes first, data structures last. */
const KNOWN_ORDER = [
  '$schema',
  '$id',
  'title',
  'description',
  'deprecated',
  '$ref',
  'type',
  'additionalProperties',
  'enum',
  'const',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'uniqueItems',
  'format',
  'default',
  'required',
  'properties',
  'items',
  'anyOf',
  'oneOf',
  'allOf',
  'if',
  'then',
  'else',
  '$defs',
];

export function orderProperties(node: unknown): unknown {
  return walk(node, (n) => {
    if (Array.isArray(n)) return;
    const ordered: Record<string, unknown> = {};
    for (const key of KNOWN_ORDER) {
      if (key in n) ordered[key] = n[key];
    }
    for (const key of Object.keys(n)) {
      if (!(key in ordered)) ordered[key] = n[key];
    }
    return ordered;
  });
}
