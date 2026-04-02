import type { RefContext } from '../../../../scripts/config-schema/post-process';
import {
  buildInlineSet,
  buildRenameMap,
  deduplicateRefDescriptions,
  extractNamedInlineDefs,
  normalizeZodOutput,
  orderProperties,
  postProcessDefs,
  resolveRefChain,
  rewriteRefs,
} from '../../../../scripts/config-schema/post-process';

describe('buildRenameMap', () => {
  it('maps defs with defName to their declared name', () => {
    const defs = {
      __schema0: { defName: 'severity', type: 'string', enum: ['critical', 'high'] },
      __schema1: { type: 'boolean' },
    };
    expect(buildRenameMap(defs)).toEqual({
      __schema0: 'severity',
      __schema1: '__schema1',
    });
  });

  it('returns identity mapping when no defName is present', () => {
    const defs = { x: { type: 'string' } };
    expect(buildRenameMap(defs)).toEqual({ x: 'x' });
  });

  it('returns empty map for empty defs', () => {
    expect(buildRenameMap({})).toEqual({});
  });
});

describe('buildInlineSet', () => {
  it('marks unnamed $ref defs as inlinable', () => {
    const defs = {
      __schema0: { $ref: '#/$defs/__schema1' },
      __schema1: { defName: 'foo', type: 'object', properties: {} },
    };
    const result = buildInlineSet(defs);
    expect(result.has('__schema0')).toBe(true);
    expect(result.has('__schema1')).toBe(false);
  });

  it('marks unnamed boolean defs as inlinable', () => {
    const defs = { __schema0: { type: 'boolean' } };
    expect(buildInlineSet(defs).has('__schema0')).toBe(true);
  });

  it('marks unnamed number defs as inlinable', () => {
    const defs = { __schema0: { type: 'number', minimum: 0 } };
    expect(buildInlineSet(defs).has('__schema0')).toBe(true);
  });

  it('marks unnamed string defs as inlinable', () => {
    const defs = { __schema0: { type: 'string' } };
    expect(buildInlineSet(defs).has('__schema0')).toBe(true);
  });

  it('marks unnamed integer (non-enum) defs as inlinable', () => {
    const defs = { __schema0: { type: 'integer', minimum: 1, maximum: 10 } };
    expect(buildInlineSet(defs).has('__schema0')).toBe(true);
  });

  it('does not mark integer enums as inlinable', () => {
    const defs = { __schema0: { type: 'integer', enum: [1, 2, 3] } };
    expect(buildInlineSet(defs).has('__schema0')).toBe(false);
  });

  it('marks empty objects (no properties) as inlinable', () => {
    const defs = { __schema0: { type: 'object' } };
    expect(buildInlineSet(defs).has('__schema0')).toBe(true);
  });

  it('does not mark objects with properties as inlinable', () => {
    const defs = { __schema0: { type: 'object', properties: { a: { type: 'string' } } } };
    expect(buildInlineSet(defs).has('__schema0')).toBe(false);
  });

  it('marks array defs as inlinable', () => {
    const defs = { __schema0: { type: 'array', items: { type: 'string' } } };
    expect(buildInlineSet(defs).has('__schema0')).toBe(true);
  });

  it('marks completely empty defs as inlinable', () => {
    const defs = { __schema0: {} };
    expect(buildInlineSet(defs).has('__schema0')).toBe(true);
  });

  it('skips defs that have a defName (renamed defs)', () => {
    const defs = { __schema0: { defName: 'severity', type: 'string' } };
    expect(buildInlineSet(defs).has('__schema0')).toBe(false);
  });

  it('inlines primitives with descriptions', () => {
    const defs = {
      __schema0: { type: 'boolean', description: 'Enable feature.' },
    };
    expect(buildInlineSet(defs).has('__schema0')).toBe(true);
  });

  it('skips extracted defs where key equals defName', () => {
    const defs = {
      severity: { defName: 'severity', type: 'string', enum: ['critical', 'high'] },
    };
    expect(buildInlineSet(defs).has('severity')).toBe(false);
  });
});

describe('extractNamedInlineDefs', () => {
  it('extracts an inline object with defName into $defs', () => {
    const defs: Record<string, Record<string, unknown>> = {};
    const schema = {
      properties: {
        review: {
          defName: 'reviewConfig',
          description: 'Review config',
          type: 'object',
          additionalProperties: false,
          properties: { pipeline: {} },
        },
      },
    };

    extractNamedInlineDefs(schema, defs);

    expect(schema.properties.review).toEqual({
      $ref: '#/$defs/reviewConfig',
      description: 'Review config',
    });
    expect(defs.reviewConfig).toEqual({
      defName: 'reviewConfig',
      description: 'Review config',
      type: 'object',
      additionalProperties: false,
      properties: { pipeline: {} },
    });
  });

  it('keeps description and deprecated as siblings on the $ref', () => {
    const defs: Record<string, Record<string, unknown>> = {};
    const schema = {
      properties: {
        paths: {
          defName: 'pathsConfig',
          description: 'Legacy paths',
          deprecated: true,
          type: 'object',
          properties: {},
        },
      },
    };

    extractNamedInlineDefs(schema, defs);

    expect(schema.properties.paths).toEqual({
      $ref: '#/$defs/pathsConfig',
      description: 'Legacy paths',
      deprecated: true,
    });
  });

  it('does not extract objects without defName', () => {
    const defs: Record<string, Record<string, unknown>> = {};
    const schema = {
      properties: {
        simple: { type: 'string' },
      },
    };

    extractNamedInlineDefs(schema, defs);

    expect(schema.properties.simple).toEqual({ type: 'string' });
    expect(Object.keys(defs)).toHaveLength(0);
  });

  it('does not extract objects that already have a $ref', () => {
    const defs: Record<string, Record<string, unknown>> = {};
    const schema = {
      properties: {
        field: { defName: 'foo', $ref: '#/$defs/bar' },
      },
    };

    extractNamedInlineDefs(schema, defs);

    expect(schema.properties.field).toEqual({ defName: 'foo', $ref: '#/$defs/bar' });
    expect(Object.keys(defs)).toHaveLength(0);
  });

  it('does not overwrite existing $defs with the same name', () => {
    const defs: Record<string, Record<string, unknown>> = {
      existing: { type: 'number' },
    };
    const schema = {
      properties: {
        field: { defName: 'existing', type: 'string' },
      },
    };

    extractNamedInlineDefs(schema, defs);

    expect(defs.existing).toEqual({ type: 'number' });
    expect(schema.properties.field).toEqual({ defName: 'existing', type: 'string' });
  });

  it('recurses into nested structures', () => {
    const defs: Record<string, Record<string, unknown>> = {};
    const schema = {
      properties: {
        outer: {
          properties: {
            inner: {
              defName: 'innerConfig',
              description: 'Nested',
              type: 'object',
              properties: {},
            },
          },
        },
      },
    };

    extractNamedInlineDefs(schema, defs);

    expect(schema.properties.outer.properties.inner).toEqual({
      $ref: '#/$defs/innerConfig',
      description: 'Nested',
    });
    expect(defs.innerConfig).toBeDefined();
  });

  it('handles arrays', () => {
    const defs: Record<string, Record<string, unknown>> = {};
    const schema = {
      items: [
        {
          defName: 'itemSchema',
          description: 'An item',
          type: 'object',
          properties: {},
        },
      ],
    };

    extractNamedInlineDefs(schema, defs);

    expect(schema.items[0]).toEqual({
      $ref: '#/$defs/itemSchema',
      description: 'An item',
    });
    expect(defs.itemSchema).toBeDefined();
  });
});

describe('resolveRefChain', () => {
  function makeCtx(
    defs: Record<string, Record<string, unknown>>,
    overrides?: Partial<RefContext>,
  ): RefContext {
    return {
      defs,
      renameMap: overrides?.renameMap ?? buildRenameMap(defs),
      inlineSet: overrides?.inlineSet ?? buildInlineSet(defs),
    };
  }

  it('resolves a single def without $ref', () => {
    const defs = { a: { type: 'boolean' } };
    expect(resolveRefChain(defs, 'a', makeCtx(defs))).toEqual({ type: 'boolean' });
  });

  it('follows a single $ref hop', () => {
    const defs = {
      a: { description: 'deprecated field', $ref: '#/$defs/b' },
      b: { type: 'boolean' },
    };
    const ctx = makeCtx(defs, { inlineSet: new Set(['a', 'b']) });
    expect(resolveRefChain(defs, 'a', ctx)).toEqual({
      description: 'deprecated field',
      type: 'boolean',
    });
  });

  it('follows a multi-hop $ref chain', () => {
    const defs = {
      a: { deprecated: true, $ref: '#/$defs/b' },
      b: { description: 'middle', $ref: '#/$defs/c' },
      c: { type: 'string' },
    };
    const ctx = makeCtx(defs, { inlineSet: new Set(['a', 'b', 'c']) });
    expect(resolveRefChain(defs, 'a', ctx)).toEqual({
      deprecated: true,
      description: 'middle',
      type: 'string',
    });
  });

  it('first property wins on key conflicts', () => {
    const defs = {
      a: { description: 'first', $ref: '#/$defs/b' },
      b: { description: 'second', type: 'string' },
    };
    const ctx = makeCtx(defs, { inlineSet: new Set(['a', 'b']) });
    expect(resolveRefChain(defs, 'a', ctx)).toEqual({
      description: 'first',
      type: 'string',
    });
  });

  it('returns null for empty def', () => {
    const defs = { a: {} };
    expect(resolveRefChain(defs, 'a', makeCtx(defs))).toBeNull();
  });

  it('stops at non-inlinable $ref and preserves it', () => {
    const defs = {
      a: { deprecated: true, $ref: '#/$defs/missing' },
    };
    const ctx = makeCtx(defs, { inlineSet: new Set(['a']) });
    expect(resolveRefChain(defs, 'a', ctx)).toEqual({
      deprecated: true,
      $ref: '#/$defs/missing',
    });
  });

  it('stops at a named def and preserves the $ref', () => {
    const defs = {
      wrapper: { description: 'per-field', $ref: '#/$defs/namedDef' },
      namedDef: { type: 'object', properties: { a: {} } },
    };
    const ctx = makeCtx(defs, {
      inlineSet: new Set(['wrapper']),
      renameMap: { wrapper: 'wrapper', namedDef: 'namedDef' },
    });

    expect(resolveRefChain(defs, 'wrapper', ctx)).toEqual({
      description: 'per-field',
      $ref: '#/$defs/namedDef',
    });
  });

  it('renames the $ref when the named def has a different final name', () => {
    const defs = {
      wrapper: { description: 'stage config', $ref: '#/$defs/__schema5' },
      __schema5: { type: 'object', defName: 'aiStageConfig', properties: {} },
    };
    const ctx = makeCtx(defs, {
      inlineSet: new Set(['wrapper']),
      renameMap: { wrapper: 'wrapper', __schema5: 'aiStageConfig' },
    });

    expect(resolveRefChain(defs, 'wrapper', ctx)).toEqual({
      description: 'stage config',
      $ref: '#/$defs/aiStageConfig',
    });
  });

  it('fully resolves when all defs in chain are inlinable', () => {
    const defs = {
      a: { deprecated: true, $ref: '#/$defs/b' },
      b: { type: 'boolean' },
    };
    const ctx = makeCtx(defs, {
      inlineSet: new Set(['a', 'b']),
      renameMap: { a: 'a', b: 'b' },
    });

    expect(resolveRefChain(defs, 'a', ctx)).toEqual({
      deprecated: true,
      type: 'boolean',
    });
  });
});

describe('rewriteRefs', () => {
  function makeCtx(overrides: {
    defs: Record<string, Record<string, unknown>>;
    renameMap?: Record<string, string>;
    inlineSet?: Set<string>;
  }): RefContext {
    return {
      defs: overrides.defs,
      renameMap: overrides.renameMap ?? buildRenameMap(overrides.defs),
      inlineSet: overrides.inlineSet ?? buildInlineSet(overrides.defs),
    };
  }

  it('inlines a $ref to an inlinable def', () => {
    const defs = { __s0: { type: 'boolean' } };
    const ctx = makeCtx({ defs, inlineSet: new Set(['__s0']) });
    const obj = { field: { $ref: '#/$defs/__s0' } };

    rewriteRefs(obj, ctx);

    expect(obj.field).toEqual({ type: 'boolean' });
  });

  it('renames $ref to a named def', () => {
    const defs = { __s0: { defName: 'severity', type: 'string', enum: ['high'] } };
    const ctx = makeCtx({ defs, renameMap: { __s0: 'severity' }, inlineSet: new Set() });
    const obj = { field: { $ref: '#/$defs/__s0' } };

    rewriteRefs(obj, ctx);

    expect((obj.field as any).$ref).toBe('#/$defs/severity');
  });

  it('preserves existing properties when inlining', () => {
    const defs = { __s0: { type: 'boolean' } };
    const ctx = makeCtx({ defs, inlineSet: new Set(['__s0']) });
    const obj = { field: { description: 'keep me', $ref: '#/$defs/__s0' } };

    rewriteRefs(obj, ctx);

    expect(obj.field).toEqual({ description: 'keep me', type: 'boolean' });
  });

  it('handles empty def inlining (passthrough additionalProperties)', () => {
    const defs = { __s0: {} };
    const ctx = makeCtx({ defs, inlineSet: new Set(['__s0']) });
    const obj = { additionalProperties: { $ref: '#/$defs/__s0' } };

    rewriteRefs(obj, ctx);

    expect(obj.additionalProperties).toEqual({});
  });

  it('recursively processes inlined content with nested $refs', () => {
    const defs = {
      __s0: { description: 'wrapper', $ref: '#/$defs/__s1' },
      __s1: { type: 'object', properties: { a: { $ref: '#/$defs/__s2' } } },
      __s2: { type: 'string' },
    };
    const ctx = makeCtx({
      defs,
      renameMap: { __s0: '__s0', __s1: '__s1', __s2: '__s2' },
      inlineSet: new Set(['__s0', '__s1', '__s2']),
    });
    const obj = { field: { $ref: '#/$defs/__s0' } };

    rewriteRefs(obj, ctx);

    expect(obj.field).toEqual({
      description: 'wrapper',
      type: 'object',
      properties: { a: { type: 'string' } },
    });
  });

  it('handles arrays', () => {
    const defs = { __s0: { type: 'boolean' } };
    const ctx = makeCtx({ defs, inlineSet: new Set(['__s0']) });
    const obj = { anyOf: [{ $ref: '#/$defs/__s0' }, { type: 'null' }] };

    rewriteRefs(obj, ctx);

    expect(obj.anyOf).toEqual([{ type: 'boolean' }, { type: 'null' }]);
  });

  it('preserves $ref to named def when inlining a wrapper', () => {
    const defs = {
      __s0: { description: 'stage config', $ref: '#/$defs/__s1' },
      __s1: { defName: 'aiStageConfig', type: 'object', properties: { model: {} } },
    };
    const ctx = makeCtx({
      defs,
      renameMap: { __s0: '__s0', __s1: 'aiStageConfig' },
      inlineSet: new Set(['__s0']),
    });
    const obj = { reviewStage: { $ref: '#/$defs/__s0' } };

    rewriteRefs(obj, ctx);

    expect(obj.reviewStage).toEqual({
      description: 'stage config',
      $ref: '#/$defs/aiStageConfig',
    });
  });

  it('does not flatten named defs shared across multiple fields', () => {
    const defs = {
      __w1: { description: 'review', $ref: '#/$defs/__named' },
      __w2: { description: 'fix', $ref: '#/$defs/__named' },
      __named: { defName: 'shared', type: 'object', properties: {} },
    };
    const ctx = makeCtx({
      defs,
      renameMap: { __w1: '__w1', __w2: '__w2', __named: 'shared' },
      inlineSet: new Set(['__w1', '__w2']),
    });
    const obj = {
      a: { $ref: '#/$defs/__w1' },
      b: { $ref: '#/$defs/__w2' },
    };

    rewriteRefs(obj, ctx);

    expect(obj.a).toEqual({ description: 'review', $ref: '#/$defs/shared' });
    expect(obj.b).toEqual({ description: 'fix', $ref: '#/$defs/shared' });
  });
});

describe('normalizeZodOutput', () => {
  it('removes defName from a flat object', () => {
    const obj = { defName: 'foo', type: 'string' };
    normalizeZodOutput(obj);
    expect(obj).toEqual({ type: 'string' });
  });

  it('removes defName recursively', () => {
    const obj = {
      properties: {
        a: { defName: 'bar', type: 'number' },
      },
      $defs: {
        x: { defName: 'baz', type: 'boolean' },
      },
    };
    normalizeZodOutput(obj);
    expect(obj.properties.a).toEqual({ type: 'number' });
    expect(obj.$defs.x).toEqual({ type: 'boolean' });
  });

  it('handles arrays', () => {
    const obj = { items: [{ defName: 'a', type: 'string' }] };
    normalizeZodOutput(obj);
    expect(obj.items[0]).toEqual({ type: 'string' });
  });

  it('handles null and primitives without error', () => {
    expect(() => normalizeZodOutput(null)).not.toThrow();
    expect(() => normalizeZodOutput('string')).not.toThrow();
    expect(() => normalizeZodOutput(42)).not.toThrow();
  });

  it('converts const to single-element enum', () => {
    const obj = { type: 'string', const: 'agentic' } as Record<string, unknown>;
    normalizeZodOutput(obj);
    expect(obj.enum).toEqual(['agentic']);
    expect(obj.const).toBeUndefined();
  });

  it('normalizes empty additionalProperties to true', () => {
    const obj = { type: 'object', additionalProperties: {} } as Record<string, unknown>;
    normalizeZodOutput(obj);
    expect(obj.additionalProperties).toBe(true);
  });

  it('strips MAX_SAFE_INTEGER ceiling on integers', () => {
    const obj = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
    normalizeZodOutput(obj);
    expect(obj.maximum).toBeUndefined();
    expect(obj.minimum).toBe(1);
  });

  it('promotes anyOf to oneOf', () => {
    const obj = { anyOf: [{ $ref: '#/$defs/a' }, { $ref: '#/$defs/b' }] } as Record<
      string,
      unknown
    >;
    normalizeZodOutput(obj);
    expect(obj.oneOf).toEqual([{ $ref: '#/$defs/a' }, { $ref: '#/$defs/b' }]);
    expect(obj.anyOf).toBeUndefined();
  });

  it('strips trivial propertyNames { type: "string" }', () => {
    const obj = { type: 'object', propertyNames: { type: 'string' } } as Record<string, unknown>;
    normalizeZodOutput(obj);
    expect(obj.propertyNames).toBeUndefined();
  });

  it('keeps non-trivial propertyNames', () => {
    const obj = {
      type: 'object',
      propertyNames: { type: 'string', pattern: '^[a-z]+$' },
    } as Record<string, unknown>;
    normalizeZodOutput(obj);
    expect(obj.propertyNames).toEqual({ type: 'string', pattern: '^[a-z]+$' });
  });
});

describe('deduplicateRefDescriptions', () => {
  it('removes description that matches the referenced def', () => {
    const defs = { severity: { description: 'Severity levels', type: 'string' } };
    const schema = {
      properties: { level: { description: 'Severity levels', $ref: '#/$defs/severity' } },
    };
    deduplicateRefDescriptions(schema, defs);
    expect((schema.properties.level as any).description).toBeUndefined();
    expect((schema.properties.level as any).$ref).toBe('#/$defs/severity');
  });

  it('keeps description that differs from the def', () => {
    const defs = { severity: { description: 'Severity levels', type: 'string' } };
    const schema = {
      properties: { level: { description: 'Custom description', $ref: '#/$defs/severity' } },
    };
    deduplicateRefDescriptions(schema, defs);
    expect((schema.properties.level as any).description).toBe('Custom description');
  });

  it('handles missing def gracefully', () => {
    const defs = {};
    const schema = {
      properties: { level: { description: 'Some desc', $ref: '#/$defs/missing' } },
    };
    deduplicateRefDescriptions(schema, defs);
    expect((schema.properties.level as any).description).toBe('Some desc');
  });
});

describe('orderProperties', () => {
  it('places $schema, $id, title, description before type and properties', () => {
    const input = {
      properties: { a: { type: 'string' } },
      type: 'object',
      description: 'A schema',
      title: 'Test',
      $id: 'test',
      $schema: 'draft-2020-12',
    };
    const result = orderProperties(input) as Record<string, unknown>;
    const keys = Object.keys(result);
    expect(keys.indexOf('$schema')).toBeLessThan(keys.indexOf('type'));
    expect(keys.indexOf('$id')).toBeLessThan(keys.indexOf('type'));
    expect(keys.indexOf('title')).toBeLessThan(keys.indexOf('type'));
    expect(keys.indexOf('description')).toBeLessThan(keys.indexOf('type'));
    expect(keys.indexOf('type')).toBeLessThan(keys.indexOf('properties'));
  });

  it('places additionalProperties before properties', () => {
    const input = { properties: {}, additionalProperties: false, type: 'object' };
    const result = orderProperties(input) as Record<string, unknown>;
    const keys = Object.keys(result);
    expect(keys.indexOf('additionalProperties')).toBeLessThan(keys.indexOf('properties'));
  });

  it('places $defs last', () => {
    const input = { $defs: {}, type: 'object', properties: {} };
    const result = orderProperties(input) as Record<string, unknown>;
    const keys = Object.keys(result);
    expect(keys.indexOf('$defs')).toBe(keys.length - 1);
  });

  it('preserves unknown keys after known keys', () => {
    const input = { customKey: 'value', type: 'string', description: 'test' };
    const result = orderProperties(input) as Record<string, unknown>;
    const keys = Object.keys(result);
    expect(keys.indexOf('description')).toBeLessThan(keys.indexOf('customKey'));
    expect(keys.indexOf('type')).toBeLessThan(keys.indexOf('customKey'));
  });

  it('recurses into nested objects', () => {
    const input = {
      properties: {
        a: { properties: { b: {} }, type: 'object', description: 'nested' },
      },
    };
    const result = orderProperties(input) as any;
    const nestedKeys = Object.keys(result.properties.a);
    expect(nestedKeys.indexOf('description')).toBeLessThan(nestedKeys.indexOf('type'));
    expect(nestedKeys.indexOf('type')).toBeLessThan(nestedKeys.indexOf('properties'));
  });

  it('recurses into arrays', () => {
    const input = { anyOf: [{ type: 'string', description: 'first' }] };
    const result = orderProperties(input) as any;
    const itemKeys = Object.keys(result.anyOf[0]);
    expect(itemKeys.indexOf('description')).toBeLessThan(itemKeys.indexOf('type'));
  });

  it('passes through null and primitives', () => {
    expect(orderProperties(null)).toBeNull();
    expect(orderProperties('string')).toBe('string');
    expect(orderProperties(42)).toBe(42);
    expect(orderProperties(true)).toBe(true);
  });
});

describe('postProcessDefs (integration)', () => {
  it('renames, inlines, and strips in one pass', () => {
    const schema = {
      type: 'object',
      properties: {
        severity: { $ref: '#/$defs/__schema0' },
        enabled: { $ref: '#/$defs/__schema1' },
        name: { description: 'A name', $ref: '#/$defs/__schema2' },
      },
      $defs: {
        __schema0: {
          defName: 'severity',
          type: 'string',
          enum: ['critical', 'high'],
        },
        __schema1: { type: 'boolean' },
        __schema2: { type: 'string', minLength: 1 },
      },
    };

    postProcessDefs(schema);

    // __schema0 renamed to severity
    expect(schema.$defs).toHaveProperty('severity');
    expect(schema.$defs).not.toHaveProperty('__schema0');
    expect((schema.$defs as any).severity.defName).toBeUndefined();

    // $ref updated to use new name
    expect((schema.properties.severity as any).$ref).toBe('#/$defs/severity');

    // __schema1 (boolean) inlined
    expect(schema.$defs).not.toHaveProperty('__schema1');
    expect(schema.properties.enabled).toEqual({ type: 'boolean' });

    // __schema2 (string) inlined, preserving existing description
    expect(schema.$defs).not.toHaveProperty('__schema2');
    expect(schema.properties.name).toEqual({
      description: 'A name',
      type: 'string',
      minLength: 1,
    });
  });

  it('handles schema without $defs', () => {
    const schema = { type: 'object', properties: {} };
    expect(() => postProcessDefs(schema)).not.toThrow();
  });

  it('handles deprecated $ref chains', () => {
    const schema = {
      type: 'object',
      properties: {
        legacy: { $ref: '#/$defs/__schema0' },
      },
      $defs: {
        __schema0: { deprecated: true, description: 'Legacy field', $ref: '#/$defs/__schema1' },
        __schema1: { type: 'boolean' },
      },
    };

    postProcessDefs(schema);

    expect(schema.properties.legacy).toEqual({
      deprecated: true,
      description: 'Legacy field',
      type: 'boolean',
    });
    expect(schema.$defs).not.toHaveProperty('__schema0');
    expect(schema.$defs).not.toHaveProperty('__schema1');
  });

  it('preserves $ref to named defs used in multiple places', () => {
    const schema = {
      type: 'object',
      properties: {
        reviewStage: { $ref: '#/$defs/__w1' },
        fixStage: { $ref: '#/$defs/__w2' },
      },
      $defs: {
        __w1: { description: 'Review stage', $ref: '#/$defs/__named' },
        __w2: { description: 'Fix stage', $ref: '#/$defs/__named' },
        __named: {
          defName: 'aiStageConfig',
          type: 'object',
          properties: { model: { type: 'string' } },
        },
      },
    };

    postProcessDefs(schema);

    expect(schema.properties.reviewStage).toEqual({
      description: 'Review stage',
      $ref: '#/$defs/aiStageConfig',
    });
    expect(schema.properties.fixStage).toEqual({
      description: 'Fix stage',
      $ref: '#/$defs/aiStageConfig',
    });
    expect(schema.$defs).toHaveProperty('aiStageConfig');
    expect(schema.$defs).not.toHaveProperty('__named');
    expect(schema.$defs).not.toHaveProperty('__w1');
    expect(schema.$defs).not.toHaveProperty('__w2');
  });

  it('inlines empty defs from passthrough()', () => {
    const schema = {
      type: 'object',
      properties: {},
      $defs: {
        __s0: {},
      },
    };

    postProcessDefs(schema);

    expect(schema.$defs).not.toHaveProperty('__s0');
  });
});
