import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    watch: {
      ignored: ['**/.venv/**', '**/venv/**', '**/__pycache__/**']
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Matias',
        short_name: 'Matias',
        description: 'Matias – Corner & Cuisine',
        theme_color: '#1E3A5F',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        // Le SW précache tous les chunks. Avec des chunks vendor au hash stable
        // (firebase/react ci-dessous), un déploiement n'invalide que le chunk app,
        // pas les ~360 KB de vendor inchangés.
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'firestore-cache', networkTimeoutSeconds: 10 }
          }
        ]
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        // Vendor splitting : isole les dépendances stables (jamais modifiées par
        // notre code) dans des chunks au hash propre. Bénéfice principal = caching
        // PWA inter-déploiements (cf. commentaire workbox ci-dessus), pas une
        // réduction du poids total au 1er chargement.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Firestore est le plus gros morceau (~210 KB gz) — chunk dédié pour
            // qu'il se mette en cache indépendamment du reste de Firebase.
            if (id.includes('@firebase/firestore') || id.includes('/firestore')) {
              return 'firebase-firestore';
            }
            if (id.includes('firebase') || id.includes('@firebase') || id.includes('@grpc') || id.includes('protobufjs')) {
              return 'firebase';
            }
            if (id.includes('react-dom') || id.includes('/react/') || id.includes('react-router') || id.includes('@remix-run')) {
              return 'react-vendor';
            }
          }
        }
      }
    }
  }
});
