import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import { Readable } from 'node:stream'

/** En desarrollo sirve las funciones de /api (en producción las ejecuta Vercel). */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      // Variables solo de servidor (p. ej. ANTHROPIC_API_KEY en .env.local), sin exponerlas al cliente.
      Object.assign(process.env, loadEnv(server.config.mode, process.cwd(), ''))
      server.middlewares.use('/api/assistant', async (req, res) => {
        try {
          const mod = await server.ssrLoadModule('/api/assistant.ts')
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          const controller = new AbortController()
          res.on('close', () => controller.abort())
          const request = new Request(`http://localhost${req.originalUrl ?? req.url}`, {
            method: req.method, headers: req.headers as Record<string, string>,
            body: req.method === 'POST' ? Buffer.concat(chunks) : undefined, signal: controller.signal,
          })
          const handler = mod[req.method ?? 'GET'] as ((r: Request) => Promise<Response>) | undefined
          const response: Response = handler ? await handler(request) : new Response('Method Not Allowed', { status: 405 })
          res.statusCode = response.status
          response.headers.forEach((v, k) => res.setHeader(k, v))
          if (response.body) Readable.fromWeb(response.body as never).pipe(res)
          else res.end()
        } catch (e) {
          server.config.logger.error(String(e))
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'Error en la función local' }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [
    devApi(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'GYM BRO — Fitness Progress System',
        short_name: 'GYM BRO',
        description: 'Seguimiento privado de entrenamientos y progreso',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        start_url: '/',
        lang: 'es',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
        shortcuts: [{ name: 'Entrenamiento activo', url: '/entrenamiento' }],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Supabase requests are never cached: data is persisted locally by the app's own sync queue.
        navigateFallbackDenylist: [/^\/auth\//, /^\/api\//],
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 30000,
  },
})
