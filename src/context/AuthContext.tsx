import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Papel, Usuario } from '../types/database'

interface AuthState {
  session: Session | null
  usuario: Usuario | null
  papel: Papel | null
  carregando: boolean
  erro: string | null
  entrar: (email: string, senha: string) => Promise<{ erro: string | null }>
  sair: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

async function buscarUsuario(userId: string): Promise<Usuario | null> {
  const { data, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) {
    // eslint-disable-next-line no-console
    console.error('Não foi possível carregar o papel do usuário:', error.message)
    return null
  }

  return data as Usuario
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!ativo) return
      setSession(data.session)
      if (data.session) {
        const u = await buscarUsuario(data.session.user.id)
        if (ativo) setUsuario(u)
      }
      if (ativo) setCarregando(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, novaSessao) => {
        setSession(novaSessao)
        if (novaSessao) {
          const u = await buscarUsuario(novaSessao.user.id)
          setUsuario(u)
        } else {
          setUsuario(null)
        }
      }
    )

    return () => {
      ativo = false
      listener.subscription.unsubscribe()
    }
  }, [])

  async function entrar(email: string, senha: string) {
    setErro(null)
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: senha,
    })
    if (error) {
      const mensagem =
        error.message === 'Invalid login credentials'
          ? 'E-mail ou senha incorretos.'
          : error.message
      setErro(mensagem)
      return { erro: mensagem }
    }
    return { erro: null }
  }

  async function sair() {
    await supabase.auth.signOut()
    setUsuario(null)
    setSession(null)
  }

  const value: AuthState = {
    session,
    usuario,
    papel: usuario?.papel ?? null,
    carregando,
    erro,
    entrar,
    sair,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth precisa ser usado dentro de <AuthProvider>')
  }
  return ctx
}
