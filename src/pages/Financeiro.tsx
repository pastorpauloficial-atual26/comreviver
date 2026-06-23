import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { MovimentoFinanceiro, OrigemMovimento, ResumoFinanceiro, TipoMovimento } from '../types/database'

const STORAGE_BUCKET_FINANCEIRO = 'financeiro'

// Aceitos: pdf, imagens, txt e doc/docx — extratos, relatórios bancários,
// notas fiscais e recibos chegam tipicamente nesses formatos.
const TIPOS_ACEITOS =
  '.pdf,.jpg,.jpeg,.png,.txt,.doc,.docx,application/pdf,image/jpeg,image/png,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function formatarMoeda(valor: number) {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarData(data: string) {
  const [ano, mes, dia] = data.split('-')
  if (!ano || !mes || !dia) return data
  return `${dia}/${mes}/${ano}`
}

function hoje() {
  return new Date().toISOString().slice(0, 10)
}

interface FormularioMovimento {
  tipo: TipoMovimento
  categoria: string
  descricao: string
  valor: string
  data_movimento: string
}

function formularioVazio(origem: OrigemMovimento): FormularioMovimento {
  return {
    tipo: origem === 'despesa' ? 'saida' : 'entrada',
    categoria: '',
    descricao: '',
    valor: '',
    data_movimento: hoje(),
  }
}

export default function Financeiro() {
  const { session, usuario, papel } = useAuth()
  const inputArquivoRef = useRef<HTMLInputElement>(null)

  const [movimentos, setMovimentos] = useState<MovimentoFinanceiro[]>([])
  const [resumo, setResumo] = useState<ResumoFinanceiro>({ total_entradas: 0, total_saidas: 0, saldo: 0 })
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [origemAberta, setOrigemAberta] = useState<OrigemMovimento | null>(null)
  const [form, setForm] = useState<FormularioMovimento>(formularioVazio('extrato'))
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)

    const [{ data: lista, error: erroLista }, { data: totais, error: erroTotais }] = await Promise.all([
      supabase
        .from('movimentos_financeiros')
        .select('*')
        .order('data_movimento', { ascending: false })
        .order('criado_em', { ascending: false })
        .limit(200),
      supabase.rpc('resumo_financeiro').single(),
    ])

    if (erroLista) {
      setErro('Não foi possível carregar os lançamentos: ' + erroLista.message)
    } else {
      setMovimentos((lista as MovimentoFinanceiro[]) ?? [])
    }

    if (erroTotais) {
      setErro((atual) => atual ?? 'Não foi possível carregar o resumo: ' + erroTotais.message)
    } else if (totais) {
      setResumo(totais as ResumoFinanceiro)
    }

    setCarregando(false)
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])

  function abrirFormulario(origem: OrigemMovimento) {
    setOrigemAberta(origem)
    setForm(formularioVazio(origem))
    setArquivo(null)
    setErro(null)
    if (inputArquivoRef.current) inputArquivoRef.current.value = ''
  }

  function fecharFormulario() {
    setOrigemAberta(null)
    setArquivo(null)
  }

  function aoEscolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    setArquivo(e.target.files?.[0] ?? null)
  }

  function atualizarCampo<K extends keyof FormularioMovimento>(campo: K, valor: FormularioMovimento[K]) {
    setForm((atual) => ({ ...atual, [campo]: valor }))
  }

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!origemAberta || !session || !usuario) return

    if (!arquivo) {
      setErro('Selecione um arquivo para anexar.')
      return
    }
    const valorNumerico = Number(form.valor.replace(',', '.'))
    if (!form.valor || Number.isNaN(valorNumerico) || valorNumerico < 0) {
      setErro('Informe um valor válido.')
      return
    }

    setEnviando(true)
    setErro(null)

    try {
      const extensao = arquivo.name.split('.').pop() || 'bin'
      const caminhoArquivo = `${usuario.id}/${origemAberta}/${Date.now()}.${extensao}`

      const { error: erroUpload } = await supabase.storage
        .from(STORAGE_BUCKET_FINANCEIRO)
        .upload(caminhoArquivo, arquivo, {
          contentType: arquivo.type || 'application/octet-stream',
          upsert: false,
        })

      if (erroUpload) throw erroUpload

      const { error: erroInsercao } = await supabase.from('movimentos_financeiros').insert({
        origem: origemAberta,
        tipo: form.tipo,
        categoria: form.categoria.trim() || null,
        descricao: form.descricao.trim() || null,
        valor: valorNumerico,
        data_movimento: form.data_movimento,
        arquivo_url: caminhoArquivo,
        nome_arquivo: arquivo.name,
        tipo_mime: arquivo.type || null,
        criado_por: usuario.id,
      })

      if (erroInsercao) throw erroInsercao

      fecharFormulario()
      await carregar()
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : 'Erro desconhecido ao salvar.'
      setErro('Não foi possível salvar o lançamento: ' + mensagem)
    } finally {
      setEnviando(false)
    }
  }

  async function abrirArquivo(movimento: MovimentoFinanceiro) {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET_FINANCEIRO)
      .createSignedUrl(movimento.arquivo_url, 60)

    if (error || !data?.signedUrl) {
      setErro('Não foi possível abrir o arquivo: ' + (error?.message ?? 'erro desconhecido'))
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function excluir(movimento: MovimentoFinanceiro) {
    if (!window.confirm('Excluir este lançamento? Esta ação não pode ser desfeita.')) return

    const { error } = await supabase.from('movimentos_financeiros').delete().eq('id', movimento.id)
    if (error) {
      setErro('Não foi possível excluir: ' + error.message)
      return
    }
    await supabase.storage.from(STORAGE_BUCKET_FINANCEIRO).remove([movimento.arquivo_url])
    await carregar()
  }

  const podeExcluir = (movimento: MovimentoFinanceiro) =>
    papel === 'admin' || movimento.criado_por === usuario?.id

  return (
    <div className="tela">
      <div className="topo">
        <div>
          <img
            src="/logo-reviver.svg"
            alt="Comunidade Reviver em Cristo"
            style={{ height: 32, display: 'block', marginBottom: 4 }}
          />
          <h1 style={{ margin: 0 }}>Financeiro</h1>
        </div>
        <Link to="/" className="btn-link">
          Voltar
        </Link>
      </div>

      {erro && <div className="mensagem-erro">{erro}</div>}

      <div className="grade-resumo">
        <div className="card cartao-resumo">
          <span className="rotulo-resumo">Total de Entradas</span>
          <strong className="valor-resumo valor-positivo">{formatarMoeda(resumo.total_entradas)}</strong>
        </div>
        <div className="card cartao-resumo">
          <span className="rotulo-resumo">Total de Saídas</span>
          <strong className="valor-resumo valor-negativo">{formatarMoeda(resumo.total_saidas)}</strong>
        </div>
        <div className="card cartao-resumo">
          <span className="rotulo-resumo">Saldo</span>
          <strong className={`valor-resumo ${resumo.saldo >= 0 ? 'valor-positivo' : 'valor-negativo'}`}>
            {formatarMoeda(resumo.saldo)}
          </strong>
        </div>
      </div>

      <div className="linha" style={{ marginTop: 16, marginBottom: 16 }}>
        <button className="btn btn-primario" onClick={() => abrirFormulario('extrato')}>
          📥 Extratos
        </button>
        <button className="btn btn-secundario" onClick={() => abrirFormulario('despesa')}>
          🧾 Despesas
        </button>
      </div>

      {origemAberta && (
        <form className="card" style={{ marginBottom: 20 }} onSubmit={enviar}>
          <div className="secao-titulo" style={{ marginTop: 0 }}>
            {origemAberta === 'extrato' ? 'Novo Extrato / Movimentação Bancária' : 'Nova Despesa (NF / Recibo)'}
          </div>

          <div className="campo">
            <label htmlFor="tipo">Tipo</label>
            <select
              id="tipo"
              value={form.tipo}
              onChange={(e) => atualizarCampo('tipo', e.target.value as TipoMovimento)}
            >
              <option value="entrada">Entrada</option>
              <option value="saida">Saída</option>
            </select>
          </div>

          <div className="campo">
            <label htmlFor="categoria">Categoria</label>
            <input
              id="categoria"
              type="text"
              placeholder={origemAberta === 'despesa' ? 'Ex: Energia Elétrica' : 'Ex: Dízimos, Ofertas'}
              value={form.categoria}
              onChange={(e) => atualizarCampo('categoria', e.target.value)}
            />
          </div>

          <div className="campo">
            <label htmlFor="descricao">Descrição</label>
            <input
              id="descricao"
              type="text"
              placeholder="Observações sobre este lançamento"
              value={form.descricao}
              onChange={(e) => atualizarCampo('descricao', e.target.value)}
            />
          </div>

          <div className="linha">
            <div className="campo" style={{ flex: 1 }}>
              <label htmlFor="valor">Valor (R$)</label>
              <input
                id="valor"
                type="number"
                step="0.01"
                min="0"
                value={form.valor}
                onChange={(e) => atualizarCampo('valor', e.target.value)}
              />
            </div>
            <div className="campo" style={{ flex: 1 }}>
              <label htmlFor="data_movimento">Data</label>
              <input
                id="data_movimento"
                type="date"
                value={form.data_movimento}
                onChange={(e) => atualizarCampo('data_movimento', e.target.value)}
              />
            </div>
          </div>

          <div className="campo">
            <label htmlFor="arquivo">Arquivo (PDF, JPG, PNG, TXT, DOC)</label>
            <input
              id="arquivo"
              ref={inputArquivoRef}
              type="file"
              accept={TIPOS_ACEITOS}
              onChange={aoEscolherArquivo}
            />
            {arquivo && <p style={{ fontSize: '0.8rem', color: 'var(--cor-texto-suave)', margin: '6px 0 0' }}>📄 {arquivo.name}</p>}
          </div>

          <div className="pilha" style={{ marginTop: 12 }}>
            <button className="btn btn-primario" type="submit" disabled={enviando}>
              {enviando ? 'Salvando...' : 'Salvar Lançamento'}
            </button>
            <button className="btn btn-perigo" type="button" disabled={enviando} onClick={fecharFormulario}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="secao-titulo">Lançamentos</div>

      {carregando ? (
        <div className="tela-centralizada">
          <div className="spinner" />
        </div>
      ) : movimentos.length === 0 ? (
        <div className="estado-vazio">Nenhum lançamento ainda. Use os botões acima para anexar o primeiro.</div>
      ) : (
        <ul className="lista-relatorios">
          {movimentos.map((m) => (
            <li key={m.id} className="item-relatorio">
              <div className="linha-topo">
                <span>
                  <span className={`badge-tipo ${m.tipo === 'entrada' ? 'badge-entrada' : 'badge-saida'}`}>
                    {m.tipo === 'entrada' ? 'Entrada' : 'Saída'}
                  </span>{' '}
                  <span className="badge-origem">{m.origem === 'extrato' ? 'Extrato' : 'Despesa'}</span>
                </span>
                <strong className={m.tipo === 'entrada' ? 'valor-positivo' : 'valor-negativo'}>
                  {formatarMoeda(m.valor)}
                </strong>
              </div>
              <div className="linha-detalhe">
                <span>{m.categoria || m.descricao || 'Sem descrição'}</span>
                <span>{formatarData(m.data_movimento)}</span>
              </div>
              {m.descricao && m.categoria && (
                <div className="linha-detalhe" style={{ fontSize: '0.8rem', color: 'var(--cor-texto-suave)' }}>
                  <span>{m.descricao}</span>
                </div>
              )}
              <div className="linha" style={{ marginTop: 8 }}>
                <button className="btn-link" type="button" onClick={() => abrirArquivo(m)}>
                  📎 Ver arquivo
                </button>
                {podeExcluir(m) && (
                  <button className="btn-link" style={{ color: 'var(--cor-erro)' }} type="button" onClick={() => excluir(m)}>
                    Excluir
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
