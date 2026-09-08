import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  publicDir: false,
  build: {
    outDir: 'dist/workspace', emptyOutDir: true, sourcemap: false, minify: true,
    lib: { entry: 'src/workspace-entry.tsx', formats: ['es'], fileName: () => 'workspace.js', cssFileName: 'workspace' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
