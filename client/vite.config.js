import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    // Required for Capacitor — assets must use relative paths inside the APK
    base: './',
  },
  server: {
    port: 5173,
    proxy: {
      '/api':       { target: 'https://sniffrweb.onrender.com', changeOrigin: true },
      '/uploads':   { target: 'https://sniffrweb.onrender.com', changeOrigin: true },
      '/socket.io': { target: 'https://sniffrweb.onrender.com', ws: true },
    }
  }
});
