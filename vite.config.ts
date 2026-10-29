import { defineConfig, configDefaults } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    build: { outDir: 'dist/client', emptyOutDir: false },
    server: {
      port: Number(env.VITE_PORT || 5173),
      strictPort: true,
      watch: { ignored: ['**/.local/**'] },
      proxy: { '/api': `http://127.0.0.1:${env.PORT || 5000}` },
    },
    test: { environment: 'node', exclude: [...configDefaults.exclude, 'e2e/**'] },
  };
});
