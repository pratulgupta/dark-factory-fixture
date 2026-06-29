# dark-factory-fixture

Minimal fixture repo for the Majordomo Dark Factory end-to-end green spike.

- Package manager: npm (detected via `package-lock.json`)
- Gate: `npm run test` → `echo ok` (exits 0, zero dependencies)
- Purpose: deterministic green verify run to prove the factory pipeline end-to-end
