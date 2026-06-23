import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

function urlBase64ParaUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Seguro = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const bruto = window.atob(base64Seguro)
  const saida = new Uint8Array(bruto.length)
  for (let i = 0; i < bruto.length; i++) {
    saida[i] = bruto.charCodeAt(i)
  }
  return saida
}

/**
 * Inscreve o dispositivo em notificações push se:
 * - o navegador suportar Service Worker + Push API
 * - o usuário logado tiver papel "admin" (é quem recebe a notificação, ver
 *   docs/03-especificacao-pwa.md seção 5)
 * - o usuário ainda não tiver negado permissão
 *
 * A inscrição é salva na tabela `push_subscriptions` (migração
 * supabase/migrations/002_push_subscriptions.sql), que a Edge Function
 * `salvar-relatorio` consulta para enviar o push.
 */
export function usePushSubscription() {
  const { usuario, papel } = useAuth()

  useEffect(() => {
    if (papel !== 'admin' || !usuario) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
    if (!vapidPublicKey) {
      // eslint-disable-next-line no-console
      console.warn('VITE_VAPID_PUBLIC_KEY não configurada — notificações push desativadas.')
      return
    }

    let cancelado = false

    async function inscrever() {
      if (Notification.permission === 'denied') return

      const permissao =
        Notification.permission === 'granted'
          ? 'granted'
          : await Notification.requestPermission()
      if (permissao !== 'granted' || cancelado) return

      const registration = await navigator.serviceWorker.ready
      let inscricao = await registration.pushManager.getSubscription()

      if (!inscricao) {
        inscricao = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ParaUint8Array(vapidPublicKey),
        })
      }

      const chaves = inscricao.toJSON().keys
      if (!chaves?.p256dh || !chaves?.auth) return

      await supabase.from('push_subscriptions').upsert(
        {
          usuario_id: usuario.id,
          endpoint: inscricao.endpoint,
          p256dh: chaves.p256dh,
          auth: chaves.auth,
        },
        { onConflict: 'endpoint' }
      )
    }

    inscrever().catch((erro) => {
      // eslint-disable-next-line no-console
      console.error('Falha ao inscrever em notificações push:', erro)
    })

    return () => {
      cancelado = true
    }
  }, [usuario, papel])
}
