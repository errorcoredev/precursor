# API reference

The public entry point is [`src/index.ts`](../src/index.ts). A build emits JavaScript and declarations at `dist/src/index.js` and `dist/src/index.d.ts`. All four public operations return promises and use the contracts exported from [`src/types/index.ts`](../src/types/index.ts).

## Engine configuration

```ts
createEvidenceEngine({
  storage: new LocalEvidenceStorage('./evidence-store'),
  adapters: [customAdapter],
  limits: { outputBytes: 65536, maxDepth: 256 },
});
```

`storage` is required. It is a trusted implementation of `EvidenceStorage`. Additional adapters are optional; `generic-json` and `errorcore-example-v1` are registered automatically. Adapter IDs must be unique, start with a lowercase letter, and contain at most 64 lowercase letters, digits or hyphens. Built-in IDs cannot be replaced.

Engine limits establish defaults within hard ceilings. The top-level function exports use a shared default engine with `.errorcore-evidence` in the process working directory. Use a configured engine when storage location and isolation need to be explicit.

## compileRuntimeState

```ts
compileRuntimeState(
  input: Readable,
  options?: CompileOptions,
): Promise<EvidenceManifest>
```

Accepts a Node.js `Readable` producing `Buffer` or `Uint8Array` chunks. String chunks and streams configured with a text encoding are rejected. Input must be valid UTF-8 JSON without a leading byte-order mark.

| Option      | Default                   | Meaning                                                    |
| ----------- | ------------------------- | ---------------------------------------------------------- |
| `adapterId` | `generic-json`            | Registered schema adapter to use.                          |
| `signal`    | None                      | An `AbortSignal` for cancellation before publication.      |
| `maxBytes`  | `Number.MAX_SAFE_INTEGER` | Maximum received source bytes, as a positive safe integer. |

The result identifies a committed capture, its root evidence ID, adapter, format version, file sizes, SHA-256 hashes, structural/graph counts, availability counts, graph completeness and ingestion metrics. `captureComplete: true` means the received JSON was fully validated and committed. It does not assert that upstream captured the complete runtime state.

The manifest must fit the engine's `outputBytes` limit. Input-byte limits and retrieval-output limits are separate. A failed or interrupted ingestion is not visible through retrieval. Cancellation racing the atomic publication point cannot revoke a completed commit.

## getOverview

```ts
getOverview(
  captureId: string,
  options?: OverviewOptions,
): Promise<IncidentOverview>
```

This is the first operation in a debugging session. It returns recorded failures, a compact execution graph, root evidence ID, availability counts, provenance and completeness notes. Full runtime objects are not included.

| Option               | Default               | Allowed values                               |
| -------------------- | --------------------- | -------------------------------------------- |
| `maxBytes`           | Engine output default | 4,096 through the configured output ceiling. |
| `operationLimit`     | 25                    | Integer from 1 through 1,000.                |
| `relationshipLimit`  | 50                    | Integer from 1 through 1,000.                |
| `failureLimit`       | 10                    | Integer from 1 through 1,000.                |
| `operationCursor`    | Beginning             | Continuation for the operation page.         |
| `relationshipCursor` | Beginning             | Continuation for the relationship page.      |
| `failureCursor`      | Beginning             | Continuation for the failure page.           |
| `focusOperationId`   | None                  | An engine operation ID in this capture.      |

The three sections paginate independently. Counts report total, returned and remaining records. Each section has an `endCursor`, including after exhaustion. `nextCursor` exists only when more records remain.

Use all three end cursors when continuing a combined projection:

```ts
let options: OverviewOptions = {};
while (true) {
  const view = await engine.getOverview(captureId, options);
  consume(view);
  if (view.responseComplete) break;
  options = {
    ...options,
    failureCursor: view.failurePage.endCursor,
    operationCursor: view.graph.operationPage.endCursor,
    relationshipCursor: view.graph.relationshipPage.endCursor,
  };
}
```

`consume` represents application processing. Begin a new pagination sequence when changing `focusOperationId`. Default ordering prioritizes failure operations, explicit parent/call ancestors, directly connected operations and then source order. A focused overview prioritizes the selected operation and its incident relationships.

Generic JSON reports an `unavailable` execution graph. The illustrative adapter reports `partial` because it cannot establish that every runtime relationship was captured. Failure location is a recorded observation, not a root-cause conclusion. Endpoint resolution is `resolved`, `missing`, `ambiguous` or `unresolved`; ambiguous source IDs do not merge operations.

## inspectNode

```ts
inspectNode(
  nodeId: string,
  options?: InspectOptions,
): Promise<EvidenceNodeView>
```

Returns node metadata, ordered child views, pagination and `responseComplete`. Metadata includes type, parent, ordinal, key/path previews, availability, payload reference and provenance.

| Option     | Default               | Allowed values                                                   |
| ---------- | --------------------- | ---------------------------------------------------------------- |
| `maxBytes` | Engine output default | 4,096 through the configured output ceiling.                     |
| `limit`    | 50                    | Integer from 1 through 1,000, shared by the recursive expansion. |
| `depth`    | 1                     | Integer from 1 through 4.                                        |
| `cursor`   | Beginning             | Continuation bound to this node and requested depth.             |

`depth: 1` returns immediate child views. Children at the depth boundary retain their own cursors for separate expansion. Response completeness applies to the requested projection; it does not require expanding descendants outside that depth.

For straightforward sequential traversal, use depth 1 and pass `page.nextCursor` until absent. For recursive responses, follow each returned view's continuation using the depth applicable to that view. The entry budget is shared, so a root page alone does not imply that every returned child's expansion is complete.

Inspection exposes original source structure, including explicit wrapper members. It does not reconstruct an unavailable runtime value.

## getEvidence

```ts
getEvidence(
  nodeId: string,
  options?: EvidenceOptions,
): Promise<EvidenceResult>
```

| Option       | Default               | Allowed values                                   |
| ------------ | --------------------- | ------------------------------------------------ |
| `maxBytes`   | Engine output default | 4,096 through the configured output ceiling.     |
| `limit`      | 50                    | Integer from 1 through 1,000 collection entries. |
| `sliceUnits` | 4,096                 | Integer from 1 through 262,144.                  |
| `cursor`     | Beginning             | Continuation for this node and evidence part.    |
| `part`       | `value`               | `value`, `key` or `pointer`.                     |

Results are a discriminated union:

| `kind`        | Content                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `scalar`      | Observed boolean or JSON `null`.                                                                                                   |
| `text`        | A string, key or pointer slice, or an exact numeric-lexeme slice. Includes `start`, `total`, `encoding` and optional `nextCursor`. |
| `collection`  | Ordered child-node references and a page state.                                                                                    |
| `reference`   | An observed/truncated wrapper's explicit `valueId`. Follow the reference to retrieve available content.                            |
| `unavailable` | Explicit redacted, not-captured, unknown or unresolved metadata.                                                                   |

Every variant includes the node, `sourceComplete` and `responseComplete`. Source incompleteness and response pagination are separate. A complete response can describe a source-truncated value. Incompleteness follows a truncated wrapper's captured value and descendants.

Numbers use `encoding: "number-lexeme"` and remain strings. Strings use `encoding: "utf16-code-units"`; a slice may split a surrogate pair. Concatenate slices before interpreting the completed text. Collection entries remain references rather than recursively materialized objects.

`part: "key"` is valid only for an object member. `part: "pointer"` retrieves the full JSON Pointer in bounded slices. Previews explicitly report their original length and completeness. Duplicate object keys retain distinct node IDs and ordinals; a JSON Pointer alone may be ambiguous.

## Limits and identity

| Engine limit     |   Default |                Hard maximum |
| ---------------- | --------: | --------------------------: |
| `outputBytes`    |    65,536 | Configured `maxOutputBytes` |
| `maxOutputBytes` | 1,048,576 |                   1,048,576 |
| `maxDepth`       |       256 |                       1,024 |
| `maxKeyBytes`    |    65,536 |                   1,048,576 |
| `maxPathBytes`   |   262,144 |                   2,097,152 |

Output budgets have a minimum of 4,096 bytes. Key/path sizes count decoded UTF-16 bytes; path escaping contributes to the path limit. Value depth includes the root. Configuring depth 256 allows 255 nested containers around a scalar.

Capture IDs are generated UUIDs. Evidence and operation IDs identify a capture and a validated structural record: `<capture UUID>:<record offset>`. These offsets belong to `structure.bin`, not to `source.json`. Prefer returned IDs to constructing them.

Cursors are opaque, HMAC-authenticated and bound to their capture/node, operation and query shape. Keep the same depth, evidence part or overview focus when continuing a query. Page sizes and byte budgets may change. Cursors survive process restarts when the store and its `cursor.key` are preserved.

Limits are evaluated against the UTF-8 byte length of the serialized JSON response. If no minimal record fits, the API throws `RESOURCE_LIMIT`. A result never silently discards excess evidence.

## Errors

Public operations throw `EvidenceError` with a stable `code`. Routine error messages do not include raw capture values or parser excerpts.

| Code                  | Meaning                                                                |
| --------------------- | ---------------------------------------------------------------------- |
| `INVALID_ARGUMENT`    | Invalid identifier, option, adapter selection or resource-limit value. |
| `INVALID_CURSOR`      | Malformed, invalidly signed, out-of-range or incorrectly bound cursor. |
| `CAPTURE_NOT_FOUND`   | No committed capture exists for the supplied ID.                       |
| `NODE_NOT_FOUND`      | No valid evidence node exists at the supplied reference.               |
| `INVALID_INPUT`       | Unsupported stream/chunk type or adapter-rejected source schema.       |
| `INVALID_JSON`        | Invalid UTF-8 or JSON grammar.                                         |
| `RESOURCE_LIMIT`      | Input, nesting, key/path or output capacity exceeded.                  |
| `ABORTED`             | Ingestion was cancelled before publication.                            |
| `STORAGE_ERROR`       | Storage or another internal operation failed.                          |
| `INTEGRITY_ERROR`     | Stored data failed integrity or structural validation.                 |
| `UNSUPPORTED_VERSION` | Unsupported persisted format version.                                  |

The file runner additionally reports `INPUT_FILE_NOT_FOUND` or `INPUT_FILE_UNREADABLE` for filesystem input errors and exits with status 1 on failure. These are CLI error codes, not additional `EvidenceError` variants.

## Integrity verification

```ts
await storage.verify(captureId); // Returns { valid: true } or throws.
```

`LocalEvidenceStorage.verify` reads and hashes the source, structure and semantic database. Normal retrieval checks file sizes, formats and structural bounds without rehashing every byte. The manifest is not externally signed, and filesystem owners remain trusted.
