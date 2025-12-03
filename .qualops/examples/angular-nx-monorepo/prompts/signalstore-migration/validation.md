# Validation Rules for SignalStore Migration Review

You are validating migration opportunities identified by the SignalStore Migration Review.

## VALIDATION CRITERIA

A migration opportunity is VALID if:

1. **Uses traditional NgRx patterns:**
   - File contains `createAction()`, `createReducer()`, `createEffect()`, or `createSelector()`
   - NOT already using `signalStore()` or `@ngrx/signals` imports
   - NOT a `*.store.ts` file (these are already modern)

2. **Has clear SignalStore equivalent:**
   - Pattern can be directly mapped to SignalStore APIs
   - Migration path is straightforward and well-documented
   - No blockers preventing migration

3. **Complete migration unit identified:**
   - All related files are identified (actions, reducer, effects, selectors, facade)
   - No missing dependencies or circular references
   - Components using this store are also identified

4. **Provides actionable guidance:**
   - Specific migration steps are provided
   - Before/after examples show the transformation
   - Complexity assessment is realistic

5. **Appropriate severity:**
   - High: Complete feature store with all files, entity patterns, performance impact
   - Medium: Simple CRUD patterns, basic state management
   - Low: Individual files (actions/selectors only), configuration changes
   - NEVER Critical: Migrations are improvements, not bugs

## INVALID (FALSE POSITIVE) PATTERNS

An issue is INVALID if:

1. **Already using SignalStore:**
   - File imports from `@ngrx/signals`
   - File contains `signalStore()`, `withState()`, `withMethods()`, `withComputed()`
   - File name is `*.store.ts`

2. **Intentional hybrid pattern:**
   - Comments indicate intentional use of both patterns
   - Form state management (often needs traditional NgRx)

3. **Non-migratable patterns:**
   - Root app store with global state
   - Router state bindings (`@ngrx/router-store`)
   - Meta-reducers or runtime checks
   - Third-party library integration requiring traditional NgRx

4. **Incomplete or vague guidance:**
   - No specific migration steps provided
   - No before/after code examples
   - Migration unit missing related files
   - Complexity not assessed

5. **Already modern patterns:**
   - Using `toSignal()` conversions
   - Using `withResetOnEtUserSwitch()` (custom feature)
   - Components already injecting stores directly

6. **File context missing:**
   - Can't verify the actual pattern from quoted code
   - No line numbers or location specified
   - Quoted code doesn't match the pattern described

## CONFIDENCE ADJUSTMENT

**Lower confidence if:**

1. **Migration complexity is high:**
   - Complex nested state structures
   - Many interdependent effects
   - Heavy entity adapter usage with custom sorting/filtering
   - Shared state across multiple features

2. **Incomplete analysis:**
   - Migration unit is partial (e.g., only effects, no actions/reducer)
   - Missing dependency analysis
   - No component impact assessment

3. **Edge cases present:**
   - File uses advanced NgRx features (runtime checks, meta-reducers)
   - Integration with third-party libraries
   - Complex routing or lazy loading requirements

4. **Hybrid project:**
   - Project already has mix of traditional and SignalStore
   - Unclear migration strategy
   - Dependencies on both patterns

**Raise confidence if:**

1. **Clear, simple pattern:**
   - Basic CRUD with load/success/failure
   - Simple entity list management
   - Straightforward state structure
   - No complex dependencies

2. **Complete migration unit:**
   - All 5 files identified (actions, reducer, effects, selectors, facade)
   - Clear transformation path for each
   - Components using this store are simple

3. **Similar patterns already migrated:**
   - Other projects in monorepo have migrated similar patterns
   - Reference implementations exist (venues, clients, seatmaps)
   - Pattern matches known successful migrations

4. **Strong migration benefits:**
   - Reduces file count significantly (5 files → 1 file)
   - Eliminates boilerplate
   - Improves performance with signals
   - Simplifies testing

## SPECIAL CASES

### Entity Management Migration
**Valid if:**
- Uses `EntityState<T>` and `EntityAdapter<T>`
- Entity operations are straightforward (add/update/remove/setAll)
- No complex custom selectors with entity adapter methods

**Invalid if:**
- Uses advanced adapter features not yet in SignalStore
- Custom sorting/filtering logic tightly coupled to adapter
- Entity normalization with nested relationships

### Effects Migration
**Valid if:**
- Effect performs API call and dispatches success/failure actions
- Uses standard operators: switchMap, mergeMap, exhaustMap, catchError
- Side effects are simple (API calls, notifications)

**Invalid if:**
- Effect has complex orchestration (multiple dependent API calls)
- Uses advanced operators not easily translatable to rxMethod
- Depends on store state in complex ways (withLatestFrom with multiple selectors)

### Facade Migration
**Valid if:**
- Facade only wraps store.select() and store.dispatch()
- No business logic in facade
- Simple observable streams

**Invalid if:**
- Facade contains business logic beyond state access
- Complex RxJS transformations in facade
- Used as dependency injection point for multiple services

## VALIDATION DECISION MATRIX

| Pattern | Files Found | SignalStore Equivalent | Complexity | Decision |
|---------|-------------|------------------------|------------|----------|
| Actions + Reducer + Effects | All 3 | withState + rxMethod | Simple CRUD | VALID (High confidence) |
| Actions + Reducer only | 2 files | withState + methods | Simple state | VALID (Medium confidence) |
| Effects only | 1 file | rxMethod | Isolated | INVALID (Incomplete unit) |
| Selectors only | 1 file | withComputed | Isolated | INVALID (Incomplete unit) |
| EntityState + Adapter | Reducer with entity | withEntities | Entity management | VALID (High confidence) |
| Facade wrapping Store | Facade file | Direct injection | Simple wrapper | VALID (Medium confidence) |
| *.store.ts file | Already modern | N/A | N/A | INVALID (False positive) |
| Hybrid pattern (events) | Mixed | Intentional | Complex | INVALID (Intentional design) |

## EXAMPLE VALIDATION DECISIONS

### Example 1: VALID Migration Opportunity
**Pattern:** Traditional Genre Store
**Files:** genre.actions.ts, genre.reducer.ts, genre.effects.ts, genre.selectors.ts, genre.facade.ts
**Analysis:** Complete migration unit, simple CRUD, no dependencies
**Decision:** KEEP with confidence 8 (clear migration path)

### Example 2: INVALID - Already Migrated
**Pattern:** Venue Store
**Files:** venue.store.ts
**Analysis:** File imports signalStore from @ngrx/signals
**Decision:** DISCARD (false positive - already modern)

### Example 3: INVALID - Incomplete Unit
**Pattern:** Effect for API call
**Files:** event.effects.ts (single file)
**Analysis:** No actions or reducer identified, part of larger hybrid system
**Decision:** DISCARD (incomplete analysis, part of intentional hybrid)

### Example 4: VALID - Entity Management
**Pattern:** Promotion Store with EntityAdapter
**Files:** promotion.actions.ts, promotion.reducer.ts (with EntityState), promotion.effects.ts
**Analysis:** Standard entity CRUD with adapter, clear withEntities equivalent
**Decision:** KEEP with confidence 7 (entity migration needs care)

### Example 5: INVALID - Intentional Hybrid
**Pattern:** Complex Form Store
**Files:** form.reducer.ts
**Analysis:** Complex form state with intentional hybrid implementation
**Decision:** DISCARD (intentional design, complex migration)
