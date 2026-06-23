import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  CAMPO_PARA_ALERTA,
  type DizimoRascunho,
  type ExtracaoRelatorio,
} from '../types/database'

type Etapa = 'captura' | 'processando' | 'revisao' | 'sucesso'

const CAMPOS_TEXTO: { campo: keyof ExtracaoRelatorio; rotulo: string; tipo: string }[] = [
  { campo: 'dia_semana', rotulo: 'Dia da Semana', tipo: 'text' },
  { campo: 'data_culto', rotulo: 'Data', tipo: 'date' },
  { campo: 'horario', rotulo: 'Horário', tipo: 'text' },
  { campo: 'dirigente', rotulo: 'Dirigente', tipo: 'text' },
  { campo: 'pregador', rotulo: 'Pregador', tipo: 'text' },
  { campo: 'resp_relatorio', rotulo: 'Responsável pelo Relatório', tipo: 'text' },
]

const CAMPOS_NUMERICOS: { campo: keyof ExtracaoRelatorio; rotulo: string }[] = [
  { campo: 'total_visitas', rotulo: 'Total de Visitas' },
  { campo: 'total_presencas', rotulo: 'Total de Presenças' },
]

// Sub-Total e Total Geral NÃO entram aqui — são sempre calculados a partir
// destes itens (ver `subTotalCalculado`/`totalGeralCalculado` no componente),
// nunca digitados manualmente.
const CAMPOS_FINANCEIROS: { campo: keyof ExtracaoRelatorio; rotulo: string }[] = [
  { campo: 'ofertas_primicias', rotulo: 'Ofertas / Primícias' },
  { campo: 'ofertas_gerais', rotulo: 'Ofertas Gerais' },
  { campo: 'ofertas_radio', rotulo: 'Ofertas Rádio' },
  { campo: 'votos_bencaos', rotulo: 'Votos e Bênçãos' },
  { campo: 'campanhas', rotulo: 'Campanhas' },
]

function extracaoVazia(): ExtracaoRelatorio {
  return {
    dia_semana: null,
    data_culto: null,
    horario: null,
    total_visitas: null,
    total_presencas: null,
    dirigente: null,
    pregador: null,
    resp_relatorio: null,
    ofertas_primicias: null,
    ofertas_gerais: null,
    ofertas_radio: null,
    votos_bencaos: null,
    campanhas: null,
    sub_total: null,
    dizimos: [],
    total_geral: null,
    texto_completo_ocr: '',
    alertas_revisao: [],
  }
}

function formatarMoeda(valor: number | null) {
  if (valor === null || valor === undefined) return 'R$ —'
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function arquivoParaBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader()
    leitor.onload = () => {
      const resultado = leitor.result as string
      // remove o prefixo "data:image/png;base64," deixando só o payload
      const base64 = resultado.split(',')[1] ?? resultado
      resolve(base64)
    }
    leitor.onerror = () => reject(leitor.error)
    leitor.readAsDataURL(arquivo)
  })
}

/** Mapeia os textos livres de `alertas_revisao` para os campos do formulário,
 *  usando correspondência por palavra-chave (heurística, ver docs/02). */
function camposEmAlerta(alertas: string[]): Set<string> {
  const resultado = new Set<string>()
  const textoCombinado = alertas.join(' | ').toLowerCase()
  for (const [palavraChave, campos] of Object.entries(CAMPO_PARA_ALERTA)) {
    if (textoCombinado.includes(palavraChave)) {
      campos.forEach((c) => resultado.add(c))
    }
  }
  return resultado
}

export default function CaptureFlow() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const inputCameraRef = useRef<HTMLInputElement>(null)
  const inputArquivoRef = useRef<HTMLInputElement>(null)

  const [etapa, setEtapa] = useState<Etapa>('captura')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [extracao, setExtracao] = useState<ExtracaoRelatorio>(extracaoVazia())
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const alertasPorCampo = useMemo(
    () => camposEmAlerta(extracao.alertas_revisao),
    [extracao.alertas_revisao]
  )

  // Sub-Total = soma das ofertas/votos/campanhas. Total Geral = Sub-Total +
  // soma dos dízimos. Nenhum dos dois é digitado — são sempre recalculados
  // a partir dos itens que os compõem (mesma regra aplicada no servidor,
  // na Edge Function `salvar-relatorio`, que nunca confia em valor do cliente).
  const subTotalCalculado = useMemo(
    () =>
      (Number(extracao.ofertas_primicias) || 0) +
      (Number(extracao.ofertas_gerais) || 0) +
      (Number(extracao.ofertas_radio) || 0) +
      (Number(extracao.votos_bencaos) || 0) +
      (Number(extracao.campanhas) || 0),
    [
      extracao.ofertas_primicias,
      extracao.ofertas_gerais,
      extracao.ofertas_radio,
      extracao.votos_bencaos,
      extracao.campanhas,
    ]
  )

  const totalDizimos = useMemo(
    () =>
      extracao.dizimos.reduce((soma, d) => soma + (Number(d.valor) || 0), 0),
    [extracao.dizimos]
  )

  const totalDizimosOfertas = useMemo(
    () => totalDizimos + subTotalCalculado,
    [totalDizimos, subTotalCalculado]
  )

  // Total Geral é o mesmo valor de "Dízimos + Ofertas" — mantemos os dois
  // em sincronia para gravar corretamente na coluna `total_geral`.
  const totalGeralCalculado = totalDizimosOfertas

  // Mantém `extracao.sub_total`/`extracao.total_geral` sempre espelhando os
  // valores calculados, para que o payload enviado ao salvar já vá correto
  // (o servidor recalcula de qualquer forma, mas a tela de revisão deve
  // mostrar e enviar os números reais, nunca um valor digitado à mão).
  useEffect(() => {
    if (extracao.sub_total !== subTotalCalculado) {
      atualizarCampo('sub_total', subTotalCalculado)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTotalCalculado])

  useEffect(() => {
    if (extracao.total_geral !== totalGeralCalculado) {
      atualizarCampo('total_geral', totalGeralCalculado)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalGeralCalculado])

  function aoEscolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setArquivo(f)
    setErro(null)
    if (f.type.startsWith('image/')) {
      setPreviewUrl(URL.createObjectURL(f))
    } else {
      setPreviewUrl(null)
    }
  }

  function limparCaptura() {
    setArquivo(null)
    setPreviewUrl(null)
    setErro(null)
    if (inputCameraRef.current) inputCameraRef.current.value = ''
    if (inputArquivoRef.current) inputArquivoRef.current.value = ''
  }

  async function processarComIA() {
    if (!arquivo) return
    setEtapa('processando')
    setErro(null)

    try {
      const imagemBase64 = await arquivoParaBase64(arquivo)

      const { data, error } = await supabase.functions.invoke('processar-relatorio', {
        body: {
          imagem_base64: imagemBase64,
          nome_arquivo: arquivo.name,
          tipo_mime: arquivo.type || 'application/octet-stream',
        },
      })

      if (error) throw error

      const resultado = data as ExtracaoRelatorio
      setExtracao({ ...extracaoVazia(), ...resultado })
      setEtapa('revisao')
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : 'Erro desconhecido ao processar o relatório.'
      setErro('Não foi possível processar o relatório: ' + mensagem)
      setEtapa('captura')
    }
  }

  function atualizarCampo<K extends keyof ExtracaoRelatorio>(campo: K, valor: ExtracaoRelatorio[K]) {
    setExtracao((atual) => ({ ...atual, [campo]: valor }))
  }

  function atualizarCampoNumerico(campo: keyof ExtracaoRelatorio, valorTexto: string) {
    if (valorTexto === '') {
      atualizarCampo(campo, null as never)
      return
    }
    const valor = Number(valorTexto)
    atualizarCampo(campo, (Number.isNaN(valor) ? null : valor) as never)
  }

  function adicionarDizimo() {
    setExtracao((atual) => ({
      ...atual,
      dizimos: [...atual.dizimos, { nome: '', valor: 0 }],
    }))
  }

  function atualizarDizimo(indice: number, parcial: Partial<DizimoRascunho>) {
    setExtracao((atual) => ({
      ...atual,
      dizimos: atual.dizimos.map((d, i) => (i === indice ? { ...d, ...parcial } : d)),
    }))
  }

  function removerDizimo(indice: number) {
    setExtracao((atual) => ({
      ...atual,
      dizimos: atual.dizimos.filter((_, i) => i !== indice),
    }))
  }

  function descartar() {
    setEtapa('captura')
    setExtracao(extracaoVazia())
    limparCaptura()
  }

  /** Alternativa à foto/arquivo + IA: pula direto para a tela de revisão
   *  com o formulário em branco, para digitação manual dos dados. */
  function digitarManualmente() {
    setErro(null)
    limparCaptura()
    setExtracao(extracaoVazia())
    setEtapa('revisao')
  }

  async function confirmarESalvar() {
    if (!session) return
    setSalvando(true)
    setErro(null)

    try {
      const payload = {
        ...extracao,
        dizimos: extracao.dizimos
          .filter((d) => d.nome.trim() !== '')
          .map((d) => ({ nome: d.nome.trim(), valor: d.valor ?? 0 })),
      }

      const { error } = await supabase.functions.invoke('salvar-relatorio', {
        body: payload,
      })

      if (error) throw error

      setEtapa('sucesso')
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : 'Erro desconhecido ao salvar.'
      setErro('Não foi possível salvar o relatório: ' + mensagem)
    } finally {
      setSalvando(false)
    }
  }

  // ----------------------------------------------------------------
  // ETAPA: captura
  // ----------------------------------------------------------------
  if (etapa === 'captura') {
    return (
      <div className="tela">
        <div className="topo">
          <div>
            <img
              src="/logo-reviver.svg"
              alt="Comunidade Reviver em Cristo"
              style={{ height: 32, display: 'block', marginBottom: 4 }}
            />
            <h1 style={{ margin: 0 }}>Capturar Relatório</h1>
          </div>
          <button className="btn-link" onClick={() => navigate('/')}>
            Cancelar
          </button>
        </div>

        {erro && <div className="mensagem-erro">{erro}</div>}

        {previewUrl ? (
          <img src={previewUrl} alt="Pré-visualização do relatório" className="preview-imagem" />
        ) : arquivo ? (
          <div className="card" style={{ textAlign: 'center' }}>
            📄 {arquivo.name}
          </div>
        ) : (
          <div className="card estado-vazio" style={{ padding: 24 }}>
            Nenhum arquivo selecionado ainda.
          </div>
        )}

        <div className="pilha" style={{ marginTop: 16 }}>
          <input
            ref={inputCameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={aoEscolherArquivo}
            style={{ display: 'none' }}
          />
          <button
            className="btn btn-secundario"
            onClick={() => inputCameraRef.current?.click()}
          >
            📷 Tirar Foto
          </button>

          <input
            ref={inputArquivoRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={aoEscolherArquivo}
            style={{ display: 'none' }}
          />
          <button
            className="btn btn-secundario"
            onClick={() => inputArquivoRef.current?.click()}
          >
            📁 Selecionar Arquivo
          </button>

          {arquivo && (
            <button className="btn-link" onClick={limparCaptura}>
              Remover seleção
            </button>
          )}

          <button className="btn btn-secundario" onClick={digitarManualmente}>
            ⌨️ Digitar
          </button>
        </div>

        <div style={{ flex: 1 }} />

        <button className="btn btn-primario" disabled={!arquivo} onClick={processarComIA}>
          Processar com IA
        </button>
      </div>
    )
  }

  // ----------------------------------------------------------------
  // ETAPA: processando
  // ----------------------------------------------------------------
  if (etapa === 'processando') {
    return (
      <div className="tela-centralizada">
        <div className="spinner" style={{ marginBottom: 16 }} />
        <p>Lendo o relatório...</p>
        <p style={{ color: 'var(--cor-texto-suave)', fontSize: '0.85rem' }}>
          Isso pode levar alguns segundos.
        </p>
      </div>
    )
  }

  // ----------------------------------------------------------------
  // ETAPA: revisão
  // ----------------------------------------------------------------
  if (etapa === 'revisao') {
    return (
      <div className="tela">
        <div className="topo">
          <div>
            <img
              src="/logo-reviver.svg"
              alt="Comunidade Reviver em Cristo"
              style={{ height: 32, display: 'block', marginBottom: 4 }}
            />
            <h1 style={{ margin: 0 }}>Revisar Relatório</h1>
          </div>
        </div>

        {erro && <div className="mensagem-erro">{erro}</div>}

        {previewUrl && (
          <img src={previewUrl} alt="Relatório original" className="miniatura-imagem" style={{ marginBottom: 8 }} />
        )}

        {extracao.alertas_revisao.length > 0 && (
          <div className="card" style={{ background: 'var(--cor-alerta-fundo)', borderColor: 'var(--cor-alerta)', marginTop: 12 }}>
            <strong style={{ color: '#92400e' }}>⚠️ Pontos para revisar:</strong>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: '#92400e', fontSize: '0.85rem' }}>
              {extracao.alertas_revisao.map((alerta, i) => (
                <li key={i}>{alerta}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="secao-titulo">Dados do Culto</div>
        <div className="pilha">
          {CAMPOS_TEXTO.map(({ campo, rotulo, tipo }) => (
            <div
              key={campo}
              className={`campo ${alertasPorCampo.has(campo) ? 'alerta' : ''}`}
            >
              <label htmlFor={campo}>{rotulo}</label>
              <input
                id={campo}
                type={tipo}
                value={(extracao[campo] as string | null) ?? ''}
                onChange={(e) => atualizarCampo(campo, e.target.value as never)}
              />
            </div>
          ))}
          <div className="linha">
            {CAMPOS_NUMERICOS.map(({ campo, rotulo }) => (
              <div
                key={campo}
                className={`campo ${alertasPorCampo.has(campo) ? 'alerta' : ''}`}
                style={{ flex: 1 }}
              >
                <label htmlFor={campo}>{rotulo}</label>
                <input
                  id={campo}
                  type="number"
                  value={(extracao[campo] as number | null) ?? ''}
                  onChange={(e) => atualizarCampoNumerico(campo, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="secao-titulo">Movimento Financeiro</div>
        <div className="pilha">
          {CAMPOS_FINANCEIROS.map(({ campo, rotulo }) => (
            <div
              key={campo}
              className={`campo ${alertasPorCampo.has(campo) ? 'alerta' : ''}`}
            >
              <label htmlFor={campo}>{rotulo} (R$)</label>
              <input
                id={campo}
                type="number"
                step="0.01"
                value={(extracao[campo] as number | null) ?? ''}
                onChange={(e) => atualizarCampoNumerico(campo, e.target.value)}
              />
            </div>
          ))}

          <div className="linha-detalhe" style={{ marginTop: 4 }}>
            <span>Sub-Total (soma das ofertas acima)</span>
            <strong>{formatarMoeda(subTotalCalculado)}</strong>
          </div>
        </div>

        <div className="secao-titulo">Dízimos</div>
        <div className="lista-dizimos">
          {extracao.dizimos.map((d, i) => (
            <div className="linha-dizimo" key={i}>
              <input
                type="text"
                placeholder="Nome do dizimista"
                value={d.nome}
                onChange={(e) => atualizarDizimo(i, { nome: e.target.value })}
              />
              <input
                type="number"
                step="0.01"
                placeholder="Valor"
                value={d.valor ?? ''}
                onChange={(e) =>
                  atualizarDizimo(i, { valor: e.target.value === '' ? null : Number(e.target.value) })
                }
              />
              <button className="botao-remover" onClick={() => removerDizimo(i)} aria-label="Remover dízimo">
                ✕
              </button>
            </div>
          ))}
          <button className="btn btn-secundario" onClick={adicionarDizimo}>
            + Adicionar Dízimo
          </button>
        </div>

        <div className="secao-titulo">Totais Calculados</div>
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="linha-detalhe">
            <span>Total de Dízimos</span>
            <strong>{formatarMoeda(totalDizimos)}</strong>
          </div>
          <div className="linha-detalhe" style={{ marginTop: 6 }}>
            <span>Total Dízimos + Ofertas</span>
            <strong>{formatarMoeda(totalDizimosOfertas)}</strong>
          </div>
          <p style={{ color: 'var(--cor-texto-suave)', fontSize: '0.8rem', margin: '8px 0 0' }}>
            Calculado automaticamente: dízimos lançados + sub-total das ofertas.
          </p>
        </div>

        <div className="secao-titulo">Total Geral</div>
        <div className="card">
          <div className="linha-detalhe">
            <span>Total Geral (R$)</span>
            <strong>{formatarMoeda(totalGeralCalculado)}</strong>
          </div>
          <p style={{ color: 'var(--cor-texto-suave)', fontSize: '0.8rem', margin: '8px 0 0' }}>
            Sub-Total das ofertas + Total de Dízimos. Não é digitado manualmente.
          </p>
        </div>

        <div className="pilha" style={{ marginTop: 24 }}>
          <button className="btn btn-primario" disabled={salvando} onClick={confirmarESalvar}>
            {salvando ? 'Salvando...' : 'Confirmar e Salvar'}
          </button>
          <button className="btn btn-perigo" disabled={salvando} onClick={descartar}>
            Descartar
          </button>
        </div>
      </div>
    )
  }

  // ----------------------------------------------------------------
  // ETAPA: sucesso
  // ----------------------------------------------------------------
  return (
    <div className="tela-centralizada">
      <div className="icone-sucesso">✓</div>
      <h2 style={{ margin: '0 0 8px' }}>Relatório salvo com sucesso!</h2>
      <p style={{ color: 'var(--cor-texto-suave)', marginBottom: 24 }}>
        Os dados foram registrados e o pastor foi notificado.
      </p>
      <div className="pilha" style={{ width: '100%', maxWidth: 320 }}>
        <button className="btn btn-primario" onClick={descartar}>
          Capturar Outro
        </button>
        <button className="btn btn-secundario" onClick={() => navigate('/')}>
          Voltar ao Início
        </button>
      </div>
    </div>
  )
}
