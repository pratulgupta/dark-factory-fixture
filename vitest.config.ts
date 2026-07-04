import { defineConfig } from 'vitest/config'

// `include` is SCOPED to src/** on purpose. The Dark Factory's frozen L2
// acceptance tests live under .factory-tests/ — out of this scope — so this
// fixture proves the factory's ephemeral-config runner collects them REGARDLESS
// of the repo's own include scoping (a plain `vitest run .factory-tests/x` would
// collect zero here).
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
})
