import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { jsPDF } from 'jspdf'
import { supabase, STORAGE_BUCKET } from '../lib/supabase'
import type { Dizimo, RelatorioCulto } from '../types/database'

function formatarMoeda(valor: number | null) {
  if (valor === null || valor === undefined) return 'R$ —'
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarData(data: string | null) {
  if (!data) return '—'
  const [ano, mes, dia] = data.split('-')
  if (!ano || !mes || !dia) return data
  return `${dia}/${mes}/${ano}`
}

function nomeArquivoPdf(relatorio: RelatorioCulto) {
  const base = `relatorio-${relatorio.data_culto ?? 'sem-data'}-${relatorio.pregador ?? 'sem-pregador'}`
  const semAcentos = base
    .toLowerCase()
    .normalize('NFD')
    .split('')
    .filter((c) => c.codePointAt(0)! < 0x300 || c.codePointAt(0)! > 0x36f)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

  return semAcentos + '.pdf'
}

/** O logo é um SVG — jsPDF só desenha bitmap, então renderizamos o SVG num
 *  <canvas> (via <img>) e extraímos um PNG em base64 para inserir no PDF. */
function carregarLogoComoPng(): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const escala = 4 // mais nitidez no PDF do que o tamanho exibido na tela
        const canvas = document.createElement('canvas')
        canvas.width = (img.width || 64) * escala
        canvas.height = (img.height || 64) * escala
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png'))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = '/logo-reviver.svg'
  })
}

export default function RelatorioDetalhe() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [relatorio, setRelatorio] = useState<RelatorioCulto | null>(null)
  const [dizimos, setDizimos] = useState<Dizimo[]>([])
  const [imagemUrl, setImagemUrl] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [gerandoPdf, setGerandoPdf] = useState(false)

  useEffect(() => {
    let ativo = true

    async function carregar() {
      if (!id) return
      setCarregando(true)
      setErro(null)

      const [respostaRelatorio, respostaDizimos] = await Promise.all([
        supabase.from('relatorios_cultos').select('*').eq('id', id).single(),
        supabase
          .from('dizimos')
          .select('*')
          .eq('relatorio_id', id)
          .order('criado_em', { ascending: true }),
      ])

      if (!ativo) return

      if (respostaRelatorio.error || !respostaRelatorio.data) {
        setErro('Relatório não encontrado, ou você não tem permissão para visualizá-lo.')
        setCarregando(false)
        return
      }

      const relatorioCarregado = respostaRelatorio.data as RelatorioCulto
      setRelatorio(relatorioCarregado)
      setDizimos((respostaDizimos.data as Dizimo[]) ?? [])

      if (respostaDizimos.error) {
        console.error('Falha ao carregar dízimos do relatório:', respostaDizimos.error.message)
      }

      if (relatorioCarregado.arquivo_url) {
        const { data: assinada } = await supabase.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(relatorioCarregado.arquivo_url, 60 * 10)
        if (ativo && assinada?.signedUrl) {
          setImagemUrl(assinada.signedUrl)
        }
      }

      setCarregando(false)
    }

    carregar()
    return () => {
      ativo = false
    }
  }, [id])

  async function emitirPdf() {
    if (!relatorio) return
    setGerandoPdf(true)

    try {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      const margem = 18
      const largura = 210 - margem * 2
      let y = 18

      const logoPng = await carregarLogoComoPng()
      const inicioTitulo = logoPng ? margem + 18 : margem
      if (logoPng) {
        doc.addImage(logoPng, 'PNG', margem, y - 4, 14, 14)
      }

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      doc.setTextColor(20)
      doc.text('Comunidade Reviver em Cristo', inicioTitulo, y + 2)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(110)
      doc.text('Relatório Diário de Culto', inicioTitulo, y + 8)

      y += 20
      doc.setDrawColor(225)
      doc.line(margem, y, margem + largura, y)
      y += 9

      function campo(rotulo: string, valor: string, x: number) {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(120)
        doc.text(rotulo.toUpperCase(), x, y)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(11)
        doc.setTextColor(20)
        doc.text(valor || '—', x, y + 5)
      }

      const col3 = largura / 3
      campo('Dia da Semana', relatorio.dia_semana ?? '—', margem)
      campo('Data', formatarData(relatorio.data_culto), margem + col3)
      campo('Horário', relatorio.horario ?? '—', margem + col3 * 2)
      y += 13

      const col2 = largura / 2
      campo('Dirigente', relatorio.dirigente ?? '—', margem)
      campo('Pregador', relatorio.pregador ?? '—', margem + col2)
      y += 13

      campo('Responsável pelo Relatório', relatorio.resp_relatorio ?? '—', margem)
      campo(
        'Visitas / Presenças',
        `${relatorio.total_visitas ?? '—'} / ${relatorio.total_presencas ?? '—'}`,
        margem + col2
      )
      y += 15

      doc.setDrawColor(225)
      doc.line(margem, y, margem + largura, y)
      y += 9

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(20)
      doc.text('Movimento Financeiro', margem, y)
      y += 7

      const itensFinanceiros: [string, number | null][] = [
        ['Ofertas / Primícias', relatorio.ofertas_primicias],
        ['Ofertas Gerais', relatorio.ofertas_gerais],
        ['Ofertas Rádio', relatorio.ofertas_radio],
        ['Votos e Bênçãos', relatorio.votos_bencaos],
        ['Campanhas', relatorio.campanhas],
      ]

      doc.setFontSize(10)
      for (const [rotulo, valor] of itensFinanceiros) {
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(70)
        doc.text(rotulo, margem, y)
        doc.text(formatarMoeda(valor), margem + largura, y, { align: 'right' })
        y += 6
      }

      doc.setFont('helvetica', 'bold')
      doc.setTextColor(20)
      doc.text('Sub-Total', margem, y)
      doc.text(formatarMoeda(relatorio.sub_total), margem + largura, y, { align: 'right' })
      y += 11

      doc.setDrawColor(225)
      doc.line(margem, y, margem + largura, y)
      y += 9

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.text('Dízimos', margem, y)
      y += 7

      doc.setFontSize(10)
      if (dizimos.length === 0) {
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(130)
        doc.text('Nenhum dízimo lançado.', margem, y)
        y += 6
      } else {
        for (const d of dizimos) {
          if (y > 270) {
            doc.addPage()
            y = 20
          }
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(70)
          doc.text(d.nome_dizimista, margem, y)
          doc.text(formatarMoeda(d.valor), margem + largura, y, { align: 'right' })
          y += 6
        }
      }

      y += 3
      if (y > 260) {
        doc.addPage()
        y = 20
      }
      doc.setDrawColor(225)
      doc.line(margem, y, margem + largura, y)
      y += 9

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(20)
      doc.text('Total de Dízimos', margem, y)
      doc.text(formatarMoeda(relatorio.total_dizimos), margem + largura, y, { align: 'right' })
      y += 7

      doc.text('Total Dízimos + Ofertas', margem, y)
      doc.text(formatarMoeda(relatorio.total_dizimos_ofertas), margem + largura, y, { align: 'right' })
      y += 10

      doc.setFontSize(13)
      doc.text('TOTAL GERAL', margem, y)
      doc.text(formatarMoeda(relatorio.total_geral), margem + largura, y, { align: 'right' })

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(150)
      doc.text(`Emitido em ${new Date().toLocaleString('pt-BR')} · Relatórios Reviver`, margem, 287)

      doc.save(nomeArquivoPdf(relatorio))
    } finally {
      setGerandoPdf(false)
    }
  }

  if (carregando) {
    return (
      <div className="tela-centralizada">
        <div className="spinner" />
      </div>
    )
  }

  if (erro || !relatorio) {
    return (
      <div className="tela">
        <div className="mensagem-erro">{erro ?? 'Relatório não encontrado.'}</div>
        <button className="btn btn-secundario" onClick={() => navigate('/')}>
          Voltar
        </button>
      </div>
    )
  }

  return (
    <div className="tela">
      <div className="topo">
        <div>
          <img
            src="/logo-reviver.svg"
            alt="Comunidade Reviver em Cristo"
            style={{ height: 32, display: 'block', marginBottom: 4 }}
          />
          <h1 style={{ margin: 0 }}>Relatório do Culto</h1>
        </div>
        <button className="btn-link" onClick={() => navigate('/')}>
          Voltar
        </button>
      </div>

      {imagemUrl && (
        <img
          src={imagemUrl}
          alt="Relatório original"
          className="miniatura-imagem"
          style={{ marginBottom: 16 }}
        />
      )}

      <div className="secao-titulo">Dados do Culto</div>
      <div className="card pilha">
        <div className="linha-detalhe">
          <span>Dia da Semana</span>
          <strong>{relatorio.dia_semana ?? '—'}</strong>
        </div>
        <div className="linha-detalhe">
          <span>Data</span>
          <strong>{formatarData(relatorio.data_culto)}</strong>
        </div>
        <div className="linha-detalhe">
          <span>Horário</span>
          <strong>{relatorio.horario ?? '—'}</strong>
        </div>
        <div className="linha-detalhe">
          <span>Dirigente</span>
          <strong>{relatorio.dirigente ?? '—'}</strong>
        </div>
        <div className="linha-detalhe">
          <span>Pregador</span>
          <strong>{relatorio.pregador ?? '—'}</strong>
        </div>
        <div className="linha-detalhe">
          <span>Responsável pelo Relatório</span>
          <strong>{relatorio.resp_relatorio ?? '—'}</strong>
        </div>
        <div className="linha-detalhe">
          <span>Total de Visitas</span>
          <strong>{relatorio.total_visitas ?? '—'}</strong>
        </div>
        <div className="linha-detalhe">
          <span>Total de Presenças</span>
          <strong>{relatorio.total_presencas ?? '—'}</strong>
        </div>
      </div>

      <div className="secao-titulo">Movimento Financeiro</div>
      <div className="card pilha">
        <div className="linha-detalhe">
          <span>Ofertas / Primícias</span>
          <strong>{formatarMoeda(relatorio.ofertas_primicias)}</strong>
        </div>
        <div className="linha-detalhe">
          <span>Ofertas Gerais</span>
          <strong>{formatarMoeda(relatorio.ofertas_gerais)}</strong>
        </div>
        <div className="linha-detalhe">
          <span>Ofertas Rádio</span>
          <strong>{formatarMoeda(relatorio.ofertas_radio)}</strong>
        </div>
        <div className="linha-detalhe">
          <span>Votos e Bênçãos</span>
          <strong>{formatarMoeda(relatorio.votos_bencaos)}</strong>
        </div>
        <div className="linha-detalhe">
          <span>Campanhas</span>
          <strong>{formatarMoeda(relatorio.campanhas)}</strong>
        </div>
        <div className="linha-detalhe" style={{ marginTop: 4 }}>
          <span>Sub-Total</span>
          <strong>{formatarMoeda(relatorio.sub_total)}</strong>
        </div>
      </div>

      <div className="secao-titulo">Dízimos</div>
      {dizimos.length === 0 ? (
        <div className="card estado-vazio">Nenhum dízimo lançado neste relatório.</div>
      ) : (
        <div className="card pilha">
          {dizimos.map((d) => (
            <div className="linha-detalhe" key={d.id}>
              <span>{d.nome_dizimista}</span>
              <strong>{formatarMoeda(d.valor)}</strong>
            </div>
          ))}
        </div>
      )}

      <div className="secao-titulo">Totais Calculados</div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="linha-detalhe">
          <span>Total de Dízimos</span>
          <strong>{formatarMoeda(relatorio.total_dizimos)}</strong>
        </div>
        <div className="linha-detalhe" style={{ marginTop: 6 }}>
          <span>Total Dízimos + Ofertas</span>
          <strong>{formatarMoeda(relatorio.total_dizimos_ofertas)}</strong>
        </div>
      </div>

      <div className="secao-titulo">Total Geral</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="linha-detalhe">
          <span>Total Geral (R$)</span>
          <strong>{formatarMoeda(relatorio.total_geral)}</strong>
        </div>
      </div>

      <button className="btn btn-primario" disabled={gerandoPdf} onClick={emitirPdf}>
        {gerandoPdf ? 'Gerando PDF...' : '📄 Emitir PDF'}
      </button>
    </div>
  )
}
