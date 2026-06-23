// Tipos que espelham o schema definido em docs/01-schema-supabase.sql.
// Mantenha este arquivo em sincronia se o schema for alterado.

export type Papel = 'admin' | 'obreiro'

export interface Usuario {
  id: string
  nome: string
  papel: Papel
  criado_em: string
}

export interface Dizimo {
  id: string
  relatorio_id: string
  nome_dizimista: string
  valor: number
  criado_em: string
}

export interface RelatorioCulto {
  id: string

  dia_semana: string | null
  data_culto: string | null
  horario: string | null
  total_visitas: number | null
  total_presencas: number | null
  dirigente: string | null
  pregador: string | null
  resp_relatorio: string | null

  ofertas_primicias: number | null
  ofertas_gerais: number | null
  ofertas_radio: number | null
  votos_bencaos: number | null
  campanhas: number | null
  sub_total: number | null

  total_geral: number | null

  // Calculados pela Edge Function `salvar-relatorio` no momento do save.
  total_dizimos: number | null
  total_dizimos_ofertas: number | null

  arquivo_url: string | null
  texto_completo_ocr: string | null

  criado_por: string
  criado_em: string
  atualizado_em: string
}

// Item de dízimo ainda não salvo (sem id/relatorio_id), usado no formulário
// de revisão antes da confirmação.
export interface DizimoRascunho {
  nome: string
  valor: number | null
}

// Formato retornado pela Edge Function `processar-relatorio`, espelhando o
// schema de saída definido em docs/02-prompt-extracao-claude.md.
export interface ExtracaoRelatorio {
  dia_semana: string | null
  data_culto: string | null
  horario: string | null
  total_visitas: number | null
  total_presencas: number | null
  dirigente: string | null
  pregador: string | null
  resp_relatorio: string | null

  ofertas_primicias: number | null
  ofertas_gerais: number | null
  ofertas_radio: number | null
  votos_bencaos: number | null
  campanhas: number | null
  sub_total: number | null

  dizimos: DizimoRascunho[]

  total_geral: number | null

  texto_completo_ocr: string

  alertas_revisao: string[]

  // Preenchido pela Edge Function após o upload para o Storage
  arquivo_url?: string | null
}

// ------------------------------------------------------------
// FINANCEIRO — Extratos, Despesas e Resumo
// ------------------------------------------------------------

export type OrigemMovimento = 'extrato' | 'despesa'
export type TipoMovimento = 'entrada' | 'saida'

export interface MovimentoFinanceiro {
  id: string
  origem: OrigemMovimento
  tipo: TipoMovimento
  categoria: string | null
  descricao: string | null
  valor: number
  data_movimento: string
  arquivo_url: string
  nome_arquivo: string | null
  tipo_mime: string | null
  criado_por: string
  criado_em: string
  atualizado_em: string
}

// Retorno da RPC `resumo_financeiro` — já respeita RLS (obreiro vê só o
// próprio resumo, admin vê o resumo geral).
export interface ResumoFinanceiro {
  total_entradas: number
  total_saidas: number
  saldo: number
}

// Campos do relatório que disparam um alerta visual quando citados em
// `alertas_revisao` (heurística simples baseada em palavras-chave em PT-BR).
export const CAMPO_PARA_ALERTA: Record<string, (keyof ExtracaoRelatorio)[]> = {
  'dia da semana': ['dia_semana'],
  data: ['data_culto'],
  horário: ['horario'],
  visitas: ['total_visitas'],
  presenças: ['total_presencas'],
  dirigente: ['dirigente'],
  pregador: ['pregador'],
  primícias: ['ofertas_primicias'],
  'ofertas gerais': ['ofertas_gerais'],
  rádio: ['ofertas_radio'],
  'votos e bênçãos': ['votos_bencaos'],
  campanhas: ['campanhas'],
  'sub-total': ['sub_total'],
  'total geral': ['total_geral'],
}
