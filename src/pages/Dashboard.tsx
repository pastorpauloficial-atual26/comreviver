import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { RelatorioCulto } from '../types/database'
import { usePushSubscription } from '../hooks/usePushSubscription'

function formatarMoeda(valor: number | null) {
  if (valor === null || valor === undefined) return '—'
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarData(data: string | null) {
  if (!data) return '—'
  const [ano, mes, dia] = data.split('-')
  if (!ano || !mes || !dia) return data
  return `${dia}/${mes}/${ano}`
}

export default function Dashboard() {
  const { usuario, papel, sair } = useAuth()
  const [relatorios, setRelatorios] = useState<RelatorioCulto[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [buscaPregador, setBuscaPregador] = useState('')
  const [buscaData, setBuscaData] = useState('')

  // Garante a inscrição em push assim que houver um usuário logado.
  usePushSubscription()

  useEffect(() => {
    let ativo = true

    async function carregar() {
      setCarregando(true)
      setErro(null)

      let query = supabase
        .from('relatorios_cultos')
        .select('*')
        .order('data_culto', { ascending: false })
        .limit(100)

      if (buscaPregador.trim()) {
        query = query.ilike('pregador', `%${buscaPregador.trim()}%`)
      }
      if (buscaData) {
        query = query.eq('data_culto', buscaData)
      }

      const { data, error } = await query

      if (!ativo) return

      if (error) {
        setErro('Não foi possível carregar os relatórios: ' + error.message)
      } else {
        setRelatorios((data as RelatorioCulto[]) ?? [])
      }
      setCarregando(false)
    }

    carregar()
    return () => {
      ativo = false
    }
  }, [buscaPregador, buscaData])

  return (
    <div className="tela">
      <div className="topo">
        <div>
          <img
            src="/logo-reviver.svg"
            alt="Comunidade Reviver em Cristo"
            style={{ height: 38, display: 'block', marginBottom: 4 }}
          />
          {usuario && (
            <span className="crachá-papel">
              {papel === 'admin' ? 'Administrador' : 'Obreiro'} · {usuario.nome}
            </span>
          )}
        </div>
        <button className="btn-link" onClick={sair}>
          Sair
        </button>
      </div>

      <Link to="/captura" className="btn btn-primario" style={{ marginBottom: 10 }}>
        + Capturar Novo Relatório
      </Link>
      <Link to="/financeiro" className="btn btn-secundario" style={{ marginBottom: 20 }}>
        💰 Financeiro
      </Link>

      <div className="linha" style={{ marginBottom: 4 }}>
        <input
          className="busca-input"
          type="text"
          placeholder="Buscar por pregador..."
          value={buscaPregador}
          onChange={(e) => setBuscaPregador(e.target.value)}
        />
      </div>
      <div className="linha">
        <input
          className="busca-input"
          type="date"
          value={buscaData}
          onChange={(e) => setBuscaData(e.target.value)}
        />
        {buscaData && (
          <button className="btn-link" onClick={() => setBuscaData('')}>
            Limpar
          </button>
        )}
      </div>

      {erro && <div className="mensagem-erro">{erro}</div>}

      {carregando ? (
        <div className="tela-centralizada">
          <div className="spinner" />
        </div>
      ) : relatorios.length === 0 ? (
        <div className="estado-vazio">
          Nenhum relatório encontrado.
          <br />
          Toque em "Capturar Novo Relatório" para lançar o primeiro.
        </div>
      ) : (
        <ul className="lista-relatorios">
          {relatorios.map((r) => (
            <li key={r.id}>
              <Link to={`/relatorio/${r.id}`} className="item-relatorio">
                <div className="linha-topo">
                  <span>{formatarData(r.data_culto)}</span>
                  <span>{formatarMoeda(r.total_geral)}</span>
                </div>
                <div className="linha-detalhe">
                  <span>{r.pregador ?? 'Pregador não informado'}</span>
                  <span>{r.dia_semana ?? ''}</span>
                </div>
                <div className="linha-detalhe" style={{ fontSize: '0.8rem', color: 'var(--cor-texto-suave)' }}>
                  <span>Dízimos: {formatarMoeda(r.total_dizimos)}</span>
                  <span>Dízimos + Ofertas: {formatarMoeda(r.total_dizimos_ofertas)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
