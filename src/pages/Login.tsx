import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { session, carregando, entrar } = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  if (!carregando && session) {
    return <Navigate to="/" replace />
  }

  async function aoEnviar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    const resultado = await entrar(email.trim(), senha)
    setEnviando(false)
    if (resultado.erro) {
      setErro(resultado.erro)
    }
  }

  return (
    <div className="tela-centralizada">
      <div className="card" style={{ width: '100%', maxWidth: 380, textAlign: 'left' }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <img
            src="/logo-reviver.svg"
            alt="Comunidade Reviver em Cristo"
            style={{ height: 96, maxWidth: '100%' }}
          />
          <p style={{ color: 'var(--cor-texto-suave)', margin: '8px 0 0', fontSize: '0.9rem' }}>
            Relatórios de Culto
          </p>
        </div>

        {erro && <div className="mensagem-erro">{erro}</div>}

        <form onSubmit={aoEnviar} className="pilha">
          <div className="campo">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
            />
          </div>

          <div className="campo">
            <label htmlFor="senha">Senha</label>
            <input
              id="senha"
              type="password"
              autoComplete="current-password"
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          <button type="submit" className="btn btn-primario" disabled={enviando}>
            {enviando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <p style={{ fontSize: '0.8rem', color: 'var(--cor-texto-suave)', marginTop: 16, textAlign: 'center' }}>
          Não há cadastro público. Sua conta é criada pelo administrador.
        </p>
      </div>
    </div>
  )
}
