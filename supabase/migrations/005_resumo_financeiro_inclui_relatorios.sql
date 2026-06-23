-- ============================================================
-- FINANCEIRO — resumo_financeiro também soma os relatórios de culto
-- ============================================================
-- Antes, o resumo financeiro (Total de Entradas/Saídas/Saldo) só
-- considerava a tabela movimentos_financeiros (extratos e despesas
-- anexados manualmente). Os relatórios de culto (dízimos + ofertas)
-- nunca entravam na conta, então o resumo ficava incompleto/zerado.
--
-- Agora: Total de Entradas = soma de relatorios_cultos.total_geral
-- + soma dos movimentos_financeiros com tipo = 'entrada' (extratos
-- de entrada). Total de Saídas = soma dos movimentos_financeiros com
-- tipo = 'saida' (despesas e extratos de saída). Saldo = Entradas - Saídas.

create or replace function public.resumo_financeiro()
returns table (total_entradas numeric, total_saidas numeric, saldo numeric)
language sql
stable
set search_path to 'public'
as $$
  with totais_relatorios as (
    select coalesce(sum(total_geral), 0) as total
    from public.relatorios_cultos
  ),
  totais_movimentos as (
    select
      coalesce(sum(valor) filter (where tipo = 'entrada'), 0) as entradas,
      coalesce(sum(valor) filter (where tipo = 'saida'), 0) as saidas
    from public.movimentos_financeiros
  )
  select
    (totais_relatorios.total + totais_movimentos.entradas) as total_entradas,
    totais_movimentos.saidas as total_saidas,
    (totais_relatorios.total + totais_movimentos.entradas - totais_movimentos.saidas) as saldo
  from totais_relatorios, totais_movimentos;
$$;

revoke all on function public.resumo_financeiro() from public, anon;
grant execute on function public.resumo_financeiro() to authenticated;
