/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/runs': 'http://localhost:3000',
      '/actors': 'http://localhost:3000',
      '/tasks': 'http://localhost:3000',
      '/steps': 'http://localhost:3000',
      '/flows': 'http://localhost:3000',
      '/grpc': 'http://localhost:3000',
      '/kafka-checks': 'http://localhost:3000',
      '/kafka-contract-checks': 'http://localhost:3000',
      '/sprint-reports': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
  },
});
