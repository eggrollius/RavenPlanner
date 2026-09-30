import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client', emptyOutDir: false },
  server: { proxy: { '/api': 'http://localhost:5000' } },
  test: { environment: 'node' }
});
