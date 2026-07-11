import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import pkg from './package.json'

const appName = pkg.name
  .split('-')
  .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
  .join(' ')

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, __dirname, '') }
  return {
    plugins: [
      tailwindcss(),
      react(),
      {
        name: 'html-inject-app-name',
        transformIndexHtml(html) {
          return html
            .replace(/__APP_NAME__/g, appName)
            .replace(
              /__APP_DESCRIPTION__/g,
              ((pkg as Record<string, unknown>).description as string) ?? '',
            )
        },
      },
    ],
    define: {
      __APP_NAME__: JSON.stringify(pkg.name),
    },
    root: 'client',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './client/src'),
      },
    },
    build: {
      outDir: '../dist',
      emptyOutDir: true,
    },
    server: {
      proxy: {
        '/api': {
          target: `http://localhost:${env.PORT}`,
          changeOrigin: true,
          ws: true,
        },
      },
    },
    optimizeDeps: {
      include: ['@tanstack/react-query'],
    },
  }
})
