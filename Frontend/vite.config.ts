import path from 'path';
import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const backendOrigin = env.VITE_BACKEND_ORIGIN || 'http://127.0.0.1:8000';
    const proxy: Record<string, ProxyOptions> = {};
    ['/health', '/projects', '/api-keys', '/custom-styles'].forEach((route) => {
        proxy[route] = {
            target: backendOrigin,
            changeOrigin: true,
        };
    });
    proxy['/files'] = {
        target: backendOrigin,
        changeOrigin: true,
    };
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        /**
         * Allow development access through dynamically generated public hosts such as
         * the ngrok URLs used in Colab environments. This prevents Vite from blocking
         * proxied requests with "host not allowed" errors when the frontend is exposed
         * through a tunnel.
         */
        allowedHosts: true,
        proxy,
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      },
      resolve: {
        alias: {
          // FIX: Replaced `process.cwd()`, which caused a TypeScript type error, with a reconstructed `__dirname` for ES Modules to correctly resolve the project root.
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
