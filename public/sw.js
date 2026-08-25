// Service Worker para ANOTADO! — Progressive Web App
// Cache focado estritamente no App Shell estático
// IndexedDB e SyncEngine são os únicos responsáveis pela persistência de dados das notas

const CACHE_NAME = 'anotado-app-shell-v1';

const STATIC_PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

// Instalação: pré-carrega o shell básico
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(STATIC_PRECACHE_URLS).catch((err) => {
          console.warn('[SW] Aviso durante pré-cache estático:', err);
        });
      })
      .then(() => self.skipWaiting())
  );
});

// Ativação: limpa caches antigos do shell sem afetar IndexedDB
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              return caches.delete(name);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Mensagem para forçar atualização quando solicitada
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Interceptador de Fetch
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Apenas requisições GET
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // 1. SUPABASE, AUTENTICAÇÃO E APIs: BYPASS TOTAL DO SERVICE WORKER
  // Não interfere com Supabase, Auth, sync_queue ou requisições de dados
  if (
    url.hostname.includes('supabase.co') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('/auth/v1') ||
    url.pathname.includes('/rest/v1') ||
    url.pathname.includes('/storage/v1')
  ) {
    return; // Deixa o navegador/IndexedDB lidar diretamente
  }

  // 2. NAVEGAÇÃO DE PÁGINAS (App Shell / HTML)
  // Network-First com Fallback para o App Shell em Cache quando offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          // Quando offline, entrega o App Shell em cache
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
          const shellFallback = await caches.match('/');
          if (shellFallback) {
            return shellFallback;
          }
          return new Response('ANOTADO! está offline. Carregando dados locais...', {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        })
    );
    return;
  }

  // 3. ASSETS ESTÁTICOS DO NEXT.JS (JS, CSS, Imagens otimizadas com hash de conteúdo)
  // Stale-While-Revalidate para garantir carregamento instantâneo e atualização em segundo plano
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.woff') ||
    url.pathname === '/manifest.json'
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseToCache);
              });
            }
            return networkResponse;
          })
          .catch(() => null);

        // Se já tiver em cache, retorna imediatamente; caso contrário aguarda a rede
        return cachedResponse || fetchPromise;
      })
    );
  }
});
