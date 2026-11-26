/* ==========================================================================
   MÓDULO DE FECHAMENTO MENSAL EXECUTIVO & DOSSIÊ DA DIRETORIA (DARK MODE)
   CARGOSOFT | VOCTT INTELIGÊNCIA DE FROTAS
   Controla a geração do dossiê executivo (mensal e anual consolidado),
   consolidação KMM/ANP, saving de negociação direta, pareceres e Firestore.
   ========================================================================== */

const FIRESTORE_BASE_DOSSIE = "https://firestore.googleapis.com/v1/projects/cargosoft-diesel/databases/(default)/documents/fechamentos_dossie";

let competenciaFechamentoAtiva = null;
let cacheDossieMes = {};
let cachePareceresGestor = {};
const mesesDossieCarregados = new Set();
let graficoEvolucaoInstancia = null;
let mapaTooltipsCardsFechamento = {};

// Lê a competência selecionada diretamente no filtro mestre do cabeçalho (#filtroMesAno).
function obterCompetenciaFiltroGlobal() {
  const selectGlobal = document.getElementById('filtroMesAno');
  if (selectGlobal && selectGlobal.value) {
    return selectGlobal.value;
  }
  return 'YTD';
}

// Retorna o ano-base mais recente presente em baseRegistrosMensais.
function obterAnoBaseFechamento() {
  if (typeof obterAnoMaisRecenteBase === 'function') {
    const ano = obterAnoMaisRecenteBase();
    if (ano) return ano;
  }
  if (typeof baseRegistrosMensais === 'undefined' || !Array.isArray(baseRegistrosMensais)) return '';
  const meses = [...new Set(baseRegistrosMensais.map(r => r.MES_ANO).filter(Boolean))].sort();
  return meses.length ? meses[meses.length - 1].slice(0, 4) : '';
}

// Usa ANP Distribuição para abastecimento interno e ANP Revenda para abastecimento externo.
function obterReferenciaAnpFechamento(registro, mes) {
  const tabela = registro.TIPO_OPERACAO === 'INTERNO' ? anpDistribuicao : anpRevenda;
  return Number(tabela?.[registro.UF_POSTO]?.[mes] || 0);
}

// Retorna a decisão mais recente já vigente na data, sem aplicar acordos futuros a meses passados.
function obterFichaTratativaAteData(tratativa, dataLimite) {
  const limite = (dataLimite || '').substring(0, 10);
  const historico = Array.isArray(tratativa.historico) ? tratativa.historico : [];
  const fichasVigentes = historico.filter(ficha =>
    ficha.vigencia && ficha.vigencia.substring(0, 10) <= limite
  ).sort((a, b) =>
    (b.vigencia || '').localeCompare(a.vigencia || '') || (b.data || '').localeCompare(a.data || '')
  );

  if (fichasVigentes.length) return fichasVigentes[0];
  if (tratativa.vigencia && tratativa.vigencia.substring(0, 10) <= limite) {
    return {
      vigencia: tratativa.vigencia,
      status: tratativa.status,
      preco: tratativa.preco_acordado,
      preco_base: tratativa.preco_base || 0,
      preco_proposto: tratativa.preco_proposto,
      volume_ref: tratativa.volume_ref || 0,
      posto_destino: tratativa.posto_destino,
      posto_destino_uf: tratativa.posto_destino_uf
    };
  }
  return null;
}

// Resolve o Preço Base Pré-Acordo de uma ficha (congelado no Firestore ou retroativo no KMM antes da vigência).
function obterPrecoBaseFichaFechamento(ficha, nomePosto, ufPosto) {
  const baseSalva = parseFloat(ficha?.preco_base || 0);
  if (baseSalva > 0) return baseSalva;

  const vig = (ficha?.vigencia || '').substring(0, 10);
  if (!vig || typeof baseRegistrosMensais === 'undefined' || !Array.isArray(baseRegistrosMensais)) return 0;

  let ultData = '';
  let ultPreco = 0;
  baseRegistrosMensais.forEach(r => {
    if (r.POSTO !== nomePosto || r.UF_POSTO !== ufPosto) return;
    const dt = (r.DATA_FIM_CICLO || '').substring(0, 10);
    const p = parseFloat(r.VALOR_UNITARIO || 0);
    if (dt && dt < vig && p > 0 && dt >= ultData) {
      ultData = dt;
      ultPreco = p;
    }
  });
  return ultPreco;
}

// Resolve o Volume Mensal de Referência pela média de até 3 meses cheios anteriores à vigência (ritmo mensal real).
function obterVolumeRefFichaFechamento(ficha, nomePosto, ufPosto) {
  const vigMes = (ficha?.vigencia || '').substring(0, 7);
  if (vigMes && typeof baseRegistrosMensais !== 'undefined' && Array.isArray(baseRegistrosMensais)) {
    const volPorMes = {};
    baseRegistrosMensais.forEach(r => {
      if (r.POSTO === nomePosto && r.UF_POSTO === ufPosto && r.MES_ANO && r.MES_ANO < vigMes) {
        volPorMes[r.MES_ANO] = (volPorMes[r.MES_ANO] || 0) + parseFloat(r.VOLUME_CICLO || 0);
      }
    });

    const mesesAnt = Object.keys(volPorMes).filter(m => volPorMes[m] > 0).sort().reverse().slice(0, 3);
    if (mesesAnt.length > 0) {
      return mesesAnt.reduce((acc, m) => acc + volPorMes[m], 0) / mesesAnt.length;
    }
  }

  const volSalvo = parseFloat(ficha?.volume_ref || 0);
  if (volSalvo > 0) return volSalvo;

  if (typeof baseRegistrosMensais !== 'undefined' && Array.isArray(baseRegistrosMensais)) {
    const volTodosMeses = {};
    baseRegistrosMensais.forEach(r => {
      if (r.POSTO === nomePosto && r.UF_POSTO === ufPosto && r.MES_ANO) {
        volTodosMeses[r.MES_ANO] = (volTodosMeses[r.MES_ANO] || 0) + parseFloat(r.VOLUME_CICLO || 0);
      }
    });
    const mesesAtivos = Object.keys(volTodosMeses).filter(m => volTodosMeses[m] > 0).sort().reverse().slice(0, 3);
    if (mesesAtivos.length > 0) {
      return mesesAtivos.reduce((acc, m) => acc + volTodosMeses[m], 0) / mesesAtivos.length;
    }
  }
  return 0;
}

// Classifica a rede comercial do posto reutilizando o motor global (painel.js) com fallback seguro.
function obterRedePostoFechamento(nomePosto) {
  if (typeof classificarRedePosto === 'function') {
    const rede = classificarRedePosto(nomePosto);
    if (rede && rede !== 'OUTROS' && rede !== 'INDEPENDENTE' && rede !== 'SEM_REDE') {
      return rede;
    }
  }
  const upper = String(nomePosto || '').toUpperCase();
  if (upper.includes('MARAJO')) return 'REDE MARAJÓ';
  if (upper.startsWith('HG ') || upper.includes(' REDE HG')) return 'REDE HG';
  if (upper.includes('REDE SIM') || upper.startsWith('SIM ')) return 'REDE SIM';
  if (upper.includes('GRAAL')) return 'REDE GRAAL';
  if (upper.includes('PELICANO')) return 'REDE PELICANO';
  if (upper.includes('DECIO') || upper.includes('DÉCIO')) return 'REDE DÉCIO';
  return '';
}

// Converte YYYY-MM no último dia civil da competência para comparar vigências.
function obterDataFimCompetencia(mes) {
  const [ano, numeroMes] = mes.split('-').map(Number);
  return new Date(Date.UTC(ano, numeroMes, 0)).toISOString().slice(0, 10);
}

// Calcula dias inteiros entre duas datas YYYY-MM-DD em UTC.
function calcularDiasEntreDatasFechamento(dataInicioStr, dataFimStr) {
  const ini = (dataInicioStr || '').substring(0, 10);
  const fim = (dataFimStr || '').substring(0, 10);
  if (!ini || !fim) return 0;
  const msIni = Date.parse(`${ini}T12:00:00Z`);
  const msFim = Date.parse(`${fim}T12:00:00Z`);
  if (!Number.isFinite(msIni) || !Number.isFinite(msFim)) return 0;
  return Math.round((msFim - msIni) / 86400000);
}

/**
 * Injeção de Estilos CSS Dark Mode Executivo, Tooltip Flutuante & Modal do Dossiê
 */
(function inicializarEstilosEModalDossie() {
  const idEstilo = "estilosFechamentoExecutivoDark";
  if (!document.getElementById(idEstilo)) {
    const styleEl = document.createElement('style');
    styleEl.id = idEstilo;
    styleEl.innerHTML = `
      /* CONTAINER GERAL DARK */
      #secaoFechamentoExecutivo {
        background: #090d16;
        color: #e2e8f0;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
      }

      /* BADGE INDICADORA DE COMPETÊNCIA SINCRONIZADA COM O TOPO */
      .badge-competencia-dossie {
        background: #1e293b;
        color: #4ade80;
        border: 1px solid rgba(74, 222, 128, 0.35);
        font-family: monospace;
        font-size: 0.74rem;
        font-weight: 700;
        padding: 5px 12px;
        border-radius: 6px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }

      /* BARRA DE ROLAGEM DARK ARREDONDADA E ELEGANTE */
      #secaoFechamentoExecutivo [style*="overflow-y: auto"],
      #secaoFechamentoExecutivo [style*="overflow-y:auto"] {
        scrollbar-width: thin;
        scrollbar-color: rgba(148, 163, 184, 0.28) rgba(9, 13, 22, 0.45);
        padding-right: 4px;
      }
      #secaoFechamentoExecutivo [style*="overflow-y: auto"]::-webkit-scrollbar,
      #secaoFechamentoExecutivo [style*="overflow-y:auto"]::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      #secaoFechamentoExecutivo [style*="overflow-y: auto"]::-webkit-scrollbar-button,
      #secaoFechamentoExecutivo [style*="overflow-y:auto"]::-webkit-scrollbar-button {
        display: none;
        width: 0;
        height: 0;
      }
      #secaoFechamentoExecutivo [style*="overflow-y: auto"]::-webkit-scrollbar-track,
      #secaoFechamentoExecutivo [style*="overflow-y:auto"]::-webkit-scrollbar-track {
        background: rgba(9, 13, 22, 0.45);
        border-radius: 999px;
      }
      #secaoFechamentoExecutivo [style*="overflow-y: auto"]::-webkit-scrollbar-thumb,
      #secaoFechamentoExecutivo [style*="overflow-y:auto"]::-webkit-scrollbar-thumb {
        background: rgba(148, 163, 184, 0.28);
        border-radius: 999px;
      }
      #secaoFechamentoExecutivo [style*="overflow-y: auto"]::-webkit-scrollbar-thumb:hover,
      #secaoFechamentoExecutivo [style*="overflow-y:auto"]::-webkit-scrollbar-thumb:hover {
        background: rgba(148, 163, 184, 0.5);
      }
      #secaoFechamentoExecutivo [style*="overflow-y: auto"]::-webkit-scrollbar-corner,
      #secaoFechamentoExecutivo [style*="overflow-y:auto"]::-webkit-scrollbar-corner {
        background: transparent;
      }

      /* CARDS EXECUTIVOS COM GLOW NEON */
      .card-exec-dark {
        background: #111827;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.07);
        padding: 16px;
        transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        position: relative;
        overflow: hidden;
      }
      .card-exec-dark:hover {
        transform: translateY(-2px);
      }
      .card-exec-dark[data-kpi-tooltip] {
        cursor: help;
      }
      .kpi-info-hint {
        color: #64748b;
        font-size: 0.72rem;
        transition: color 0.2s ease;
      }
      .card-exec-dark:hover .kpi-info-hint {
        color: #cbd5e1;
      }

      /* TOOLTIP EXECUTIVO FLUTUANTE DARK MODE */
      #tooltipExecutivoDark {
        position: fixed;
        z-index: 100080;
        width: 365px;
        max-width: calc(100vw - 24px);
        background: rgba(15, 23, 42, 0.98);
        backdrop-filter: blur(10px);
        color: #e2e8f0;
        border: 1px solid rgba(148, 163, 184, 0.26);
        border-radius: 10px;
        padding: 12px 14px;
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.72), 0 0 0 1px rgba(255, 255, 255, 0.04);
        pointer-events: none;
        opacity: 0;
        transform: translateY(4px);
        transition: opacity 0.16s ease, transform 0.16s ease;
        font-size: 0.73rem;
        line-height: 1.42;
      }
      #tooltipExecutivoDark.visivel {
        opacity: 1;
        transform: translateY(0);
      }
      #tooltipExecutivoDark.borda-verde {
        border-color: rgba(74, 222, 128, 0.45);
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.75), 0 0 20px rgba(74, 222, 128, 0.12);
      }
      #tooltipExecutivoDark.borda-azul {
        border-color: rgba(56, 189, 248, 0.45);
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.75), 0 0 20px rgba(56, 189, 248, 0.12);
      }
      #tooltipExecutivoDark.borda-vermelho {
        border-color: rgba(248, 113, 113, 0.45);
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.75), 0 0 20px rgba(248, 113, 113, 0.12);
      }
      .tt-exec-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-bottom: 6px;
        margin-bottom: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      .tt-exec-titulo {
        font-size: 0.68rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #f8fafc;
      }
      .tt-exec-tag {
        font-size: 0.58rem;
        font-family: monospace;
        padding: 1px 6px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.08);
        color: #94a3b8;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .tt-exec-bloco {
        margin-bottom: 7px;
      }
      .tt-exec-bloco:last-child {
        margin-bottom: 0;
      }
      .tt-exec-label {
        font-size: 0.65rem;
        font-weight: 700;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        margin-bottom: 2px;
      }
      .tt-exec-lista {
        display: flex;
        flex-direction: column;
        gap: 5px;
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px dashed rgba(255, 255, 255, 0.12);
      }
      .tt-exec-item {
        background: rgba(30, 41, 59, 0.65);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 6px;
        padding: 5px 8px;
        font-size: 0.68rem;
      }
      .tt-exec-item-topo {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        font-weight: 700;
        color: #f8fafc;
      }
      .tt-exec-item-nome {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tt-exec-item-valor {
        flex-shrink: 0;
        white-space: nowrap;
        text-align: right;
      }
      .tt-exec-item-sub {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        color: #94a3b8;
        font-family: monospace;
        font-size: 0.63rem;
        margin-top: 2px;
      }

      /* BORDAS & TEXTOS NEON SUTIS */
      .glow-verde {
        border: 1px solid rgba(74, 222, 128, 0.35) !important;
        box-shadow: 0 0 18px rgba(74, 222, 128, 0.08);
      }
      .glow-azul {
        border: 1px solid rgba(56, 189, 248, 0.35) !important;
        box-shadow: 0 0 18px rgba(56, 189, 248, 0.08);
      }
      .glow-laranja {
        border: 1px solid rgba(251, 146, 60, 0.35) !important;
        box-shadow: 0 0 18px rgba(251, 146, 60, 0.08);
      }
      .glow-vermelho {
        border: 1px solid rgba(248, 113, 113, 0.4) !important;
        box-shadow: 0 0 18px rgba(248, 113, 113, 0.1);
      }

      /* NÚMEROS DE DESTAQUE AMPLIADOS */
      .num-kpi-grande {
        font-size: 1.72rem;
        font-weight: 800;
        font-family: monospace;
        line-height: 1.15;
        letter-spacing: -0.02em;
      }
      .num-neon-verde {
        color: #4ade80 !important;
        text-shadow: 0 0 12px rgba(74, 222, 128, 0.35);
      }
      .num-neon-azul {
        color: #38bdf8 !important;
        text-shadow: 0 0 12px rgba(56, 189, 248, 0.35);
      }
      .num-neon-branco {
        color: #f8fafc !important;
        text-shadow: 0 0 10px rgba(248, 250, 252, 0.2);
      }

      /* BOTÃO CLEAN DARK */
      .btn-clean-dark {
        background: #1e293b;
        color: #cbd5e1;
        border: 1px solid rgba(255, 255, 255, 0.15);
        font-weight: 600;
        transition: all 0.2s ease;
      }
      .btn-clean-dark:hover {
        background: #334155;
        color: #ffffff;
        border-color: rgba(255, 255, 255, 0.3);
      }

      /* TABELA DARK COM VISIBILIDADE FORÇADA */
      .tabela-fechamento-dark {
        color: #f1f5f9 !important;
        margin-bottom: 0;
      }
      .tabela-fechamento-dark thead th {
        background: #0f172a !important;
        color: #94a3b8 !important;
        border-bottom: 2px solid #334155 !important;
        font-size: 0.68rem;
        text-transform: uppercase;
        padding: 8px 6px;
      }
      .tabela-fechamento-dark tbody td {
        border-color: rgba(255, 255, 255, 0.06) !important;
        padding: 7px 6px;
        font-size: 0.72rem;
        background: transparent !important;
      }
      .tabela-fechamento-dark tbody tr:hover {
        background: rgba(255, 255, 255, 0.03) !important;
      }

      /* MINI TABELA DA VITRINE TÁTICA AGRUPADA POR REDE */
      .tabela-vitrine-rede {
        width: 100%;
        color: #e2e8f0;
        font-size: 0.66rem;
        margin-top: 6px;
        margin-bottom: 2px;
        border-collapse: collapse;
      }
      .tabela-vitrine-rede th {
        color: #94a3b8;
        font-size: 0.57rem;
        text-transform: uppercase;
        font-weight: 700;
        padding: 3px 4px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      }
      .tabela-vitrine-rede td {
        padding: 4px 4px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        vertical-align: middle;
      }
      .tabela-vitrine-rede tbody tr:last-child td {
        border-bottom: none;
      }

      /* MODAL DE PARECER DA GESTÃO */
      #modalParecerGestor .modal-content {
        background: #0f172a;
        color: #f8fafc;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 12px;
        box-shadow: 0 25px 60px rgba(0, 0, 0, 0.5);
      }
      #modalParecerGestor .modal-header {
        background: linear-gradient(135deg, #3b2b08 0%, #6b4f0e 55%, #8a6715 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      #modalParecerGestor .form-control, #modalParecerGestor .form-select {
        background: #1e293b;
        color: #f8fafc;
        border: 1px solid #334155;
      }
      #modalParecerGestor .form-control:focus, #modalParecerGestor .form-select:focus {
        background: #1e293b;
        color: #f8fafc;
        border-color: #eab308;
        box-shadow: 0 0 0 0.2rem rgba(234, 179, 8, 0.2);
      }
      .parecer-manual-card {
        height: 100%;
        padding: 14px;
        color: #f8fafc;
        background: linear-gradient(135deg, #211b0d 0%, #171a22 100%);
        border: 1px solid rgba(234, 179, 8, 0.34);
        border-left: 4px solid #eab308;
        border-radius: 8px;
      }
      .parecer-manual-subtitulo {
        color: #facc15;
        font-size: 0.72rem;
      }
      .parecer-manual-texto {
        color: #e2e8f0;
        font-size: 0.78rem;
        line-height: 1.5;
        white-space: pre-wrap;
      }
      .parecer-manual-indicador {
        min-width: 150px;
        padding: 8px 10px;
        background: rgba(234, 179, 8, 0.08);
        border: 1px solid rgba(234, 179, 8, 0.2);
        border-radius: 6px;
      }
      .parecer-manual-valor {
        color: #facc15;
        font-size: 0.88rem;
        font-weight: 800;
      }

      /* REGRAS DE IMPRESSÃO DO DOSSIÊ */
      @media print {
        #tooltipExecutivoDark,
        .kpi-info-hint {
          display: none !important;
        }
        body.printing-dossie .badge-competencia-dossie {
          background: #f1f5f9 !important;
          color: #0f172a !important;
          border: 1px solid #cbd5e1 !important;
        }
        body.printing-dossie #secaoFechamentoExecutivo {
          background: #ffffff !important;
          color: #0f172a !important;
          border: none !important;
          box-shadow: none !important;
        }
        body.printing-dossie .btn,
        body.printing-dossie select {
          display: none !important;
        }
        body.printing-dossie .dossie-pareceres-vazio {
          display: none !important;
        }
        body.printing-dossie .tabela-vitrine-rede {
          color: #0f172a !important;
        }
        body.printing-dossie .tabela-vitrine-rede th {
          color: #475569 !important;
          border-bottom-color: #cbd5e1 !important;
        }
        body.printing-dossie .tabela-vitrine-rede td {
          border-bottom-color: #e2e8f0 !important;
        }
      }
    `;
    document.head.appendChild(styleEl);
  }

  const inserirElementosGlobais = () => {
    if (!document.body) return;

    if (!document.getElementById('tooltipExecutivoDark')) {
      const ttEl = document.createElement('div');
      ttEl.id = 'tooltipExecutivoDark';
      ttEl.setAttribute('role', 'tooltip');
      document.body.appendChild(ttEl);
    }

    if (!document.getElementById('modalParecerGestor')) {
      const modalHtml = `
        <div class="modal fade" id="modalParecerGestor" tabindex="-1" aria-labelledby="lblModalParecer" aria-hidden="true" style="z-index: 100060;">
          <div class="modal-dialog modal-dialog-centered modal-lg">
            <div class="modal-content">
              <div class="modal-header d-flex justify-content-between align-items-center py-2 px-3">
                <div class="d-flex align-items-center gap-2">
                  <i class="bi bi-chat-square-text text-warning fs-5"></i>
                  <h6 class="modal-title fw-bold text-white mb-0" id="lblModalParecer">Novo Parecer da Gestão</h6>
                </div>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Fechar"></button>
              </div>
              <div class="modal-body p-3">
                <form id="formParecerGestor" onsubmit="salvarParecerGestor(event)">
                  <div class="mb-2">
                    <label for="campoParecerTitulo" class="form-label small fw-bold text-white-50 mb-1">Título</label>
                    <input id="campoParecerTitulo" class="form-control" maxlength="100" required placeholder="Ex.: Renegociação de abastecimento no corredor Sul">
                  </div>
                  <div class="mb-2">
                    <label for="campoParecerSubtitulo" class="form-label small fw-bold text-white-50 mb-1">Subtítulo</label>
                    <input id="campoParecerSubtitulo" class="form-control" maxlength="140" required placeholder="Ex.: Ação adotada para reduzir custo e garantir abastecimento">
                  </div>
                  <div class="mb-3">
                    <label for="campoParecerTexto" class="form-label small fw-bold text-white-50 mb-1">Análise e observações</label>
                    <textarea id="campoParecerTexto" class="form-control" rows="5" maxlength="3000" required placeholder="Registre o contexto, a decisão tomada, fatores que não aparecem nos dados e próximos passos."></textarea>
                  </div>
                  <div class="mb-3">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                      <label class="form-label small fw-bold text-white-50 mb-0">Indicadores manuais de saving</label>
                      <button type="button" class="btn btn-sm btn-outline-warning" onclick="adicionarIndicadorParecer()">
                        <i class="bi bi-plus-lg me-1"></i> Adicionar indicador
                      </button>
                    </div>
                    <div id="listaIndicadoresParecer"></div>
                  </div>
                  <div class="d-flex justify-content-between align-items-center pt-2 border-top border-secondary">
                    <span class="text-white-50 small" style="font-size: 0.65rem;" id="parecerInfoCompetencia">--</span>
                    <div class="d-flex gap-2">
                      <button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
                      <button type="submit" id="btnSalvarParecer" class="btn btn-sm btn-warning fw-bold px-3">
                        <i class="bi bi-check-circle me-1"></i> Salvar Parecer
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', modalHtml);
    }
  };

  if (document.body) inserirElementosGlobais();
  else document.addEventListener('DOMContentLoaded', inserirElementosGlobais, { once: true });
})();

/**
 * Montagem e Vinculação dos Tooltips Executivos Dark Mode nos Cards KPI
 */
function prepararConteudoTooltipsFechamento(dados) {
  const ehAnual = dados.ehModoAnual;
  const rotuloPeriodo = formatarRotuloCompetencia(competenciaFechamentoAtiva);
  const sufixoPeriodo = ehAnual ? 'no ano' : 'no mês';

  // 1. Termômetro da Frota
  const htmlTermometro = `
    <div class="tt-exec-header">
      <span class="tt-exec-titulo"><i class="bi bi-speedometer2 text-success me-1"></i>Termômetro da Frota</span>
      <span class="tt-exec-tag">${rotuloPeriodo}</span>
    </div>
    <div class="tt-exec-bloco">
      Compara o <strong>preço médio ponderado pago pela frota</strong> (abastecimentos externos e internos com referência oficial disponível) frente à média oficial da <strong>ANP</strong> na mesma UF ${sufixoPeriodo}.
    </div>
    <div class="tt-exec-bloco">
      <div class="tt-exec-label">Composição ${ehAnual ? 'do Ano' : 'do Mês & YTD'}</div>
      <div>• Custo Médio Frota (base ANP): <strong class="font-monospace text-white">R$ ${dados.custoMedioComAnpMes.toFixed(3)}/L</strong></div>
      <div>• Média Ponderada ANP: <strong class="font-monospace text-info">R$ ${dados.anpMediaPonderadaMes.toFixed(3)}/L</strong></div>
      <div>• Acumulado YTD: soma do Hard Saving auditado de Janeiro até ${dados.rotuloMesMaisRecenteAno}.</div>
    </div>
  `;

  // 2. Hard Saving (Vs. ANP)
  const htmlHardSaving = `
    <div class="tt-exec-header">
      <span class="tt-exec-titulo"><i class="bi bi-shield-check text-success me-1"></i>Hard Saving (Vs. ANP)</span>
      <span class="tt-exec-tag">Benchmark</span>
    </div>
    <div class="tt-exec-bloco">
      Economia real auditada ciclo a ciclo sempre que o valor unitário pago ficou <strong>abaixo da referência oficial ANP</strong> da UF na respectiva competência:
    </div>
    <div class="tt-exec-bloco">
      <div class="tt-exec-label">Critérios de Auditoria</div>
      <div>• <strong>Postos Externos:</strong> confrontados contra <em>ANP Revenda</em>.</div>
      <div>• <strong>Garagens / Matrizes:</strong> confrontadas contra <em>ANP Distribuição</em>.</div>
      <div>• Fórmula: <span class="font-monospace text-success">(Ref. ANP − Preço Pago) × Litros</span>.</div>
    </div>
  `;

  // 3. Saving Negociação Direta
  const itensRunRate = [...(dados.detalhesRunRate || [])].sort((a, b) => b.impactoMensal - a.impactoMensal);
  const listaRunRateHtml = itensRunRate.length > 0
    ? `<div class="tt-exec-lista">
        <div class="tt-exec-label">Principais Acordos no Contratado (Run-Rate)</div>
        ${itensRunRate.slice(0, 6).map(it => `
          <div class="tt-exec-item">
            <div class="tt-exec-item-topo">
              <span class="tt-exec-item-nome">${escaparHtmlParecer(it.posto)} (${escaparHtmlParecer(it.uf)})</span>
              <span class="tt-exec-item-valor font-monospace text-success">+R$ ${Math.round(it.impactoMensal).toLocaleString('pt-BR')}/mês</span>
            </div>
            <div class="tt-exec-item-sub">
              <span>R$ ${it.precoBase.toFixed(3)} &rarr; R$ ${it.precoNeg.toFixed(3)} (-${it.diff.toFixed(3)})</span>
              <span class="tt-exec-item-valor">Base: ${Math.round(it.volRef).toLocaleString('pt-BR')} L</span>
            </div>
          </div>
        `).join('')}
        ${itensRunRate.length > 6 ? `<div class="text-white-50 fst-italic" style="font-size: 0.63rem;">+ ${itensRunRate.length - 6} outros acordos no período</div>` : ''}
      </div>`
    : '';

  const htmlNegociacaoDireta = `
    <div class="tt-exec-header">
      <span class="tt-exec-titulo"><i class="bi bi-handshake text-success me-1"></i>Saving Negociação Direta</span>
      <span class="tt-exec-tag">Mesa Comercial</span>
    </div>
    <div class="tt-exec-bloco">
      <div class="tt-exec-label text-success">Número Principal (+R$ ${Math.round(dados.savingNegociacaoRealizadoMes).toLocaleString('pt-BR')}) — Realizado</div>
      Economia efetiva já capturada no caixa sobre os <strong>litros abastecidos ${sufixoPeriodo}</strong> após a vigência do acordo, comparando o preço negociado contra o <strong>último preço pago antes da negociação</strong>.
    </div>
    <div class="tt-exec-bloco">
      <div class="tt-exec-label text-info">Rodapé: Contratado (Run-Rate)</div>
      É o <strong>potencial mensal recorrente</strong> (velocidade de cruzeiro) dos acordos vigentes fechados no período, projetado sobre a média de volume de até <strong>3 meses cheios anteriores</strong> de cada posto.
    </div>
    ${listaRunRateHtml}
  `;

  // 4. Cost Avoidance de Tabela
  const itensAvoidance = [...(dados.detalhesCostAvoidance || [])].sort((a, b) => b.impactoTotal - a.impactoTotal);
  const listaAvoidanceHtml = itensAvoidance.length > 0
    ? `<div class="tt-exec-lista">
        <div class="tt-exec-label">Negociações Blindadas ${ehAnual ? 'no Ano' : 'no Mês'} (${itensAvoidance.length})</div>
        ${itensAvoidance.slice(0, 7).map(it => `
          <div class="tt-exec-item">
            <div class="tt-exec-item-topo">
              <span class="tt-exec-item-nome">${escaparHtmlParecer(it.posto)} (${escaparHtmlParecer(it.uf)})</span>
              <span class="tt-exec-item-valor font-monospace text-info">+R$ ${Math.round(it.impactoTotal).toLocaleString('pt-BR')}</span>
            </div>
            <div class="tt-exec-item-sub">
              <span>Balcão R$ ${it.precoProposto.toFixed(3)} &rarr; Acordo R$ ${it.precoAcordado.toFixed(3)}</span>
              <span class="tt-exec-item-valor">${Math.round(it.volume).toLocaleString('pt-BR')} L</span>
            </div>
          </div>
        `).join('')}
        ${itensAvoidance.length > 7 ? `<div class="text-white-50 fst-italic" style="font-size: 0.63rem;">+ ${itensAvoidance.length - 7} outros postos blindados</div>` : ''}
      </div>`
    : `<div class="tt-exec-lista">
        <div class="text-white-50" style="font-size: 0.67rem;">Nenhum reajuste de balcão barrado foi faturado neste período.</div>
      </div>`;

  const htmlCostAvoidance = `
    <div class="tt-exec-header">
      <span class="tt-exec-titulo"><i class="bi bi-shield-lock text-info me-1"></i>Cost Avoidance de Tabela</span>
      <span class="tt-exec-tag">Blindagem</span>
    </div>
    <div class="tt-exec-bloco">
      Custo evitado quando o posto tentou aplicar <strong>preço de bomba/proposta superior</strong>, mas a mesa comercial barrou o reajuste e manteve o faturamento no preço acordado:
      <div class="font-monospace text-info mt-1" style="font-size: 0.66rem;">(Preço Balcão − Preço Acordado) × Litros</div>
    </div>
    ${listaAvoidanceHtml}
  `;

  // 5. Volume Sob Gestão Direta
  const htmlVolumeGestao = `
    <div class="tt-exec-header">
      <span class="tt-exec-titulo"><i class="bi bi-fuel-pump text-white me-1"></i>Volume Sob Gestão Direta</span>
      <span class="tt-exec-tag">Cobertura</span>
    </div>
    <div class="tt-exec-bloco">
      Total de litros abastecidos ${sufixoPeriodo} em postos que possuíam <strong>acordo comercial vigente</strong> na data do ciclo.
    </div>
    <div class="tt-exec-bloco">
      <div class="tt-exec-label">Representatividade na Competência</div>
      <div>• Sob Acordo: <strong class="font-monospace text-white">${Math.round(dados.volumeSobAcordoMes).toLocaleString('pt-BR')} L</strong> (${dados.qtdPostosAcordadosAtivos} postos)</div>
      <div>• Volume Total Frota: <strong class="font-monospace text-white-50">${Math.round(dados.volumeTotalMes).toLocaleString('pt-BR')} L</strong></div>
      <div>• Cobertura: <strong class="font-monospace text-success">${dados.percVolumeAcordado.toFixed(1).replace('.', ',')}%</strong> da operação auditada.</div>
    </div>
  `;

  mapaTooltipsCardsFechamento = {
    termometro: { html: htmlTermometro, borda: dados.operacaoVerde === false ? 'borda-vermelho' : 'borda-verde' },
    hardSaving: { html: htmlHardSaving, borda: 'borda-verde' },
    negociacaoDireta: { html: htmlNegociacaoDireta, borda: 'borda-verde' },
    costAvoidance: { html: htmlCostAvoidance, borda: 'borda-azul' },
    volumeGestao: { html: htmlVolumeGestao, borda: 'borda-verde' }
  };
}

function posicionarTooltipExecutivo(cardEl, tooltipEl) {
  const rectCard = cardEl.getBoundingClientRect();
  const rectTt = tooltipEl.getBoundingClientRect();
  const margem = 10;

  let left = rectCard.left + (rectCard.width / 2) - (rectTt.width / 2);
  if (left < margem) left = margem;
  if (left + rectTt.width > window.innerWidth - margem) {
    left = window.innerWidth - rectTt.width - margem;
  }

  let top = rectCard.bottom + 8;
  if (top + rectTt.height > window.innerHeight - margem) {
    top = rectCard.top - rectTt.height - 8;
  }
  if (top < margem) top = margem;

  tooltipEl.style.left = `${Math.round(left)}px`;
  tooltipEl.style.top = `${Math.round(top)}px`;
}

function vincularTooltipsCardsFechamento() {
  const tooltipEl = document.getElementById('tooltipExecutivoDark');
  if (!tooltipEl) return;

  const cards = document.querySelectorAll('#secaoFechamentoExecutivo [data-kpi-tooltip]');
  cards.forEach(card => {
    const chave = card.getAttribute('data-kpi-tooltip');

    card.addEventListener('mouseenter', () => {
      const config = mapaTooltipsCardsFechamento[chave];
      if (!config) return;
      tooltipEl.className = config.borda || '';
      tooltipEl.innerHTML = config.html;
      tooltipEl.classList.add('visivel');
      posicionarTooltipExecutivo(card, tooltipEl);
    });

    card.addEventListener('mousemove', () => {
      if (tooltipEl.classList.contains('visivel')) {
        posicionarTooltipExecutivo(card, tooltipEl);
      }
    });

    card.addEventListener('mouseleave', () => {
      tooltipEl.classList.remove('visivel');
    });
  });
}

/**
 * Inicialização e renderização principal da aba de Fechamento Executivo
 */
async function renderizarAbaFechamentoExecutivo() {
  const container = document.getElementById('secaoFechamentoExecutivo');
  if (!container) return;

  try {
    await renderizarConteudoFechamentoExecutivo();
  } catch (erro) {
    console.error('Falha ao renderizar o Fechamento Executivo:', erro);
    container.replaceChildren();
    const alerta = document.createElement('div');
    alerta.className = 'alert alert-danger p-3 text-center';
    alerta.textContent = `Não foi possível carregar o Fechamento Executivo: ${erro?.message || 'erro inesperado'}`;
    container.appendChild(alerta);
  }
}

async function renderizarConteudoFechamentoExecutivo() {
  const container = document.getElementById('secaoFechamentoExecutivo');
  if (!container) return;

  const tooltipEl = document.getElementById('tooltipExecutivoDark');
  if (tooltipEl) tooltipEl.classList.remove('visivel');

  if (typeof baseRegistrosMensais === 'undefined' || !Array.isArray(baseRegistrosMensais) || baseRegistrosMensais.length === 0) {
    container.innerHTML = `
      <div class="alert alert-dark p-3 text-center border-secondary">
        <i class="bi bi-hourglass-split me-2 text-warning"></i> Aguardando o carregamento dos registros transacionais do KMM...
      </div>
    `;
    return;
  }

  competenciaFechamentoAtiva = obterCompetenciaFiltroGlobal();
  const ehAnual = competenciaFechamentoAtiva === 'YTD';
  const anoBase = obterAnoBaseFechamento();
  const mesesDoAno = [...new Set(baseRegistrosMensais.map(r => r.MES_ANO).filter(m => m && (!anoBase || m.startsWith(`${anoBase}-`))))].sort();

  container.innerHTML = `
    <div class="text-center py-5 text-muted">
      <div class="spinner-border spinner-border-sm text-success me-2" role="status"></div>
      Consolidando indicadores executivos, matrizes de garagem e curva temporal de savings...
    </div>
  `;

  if (ehAnual) {
    const chavesDossie = [`YTD_${anoBase}`, ...mesesDoAno];
    await Promise.all(chavesDossie.map(chave => carregarDossieMesFirestore(chave)));
  } else {
    await carregarDossieMesFirestore(competenciaFechamentoAtiva);
  }

  const dados = calcularMetricasFechamento(competenciaFechamentoAtiva);
  prepararConteudoTooltipsFechamento(dados);

  const rotuloCompetencia = formatarRotuloCompetencia(competenciaFechamentoAtiva);
  const sufixoPeriodo = ehAnual ? 'no ano' : 'no mês';

  container.innerHTML = `
    <!-- TOPO EXECUTIVO: TÍTULO, COMPETÊNCIA SINCRONIZADA E BOTÕES CLEAN DARK -->
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 pb-2 border-bottom border-secondary">
      <div>
        <h5 class="fw-bold mb-0 text-white d-flex align-items-center gap-2">
          <i class="bi bi-briefcase-fill text-success fs-4"></i>
          <span>Fechamento Executivo & Prestação de Contas da Frota</span>
        </h5>
        <span class="small text-white-50" style="font-size: 0.72rem;">
          Consolidação Operacional, Estratégia de Garagens e Economia Real Auditada no Caixa da Cargosoft
        </span>
      </div>

      <div class="d-flex align-items-center gap-2 flex-wrap">
        <span class="badge-competencia-dossie" title="Sincronizado com o filtro de competência superior">
          <i class="bi bi-calendar-check"></i>
          <span>${escaparHtmlParecer(rotuloCompetencia)}</span>
        </span>
        <button class="btn btn-sm btn-clean-dark shadow-sm text-nowrap px-3" onclick="abrirModalParecer()">
          <i class="bi bi-chat-square-text me-1 text-warning"></i> Inserir Parecer
        </button>
        <button class="btn btn-sm btn-clean-dark shadow-sm text-nowrap px-3" onclick="emitirRelatorioFechamentoExecutivo()">
          <i class="bi bi-printer me-1 text-secondary"></i> Imprimir Dossiê
        </button>
      </div>
    </div>

    <!-- BLOCO 1: CARDS DE IMPACTO COM NÚMEROS AMPLIADOS & NEON GLOW (5 CARDS PROPORCIONAIS) -->
    <div class="row g-2 mb-3 cards-fechamento-principais">
      <!-- TERMÔMETRO MACRO DO PERÍODO -->
      <div class="col-12 col-md-6 col-xl">
        <div data-kpi-tooltip="termometro" class="card-exec-dark h-100 ${dados.operacaoVerde === null ? '' : (dados.operacaoVerde ? 'glow-verde' : 'glow-vermelho')} d-flex flex-column justify-content-between">
          <div>
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="text-uppercase fw-bold text-white-50" style="font-size: 0.62rem; letter-spacing: 0.05em;">Termômetro da Frota</span>
              <div class="d-flex align-items-center gap-2">
                <i class="bi bi-info-circle kpi-info-hint"></i>
                <i class="bi ${dados.operacaoVerde === null ? 'bi-dash-circle text-secondary' : (dados.operacaoVerde ? 'bi-shield-check text-success' : 'bi-shield-exclamation text-danger')} fs-5"></i>
              </div>
            </div>
            <div class="num-kpi-grande ${dados.operacaoVerde === null ? 'text-secondary' : (dados.operacaoVerde ? 'num-neon-verde' : 'text-danger')} my-1">
              ${dados.operacaoVerde === null ? 'SEM REFERÊNCIA ANP' : (dados.operacaoVerde ? 'OPERAÇÃO NO VERDE' : 'ALERTA DE ÁGIO')}
            </div>
            <div class="text-white-50 small" style="font-size: 0.70rem; line-height: 1.3;">
              ${dados.anpMediaPonderadaMes > 0 
                ? (dados.operacaoVerde 
                  ? `Preço médio da frota ficou <strong>R$ ${Math.abs(dados.spreadMedioMes).toFixed(3)}/L abaixo da média oficial ANP</strong>.` 
                  : `Diesel comprado R$ ${dados.spreadMedioMes.toFixed(3)}/L acima da ANP na média.`)
                : `Tabela oficial ANP não disponível para esta competência.`}
            </div>
          </div>
          <div class="pt-2 mt-2 border-top border-secondary font-monospace text-white-50" style="font-size: 0.65rem;">
            Acumulado do Ano (YTD): <strong class="text-success">+R$ ${Math.round(dados.savingAcumuladoYtd).toLocaleString('pt-BR')}</strong>
          </div>
        </div>
      </div>

      <!-- HARD SAVING (CAIXA REAL RETIDO VS ANP) -->
      <div class="col-12 col-md-6 col-xl">
        <div data-kpi-tooltip="hardSaving" class="card-exec-dark h-100 glow-verde d-flex flex-column justify-content-between">
          <div>
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="text-uppercase fw-bold text-white-50" style="font-size: 0.62rem; letter-spacing: 0.05em;">Hard Saving (Vs. ANP)</span>
              <i class="bi bi-info-circle kpi-info-hint"></i>
            </div>
            <div class="num-kpi-grande num-neon-verde my-1">
              + R$ ${Math.round(dados.hardSavingTotalMes).toLocaleString('pt-BR')}
            </div>
            <div class="text-white-50 small" style="font-size: 0.70rem;">
              Economia real auditada vs. tabela oficial ANP ${sufixoPeriodo}.
            </div>
          </div>
          <div class="pt-2 mt-2 border-top border-secondary font-monospace text-white-50" style="font-size: 0.65rem;">
            Volume Auditado: <strong class="text-white">${Math.round(dados.volumeTotalMes).toLocaleString('pt-BR')} L</strong>
          </div>
        </div>
      </div>

      <!-- SAVING DE NEGOCIAÇÃO DIRETA (ATUAÇÃO NA MESA) -->
      <div class="col-12 col-md-6 col-xl">
        <div data-kpi-tooltip="negociacaoDireta" class="card-exec-dark h-100 glow-verde d-flex flex-column justify-content-between">
          <div>
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="text-uppercase fw-bold text-white-50" style="font-size: 0.62rem; letter-spacing: 0.05em;">Saving Negociação Direta</span>
              <i class="bi bi-info-circle kpi-info-hint"></i>
            </div>
            <div class="num-kpi-grande num-neon-verde my-1">
              + R$ ${Math.round(dados.savingNegociacaoRealizadoMes).toLocaleString('pt-BR')}
            </div>
            <div class="text-white-50 small" style="font-size: 0.70rem;">
              Redução direta realizada na mesa vs. preço anterior pago.
            </div>
          </div>
          <div class="pt-2 mt-2 border-top border-secondary font-monospace" style="font-size: 0.68rem;">
            ${dados.savingNegociacaoContratadoMes > 0
              ? `<span class="text-white-50">Contratado (Run-Rate):</span> <strong class="text-success">+R$ ${Math.round(dados.savingNegociacaoContratadoMes).toLocaleString('pt-BR')}/mês</strong>`
              : `<span class="text-white-50">Atuação direta sobre a carteira</span>`}
          </div>
        </div>
      </div>

      <!-- COST AVOIDANCE DE TABELA -->
      <div class="col-12 col-md-6 col-xl">
        <div data-kpi-tooltip="costAvoidance" class="card-exec-dark h-100 glow-azul d-flex flex-column justify-content-between">
          <div>
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="text-uppercase fw-bold text-white-50" style="font-size: 0.62rem; letter-spacing: 0.05em;">Cost Avoidance de Tabela</span>
              <i class="bi bi-info-circle kpi-info-hint"></i>
            </div>
            <div class="num-kpi-grande num-neon-azul my-1">
              + R$ ${Math.round(dados.costAvoidanceMes).toLocaleString('pt-BR')}
            </div>
            <div class="text-white-50 small" style="font-size: 0.70rem;">
              Aumentos de bomba e propostas de balcão barrados na mesa.
            </div>
          </div>
          <div class="pt-2 mt-2 border-top border-secondary font-monospace text-white-50" style="font-size: 0.65rem;">
            Blindagem ativa ${sufixoPeriodo}
          </div>
        </div>
      </div>

      <!-- VOLUME SOB GESTÃO DIRETA -->
      <div class="col-12 col-md-6 col-xl">
        <div data-kpi-tooltip="volumeGestao" class="card-exec-dark h-100 glow-verde d-flex flex-column justify-content-between">
          <div>
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="text-uppercase fw-bold text-white-50" style="font-size: 0.62rem; letter-spacing: 0.05em;">Volume Sob Gestão Direta</span>
              <i class="bi bi-info-circle kpi-info-hint"></i>
            </div>
            <div class="num-kpi-grande num-neon-branco my-1">
              ${Math.round(dados.volumeSobAcordoMes).toLocaleString('pt-BR')} L
            </div>
            <div class="text-white-50 small" style="font-size: 0.70rem;">
              <strong>${dados.percVolumeAcordado.toFixed(1).replace('.', ',')}%</strong> do consumo ${ehAnual ? 'do ano' : 'do mês'} rodou sob postos com acordo ativo.
            </div>
          </div>
          <div class="pt-2 mt-2 border-top border-secondary font-monospace text-white-50" style="font-size: 0.65rem;">
            ${dados.qtdPostosAcordadosAtivos} postos com acordo vigente
          </div>
        </div>
      </div>
    </div>

    <!-- BLOCO 2: GRÁFICO DE EVIDÊNCIA DE GESTÃO (CURVA DE EFICIÊNCIA TEMPORAL) -->
    <div class="card-exec-dark mb-3 p-3">
      <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom border-secondary">
        <div>
          <h6 class="fw-bold mb-0 text-white" style="font-size: 0.85rem;">
            <i class="bi bi-graph-up-arrow text-success me-2"></i>Curva de Eficiência da Gestão: Evolução de Savings & Spread ANP
          </h6>
          <span class="small text-white-50" style="font-size: 0.68rem;">
            Evidência temporal do descolamento de custos a partir da atuação estratégica de compras na frota
          </span>
        </div>
        <span class="badge bg-dark text-success border border-success font-monospace" style="font-size: 0.60rem;">
          Série por competência
        </span>
      </div>
      <div id="graficoEvolucaoSavings" style="min-height: 230px; width: 100%;"></div>
    </div>

    <!-- BLOCO 3: PAINEL EXECUTIVO DE MATRIZES & GARAGENS PRÓPRIAS -->
    <div class="card-exec-dark mb-3 p-3">
      <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom border-secondary">
        <div>
          <h6 class="fw-bold mb-0 text-white" style="font-size: 0.85rem;">
            <i class="bi bi-fuel-pump-fill text-success me-2"></i>Estratégia de Tanques Próprios & Margem de Garagem (Matrizes)
          </h6>
          <span class="small text-white-50" style="font-size: 0.68rem;">
            ${ehAnual
              ? `Consolidação acumulada no ano (cálculo mês a mês) do ganho retido em garagem vs. preço de rua`
              : `Auditoria de compras no atacado vs. ANP Distribuição e ganho unitário contra a bomba de rua`}
          </span>
        </div>
        <span class="badge bg-dark text-white-50 border border-secondary font-monospace" style="font-size: 0.60rem;">
          ${dados.matrizesGaragem.length} garagens ativas
        </span>
      </div>

      <div class="row g-2 mb-2">
        <div class="col-12 col-md-4">
          <div class="p-2 rounded bg-dark border border-secondary">
            <span class="text-white-50 text-uppercase" style="font-size: 0.60rem; font-weight: 700;">${ehAnual ? 'Volume Interno Acumulado (Ano)' : 'Volume Interno no Mês'}</span>
            <div class="fw-bold font-monospace text-white fs-6">${Math.round(dados.volInternoMes).toLocaleString('pt-BR')} L</div>
            <div class="text-white-50" style="font-size: 0.62rem;">${dados.percInternoMes.toFixed(1).replace('.', ',')}% do abastecimento total</div>
          </div>
        </div>
        <div class="col-12 col-md-4">
          <div class="p-2 rounded bg-dark border border-secondary">
            <span class="text-white-50 text-uppercase" style="font-size: 0.60rem; font-weight: 700;">${ehAnual ? 'Spread Médio Ponderado vs. Rua' : 'Spread Médio Garagem vs. Rua'}</span>
            <div class="fw-bold font-monospace ${dados.spreadMedioGaragemMes >= 0 ? 'text-success' : 'text-danger'} fs-6">${dados.spreadMedioGaragemMes > 0 ? '+' : (dados.spreadMedioGaragemMes < 0 ? '-' : '')} R$ ${Math.abs(dados.spreadMedioGaragemMes).toFixed(3)}/L</div>
            <div class="text-white-50" style="font-size: 0.62rem;">Vantagem líquida unitária interna</div>
          </div>
        </div>
        <div class="col-12 col-md-4">
          <div class="p-2 rounded bg-dark border border-secondary">
            <span class="text-white-50 text-uppercase" style="font-size: 0.60rem; font-weight: 700;">${ehAnual ? 'Ganho Total Retido em Garagem (Ano)' : 'Economia Retida em Garagem'}</span>
            <div class="fw-bold font-monospace ${dados.savingGaragemMes >= 0 ? 'text-success' : 'text-danger'} fs-6">${dados.savingGaragemMes > 0 ? '+' : (dados.savingGaragemMes < 0 ? '-' : '')} R$ ${Math.round(Math.abs(dados.savingGaragemMes)).toLocaleString('pt-BR')}</div>
            <div class="text-white-50" style="font-size: 0.62rem;">${ehAnual ? 'Gap acumulado abastecendo interno vs. externo' : 'Preservação direta de caixa'}</div>
          </div>
        </div>
      </div>

      <div class="table-responsive">
        <table class="table tabela-fechamento-dark align-middle text-center" style="white-space: nowrap;">
          <thead>
            <tr>
              <th class="text-start">Filial / Garagem</th>
              <th>UF</th>
              <th class="text-end">${ehAnual ? 'Custo Médio (R$/L)' : 'Custo Garagem (R$/L)'}</th>
              <th class="text-end">Ref. ANP Distr.</th>
              <th class="text-end">Eficiência Atacado (%)</th>
              <th class="text-end">Média Rua (UF)</th>
              <th class="text-end">Spread vs. Rua (R$/L)</th>
              <th class="text-end">Volume</th>
              <th class="text-end">${ehAnual ? 'Ganho Retido (Ano)' : 'Ganho Retido'}</th>
            </tr>
          </thead>
          <tbody>
            ${renderizarLinhasMatrizesFechamento(dados.matrizesGaragem)}
          </tbody>
        </table>
      </div>
    </div>

    <!-- BLOCO 4: VITRINE TÁTICA (CONSOLIDADA POR REDE & DECISÕES DO PERÍODO) -->
    <div class="card-exec-dark mb-3 p-3">
      <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom border-secondary">
        <h6 class="fw-bold mb-0 text-white" style="font-size: 0.85rem;">
          <i class="bi bi-signpost-split-fill text-success me-2"></i>Vitrine Tática: Reduções Negociadas, Manobras & Blindagem
        </h6>
        <span class="badge bg-dark text-white-50 border border-secondary font-monospace" style="font-size: 0.60rem;">
          ${ehAnual ? `Consolidado Executivo ${anoBase}` : 'Negociações Iniciadas na Competência'}
        </span>
      </div>
      <div class="row g-2">
        ${renderizarCardsVitrineTatica(dados.acoesTaticas, ehAnual)}
      </div>
    </div>

    <!-- BLOCO 5: PARECER ESTRATÉGICO DO GESTOR -->
    ${renderizarPareceresGestor(ehAnual, anoBase, mesesDoAno)}

    <!-- BLOCO 6: RESUMO DE NEGOCIAÇÕES ATIVAS DO PERÍODO -->
    <div class="card-exec-dark mb-3 p-3">
      <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom border-secondary">
        <h6 class="fw-bold mb-0 text-white" style="font-size: 0.85rem;">
          <i class="bi bi-table text-secondary me-2"></i>${ehAnual ? `Resumo Consolidado dos Postos Sob Acordo (${anoBase})` : 'Resumo dos Postos Sob Acordo Vigente na Competência'}
        </h6>
        <span class="badge bg-dark text-white-50 border border-secondary font-monospace" style="font-size: 0.60rem;">${dados.tabelaPostosMes.length} postos auditados</span>
      </div>

      <div class="table-responsive">
        <table class="table tabela-fechamento-dark align-middle text-center" style="white-space: nowrap;">
          <thead>
            <tr>
              <th class="text-start" style="min-width: 240px;">Posto / Praça</th>
              <th>UF</th>
              <th>Vigência</th>
              <th class="text-end">Preço Balcão</th>
              <th class="text-end">Preço Negociado</th>
              <th class="text-end">Último Pago</th>
              <th class="text-end">Ref. ANP</th>
              <th class="text-end">Spread vs ANP</th>
              <th class="text-end">Vol. Auditado</th>
              <th class="text-end">Saving vs. ANP</th>
              <th class="text-end">Saving Negociação</th>
            </tr>
          </thead>
          <tbody>
            ${renderizarLinhasTabelaFechamento(dados.tabelaPostosMes)}
          </tbody>
        </table>
      </div>
    </div>

    <!-- BLOCO 7: GOVERNANÇA, GLOSAS & PLANO DE AÇÃO (APENAS CARTEIRA ATIVA RECENTE) -->
    <div class="row g-2">
      <!-- GLOSAS E FUROS A CONTESTAR -->
      <div class="col-12 col-md-6">
        <div class="card-exec-dark glow-vermelho h-100 p-3 d-flex flex-column" style="max-height: 480px;">
          <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom border-secondary flex-shrink-0">
            <h6 class="fw-bold mb-0 text-danger" style="font-size: 0.85rem;">
              <i class="bi bi-exclamation-octagon-fill me-1"></i> Desvios Recentes (${dados.rotuloMesOperacional}): Passíveis de Glosa
            </h6>
            <span class="badge bg-danger font-monospace" style="font-size: 0.60rem;">${dados.postosComFuro.length} desvios</span>
          </div>

          ${dados.postosComFuro.length === 0 
            ? `<div class="p-2 border border-success rounded bg-dark text-success small mb-0"><i class="bi bi-check-circle-fill me-1"></i> Nenhum furo comercial apurado dentro dos 30 dias de vigência em ${dados.rotuloMesOperacional}.</div>` 
            : `<div class="d-flex flex-column gap-2 flex-grow-1" style="min-height: 0; overflow-y: auto; scrollbar-width: thin;">
                ${dados.postosComFuro.map(f => `
                  <div class="p-2 border rounded" style="background: rgba(239, 68, 68, 0.08); border-color: rgba(239, 68, 68, 0.3) !important; font-size: 0.72rem;">
                    <div class="d-flex justify-content-between">
                      <strong class="text-white">${f.posto} (${f.uf})</strong>
                      <span class="badge bg-danger font-monospace">+R$ ${f.gap.toFixed(3)}/L</span>
                    </div>
                    <div class="text-white-50 mt-1">
                      Acordado: R$ ${f.precoAcordado.toFixed(3)} (Vigência: ${f.vigenciaFmt}) | Pago nos ciclos com furo: <strong class="text-danger">R$ ${f.precoPagoFuro.toFixed(3)}</strong>
                    </div>
                    <div class="text-danger fw-bold mt-1">
                      Desvio financeiro total: R$ ${Math.round(f.impactoReais).toLocaleString('pt-BR')} (sobre ${Math.round(f.volumeFuro).toLocaleString('pt-BR')} L faturados acima)
                    </div>
                  </div>
                `).join('')}
              </div>`
          }
        </div>
      </div>

      <!-- SLA DE RENOVAÇÃO PARA O PRÓXIMO MÊS -->
      <div class="col-12 col-md-6">
        <div class="card-exec-dark glow-laranja h-100 p-3 d-flex flex-column" style="max-height: 480px;">
          <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom border-secondary flex-shrink-0">
            <h6 class="fw-bold mb-0 text-warning" style="font-size: 0.85rem;">
              <i class="bi bi-clock-history text-warning me-1"></i> Foco de Compras: Renovar Negociação (SLA > 30d)
            </h6>
            <span class="badge bg-warning text-dark font-monospace" style="font-size: 0.60rem;">${dados.postosParaRenovar.length} acordos ativos</span>
          </div>

          ${dados.postosParaRenovar.length === 0 
            ? `<div class="p-2 border border-secondary rounded bg-dark text-white-50 small mb-0"><i class="bi bi-shield-check text-success me-1"></i> Todas as tabelas ativas com consumo recente estão dentro do SLA de 30 dias.</div>` 
            : `<div class="d-flex flex-column gap-2 flex-grow-1" style="min-height: 0; overflow-y: auto; scrollbar-width: thin;">
                ${dados.postosParaRenovar.map(p => `
                  <div class="p-2 border rounded d-flex justify-content-between align-items-center" style="background: rgba(245, 158, 11, 0.08); border-color: rgba(245, 158, 11, 0.3) !important; font-size: 0.72rem;">
                    <div>
                      <strong class="text-white d-block">${p.posto} (${p.uf})</strong>
                      <span class="text-white-50">Vigência: ${p.dataVigenciaFmt} (+${p.diasDecorridos} dias rodando) &bull; Último abast.: ${p.ultimoAbastFmt}</span>
                    </div>
                    <span class="badge bg-warning text-dark font-monospace">Renovar Mesa</span>
                  </div>
                `).join('')}
              </div>`
          }
        </div>
      </div>
    </div>
  `;

  vincularTooltipsCardsFechamento();
  renderizarGraficoEvolucaoSavings();
}

/**
 * Renderização Elegante do Parecer Executivo do Gestor
 */
function escaparHtmlParecer(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, caractere => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[caractere]);
}

function obterChaveFirestoreParecerAtivo() {
  if (competenciaFechamentoAtiva === 'YTD') {
    const ano = obterAnoBaseFechamento();
    return `YTD_${ano || new Date().getFullYear()}`;
  }
  return competenciaFechamentoAtiva;
}

function renderizarPareceresGestor(ehAnual = false, anoBase = '', mesesDoAno = []) {
  let pareceres = [];

  if (ehAnual) {
    const chaveAnual = `YTD_${anoBase}`;
    (cachePareceresGestor[chaveAnual] || []).forEach(p => {
      pareceres.push({ ...p, origemCompetencia: `Consolidado ${anoBase}` });
    });

    [...mesesDoAno].reverse().forEach(mes => {
      (cachePareceresGestor[mes] || []).forEach(p => {
        pareceres.push({ ...p, origemCompetencia: formatarRotuloCompetencia(mes) });
      });
      if (cacheDossieMes[mes]) {
        pareceres.push({
          titulo: `Observação da gestão (${formatarRotuloCompetencia(mes)})`,
          subtitulo: 'Registro salvo no formato anterior de parecer',
          texto: cacheDossieMes[mes],
          indicadores: [],
          origemCompetencia: formatarRotuloCompetencia(mes)
        });
      }
    });
  } else {
    pareceres = [...(cachePareceresGestor[competenciaFechamentoAtiva] || [])];
    const notaLegada = cacheDossieMes[competenciaFechamentoAtiva] || '';
    if (notaLegada) {
      pareceres.unshift({
        titulo: 'Observação anterior da gestão',
        subtitulo: 'Registro salvo no formato anterior de parecer',
        texto: notaLegada,
        indicadores: []
      });
    }
  }

  const cards = pareceres.map(parecer => {
    const indicadores = (parecer.indicadores || []).map(indicador => {
      const valor = Number(indicador.valor);
      const valorFormatado = Number.isFinite(valor)
        ? valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : '--';
      return `
        <div class="parecer-manual-indicador">
          <div class="text-white-50 text-uppercase" style="font-size: 0.58rem; font-weight: 700;">${escaparHtmlParecer(indicador.titulo)}</div>
          <div class="parecer-manual-valor font-monospace">${valorFormatado}</div>
        </div>
      `;
    }).join('');
    const dataRegistro = parecer.criadoEm ? new Date(parecer.criadoEm).toLocaleDateString('pt-BR') : '';
    const tagCompetencia = parecer.origemCompetencia
      ? `<span class="badge bg-dark text-warning border border-warning-subtle ms-1" style="font-size: 0.56rem;">${escaparHtmlParecer(parecer.origemCompetencia)}</span>`
      : '';

    return `
      <div class="col-12">
        <article class="parecer-manual-card">
          <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
            <div class="min-w-0">
              <span class="badge text-dark mb-1" style="background: #eab308; font-size: 0.58rem;">PARECER DA GESTÃO</span>${tagCompetencia}
              <h6 class="fw-bold text-white mb-1">${escaparHtmlParecer(parecer.titulo)}</h6>
              <div class="parecer-manual-subtitulo">${escaparHtmlParecer(parecer.subtitulo)}</div>
            </div>
            ${dataRegistro ? `<span class="text-white-50 text-nowrap" style="font-size: 0.62rem;">${escaparHtmlParecer(dataRegistro)}</span>` : ''}
          </div>
          <div class="parecer-manual-texto">${escaparHtmlParecer(parecer.texto)}</div>
          ${indicadores ? `<div class="d-flex flex-wrap gap-2 mt-3 pt-2 border-top border-secondary">${indicadores}</div>` : ''}
        </article>
      </div>
    `;
  }).join('');

  return `
    <section class="mb-3">
      <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom border-secondary">
        <div>
          <h6 class="fw-bold text-white mb-0"><i class="bi bi-chat-square-text text-warning me-2"></i>Pareceres da Gestão</h6>
          <span class="small text-white-50" style="font-size: 0.68rem;">Análises complementares registradas manualmente para ${escaparHtmlParecer(formatarRotuloCompetencia(competenciaFechamentoAtiva))}</span>
        </div>
        <span class="badge bg-dark text-warning border border-warning-subtle font-monospace" style="font-size: 0.60rem;">${pareceres.length} pareceres</span>
      </div>
      ${cards ? `<div class="row g-2">${cards}</div>` : `<div class="small text-white-50 py-2 dossie-pareceres-vazio">Nenhum parecer registrado para este período.</div>`}
    </section>
  `;
}

/**
 * Abertura e População do Modal do Dossiê
 */
function abrirModalParecer() {
  const formulario = document.getElementById('formParecerGestor');
  const listaIndicadores = document.getElementById('listaIndicadoresParecer');
  const competencia = document.getElementById('parecerInfoCompetencia');
  if (!formulario || !listaIndicadores) return;

  formulario.reset();
  listaIndicadores.innerHTML = '';
  adicionarIndicadorParecer();
  if (competencia) competencia.innerText = `Competência: ${formatarRotuloCompetencia(competenciaFechamentoAtiva)}`;

  const modalEl = document.getElementById('modalParecerGestor');
  if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function adicionarIndicadorParecer() {
  const lista = document.getElementById('listaIndicadoresParecer');
  if (!lista) return;

  const linha = document.createElement('div');
  linha.className = 'row g-2 align-items-center mb-2 item-indicador-parecer';
  linha.innerHTML = `
    <div class="col-12 col-md-7">
      <input class="form-control form-control-sm campo-indicador-titulo" required maxlength="60" aria-label="Nome do indicador de saving" placeholder="Ex.: Saving realizado no mês">
    </div>
    <div class="col-9 col-md-4">
      <div class="input-group input-group-sm">
        <span class="input-group-text">R$</span>
        <input class="form-control campo-indicador-valor" type="number" step="0.01" required aria-label="Valor do indicador em reais" placeholder="0,00">
      </div>
    </div>
    <div class="col-3 col-md-1 text-end">
      <button type="button" class="btn btn-sm btn-outline-secondary" onclick="removerIndicadorParecer(this)" title="Remover indicador" aria-label="Remover indicador">
        <i class="bi bi-trash"></i>
      </button>
    </div>
  `;
  lista.appendChild(linha);
}

function removerIndicadorParecer(botao) {
  const linha = botao.closest('.item-indicador-parecer');
  const linhas = document.querySelectorAll('#listaIndicadoresParecer .item-indicador-parecer');
  if (!linha) return;

  if (linhas.length === 1) linha.querySelectorAll('input').forEach(campo => { campo.value = ''; });
  else linha.remove();
}

function serializarParecerFirestore(parecer) {
  const stringValue = valor => ({ stringValue: valor });
  return {
    mapValue: {
      fields: {
        titulo: stringValue(parecer.titulo),
        subtitulo: stringValue(parecer.subtitulo),
        texto: stringValue(parecer.texto),
        criado_em: { timestampValue: parecer.criadoEm },
        autor: stringValue(parecer.autor),
        indicadores: {
          arrayValue: {
            values: parecer.indicadores.map(indicador => ({
              mapValue: {
                fields: {
                  titulo: stringValue(indicador.titulo),
                  valor: { doubleValue: indicador.valor }
                }
              }
            }))
          }
        }
      }
    }
  };
}

async function salvarParecerGestor(event) {
  event.preventDefault();
  const formulario = document.getElementById('formParecerGestor');
  const botao = document.getElementById('btnSalvarParecer');
  if (!formulario || !botao || !formulario.reportValidity()) return;

  const chaveDoc = obterChaveFirestoreParecerAtivo();
  const indicadores = Array.from(document.querySelectorAll('#listaIndicadoresParecer .item-indicador-parecer')).map(linha => ({
    titulo: linha.querySelector('.campo-indicador-titulo').value.trim(),
    valor: linha.querySelector('.campo-indicador-valor').valueAsNumber
  }));
  const parecer = {
    titulo: document.getElementById('campoParecerTitulo').value.trim(),
    subtitulo: document.getElementById('campoParecerSubtitulo').value.trim(),
    texto: document.getElementById('campoParecerTexto').value.trim(),
    indicadores,
    criadoEm: new Date().toISOString(),
    autor: (typeof utilizadorAutenticado !== 'undefined' && utilizadorAutenticado?.email) || 'Gestor'
  };
  const pareceresAtualizados = [...(cachePareceresGestor[chaveDoc] || []), parecer];
  const token = (typeof utilizadorAutenticado !== 'undefined' && utilizadorAutenticado) ? utilizadorAutenticado.idToken : '';

  botao.disabled = true;
  botao.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Salvando...`;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const resp = await fetch(`${FIRESTORE_BASE_DOSSIE}/${chaveDoc}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        fields: {
          mes_ano: { stringValue: chaveDoc },
          pareceres: { arrayValue: { values: pareceresAtualizados.map(serializarParecerFirestore) } },
          atualizado_em: { timestampValue: parecer.criadoEm }
        }
      })
    });
    if (!resp.ok) throw new Error(`Erro HTTP ${resp.status}`);

    cachePareceresGestor[chaveDoc] = pareceresAtualizados;
    mesesDossieCarregados.add(chaveDoc);
    const modalEl = document.getElementById('modalParecerGestor');
    const instancia = modalEl ? bootstrap.Modal.getInstance(modalEl) : null;
    if (instancia) instancia.hide();
    await renderizarAbaFechamentoExecutivo();
  } catch (err) {
    alert(`Falha ao salvar parecer: ${err.message}`);
  } finally {
    botao.disabled = false;
    botao.innerHTML = `<i class="bi bi-check-circle me-1"></i> Salvar Parecer`;
  }
}

/**
 * Renderização das Linhas da Tabela de Postos Auditados
 */
function renderizarLinhasTabelaFechamento(linhas) {
  if (!linhas || linhas.length === 0) {
    return `<tr><td colspan="11" style="color: #94a3b8 !important; padding: 16px;">Nenhum posto faturado com acordo ativo no período selecionado.</td></tr>`;
  }

  return linhas.map(l => {
    const corSpread = l.refAnp > 0 ? (l.spreadAnp < 0 ? '#4ade80' : (l.spreadAnp > 0 ? '#f87171' : '#94a3b8')) : '#94a3b8';
    const sinalSpread = l.spreadAnp > 0 ? '+' : '';

    return `
      <tr>
        <td class="text-start fw-bold text-truncate" style="color: #f8fafc !important; max-width: 250px;" title="${l.posto}">
          ${l.posto}
        </td>
        <td>
          <span class="badge bg-dark text-white border border-secondary font-monospace" style="color: #ffffff !important;">${l.uf}</span>
        </td>
        <td class="font-monospace" style="color: #94a3b8 !important;">${l.vigenciaFmt}</td>
        <td class="text-end font-monospace" style="color: #94a3b8 !important;">
          ${l.precoProposto > 0 ? `R$ ${l.precoProposto.toFixed(3)}` : '--'}
        </td>
        <td class="text-end font-monospace fw-bold" style="color: #f8fafc !important;">
          ${l.precoAcordado > 0 ? `R$ ${l.precoAcordado.toFixed(3)}` : '--'}
        </td>
        <td class="text-end font-monospace" style="color: #cbd5e1 !important;">
          ${l.ultimoPrecoBomba > 0 ? `R$ ${l.ultimoPrecoBomba.toFixed(3)}` : '--'}
        </td>
        <td class="text-end font-monospace fw-bold" style="color: #38bdf8 !important;">
          ${l.refAnp > 0 ? `R$ ${l.refAnp.toFixed(3)}` : '<span class="badge bg-secondary font-monospace" style="font-size:0.55rem;">Sem ANP</span>'}
        </td>
        <td class="text-end font-monospace fw-bold" style="color: ${corSpread} !important;">
          ${l.refAnp > 0 ? `${sinalSpread}R$ ${l.spreadAnp.toFixed(3)}` : '--'}
        </td>
        <td class="text-end font-monospace fw-bold" style="color: #f8fafc !important;">
          ${Math.round(l.volume).toLocaleString('pt-BR')} L
        </td>
        <td class="text-end font-monospace fw-bold" style="color: #4ade80 !important;">
          ${l.hardSaving > 0 ? `+ R$ ${Math.round(l.hardSaving).toLocaleString('pt-BR')}` : '--'}
        </td>
        <td class="text-end font-monospace fw-bold" style="color: #4ade80 !important;">
          ${l.savingNegociacao > 0 ? `+ R$ ${Math.round(l.savingNegociacao).toLocaleString('pt-BR')}` : '--'}
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Renderização das Linhas da Tabela de Matrizes (Garagens)
 */
function renderizarLinhasMatrizesFechamento(linhas) {
  if (!linhas || linhas.length === 0) {
    return `<tr><td colspan="9" style="color: #94a3b8 !important; padding: 14px;">Sem registros de abastecimento interno para este período.</td></tr>`;
  }

  return linhas.map(g => {
    const corEfic = g.refDist > 0 ? (g.varDistPerc <= 0 ? '#4ade80' : '#f87171') : '#94a3b8';
    const sinalEfic = g.varDistPerc > 0 ? '+' : '';
    const corSpread = g.precoRuaUf > 0 ? (g.spreadRua >= 0 ? '#4ade80' : '#f87171') : '#94a3b8';

    let celulaRuaHtml = '';
    if (g.precoRuaUf > 0) {
      celulaRuaHtml = `<span class="font-monospace text-white">R$ ${g.precoRuaUf.toFixed(3)}</span>`;
    } else {
      celulaRuaHtml = `<span class="text-white-50 font-monospace" title="Sem compras externas comparáveis na UF neste período">Sem compra externa</span>`;
    }

    return `
      <tr>
        <td class="text-start fw-bold" style="color: #f8fafc !important;">${g.nome}</td>
        <td><span class="badge bg-dark text-white border border-secondary font-monospace">${g.uf}</span></td>
        <td class="text-end font-monospace fw-bold" style="color: #f8fafc !important;">R$ ${g.custoGaragem.toFixed(3)}</td>
        <td class="text-end font-monospace text-primary">${g.refDist > 0 ? `R$ ${g.refDist.toFixed(3)}` : '<span class="text-white-50 font-monospace" style="font-size:0.60rem;">--</span>'}</td>
        <td class="text-end font-monospace fw-bold" style="color: ${corEfic} !important;">
          ${g.refDist > 0 ? `${sinalEfic}${g.varDistPerc.toFixed(2).replace('.', ',')}%` : '--'}
        </td>
        <td class="text-end">${celulaRuaHtml}</td>
        <td class="text-end font-monospace fw-bold" style="color: ${corSpread} !important;">
          ${g.precoRuaUf > 0 ? `${g.spreadRua > 0 ? '+' : (g.spreadRua < 0 ? '-' : '')} R$ ${Math.abs(g.spreadRua).toFixed(3)}` : '--'}
        </td>
        <td class="text-end font-monospace text-white">${Math.round(g.volume).toLocaleString('pt-BR')} L</td>
        <td class="text-end font-monospace fw-bold" style="color: ${g.ganhoTotal >= 0 ? '#4ade80' : '#f87171'} !important;">
          ${g.ganhoTotal > 0 ? '+' : (g.ganhoTotal < 0 ? '-' : '')} R$ ${Math.round(Math.abs(g.ganhoTotal)).toLocaleString('pt-BR')}
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Renderização dos Cards da Vitrine Tática (Suporta Card Consolidado por Rede e Cards Individuais)
 */
function renderizarCardsVitrineTatica(acoes, ehAnual = false) {
  if (!acoes || acoes.length === 0) {
    return `
      <div class="col-12">
        <div class="p-2 border border-secondary rounded bg-dark text-white-50 small mb-0">
          Nenhuma redução negociada, manobra de rota ou ação tática registrada neste período.
        </div>
      </div>
    `;
  }

  return acoes.map(a => {
    // CARD CONSOLIDADO POR REDE (TABELA COMPACTA EXECUTIVA — LIMITA TOP 5 NO MODO ANUAL)
    if (a.tipo === 'REDUCAO_REDE' && Array.isArray(a.itens)) {
      const limiteItens = ehAnual ? 5 : a.itens.length;
      const itensExibidos = a.itens.slice(0, limiteItens);
      const itensRestantes = a.itens.slice(limiteItens);

      const linhasRede = itensExibidos.map(it => `
        <tr>
          <td class="text-start text-white fw-semibold text-truncate" style="max-width: 215px;" title="${it.posto}">
            <span class="badge bg-dark text-white-50 border border-secondary font-monospace me-1" style="font-size: 0.55rem;">${it.uf}</span>${it.posto}
          </td>
          <td class="text-end font-monospace text-white-50">
            R$ ${it.precoBase.toFixed(3)} &rarr; <strong class="text-white">R$ ${it.precoNeg.toFixed(3)}</strong>
            <span class="text-success fw-bold ms-1">(-${it.diff.toFixed(3)})</span>
          </td>
          <td class="text-end font-monospace text-white-50">
            ${it.volRef > 0 ? `${Math.round(it.volRef).toLocaleString('pt-BR')} L` : '--'}
          </td>
          <td class="text-end font-monospace fw-bold text-success">
            ${it.impactoMensal > 0 ? `+ R$ ${Math.round(it.impactoMensal).toLocaleString('pt-BR')}` : '--'}
          </td>
        </tr>
      `).join('');

      let linhaResumoRestante = '';
      if (itensRestantes.length > 0) {
        const volRestante = itensRestantes.reduce((acc, it) => acc + (it.volRef || 0), 0);
        const impactoRestante = itensRestantes.reduce((acc, it) => acc + (it.impactoMensal || 0), 0);
        linhaResumoRestante = `
          <tr>
            <td colspan="2" class="text-start text-white-50 fst-italic">
              + ${itensRestantes.length} demais ${itensRestantes.length === 1 ? 'posto da rede' : 'postos da rede'}
            </td>
            <td class="text-end font-monospace text-white-50">${volRestante > 0 ? `${Math.round(volRestante).toLocaleString('pt-BR')} L` : '--'}</td>
            <td class="text-end font-monospace fw-bold text-success">${impactoRestante > 0 ? `+ R$ ${Math.round(impactoRestante).toLocaleString('pt-BR')}` : '--'}</td>
          </tr>
        `;
      }

      return `
        <div class="col-12 col-xl-6">
          <div class="p-2 border rounded h-100 d-flex flex-column justify-content-between glow-verde"
            style="background: #111827; border-color: rgba(74, 222, 128, 0.35) !important;">
            <div>
              <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="badge bg-success" style="font-size: 0.58rem;">REDUÇÃO NA MESA • REDE</span>
                <span class="text-white-50 font-monospace" style="font-size: 0.60rem;">${a.itens.length} ${a.itens.length === 1 ? 'posto' : 'postos'}</span>
              </div>
              <strong class="text-white small d-block">${a.titulo}</strong>
              <div class="table-responsive">
                <table class="tabela-vitrine-rede">
                  <thead>
                    <tr>
                      <th class="text-start">Posto</th>
                      <th class="text-end">De &rarr; Para (Desc.)</th>
                      <th class="text-end">Vol. Base</th>
                      <th class="text-end">Proj./Mês</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${linhasRede}
                    ${linhaResumoRestante}
                  </tbody>
                </table>
              </div>
            </div>
            <div class="mt-2 pt-1 border-top border-secondary d-flex justify-content-between align-items-center font-monospace fw-bold text-success" style="font-size: 0.70rem;">
              <span>${a.volumeTotal > 0 ? `Base: ${Math.round(a.volumeTotal).toLocaleString('pt-BR')} L/mês` : 'Total Consolidado'}</span>
              <span>${a.impacto}</span>
            </div>
          </div>
        </div>
      `;
    }

    // CARDS INDIVIDUAIS OU RESUMO CONSOLIDADO ANUAL
    const ehNegativo = a.impacto.includes('- R$') || a.impacto.includes('Acréscimo');
    const classeGlow = ehNegativo ? 'glow-vermelho' : (a.tipo === 'BLINDAGEM' ? 'glow-azul' : 'glow-verde');
    const corBorda = ehNegativo
      ? 'rgba(248, 113, 113, 0.4) !important'
      : (a.tipo === 'BLINDAGEM' ? 'rgba(56, 189, 248, 0.35) !important' : 'rgba(74, 222, 128, 0.35) !important');
    const corTexto = ehNegativo ? 'text-danger' : (a.tipo === 'BLINDAGEM' ? 'text-info' : 'text-success');

    let badgeClasse = 'bg-primary';
    let badgeRotulo = 'COST AVOIDANCE';
    if (a.tipo === 'BLOQUEIO') {
      badgeClasse = ehNegativo ? 'bg-danger' : 'bg-success';
      badgeRotulo = 'MANOBRA DE ROTA';
    } else if (a.tipo === 'REDUCAO_MESA') {
      badgeClasse = 'bg-success';
      badgeRotulo = 'REDUÇÃO NA MESA';
    } else if (a.tipo === 'RESUMO_AVULSOS') {
      badgeClasse = 'bg-success';
      badgeRotulo = 'CARTEIRA AVULSA';
    }

    return `
      <div class="col-12 col-md-6">
        <div class="p-2 border rounded h-100 d-flex flex-column justify-content-between ${classeGlow}" 
          style="background: #111827; border-color: ${corBorda};">
          <div>
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="badge ${badgeClasse}" style="font-size: 0.58rem;">
                ${badgeRotulo}
              </span>
            </div>
            <strong class="text-white small d-block mb-1">${a.titulo}</strong>
            <div class="text-white-50" style="font-size: 0.72rem; line-height: 1.35;">${a.descricao}</div>
          </div>
          <div class="mt-2 pt-1 border-top border-secondary font-monospace fw-bold ${corTexto}" style="font-size: 0.70rem;">
            ${a.impacto}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Renderização do Gráfico Misto ApexCharts (Curva de Eficiência & Descolamento ANP)
 */
function renderizarGraficoEvolucaoSavings() {
  const container = document.getElementById('graficoEvolucaoSavings');
  if (!container) return;

  if (graficoEvolucaoInstancia) {
    try { graficoEvolucaoInstancia.destroy(); } catch(e){}
  }

  const anoBase = obterAnoBaseFechamento();
  const mesesDisponiveis = [...new Set(baseRegistrosMensais.map(r => r.MES_ANO).filter(m => m && (!anoBase || m.startsWith(`${anoBase}-`))))].sort();
  
  const seriesHardSaving = [];
  const seriesSpreadAnp = [];

  mesesDisponiveis.forEach(m => {
    const regsMes = baseRegistrosMensais.filter(r => r.MES_ANO === m);
    let savingMes = 0;
    let volumeMes = 0;
    let gastoMes = 0;
    let gastoComAnpMes = 0;
    let somaAnpMes = 0;
    let volumeComAnp = 0;

    regsMes.forEach(r => {
      const v = parseFloat(r.VOLUME_CICLO || 0);
      const p = parseFloat(r.VALOR_UNITARIO || 0);
      const refAnp = obterReferenciaAnpFechamento(r, m);

      volumeMes += v;
      gastoMes += (p * v);
      if (refAnp > 0 && p > 0 && v > 0) {
        somaAnpMes += (refAnp * v);
        volumeComAnp += v;
        gastoComAnpMes += (p * v);
        if (p < refAnp) {
          savingMes += ((refAnp - p) * v);
        }
      }
    });

    const anpMedioFrota = volumeComAnp > 0 ? (somaAnpMes / volumeComAnp) : 0;
    const precoMedioComAnp = volumeComAnp > 0 ? (gastoComAnpMes / volumeComAnp) : 0;
    const spreadMedio = (precoMedioComAnp > 0 && anpMedioFrota > 0) ? (precoMedioComAnp - anpMedioFrota) : 0;

    seriesHardSaving.push(Math.round(savingMes));
    seriesSpreadAnp.push(parseFloat(spreadMedio.toFixed(3)));
  });

  const nomesMesAbrev = {
    '01': 'Jan', '02': 'Fev', '03': 'Mar', '04': 'Abr',
    '05': 'Mai', '06': 'Jun', '07': 'Jul', '08': 'Ago',
    '09': 'Set', '10': 'Out', '11': 'Nov', '12': 'Dez'
  };

  const categorias = mesesDisponiveis.map(m => {
    const [ano, mes] = m.split('-');
    return `${nomesMesAbrev[mes] || mes}/${ano.slice(-2)}`;
  });

  const options = {
    series: [
      {
        name: 'Hard Saving Real (R$)',
        type: 'column',
        data: seriesHardSaving
      },
      {
        name: 'Spread vs ANP (R$/L)',
        type: 'line',
        data: seriesSpreadAnp
      }
    ],
    chart: {
      height: 230,
      type: 'line',
      toolbar: { show: false },
      background: 'transparent'
    },
    theme: { mode: 'dark' },
    colors: ['#22c55e', '#38bdf8'],
    stroke: {
      width: [0, 3],
      curve: 'smooth'
    },
    markers: {
      size: [0, 4],
      colors: ['#22c55e', '#38bdf8'],
      strokeColors: '#0f172a',
      strokeWidth: 2,
      hover: {
        size: 6
      }
    },
    dataLabels: {
      enabled: true,
      enabledOnSeries: [0, 1],
      formatter: function (val, opts) {
        if (val === null || val === undefined) return '';
        if (opts.seriesIndex === 0) {
          if (val === 0) return '';
          return val >= 1000 ? `R$ ${(val / 1000).toFixed(0)}k` : `R$ ${Math.round(val)}`;
        }
        return (val >= 0 ? '+' : '') + Number(val).toFixed(2);
      },
      style: {
        fontSize: '10px',
        fontWeight: 'bold',
        colors: ['#86efac', '#7dd3fc']
      },
      background: {
        enabled: true,
        foreColor: '#0f172a',
        padding: 3,
        borderRadius: 3,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.1)',
        opacity: 0.85
      }
    },
    plotOptions: {
      bar: {
        columnWidth: '40%',
        borderRadius: 4,
        dataLabels: {
          position: 'top'
        }
      }
    },
    fill: {
      opacity: [0.85, 1],
      gradient: {
        inverseColors: false,
        shade: 'dark',
        type: "vertical",
        opacityFrom: 0.9,
        opacityTo: 0.3
      }
    },
    xaxis: {
      categories: categorias,
      axisBorder: { color: '#334155' },
      axisTicks: { color: '#334155' },
      labels: { style: { colors: '#94a3b8', fontSize: '11px' } }
    },
    yaxis: [
      {
        title: { text: 'Saving (R$)', style: { color: '#22c55e', fontSize: '11px' } },
        labels: {
          style: { colors: '#94a3b8', fontSize: '10px' },
          formatter: (v) => 'R$ ' + (v / 1000).toFixed(0) + 'k'
        }
      },
      {
        opposite: true,
        title: { text: 'Spread vs ANP (R$/L)', style: { color: '#38bdf8', fontSize: '11px' } },
        labels: {
          style: { colors: '#94a3b8', fontSize: '10px' },
          formatter: (v) => (v >= 0 ? '+' : '') + v.toFixed(2)
        }
      }
    ],
    grid: {
      borderColor: 'rgba(255, 255, 255, 0.05)',
      strokeDashArray: 3
    },
    legend: {
      show: true,
      position: 'top',
      horizontalAlign: 'right',
      labels: { colors: '#cbd5e1' },
      markers: {
        width: 10,
        height: 10,
        radius: 12,
        fillColors: ['#22c55e', '#38bdf8']
      },
      itemMargin: {
        horizontal: 8,
        vertical: 4
      }
    },
    tooltip: {
      theme: 'dark',
      shared: true,
      intersect: false,
      y: {
        formatter: function (y, { seriesIndex }) {
          if (seriesIndex === 0) return 'R$ ' + Math.round(y).toLocaleString('pt-BR');
          return (y >= 0 ? '+' : '') + 'R$ ' + y.toFixed(3) + '/L';
        }
      }
    }
  };

  graficoEvolucaoInstancia = new ApexCharts(container, options);
  graficoEvolucaoInstancia.render();
}

/**
 * Motor de Cálculo Matemático e Agrupamento (Suporta Competência Mensal e Ano Completo YTD)
 */
function calcularMetricasFechamento(competenciaAlvo) {
  const ehModoAnual = competenciaAlvo === 'YTD';
  const anoBase = obterAnoBaseFechamento();
  const mesesBaseAno = [...new Set(baseRegistrosMensais.map(r => r.MES_ANO).filter(m => m && (!anoBase || m.startsWith(`${anoBase}-`))))].sort();
  const mesMaisRecenteAno = mesesBaseAno[mesesBaseAno.length - 1] || '';
  const mesOperacionalRef = ehModoAnual ? mesMaisRecenteAno : competenciaAlvo;
  const rotuloMesOperacional = formatarRotuloCompetencia(mesOperacionalRef);
  const rotuloMesMaisRecenteAno = formatarRotuloCompetencia(mesMaisRecenteAno);

  const regsPeriodo = ehModoAnual
    ? baseRegistrosMensais.filter(r => r.MES_ANO && (!anoBase || r.MES_ANO.startsWith(`${anoBase}-`)))
    : baseRegistrosMensais.filter(r => r.MES_ANO === competenciaAlvo);

  const mapaTrat = (typeof mapaTratativasCadastradas !== 'undefined') ? mapaTratativasCadastradas : {};

  let volumeTotalMes = 0;
  let valorTotalGastoMes = 0;
  let hardSavingTotalMes = 0;
  let somaAnpPonderada = 0;
  let volumePonderadoAnp = 0;
  let valorPonderadoAnp = 0;

  regsPeriodo.forEach(r => {
    const v = parseFloat(r.VOLUME_CICLO || 0);
    const p = parseFloat(r.VALOR_UNITARIO || 0);
    const vt = parseFloat(r.VALOR_TOTAL_CICLO || (v * p));
    volumeTotalMes += v;
    valorTotalGastoMes += vt;

    const refAnp = obterReferenciaAnpFechamento(r, r.MES_ANO);
    if (refAnp > 0 && p > 0 && v > 0) {
      somaAnpPonderada += (refAnp * v);
      valorPonderadoAnp += (p * v);
      volumePonderadoAnp += v;
      if (p < refAnp) hardSavingTotalMes += ((refAnp - p) * v);
    }
  });

  const custoMedioFrotaMes = volumeTotalMes > 0 ? (valorTotalGastoMes / volumeTotalMes) : 0;
  const anpMediaPonderadaMes = volumePonderadoAnp > 0 ? (somaAnpPonderada / volumePonderadoAnp) : 0;
  const custoMedioComAnpMes = volumePonderadoAnp > 0 ? (valorPonderadoAnp / volumePonderadoAnp) : 0;
  const spreadMedioMes = volumePonderadoAnp > 0 ? (custoMedioComAnpMes - anpMediaPonderadaMes) : 0;
  const operacaoVerde = volumePonderadoAnp > 0 ? spreadMedioMes <= 0 : null;

  let costAvoidanceMes = 0;
  let savingNegociacaoRealizadoMes = 0;
  let savingNegociacaoContratadoMes = 0;
  let volumeSobAcordoMes = 0;
  let qtdPostosAcordadosAtivos = 0;

  const tabelaPostosMes = [];
  const postosComFuro = [];
  const postosParaRenovar = [];
  const acoesTaticas = [];
  const gruposReducaoRede = {};
  const reducoesAvulsas = [];
  const detalhesCostAvoidance = [];
  const detalhesRunRate = [];
  const manobrasAno = [];

  const postosProcessadosSet = new Set();
  const dataLimitePeriodo = mesOperacionalRef ? obterDataFimCompetencia(mesOperacionalRef) : '';

  Object.keys(mapaTrat).forEach(docId => {
    const trat = mapaTrat[docId];
    if (!trat) return;

    const nomePosto = trat.posto;
    const ufPosto = trat.uf;
    const chaveUnica = `${nomePosto}_${ufPosto}`;
    if (postosProcessadosSet.has(chaveUnica)) return;
    postosProcessadosSet.add(chaveUnica);

    const fichaDecisaoPeriodo = dataLimitePeriodo ? obterFichaTratativaAteData(trat, dataLimitePeriodo) : null;
    const statusTratativaPeriodo = fichaDecisaoPeriodo?.status || '';
    const vigenciaDecisaoPeriodo = fichaDecisaoPeriodo?.vigencia || '';
    const mesVigenciaDecisao = vigenciaDecisaoPeriodo ? vigenciaDecisaoPeriodo.substring(0, 7) : '';

    // Coleta reduções fechadas com vigência no período (mês consultado ou qualquer mês do ano no modo YTD)
    const condicaoVigenciaReducao = ehModoAnual
      ? (mesVigenciaDecisao && (!anoBase || mesVigenciaDecisao.startsWith(`${anoBase}-`)))
      : (mesVigenciaDecisao === competenciaAlvo);

    if (statusTratativaPeriodo === 'ACORDO_FECHADO' && condicaoVigenciaReducao && Number(fichaDecisaoPeriodo?.preco) > 0) {
      const precoNegMesa = Number(fichaDecisaoPeriodo.preco);
      const precoBaseMesa = obterPrecoBaseFichaFechamento(fichaDecisaoPeriodo, nomePosto, ufPosto);
      const volRefMesa = obterVolumeRefFichaFechamento(fichaDecisaoPeriodo, nomePosto, ufPosto);

      if (precoBaseMesa > precoNegMesa) {
        const diffMesa = precoBaseMesa - precoNegMesa;
        const impactoMensalMesa = diffMesa * (volRefMesa > 0 ? volRefMesa : 0);
        savingNegociacaoContratadoMes += impactoMensalMesa;

        const redeNome = obterRedePostoFechamento(nomePosto);
        const itemReducao = {
          posto: nomePosto,
          uf: ufPosto,
          vigencia: vigenciaDecisaoPeriodo,
          precoBase: precoBaseMesa,
          precoNeg: precoNegMesa,
          diff: diffMesa,
          volRef: volRefMesa,
          impactoMensal: impactoMensalMesa
        };

        if (impactoMensalMesa > 0) {
          detalhesRunRate.push(itemReducao);
        }

        if (redeNome) {
          if (!gruposReducaoRede[redeNome]) gruposReducaoRede[redeNome] = [];
          gruposReducaoRede[redeNome].push(itemReducao);
        } else {
          reducoesAvulsas.push(itemReducao);
        }
      }
    }

    const regsPostoPeriodo = regsPeriodo.filter(r => r.POSTO === nomePosto && r.UF_POSTO === ufPosto);
    const transacoesAcordadasPeriodo = regsPostoPeriodo.map(registro => ({
      registro,
      ficha: obterFichaTratativaAteData(trat, (registro.DATA_FIM_CICLO || '').substring(0, 10))
    })).filter(item => item.ficha?.status === 'ACORDO_FECHADO' && Number(item.ficha.preco) > 0);

    let volPostoPeriodo = 0;
    let ultimoPrecoBomba = 0;
    let dataUltimoBomba = "";
    let mesUltimoBomba = "";
    let hardSavingPosto = 0;
    let savingNegociacaoPosto = 0;
    let costAvoidancePosto = 0;
    let volAvoidancePosto = 0;
    let precoPropostoAvoidance = 0;
    let precoAcordadoAvoidance = 0;
    let fichaUltimoConsumo = null;

    // Variáveis isoladas para apuração de furo conforme regra exata da Auditoria Comercial:
    // 1) Pertence à vigência atual/mais recente do posto (fichaDecisaoPeriodo.vigencia)
    // 2) gapAcordo > 0.005
    // 3) diasDecorridos <= 30 (após 30d é Acordo Vencido / Renovação)
    // 4) gapAnp >= -0.05 (se gapAnp < -0.05 é Margem Preservada / Blindado)
    let impactoFuroMesRef = 0;
    let volFuroMesRef = 0;
    let valorPagoFuroMesRef = 0;
    let precoAcordadoFuroMesRef = 0;
    let vigenciaFuroMesRef = '';
    const vigenciaAtualMaisRecente = (fichaDecisaoPeriodo?.vigencia || '').substring(0, 10);

    transacoesAcordadasPeriodo.forEach(({ registro: r, ficha }) => {
      const v = parseFloat(r.VOLUME_CICLO || 0);
      const p = parseFloat(r.VALOR_UNITARIO || 0);
      if (v <= 0 || p <= 0) return;

      volPostoPeriodo += v;
      const precoAcordadoCiclo = Number(ficha.preco) || 0;
      const precoPropostoCiclo = Number(ficha.preco_proposto) || 0;
      const precoBaseCiclo = obterPrecoBaseFichaFechamento(ficha, nomePosto, ufPosto);
      const refAnpCiclo = obterReferenciaAnpFechamento(r, r.MES_ANO);

      if (refAnpCiclo > 0 && p < refAnpCiclo) {
        hardSavingPosto += (refAnpCiclo - p) * v;
      }
      if (precoBaseCiclo > 0 && p < precoBaseCiclo) {
        savingNegociacaoPosto += (precoBaseCiclo - p) * v;
      }
      if (precoPropostoCiclo > precoAcordadoCiclo && p <= precoAcordadoCiclo) {
        costAvoidancePosto += (precoPropostoCiclo - precoAcordadoCiclo) * v;
        volAvoidancePosto += v;
        precoPropostoAvoidance = precoPropostoCiclo;
        precoAcordadoAvoidance = precoAcordadoCiclo;
      }

      // Verifica desvio passível de glosa espelhando a régua da Auditoria Comercial
      const vigFichaCiclo = (ficha.vigencia || '').substring(0, 10);
      const ehVigenciaAtual = statusTratativaPeriodo === 'ACORDO_FECHADO' && vigFichaCiclo === vigenciaAtualMaisRecente;
      const gapAcordoCiclo = p - precoAcordadoCiclo;
      const gapAnpCiclo = refAnpCiclo > 0 ? (p - refAnpCiclo) : 0;
      const diasDesdeVigencia = calcularDiasEntreDatasFechamento(vigFichaCiclo, r.DATA_FIM_CICLO);

      if (
        r.MES_ANO === mesOperacionalRef &&
        ehVigenciaAtual &&
        gapAcordoCiclo > 0.005 &&
        diasDesdeVigencia >= 0 &&
        diasDesdeVigencia <= 30 &&
        !(refAnpCiclo > 0 && gapAnpCiclo < -0.05)
      ) {
        impactoFuroMesRef += gapAcordoCiclo * v;
        volFuroMesRef += v;
        valorPagoFuroMesRef += (p * v);
        precoAcordadoFuroMesRef = precoAcordadoCiclo;
        vigenciaFuroMesRef = vigFichaCiclo;
      }

      if ((r.DATA_FIM_CICLO || '') >= dataUltimoBomba) {
        dataUltimoBomba = r.DATA_FIM_CICLO || '';
        mesUltimoBomba = r.MES_ANO || mesOperacionalRef;
        ultimoPrecoBomba = p;
        fichaUltimoConsumo = ficha;
      }
    });

    const vigencia = fichaUltimoConsumo?.vigencia || vigenciaDecisaoPeriodo;
    const precoAcordado = Number(fichaUltimoConsumo?.preco) || 0;
    const precoProposto = Number(fichaUltimoConsumo?.preco_proposto) || 0;
    const refAnp = Number(anpRevenda[ufPosto]?.[mesUltimoBomba || mesOperacionalRef] || 0);

    if (volPostoPeriodo > 0 && precoAcordado > 0 && fichaUltimoConsumo) {
      volumeSobAcordoMes += volPostoPeriodo;
      qtdPostosAcordadosAtivos++;
      savingNegociacaoRealizadoMes += savingNegociacaoPosto;

      costAvoidanceMes += costAvoidancePosto;
      if (costAvoidancePosto > 0) {
        detalhesCostAvoidance.push({
          posto: nomePosto,
          uf: ufPosto,
          precoProposto: precoPropostoAvoidance || precoProposto,
          precoAcordado: precoAcordadoAvoidance || precoAcordado,
          economiaUnitaria: (precoPropostoAvoidance || precoProposto) - (precoAcordadoAvoidance || precoAcordado),
          volume: volAvoidancePosto,
          impactoTotal: costAvoidancePosto
        });
      }

      if (!ehModoAnual && costAvoidancePosto > 0 && precoProposto > precoAcordado && competenciaAlvo === (vigencia || '').substring(0, 7)) {
        acoesTaticas.push({
          tipo: "BLINDAGEM",
          titulo: `Blindagem de Balcão: ${nomePosto} (${ufPosto})`,
          descricao: `Tentativa do posto de subir para <strong>R$ ${precoProposto.toFixed(3)}</strong> foi barrada na mesa, mantendo o acordo em <strong>R$ ${precoAcordado.toFixed(3)}</strong>.`,
          impacto: `+ R$ ${Math.round(costAvoidancePosto).toLocaleString('pt-BR')} de Cost Avoidance no mês`
        });
      }

      // Adiciona ao card de Glosas SOMENTE se houve furo válido no último mês operacional ativo
      // e o último abastecimento registrado ainda não normalizou dentro do acordado.
      const ultimoPrecoAindaAcima = (ultimoPrecoBomba - precoAcordadoFuroMesRef) > 0.005;
      if (impactoFuroMesRef > 0 && volFuroMesRef > 0 && ultimoPrecoAindaAcima) {
        const precoPagoFuro = valorPagoFuroMesRef / volFuroMesRef;
        const gapAcordo = precoPagoFuro - precoAcordadoFuroMesRef;
        postosComFuro.push({
          posto: nomePosto,
          uf: ufPosto,
          vigenciaFmt: vigenciaFuroMesRef ? vigenciaFuroMesRef.split('-').reverse().join('/') : '--',
          precoAcordado: precoAcordadoFuroMesRef,
          precoPagoFuro,
          gap: gapAcordo,
          volumeFuro: volFuroMesRef,
          impactoReais: impactoFuroMesRef
        });
      }

      // Adiciona ao SLA de Renovação SOMENTE se o posto teve consumo no último mês operacional ativo
      // e a vigência atual já ultrapassou 30 dias.
      const teveConsumoMesRecente = mesUltimoBomba === mesOperacionalRef;
      const vigAtualParaSla = vigenciaAtualMaisRecente || (vigencia || '').substring(0, 10);
      if (teveConsumoMesRecente && statusTratativaPeriodo === 'ACORDO_FECHADO' && vigAtualParaSla) {
        const dtVig = new Date(`${vigAtualParaSla}T12:00:00Z`);
        const hoje = new Date();
        hoje.setUTCHours(12, 0, 0, 0);
        const dtFimComp = new Date(`${dataLimitePeriodo}T12:00:00Z`);
        const dtRef = dtFimComp > hoje ? hoje : dtFimComp;
        const dias = Math.round((dtRef - dtVig) / (1000 * 60 * 60 * 24));
        if (dias > 30) {
          postosParaRenovar.push({
            posto: nomePosto,
            uf: ufPosto,
            dataVigenciaFmt: vigAtualParaSla.split('-').reverse().join('/'),
            diasDecorridos: dias,
            ultimoAbastFmt: dataUltimoBomba ? dataUltimoBomba.substring(0, 10).split('-').reverse().join('/') : '--'
          });
        }
      }

      tabelaPostosMes.push({
        posto: nomePosto,
        uf: ufPosto,
        vigenciaFmt: vigAtualParaSla ? vigAtualParaSla.split('-').reverse().join('/') : '--',
        precoProposto,
        precoAcordado: Number(fichaDecisaoPeriodo?.preco) || precoAcordado,
        ultimoPrecoBomba,
        refAnp,
        spreadAnp: ultimoPrecoBomba > 0 && refAnp > 0 ? (ultimoPrecoBomba - refAnp) : 0,
        volume: volPostoPeriodo,
        hardSaving: hardSavingPosto,
        savingNegociacao: savingNegociacaoPosto
      });
    }

    // MANOBRA DE ROTA (Exibe bloqueios iniciados no mês consultado ou acumula no modo anual)
    const condicaoBloqueio = ehModoAnual
      ? (statusTratativaPeriodo === 'POSTO_BLOQUEADO' && mesVigenciaDecisao && (!anoBase || mesVigenciaDecisao.startsWith(`${anoBase}-`)) && fichaDecisaoPeriodo?.posto_destino)
      : (statusTratativaPeriodo === 'POSTO_BLOQUEADO' && mesVigenciaDecisao === competenciaAlvo && fichaDecisaoPeriodo?.posto_destino);

    if (condicaoBloqueio) {
      const postoDestino = fichaDecisaoPeriodo.posto_destino;
      const ufDestino = fichaDecisaoPeriodo.posto_destino_uf || ufPosto;
      const mesTransicao = mesVigenciaDecisao || mesOperacionalRef;

      const historicoOrigem = baseRegistrosMensais.filter(r =>
        r.POSTO === nomePosto && r.UF_POSTO === ufPosto
      );

      const volPorMesOrigem = {};
      historicoOrigem.forEach(r => {
        const m = r.MES_ANO;
        if (m) {
          volPorMesOrigem[m] = (volPorMesOrigem[m] || 0) + parseFloat(r.VOLUME_CICLO || 0);
        }
      });

      const mesesAnterioresAoBloqueio = Object.keys(volPorMesOrigem)
        .filter(m => m < mesTransicao && volPorMesOrigem[m] > 0)
        .sort()
        .reverse();

      let volumeReferencia = 0;
      let rotuloPeriodoVolume = "";

      if (mesesAnterioresAoBloqueio.length > 0) {
        const mesesAmostra = mesesAnterioresAoBloqueio.slice(0, 3);
        const somaVolumeAmostra = mesesAmostra.reduce((acc, m) => acc + volPorMesOrigem[m], 0);
        volumeReferencia = somaVolumeAmostra / mesesAmostra.length;
        rotuloPeriodoVolume = mesesAmostra.length === 1 
          ? `Mês anterior (${mesesAmostra[0].split('-').reverse().join('/')})` 
          : `Média de ${mesesAmostra.length} meses cheios anteriores`;
      } else {
        const mesesComVolume = Object.keys(volPorMesOrigem).filter(m => volPorMesOrigem[m] > 0).sort();
        const ultMes = mesesComVolume[mesesComVolume.length - 1] || '';
        volumeReferencia = ultMes ? volPorMesOrigem[ultMes] : 0;
        rotuloPeriodoVolume = ultMes ? `Litragem em ${ultMes.split('-').reverse().join('/')}` : 'Volume residual';
      }

      const regsOrigemMesTransicao = historicoOrigem.filter(r => r.MES_ANO === mesTransicao);
      let vOrigemMes = 0;
      let vtOrigemMes = 0;
      regsOrigemMesTransicao.forEach(r => {
        const v = parseFloat(r.VOLUME_CICLO || 0);
        vOrigemMes += v;
        vtOrigemMes += parseFloat(r.VALOR_TOTAL_CICLO || (v * parseFloat(r.VALOR_UNITARIO || 0)));
      });

      let precoOrigem = vOrigemMes > 0 ? (vtOrigemMes / vOrigemMes) : 0;

      if (precoOrigem === 0) {
        let ultCicloOrigem = null;
        historicoOrigem.filter(r => r.MES_ANO <= mesTransicao).forEach(r => {
          const p = parseFloat(r.VALOR_UNITARIO || 0);
          if (p > 0 && (!ultCicloOrigem || (r.DATA_FIM_CICLO || '') > (ultCicloOrigem.DATA_FIM_CICLO || ''))) {
            ultCicloOrigem = r;
          }
        });
        precoOrigem = ultCicloOrigem ? parseFloat(ultCicloOrigem.VALOR_UNITARIO || 0) : (trat.preco_acordado || 0);
      }

      const historicoDestino = baseRegistrosMensais.filter(r =>
        r.POSTO === postoDestino && r.UF_POSTO === ufDestino
      );

      const regsDestinoMesTransicao = historicoDestino.filter(r => r.MES_ANO === mesTransicao);
      let vDestinoMes = 0;
      let vtDestinoMes = 0;
      regsDestinoMesTransicao.forEach(r => {
        const v = parseFloat(r.VOLUME_CICLO || 0);
        vDestinoMes += v;
        vtDestinoMes += parseFloat(r.VALOR_TOTAL_CICLO || (v * parseFloat(r.VALOR_UNITARIO || 0)));
      });

      let precoDestino = vDestinoMes > 0 ? (vtDestinoMes / vDestinoMes) : 0;

      if (precoDestino === 0) {
        const tratDestino = mapaTrat[gerarDocumentIdPosto(postoDestino, ufDestino)];
        const acordosDestinoNaEpoca = (tratDestino?.historico || []).filter(h =>
          h.status === 'ACORDO_FECHADO' && h.preco > 0 && h.vigencia && h.vigencia.substring(0, 7) <= mesTransicao
        ).sort((a, b) => (b.vigencia || '').localeCompare(a.vigencia || ''));

        if (acordosDestinoNaEpoca.length > 0) {
          precoDestino = acordosDestinoNaEpoca[0].preco;
        } else if (tratDestino?.preco_acordado > 0 && tratDestino.vigencia?.substring(0, 7) <= mesTransicao) {
          precoDestino = tratDestino.preco_acordado;
        } else {
          const regsDestinoMesAlvo = historicoDestino.filter(r => r.MES_ANO === mesOperacionalRef);
          let vDestAlvo = 0, vtDestAlvo = 0;
          regsDestinoMesAlvo.forEach(r => {
            const v = parseFloat(r.VOLUME_CICLO || 0);
            vDestAlvo += v;
            vtDestAlvo += parseFloat(r.VALOR_TOTAL_CICLO || (v * parseFloat(r.VALOR_UNITARIO || 0)));
          });
          precoDestino = vDestAlvo > 0 ? (vtDestAlvo / vDestAlvo) : 0;
        }
      }

      const diffUnitario = (precoOrigem > 0 && precoDestino > 0) ? (precoOrigem - precoDestino) : null;
      const savingProjetado = diffUnitario !== null ? (diffUnitario * volumeReferencia) : 0;
      const volumeFmt = Math.round(volumeReferencia).toLocaleString('pt-BR');
      const mesTransFmt = mesTransicao.split('-').reverse().join('/');

      if (ehModoAnual) {
        manobrasAno.push({
          postoOrigem: nomePosto,
          ufOrigem: ufPosto,
          postoDestino,
          ufDestino,
          volumeReferencia,
          savingProjetado
        });
      } else {
        let descricaoManobra;
        let impactoManobra;

        if (volumeReferencia <= 0) {
          descricaoManobra = `Sem volume histórico representativo para <strong>${nomePosto} (${ufPosto})</strong> até ${mesOperacionalRef}.`;
          impactoManobra = 'Saving não calculado: volume real indisponível';
        } else if (diffUnitario === null) {
          descricaoManobra = `Volume base de <strong>${volumeFmt} L/mês</strong> (${rotuloPeriodoVolume}), suspenso em <strong>${nomePosto} (${ufPosto})</strong> e destinado para <strong>${postoDestino}</strong>.`;
          impactoManobra = 'Saving não calculado: preço real da época indisponível';
        } else {
          descricaoManobra = `Volume de <strong>${volumeFmt} L/mês</strong> (${rotuloPeriodoVolume}) realocado de <strong>${nomePosto} (${ufPosto})</strong> para <strong>${postoDestino} (${ufDestino})</strong>; preço real na transição (${mesTransFmt}) R$ ${precoOrigem.toFixed(3)}/L vs. R$ ${precoDestino.toFixed(3)}/L no destino.`;
          
          const tipoImpacto = savingProjetado >= 0 ? 'Economia Mensal Projetada' : 'Acréscimo Mensal Projetado';
          impactoManobra = `${savingProjetado >= 0 ? '+' : '-'} R$ ${Math.round(Math.abs(savingProjetado)).toLocaleString('pt-BR')} de ${tipoImpacto}`;
        }

        acoesTaticas.push({
          tipo: "BLOQUEIO",
          titulo: `Manobra de Rota: Bloqueio & Realocação Estratégica`,
          descricao: descricaoManobra,
          impacto: impactoManobra
        });
      }
    }
  });

  // Ordena tabelas e governança por relevância financeira
  tabelaPostosMes.sort((a, b) => (b.hardSaving + b.savingNegociacao) - (a.hardSaving + a.savingNegociacao) || b.volume - a.volume);
  postosComFuro.sort((a, b) => b.impactoReais - a.impactoReais);
  postosParaRenovar.sort((a, b) => b.diasDecorridos - a.diasDecorridos);

  // Monta cards consolidados por Rede no início da Vitrine Tática (ordenados por maior saving mensal)
  const cardsRedes = Object.entries(gruposReducaoRede).map(([redeNome, itens]) => {
    itens.sort((a, b) => (b.impactoMensal - a.impactoMensal) || (b.diff - a.diff));
    const totalRede = itens.reduce((acc, it) => acc + it.impactoMensal, 0);
    const volumeTotal = itens.reduce((acc, it) => acc + (it.volRef || 0), 0);
    return {
      tipo: 'REDUCAO_REDE',
      titulo: redeNome,
      itens,
      volumeTotal,
      totalRede,
      impacto: totalRede > 0
        ? `+ R$ ${Math.round(totalRede).toLocaleString('pt-BR')}/mês contratados (Run-Rate)`
        : `Redução unitária garantida`
    };
  }).sort((a, b) => b.totalRede - a.totalRede);

  if (ehModoAnual) {
    // No modo anual, consolida postos avulsos e manobras em cards resumo executivos
    if (reducoesAvulsas.length > 0) {
      const totalAvulsos = reducoesAvulsas.reduce((acc, it) => acc + it.impactoMensal, 0);
      const volAvulsos = reducoesAvulsas.reduce((acc, it) => acc + (it.volRef || 0), 0);
      const topAvulso = [...reducoesAvulsas].sort((a, b) => b.impactoMensal - a.impactoMensal)[0];
      acoesTaticas.push({
        tipo: 'RESUMO_AVULSOS',
        titulo: `Reduções em Postos Avulsos (${reducoesAvulsas.length} postos)`,
        descricao: `Carteira avulsa renegociada em ${anoBase} sobre base de <strong>${Math.round(volAvulsos).toLocaleString('pt-BR')} L/mês</strong>. Destaque: <strong>${topAvulso.posto} (${topAvulso.uf})</strong> (-R$ ${topAvulso.diff.toFixed(3)}/L).`,
        impacto: `+ R$ ${Math.round(totalAvulsos).toLocaleString('pt-BR')}/mês contratados (Run-Rate)`
      });
    }

    if (manobrasAno.length > 0) {
      const totalManobras = manobrasAno.reduce((acc, m) => acc + m.savingProjetado, 0);
      const volManobras = manobrasAno.reduce((acc, m) => acc + m.volumeReferencia, 0);
      acoesTaticas.push({
        tipo: 'BLOQUEIO',
        titulo: `Manobras de Rota & Bloqueios (${manobrasAno.length} migrações)`,
        descricao: `Realocação estratégica de <strong>${Math.round(volManobras).toLocaleString('pt-BR')} L/mês</strong> de postos bloqueados para corredores com melhor tarifa em ${anoBase}.`,
        impacto: `${totalManobras >= 0 ? '+' : '-'} R$ ${Math.round(Math.abs(totalManobras)).toLocaleString('pt-BR')}/mês de Economia Projetada`
      });
    }

    if (costAvoidanceMes > 0) {
      acoesTaticas.push({
        tipo: 'BLINDAGEM',
        titulo: `Blindagem de Tabela Acumulada (${detalhesCostAvoidance.length} postos)`,
        descricao: `Reajustes de balcão barrados na mesa comercial ao longo de ${anoBase}, preservando as condições acordadas.`,
        impacto: `+ R$ ${Math.round(costAvoidanceMes).toLocaleString('pt-BR')} de Cost Avoidance acumulado`
      });
    }

    acoesTaticas.unshift(...cardsRedes);
  } else {
    const cardsAvulsos = reducoesAvulsas
      .sort((a, b) => (b.impactoMensal - a.impactoMensal) || (b.diff - a.diff))
      .map(it => {
        const vigFmtMesa = it.vigencia.split('-').reverse().join('/');
        return {
          tipo: 'REDUCAO_MESA',
          titulo: `Redução na Mesa: ${it.posto} (${it.uf})`,
          descricao: `Preço reduzido de <strong>R$ ${it.precoBase.toFixed(3)}/L</strong> para <strong>R$ ${it.precoNeg.toFixed(3)}/L</strong> (<strong>-R$ ${it.diff.toFixed(3)}/L</strong>) com vigência a partir de ${vigFmtMesa}.`,
          impacto: it.impactoMensal > 0
            ? `+ R$ ${Math.round(it.impactoMensal).toLocaleString('pt-BR')}/mês contratados (Run-Rate sobre ${Math.round(it.volRef).toLocaleString('pt-BR')} L/mês)`
            : `+ R$ ${it.diff.toFixed(3)}/L de redução unitária garantida`
        };
      });

    acoesTaticas.unshift(...cardsRedes, ...cardsAvulsos);
  }

  // INTEGRAÇÃO DAS MATRIZES GERENCIAIS & GARAGENS PRÓPRIAS
  // Calcula mês a mês antes de consolidar para preservar a aderência exata contra a rua e ANP Distr. da época.
  const matrizesGaragem = [];
  let volInternoMes = 0;
  let gastoInternoMes = 0;
  let savingGaragemMes = 0;

  const mesesParaGaragem = ehModoAnual ? mesesBaseAno : [competenciaAlvo];
  const garagensConsolidadoMap = new Map();

  mesesParaGaragem.forEach(m => {
    const regsDoMes = baseRegistrosMensais.filter(r => r.MES_ANO === m);
    const garagensRegsMes = regsDoMes.filter(r => r.TIPO_OPERACAO === 'INTERNO');

    // Pré-calcula média de rua por UF nesse mês específico
    const ruaPorUfMes = {};
    regsDoMes.filter(r => r.TIPO_OPERACAO === 'EXTERNO').forEach(r => {
      const uf = r.UF_POSTO || '';
      const vol = parseFloat(r.VOLUME_CICLO || 0);
      const vt = parseFloat(r.VALOR_TOTAL_CICLO || (vol * parseFloat(r.VALOR_UNITARIO || 0)));
      if (!ruaPorUfMes[uf]) ruaPorUfMes[uf] = { v: 0, vt: 0 };
      ruaPorUfMes[uf].v += vol;
      ruaPorUfMes[uf].vt += vt;
    });

    const garagensMesMap = new Map();
    garagensRegsMes.forEach(r => {
      const nomeGaragem = typeof identificarNomePonto === 'function'
        ? identificarNomePonto(r.POSTO, r.MUNICIPIO_POSTO, r.UF_POSTO, 'INTERNO')
        : (r.MUNICIPIO_POSTO || r.POSTO || `Unidade ${r.UF_POSTO || ''}`);
      const chaveGaragem = JSON.stringify([r.UF_POSTO, nomeGaragem]);
      if (!garagensMesMap.has(chaveGaragem)) {
        garagensMesMap.set(chaveGaragem, { nome: nomeGaragem, uf: r.UF_POSTO || '', v: 0, vt: 0 });
      }
      const item = garagensMesMap.get(chaveGaragem);
      const vol = parseFloat(r.VOLUME_CICLO || 0);
      item.v += vol;
      item.vt += parseFloat(r.VALOR_TOTAL_CICLO || (vol * parseFloat(r.VALOR_UNITARIO || 0)));
    });

    garagensMesMap.forEach((gMes, chaveGaragem) => {
      if (gMes.v <= 0) return;
      const custoMes = gMes.vt / gMes.v;
      volInternoMes += gMes.v;
      gastoInternoMes += gMes.vt;

      const mapaDist = (typeof anpDistribuicao !== 'undefined') ? anpDistribuicao : {};
      const refDistMes = (mapaDist[gMes.uf] && mapaDist[gMes.uf][m]) ? Number(mapaDist[gMes.uf][m]) : 0;

      const dadosRuaUf = ruaPorUfMes[gMes.uf];
      const precoRuaMes = (dadosRuaUf && dadosRuaUf.v > 0) ? (dadosRuaUf.vt / dadosRuaUf.v) : 0;
      const ganhoMes = (precoRuaMes > 0 && custoMes > 0) ? ((precoRuaMes - custoMes) * gMes.v) : 0;
      savingGaragemMes += ganhoMes;

      if (!garagensConsolidadoMap.has(chaveGaragem)) {
        garagensConsolidadoMap.set(chaveGaragem, {
          nome: gMes.nome,
          uf: gMes.uf,
          volume: 0,
          gastoTotal: 0,
          somaRefDistPonderada: 0,
          volComDist: 0,
          somaRuaPonderada: 0,
          volComRua: 0,
          ganhoTotal: 0
        });
      }

      const acc = garagensConsolidadoMap.get(chaveGaragem);
      acc.volume += gMes.v;
      acc.gastoTotal += gMes.vt;
      if (refDistMes > 0) {
        acc.somaRefDistPonderada += refDistMes * gMes.v;
        acc.volComDist += gMes.v;
      }
      if (precoRuaMes > 0) {
        acc.somaRuaPonderada += precoRuaMes * gMes.v;
        acc.volComRua += gMes.v;
      }
      acc.ganhoTotal += ganhoMes;
    });
  });

  garagensConsolidadoMap.forEach(acc => {
    const custoGaragem = acc.volume > 0 ? (acc.gastoTotal / acc.volume) : 0;
    const refDist = acc.volComDist > 0 ? (acc.somaRefDistPonderada / acc.volComDist) : 0;
    const varDistPerc = (custoGaragem > 0 && refDist > 0) ? (((custoGaragem - refDist) / refDist) * 100) : 0;
    const precoRuaUf = acc.volComRua > 0 ? (acc.somaRuaPonderada / acc.volComRua) : 0;
    const spreadRua = (precoRuaUf > 0 && custoGaragem > 0) ? (precoRuaUf - custoGaragem) : 0;

    matrizesGaragem.push({
      nome: acc.nome,
      uf: acc.uf,
      custoGaragem,
      refDist,
      varDistPerc,
      precoRuaUf,
      spreadRua,
      volume: acc.volume,
      ganhoTotal: acc.ganhoTotal
    });
  });

  matrizesGaragem.sort((a, b) => b.ganhoTotal - a.ganhoTotal || b.volume - a.volume);

  const percInternoMes = volumeTotalMes > 0 ? ((volInternoMes / volumeTotalMes) * 100) : 0;
  const spreadMedioGaragemMes = volInternoMes > 0 ? (savingGaragemMes / volInternoMes) : 0;

  // CÁLCULO YTD ACUMULADO DO ANO
  let savingAcumuladoYtd = 0;
  baseRegistrosMensais.forEach(r => {
    if (!r.MES_ANO || r.MES_ANO.substring(0, 4) !== (anoBase || mesOperacionalRef.substring(0, 4))) return;
    if (!ehModoAnual && r.MES_ANO > mesOperacionalRef) return;
    const p = parseFloat(r.VALOR_UNITARIO || 0);
    const v = parseFloat(r.VOLUME_CICLO || 0);
    const refAnp = obterReferenciaAnpFechamento(r, r.MES_ANO);
    if (refAnp > 0 && p > 0 && p < refAnp) {
      savingAcumuladoYtd += ((refAnp - p) * v);
    }
  });

  const percVolumeAcordado = volumeTotalMes > 0 ? ((volumeSobAcordoMes / volumeTotalMes) * 100) : 0;

  return {
    ehModoAnual,
    anoBase,
    rotuloMesOperacional,
    rotuloMesMaisRecenteAno,
    volumeTotalMes,
    custoMedioFrotaMes,
    custoMedioComAnpMes,
    anpMediaPonderadaMes,
    spreadMedioMes,
    operacaoVerde,
    hardSavingTotalMes,
    savingNegociacaoRealizadoMes,
    savingNegociacaoContratadoMes,
    costAvoidanceMes,
    detalhesCostAvoidance,
    detalhesRunRate,
    volumeSobAcordoMes,
    percVolumeAcordado,
    qtdPostosAcordadosAtivos,
    savingAcumuladoYtd,
    tabelaPostosMes,
    postosComFuro,
    postosParaRenovar,
    acoesTaticas,
    matrizesGaragem,
    volInternoMes,
    percInternoMes,
    spreadMedioGaragemMes,
    savingGaragemMes
  };
}

/**
 * Formata 'YTD' ou '2026-10' para rótulo executivo limpo
 */
function formatarRotuloCompetencia(compStr) {
  if (!compStr || compStr === 'YTD') {
    const ano = obterAnoBaseFechamento();
    return `Ano Completo${ano ? ` ${ano}` : ''} (Consolidado)`;
  }
  if (!compStr.includes('-')) return compStr;
  const nomes = {
    '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
    '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
    '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro'
  };
  const [ano, mes] = compStr.split('-');
  return `${nomes[mes] || mes}/${ano}`;
}

/**
 * Leitura do Dossiê do Firestore
 */
async function carregarDossieMesFirestore(mesAno) {
  if (!mesAno || mesesDossieCarregados.has(mesAno)) return;

  try {
    const token = (typeof utilizadorAutenticado !== 'undefined' && utilizadorAutenticado) ? utilizadorAutenticado.idToken : "";
    const headers = token ? { "Authorization": `Bearer ${token}` } : {};

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    let resp;
    try {
      resp = await fetch(`${FIRESTORE_BASE_DOSSIE}/${mesAno}`, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
    if (resp.status === 404) {
      cacheDossieMes[mesAno] = '';
      cachePareceresGestor[mesAno] = [];
      mesesDossieCarregados.add(mesAno);
      return;
    }
    if (!resp.ok) throw new Error(`Erro HTTP ${resp.status}`);

    if (resp.ok) {
      const json = await resp.json();
      const fields = json.fields || {};
      cacheDossieMes[mesAno] = fields.notas_gestor?.stringValue || '';
      const pareceres = decodificarValorFirestore(fields.pareceres) || [];
      cachePareceresGestor[mesAno] = Array.isArray(pareceres)
        ? pareceres.map(parecer => ({ ...parecer, criadoEm: parecer.criado_em || parecer.criadoEm }))
        : [];
      mesesDossieCarregados.add(mesAno);
    }
  } catch (err) {
    console.warn("Aviso ao carregar dossiê do período:", err);
  }
}

function decodificarValorFirestore(valor) {
  if (!valor || typeof valor !== 'object') return null;
  if ('stringValue' in valor) return valor.stringValue;
  if ('integerValue' in valor) return Number(valor.integerValue);
  if ('doubleValue' in valor) return valor.doubleValue;
  if ('booleanValue' in valor) return valor.booleanValue;
  if ('timestampValue' in valor) return valor.timestampValue;
  if ('arrayValue' in valor) return (valor.arrayValue.values || []).map(decodificarValorFirestore);
  if ('mapValue' in valor) {
    return Object.fromEntries(Object.entries(valor.mapValue.fields || {}).map(([chave, campo]) => [chave, decodificarValorFirestore(campo)]));
  }
  return null;
}

/**
 * Impressão Executiva Sem Sobreposições (Folha A4)
 */
async function emitirRelatorioFechamentoExecutivo() {
  const container = document.getElementById('secaoFechamentoExecutivo');
  if (!container) return;

  const tooltipEl = document.getElementById('tooltipExecutivoDark');
  if (tooltipEl) tooltipEl.classList.remove('visivel');

  // 1) Configurações de tema claro para o ApexCharts
  const opcoesTemaClaro = {
    chart: {
      background: 'transparent'
    },
    theme: {
      mode: 'light'
    },
    xaxis: {
      axisBorder: { color: '#cbd5e1' },
      axisTicks: { color: '#cbd5e1' },
      labels: { style: { colors: '#1e293b' } }
    },
    yaxis: [
      {
        title: { style: { color: '#15803d' } },
        labels: { style: { colors: '#1e293b' } }
      },
      {
        opposite: true,
        title: { style: { color: '#0369a1' } },
        labels: { style: { colors: '#1e293b' } }
      }
    ],
    grid: {
      borderColor: '#e2e8f0'
    },
    legend: {
      labels: { colors: '#1e293b' }
    }
  };

  const opcoesTemaEscuro = {
    chart: {
      background: 'transparent'
    },
    theme: {
      mode: 'dark'
    },
    xaxis: {
      axisBorder: { color: '#334155' },
      axisTicks: { color: '#334155' },
      labels: { style: { colors: '#94a3b8' } }
    },
    yaxis: [
      {
        title: { style: { color: '#22c55e' } },
        labels: { style: { colors: '#94a3b8' } }
      },
      {
        opposite: true,
        title: { style: { color: '#38bdf8' } },
        labels: { style: { colors: '#94a3b8' } }
      }
    ],
    grid: {
      borderColor: 'rgba(255, 255, 255, 0.05)'
    },
    legend: {
      labels: { colors: '#cbd5e1' }
    }
  };

  if (graficoEvolucaoInstancia) {
    try {
      await graficoEvolucaoInstancia.updateOptions(opcoesTemaClaro, false, false);
      window.dispatchEvent(new Event('resize'));
    } catch (e) {
      console.warn('Aviso ao aplicar tema claro no gráfico:', e);
    }
  }

  document.body.classList.add('printing-dossie');

  let restaurado = false;
  const restaurarEstadoOriginal = async () => {
    if (restaurado) return;
    restaurado = true;
    window.removeEventListener('afterprint', restaurarEstadoOriginal);
    document.body.classList.remove('printing-dossie');
    if (graficoEvolucaoInstancia) {
      try {
        await graficoEvolucaoInstancia.updateOptions(opcoesTemaEscuro, false, false);
        window.dispatchEvent(new Event('resize'));
      } catch (e) {
        console.warn('Aviso ao restaurar tema escuro no gráfico:', e);
      }
    }
  };

  window.addEventListener('afterprint', restaurarEstadoOriginal, { once: true });

  try {
    window.print();
  } finally {
    setTimeout(restaurarEstadoOriginal, 1000);
  }
}
