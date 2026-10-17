// Default fakes for Kogent's case runs (§4.1). Generated: v1 has no code builds, so every tool's fake comes from its effect and output schema.
import type { Backend, TestWorld } from './runtime/types.ts'

export const fakeOverrides: Record<string, (world: TestWorld) => Backend> = {}
