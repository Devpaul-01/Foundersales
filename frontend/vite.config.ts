import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          supabase: ['@supabase/supabase-js'],
          framer: ['framer-motion'],
          charts: ['recharts'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable'],
          forms: ['react-hook-form', 'zod', '@hookform/resolvers'],
          firebase: ['firebase/app', 'firebase/messaging'],
        },
      },
    },
    sourcemap: true,
    target: 'es2020',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
