/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

// Injetado automaticamente pelo vite-plugin-pwa (estratégia injectManifest)
// com a lista de assets a pré-cachear.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

self.skipWaiting()
self.addEventListener('activate', () => self.clients.claim())

// ----------------------------------------------------------------
// Notificações Push (ver docs/03-especificacao-pwa.md, seção 5)
// ----------------------------------------------------------------

interface PayloadPush {
  titulo: string
  corpo: string
  url?: string
}

self.addEventListener('push', (evento: PushEvent) => {
  let dados: PayloadPush = {
    titulo: 'Relatórios Reviver',
    corpo: 'Novo relatório lançado.',
  }

  if (evento.data) {
    try {
      dados = { ...dados, ...evento.data.json() }
    } catch {
      dados.corpo = evento.data.text()
    }
  }

  evento.waitUntil(
    self.registration.showNotification(dados.titulo, {
      body: dados.corpo,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: dados.url ?? '/' },
    })
  )
})

self.addEventListener('notificationclick', (evento: NotificationEvent) => {
  evento.notification.close()
  const url = (evento.notification.data as { url?: string })?.url ?? '/'

  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((listaClientes) => {
      for (const cliente of listaClientes) {
        if (cliente.url.includes(url) && 'focus' in cliente) {
          return (cliente as WindowClient).focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
