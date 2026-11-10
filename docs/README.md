# Documentation

Precursor provides deterministic storage and progressive retrieval of runtime evidence. Start with the [repository README](../README.md) for installation and an executable usage example.

| Document                                      | Contents                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| [API reference](API.md)                       | Public operations, options, result variants, limits, pagination and errors.        |
| [Schema adapters](ADAPTERS.md)                | Generic behavior, illustrative schema and adapter integration contract.            |
| [Architecture](ARCHITECTURE.md)               | Compilation pipeline, binary format, indexes, graph resolution and retrieval.      |
| [Operations](OPERATIONS.md)                   | Storage lifecycle, integrity verification, resource planning and failure handling. |
| [Specification](SPEC.md)                      | Design invariants, data model, public contracts and acceptance requirements.       |
| [Implementation plan](IMPLEMENTATION_PLAN.md) | Completed work, verification record and remaining integration work.                |
| [Benchmark report](../benchmarks/RESULTS.md)  | Reproducible methodology and measured synthetic results.                           |
| [Contribution guide](../CONTRIBUTING.md)      | Development workflow, testing and documentation expectations.                      |

The exported [TypeScript interfaces](../src/types/index.ts) define the concrete result contracts. The included Errorcore adapter and runtime fixture are illustrative. They do not establish a production capture schema.
