# Schema adapters

Adapters separate generic JSON structure from source-specific capture semantics. Select an adapter at compilation time. Retrieval uses the semantic records persisted during compilation.

## Included adapters

| ID                     | Behavior                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `generic-json`         | Index any accepted UTF-8 JSON input. All JSON values are direct observations. Emit no operations, failures or availability interpretations. |
| `errorcore-example-v1` | Interpret the explicitly versioned synthetic schema described below.                                                                        |

The illustrative adapter is not Errorcore's production schema. Production integration requires a real schema definition and corresponding sanitized fixtures.

## Illustrative capture schema

The root must be an object containing `$schema: "errorcore.example/v1"`. The example uses three optional root arrays:

```json
{
  "$schema": "errorcore.example/v1",
  "operations": [
    {
      "id": "request-1",
      "label": "Handle request",
      "correlationId": "trace-1",
      "snapshot": { "request": { "route": "/orders" } }
    },
    {
      "id": "write-2",
      "status": "failed",
      "snapshot": {
        "exception": { "message": "Recorded write failure" },
        "customer": {
          "$availability": "redacted",
          "reason": "upstream policy"
        }
      }
    }
  ],
  "relationships": [{ "from": "request-1", "to": "write-2", "type": "await" }],
  "failures": [
    { "operationId": "write-2", "message": "Recorded failure", "primary": true }
  ]
}
```

Operation records retain string ID, label and correlation metadata when supplied, plus a reference to the snapshot. Engine operation IDs identify source record occurrences, preventing collisions when source IDs are duplicated. Exact string IDs up to 1,024 UTF-16 code units participate in resolution. Longer, absent or non-string IDs remain referenceable but unresolved. Duplicate source IDs make matching endpoints ambiguous.

Relationships require an explicit supported type: `parent`, `call`, `await`, `trigger`, `sequence` or `dependency`. `parent` and `call` run from parent/caller to child. The engine preserves these distinctions and never infers a relationship from array order, elapsed time or labels.

An operation's explicit `status: "failed"` records a failure at the status field. Entries in `failures` record additional failure locations. Both records are retained if both were supplied. Only an explicit boolean `primary: true` establishes primary status.

## Availability wrappers

Objects may contain `$availability` with `observed`, `redacted`, `truncated`, `not_captured`, `unknown` or `unresolved`. Optional string fields include `reason` and `$runtimeType`. Observed and truncated wrappers may contain an explicit `value`.

```json
{
  "$availability": "truncated",
  "reason": "source capture limit",
  "value": [1, 2]
}
```

`getEvidence` returns a `reference` to that `value` with `sourceComplete: false`. Following the reference retrieves the available portion; source incompleteness remains explicit. An observed or truncated wrapper without `value` returns unresolved availability. Other unavailable states return metadata without inventing a runtime value.

`$runtimeType` reports upstream metadata only. For example, an explicit undefined encoding can be preserved as an observed wrapper with `$runtimeType: "undefined"` and a JSON value. The engine does not reconstruct a JavaScript `undefined`, circular reference or object identity.

Original wrapper members remain stored and structurally navigable. Generic mode treats all of these fields as ordinary JSON. Duplicate reserved fields in semantic records are rejected as ambiguous; duplicate ordinary runtime keys remain separate structural observations.

## Implementing an adapter

The interfaces are defined in [`src/types/index.ts`](../src/types/index.ts). [`src/adapters/example.ts`](../src/adapters/example.ts) provides the complete reference implementation.

```ts
interface CaptureSchemaAdapter {
  id: string;
  create(context: AdapterContext): AdapterSession;
}

interface AdapterSession {
  start(event: StructuralEvent): void;
  end(event: StructuralEvent): void;
  finish(): void;
}
```

Each compilation creates an isolated session. `start` receives the beginning of a structural value. `end` receives its completed scalar length and bounded preview. `finish` validates the completed schema. Events include record/parent offsets, ordinal, kind, key, depth, scalar length and optional preview. Scalar previews contain at most 1,024 UTF-16 code units; keys are constrained by ingestion limits.

`context.emit` persists discriminated semantic records for operations, relationships, failures or availability. Emitted evidence references and provenance must resolve to actual structural records. Optional `sourceKey`, `fromKey`, `toKey` and `operationKey` provide consistent exact-match keys for persisted graph resolution. `directOperation` can bind a failure to an operation record directly. The example encodes complete source strings as base64 UTF-16LE to preserve exact matching, including NUL and lone surrogates.

Adapter sessions must keep state bounded by nesting and recognized metadata. Do not assemble runtime objects, accumulate a graph in memory, or treat incomplete previews as complete source identifiers. Configured adapters execute trusted synchronous code; they must not alter evidence or log raw runtime values.

Register the adapter and select it by ID:

```ts
const engine = createEvidenceEngine({ storage, adapters: [productionAdapter] });
await engine.compileRuntimeState(stream, { adapterId: productionAdapter.id });
```

Custom adapters currently produce graph completeness `partial`; there is no complete-graph declaration in the adapter interface. Add integration tests for explicit metadata, missing fields, duplicate and oversized IDs, unavailable values, graph references and ambiguous relationships before integrating a production format.
