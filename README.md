# dark-factory-fixture

Fixture repo for the Majordomo Dark Factory **L2 author-sandbox smoke**
(`services/studioservices/scripts/smoke-factory-author.ts`).

- **Package manager:** npm (detected via `package-lock.json`).
- **Runner:** vitest, with `include` **scoped to `src/**`** on purpose.
- **`src/greet.ts`** exports `greet(name)` returning the *wrong* string
  (`hi <name>`). The acceptance criterion wants `greet("world") === "Hello, world!"`.
- **`src/greet.test.ts`** is an in-scope test of the current behaviour, so the
  repo's own suite (the factory's L1 regression gate) is green.

Because the criterion is unimplemented, a spec-derived acceptance test is
**red-before**; because `.factory-tests/` is out of the repo's `include` scope,
the fixture also exercises the factory's ephemeral-config runner, which
force-collects the frozen L2 tests regardless of repo scoping.

> The previous "echo ok" green-spike gate (v1.x) was replaced by this
> vitest-based L2 fixture (v2.0.0).
