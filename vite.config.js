/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // Default env is node — fast, and correct for the large pure-logic suite.
    // Component render tests opt into happy-dom per-file via a
    // `// @vitest-environment happy-dom` docblock, so the two coexist without a
    // second config.
    environment: 'node',
    include: [
      'server.test.mjs',
      'src/**/*.test.{js,ts,jsx,tsx}',
      'scripts/**/*.test.{js,ts,mjs}',
      'api/**/*.test.{js,mjs}',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      // Coverage is measured on the pure-logic core (parsers, metrics,
      // legibility layer, runtime store) — the deterministic code the tests
      // actually pin. UI/3D/render layers are intentionally excluded.
      include: ['src/lib/**/*.ts'],
    },
  },
})
