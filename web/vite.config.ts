import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8080' } },
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: { output: { manualChunks: { charts: ['echarts'] } } },
  },
});
