/* ==========================================================================
   MÓDULO DE FECHAMENTO MENSAL EXECUTIVO & DOSSIÊ DA DIRETORIA (DARK MODE)
   CARGOSOFT | VOCTT INTELIGÊNCIA DE FROTAS
   Controla a geração do dossiê executivo mensal, relatórios gerenciais,
   consolidação KMM/ANP, pareceres de gestores e sincronização via Firestore.
   ========================================================================== */

const FIRESTORE_BASE_DOSSIE = "https://firestore.googleapis.com/v1/projects/cargosoft-diesel/databases/(default)/documents/fechamentos_dossie";

let mesFechamentoAtivo = null;
let cacheDossieMes = {};
let cachePareceresGestor = {};
const mesesDossieCarregados = new Set();
let graficoEvolucaoInstancia = null;

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
      preco_proposto: tratativa.preco_proposto,
      posto_destino: tratativa.posto_destino,
      posto_destino_uf: tratativa.posto_destino_uf
    };
  }
  return null;
}

// Converte YYYY-MM no último dia civil da competência para comparar vigências.
function obterDataFimCompetencia(mes) {
  const [ano, numeroMes] = mes.split('-').map(Number);
  return new Date(Date.UTC(ano, numeroMes, 0)).toISOString().slice(0, 10);
}

/**
 * Injeção de Estilos CSS Dark Mode Executivo & Modal do Dossiê
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

      /* CARDS EXECUTIVOS COM GLOW NEON */
      .card-exec-dark {
        background: #111827;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.07);
        padding: 16px;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        position: relative;
        overflow: hidden;
      }
      .card-exec-dark:hover {
        transform: translateY(-2px);
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
        font-size: 1.85rem;
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
        body.printing-dossie #secaoFechamentoExecutivo {
          background: #ffffff !important;
          color: #0f172a !important;
          border: none !important;
          box-shadow: none !important;
        }
        body.printing-dossie .btn,
        body.printing-dossie select,
        body.printing-dossie #seletorMesFechamento {
          display: none !important;
        }
        body.printing-dossie .dossie-pareceres-vazio {
          display: none !important;
        }
      }
    `;
    document.head.appendChild(styleEl);
  }

  const inserirModalParecer = () => {
    if (!document.body || document.getElementById('modalParecerGestor')) return;

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
  };

  if (document.body) inserirModalParecer();
  else document.addEventListener('DOMContentLoaded', inserirModalParecer, { once: true });
})();

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

  if (typeof baseRegistrosMensais === 'undefined' || !Array.isArray(baseRegistrosMensais) || baseRegistrosMensais.length === 0) {
    container.innerHTML = `
      <div class="alert alert-dark p-3 text-center border-secondary">
        <i class="bi bi-hourglass-split me-2 text-warning"></i> Aguardando o carregamento dos registros transacionais do KMM...
      </div>
    `;
    return;
  }

  const mesesDisponiveis = [...new Set(baseRegistrosMensais.map(r => r.MES_ANO).filter(Boolean))].sort().reverse();
  
  // Resolução dinâmica: seleciona o mês mais recente da base caso não haja seleção ou o mês ativo não exista
  if (mesesDisponiveis.length > 0 && (!mesFechamentoAtivo || !mesesDisponiveis.includes(mesFechamentoAtivo))) {
    mesFechamentoAtivo = mesesDisponiveis[0];
  }

  container.innerHTML = `
    <div class="text-center py-5 text-muted">
      <div class="spinner-border spinner-border-sm text-success me-2" role="status"></div>
      Consolidando indicadores executivos, matrizes de garagem e curva temporal de savings...
    </div>
  `;

  await carregarDossieMesFirestore(mesFechamentoAtivo);
  const dados = calcularMetricasFechamento(mesFechamentoAtivo);

  container.innerHTML = `
    <!-- TOPO EXECUTIVO: TÍTULO, SELETOR E BOTÕES CLEAN DARK -->
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

      <div class="d-flex align-items-center gap-2">
        <label class="small fw-bold text-white-50 text-nowrap mb-0" style="font-size: 0.68rem;">Competência:</label>
        <select id="seletorMesFechamento" class="form-select form-select-sm font-monospace fw-bold" 
          style="width: 145px; background: #1e293b; color: #f8fafc; border-color: #475569;" 
          onchange="trocarMesFechamento(this.value)">
          ${mesesDisponiveis.map(m => `<option value="${m}" ${m === mesFechamentoAtivo ? 'selected' : ''}>${formatarRotuloMes(m)}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-clean-dark shadow-sm text-nowrap px-3" onclick="abrirModalParecer()">
          <i class="bi bi-chat-square-text me-1 text-warning"></i> Inserir Parecer
        </button>
        <button class="btn btn-sm btn-clean-dark shadow-sm text-nowrap px-3" onclick="emitirRelatorioFechamentoExecutivo()">
          <i class="bi bi-printer me-1 text-secondary"></i> Imprimir Dossiê
        </button>
      </div>
    </div>

    <!-- BLOCO 1: CARDS DE IMPACTO COM NÚMEROS AMPLIADOS & NEON GLOW -->
    <div class="row g-2 mb-3 cards-fechamento-principais">
      <!-- TERMÔMETRO MACRO DO MÊS -->
      <div class="col-12 col-md-3">
        <div class="card-exec-dark h-100 ${dados.operacaoVerde === null ? '' : (dados.operacaoVerde ? 'glow-verde' : 'glow-vermelho')} d-flex flex-column justify-content-between">
          <div>
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="text-uppercase fw-bold text-white-50" style="font-size: 0.62rem; letter-spacing: 0.05em;">Termômetro da Frota</span>
              <i class="bi ${dados.operacaoVerde === null ? 'bi-dash-circle text-secondary' : (dados.operacaoVerde ? 'bi-shield-check text-success' : 'bi-shield-exclamation text-danger')} fs-5"></i>
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

      <!-- HARD SAVING (CAIXA REAL RETIDO NO MÊS) -->
      <div class="col-12 col-md-3">
        <div class="card-exec-dark h-100 glow-verde d-flex flex-column justify-content-between">
          <div>
            <span class="text-uppercase fw-bold text-white-50" style="font-size: 0.62rem; letter-spacing: 0.05em;">Hard Saving (Efetivo no Caixa)</span>
            <div class="num-kpi-grande num-neon-verde my-1">
              + R$ ${Math.round(dados.hardSavingTotalMes).toLocaleString('pt-BR')}
            </div>
            <div class="text-white-50 small" style="font-size: 0.70rem;">
              Economia real auditada vs. tabela oficial ANP no mês.
            </div>
          </div>
          <div class="pt-2 mt-2 border-top border-secondary font-monospace text-white-50" style="font-size: 0.65rem;">
            Volume Auditado: <strong class="text-white">${Math.round(dados.volumeTotalMes).toLocaleString('pt-BR')} L</strong>
          </div>
        </div>
      </div>

      <!-- COST AVOIDANCE DE TABELA -->
      <div class="col-12 col-md-3">
        <div class="card-exec-dark h-100 glow-azul d-flex flex-column justify-content-between">
          <div>
            <span class="text-uppercase fw-bold text-white-50" style="font-size: 0.62rem; letter-spacing: 0.05em;">Cost Avoidance de Tabela</span>
            <div class="num-kpi-grande num-neon-azul my-1">
              + R$ ${Math.round(dados.costAvoidanceMes).toLocaleString('pt-BR')}
            </div>
            <div class="text-white-50 small" style="font-size: 0.70rem;">
              Aumentos de bomba e propostas de balcão barrados na mesa.
            </div>
          </div>
          <div class="pt-2 mt-2 border-top border-secondary font-monospace text-white-50" style="font-size: 0.65rem;">
            Blindagem ativa no mês
          </div>
        </div>
      </div>

      <!-- VOLUME SOB GESTÃO DIRETA -->
      <div class="col-12 col-md-3">
        <div class="card-exec-dark h-100 glow-verde d-flex flex-column justify-content-between">
          <div>
            <span class="text-uppercase fw-bold text-white-50" style="font-size: 0.62rem; letter-spacing: 0.05em;">Volume Sob Gestão Direta</span>
            <div class="num-kpi-grande num-neon-branco my-1">
              ${Math.round(dados.volumeSobAcordoMes).toLocaleString('pt-BR')} L
            </div>
            <div class="text-white-50 small" style="font-size: 0.70rem;">
              <strong>${dados.percVolumeAcordado.toFixed(1).replace('.', ',')}%</strong> do consumo do mês rodou sob postos com acordo ativo.
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
            Auditoria de compras no atacado vs. ANP Distribuição e ganho unitário contra a bomba de rua
          </span>
        </div>
        <span class="badge bg-dark text-white-50 border border-secondary font-monospace" style="font-size: 0.60rem;">
          ${dados.matrizesGaragem.length} garagens ativas
        </span>
      </div>

      <div class="row g-2 mb-2">
        <div class="col-12 col-md-4">
          <div class="p-2 rounded bg-dark border border-secondary">
            <span class="text-white-50 text-uppercase" style="font-size: 0.60rem; font-weight: 700;">Volume Interno no Mês</span>
            <div class="fw-bold font-monospace text-white fs-6">${Math.round(dados.volInternoMes).toLocaleString('pt-BR')} L</div>
            <div class="text-white-50" style="font-size: 0.62rem;">${dados.percInternoMes.toFixed(1).replace('.', ',')}% do abastecimento total</div>
          </div>
        </div>
        <div class="col-12 col-md-4">
          <div class="p-2 rounded bg-dark border border-secondary">
            <span class="text-white-50 text-uppercase" style="font-size: 0.60rem; font-weight: 700;">Spread Médio Garagem vs. Rua</span>
            <div class="fw-bold font-monospace ${dados.spreadMedioGaragemMes >= 0 ? 'text-success' : 'text-danger'} fs-6">${dados.spreadMedioGaragemMes > 0 ? '+' : (dados.spreadMedioGaragemMes < 0 ? '-' : '')} R$ ${Math.abs(dados.spreadMedioGaragemMes).toFixed(3)}/L</div>
            <div class="text-white-50" style="font-size: 0.62rem;">Vantagem líquida unitária interna</div>
          </div>
        </div>
        <div class="col-12 col-md-4">
          <div class="p-2 rounded bg-dark border border-secondary">
            <span class="text-white-50 text-uppercase" style="font-size: 0.60rem; font-weight: 700;">Economia Retida em Garagem</span>
            <div class="fw-bold font-monospace ${dados.savingGaragemMes >= 0 ? 'text-success' : 'text-danger'} fs-6">${dados.savingGaragemMes > 0 ? '+' : (dados.savingGaragemMes < 0 ? '-' : '')} R$ ${Math.round(Math.abs(dados.savingGaragemMes)).toLocaleString('pt-BR')}</div>
            <div class="text-white-50" style="font-size: 0.62rem;">Preservação direta de caixa</div>
          </div>
        </div>
      </div>

      <div class="table-responsive">
        <table class="table tabela-fechamento-dark align-middle text-center" style="white-space: nowrap;">
          <thead>
            <tr>
              <th class="text-start">Filial / Garagem</th>
              <th>UF</th>
              <th class="text-end">Custo Garagem (R$/L)</th>
              <th class="text-end">Ref. ANP Distr.</th>
              <th class="text-end">Eficiência Atacado (%)</th>
              <th class="text-end">Média Rua (UF)</th>
              <th class="text-end">Spread vs. Rua (R$/L)</th>
              <th class="text-end">Volume</th>
              <th class="text-end">Ganho Retido</th>
            </tr>
          </thead>
          <tbody>
            ${renderizarLinhasMatrizesFechamento(dados.matrizesGaragem)}
          </tbody>
        </table>
      </div>
    </div>

    <!-- BLOCO 4: VITRINE TÁTICA (MANOBRAS DE ROTA & AÇÕES DE COMPRAS) -->
    <div class="card-exec-dark mb-3 p-3">
      <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom border-secondary">
        <h6 class="fw-bold mb-0 text-white" style="font-size: 0.85rem;">
          <i class="bi bi-signpost-split-fill text-success me-2"></i>Vitrine Tática: Manobras de Rota & Blindagem Comercial
        </h6>
        <span class="badge bg-dark text-white-50 border border-secondary font-monospace" style="font-size: 0.60rem;">Decisões Vigentes na Competência</span>
      </div>
      <div class="row g-2">
        ${renderizarCardsVitrineTatica(dados.acoesTaticas)}
      </div>
    </div>

    <!-- BLOCO 5: PARECER ESTRATÉGICO DO GESTOR -->
    ${renderizarPareceresGestor()}

    <!-- BLOCO 6: RESUMO DE NEGOCIAÇÕES ATIVAS DO MÊS -->
    <div class="card-exec-dark mb-3 p-3">
      <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom border-secondary">
        <h6 class="fw-bold mb-0 text-white" style="font-size: 0.85rem;">
          <i class="bi bi-table text-secondary me-2"></i>Resumo dos Postos Sob Acordo Vigente na Competência
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
              <th class="text-end">Hard Saving</th>
            </tr>
          </thead>
          <tbody>
            ${renderizarLinhasTabelaFechamento(dados.tabelaPostosMes)}
          </tbody>
        </table>
      </div>
    </div>

    <!-- BLOCO 7: GOVERNANÇA, GLOSAS & PLANO DE AÇÃO PARA O PRÓXIMO MÊS -->
    <div class="row g-2">
      <!-- GLOSAS E FUROS A CONTESTAR -->
      <div class="col-12 col-md-6">
        <div class="card-exec-dark glow-vermelho h-100 p-3 d-flex flex-column" style="max-height: 480px;">
          <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom border-secondary flex-shrink-0">
            <h6 class="fw-bold mb-0 text-danger" style="font-size: 0.85rem;">
              <i class="bi bi-exclamation-octagon-fill me-1"></i> Desvios do Mês: Passíveis de Glosa Quinzenal
            </h6>
            <span class="badge bg-danger font-monospace" style="font-size: 0.60rem;">${dados.postosComFuro.length} desvios</span>
          </div>

          ${dados.postosComFuro.length === 0 
            ? `<div class="p-2 border border-success rounded bg-dark text-success small mb-0"><i class="bi bi-check-circle-fill me-1"></i> Nenhum furo comercial apurado na competência. Todos os postos sob acordo faturaram em conformidade.</div>` 
            : `<div class="d-flex flex-column gap-2 flex-grow-1" style="min-height: 0; overflow-y: auto; scrollbar-width: thin;">
                ${dados.postosComFuro.map(f => `
                  <div class="p-2 border rounded" style="background: rgba(239, 68, 68, 0.08); border-color: rgba(239, 68, 68, 0.3) !important; font-size: 0.72rem;">
                    <div class="d-flex justify-content-between">
                      <strong class="text-white">${f.posto} (${f.uf})</strong>
                      <span class="badge bg-danger font-monospace">+R$ ${f.gap.toFixed(3)}/L</span>
                    </div>
                    <div class="text-white-50 mt-1">
                      Acordado: R$ ${f.precoAcordado.toFixed(3)} (Vigência: ${f.vigenciaFmt}) | Pago: <strong class="text-danger">R$ ${f.precoPago.toFixed(3)}</strong>
                    </div>
                    <div class="text-danger fw-bold mt-1">
                      Desvio financeiro total: R$ ${Math.round(f.impactoReais).toLocaleString('pt-BR')} (sobre ${Math.round(f.volume).toLocaleString('pt-BR')} L)
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
            <span class="badge bg-warning text-dark font-monospace" style="font-size: 0.60rem;">${dados.postosParaRenovar.length} acordos</span>
          </div>

          ${dados.postosParaRenovar.length === 0 
            ? `<div class="p-2 border border-secondary rounded bg-dark text-white-50 small mb-0"><i class="bi bi-shield-check text-success me-1"></i> Todas as tabelas ativas estão vigentes e dentro do SLA de 30 dias.</div>` 
            : `<div class="d-flex flex-column gap-2 flex-grow-1" style="min-height: 0; overflow-y: auto; scrollbar-width: thin;">
                ${dados.postosParaRenovar.map(p => `
                  <div class="p-2 border rounded d-flex justify-content-between align-items-center" style="background: rgba(245, 158, 11, 0.08); border-color: rgba(245, 158, 11, 0.3) !important; font-size: 0.72rem;">
                    <div>
                      <strong class="text-white d-block">${p.posto} (${p.uf})</strong>
                      <span class="text-white-50">Vigência: ${p.dataVigenciaFmt} (+${p.diasDecorridos} dias rodando)</span>
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

function renderizarPareceresGestor() {
  const pareceres = [...(cachePareceresGestor[mesFechamentoAtivo] || [])];
  const notaLegada = cacheDossieMes[mesFechamentoAtivo] || '';
  if (notaLegada) {
    pareceres.unshift({
      titulo: 'Observação anterior da gestão',
      subtitulo: 'Registro salvo no formato anterior de parecer',
      texto: notaLegada,
      indicadores: []
    });
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

    return `
      <div class="col-12">
        <article class="parecer-manual-card">
          <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
            <div class="min-w-0">
              <span class="badge text-dark mb-1" style="background: #eab308; font-size: 0.58rem;">PARECER DA GESTÃO</span>
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
          <span class="small text-white-50" style="font-size: 0.68rem;">Análises complementares registradas manualmente para ${escaparHtmlParecer(formatarRotuloMes(mesFechamentoAtivo))}</span>
        </div>
        <span class="badge bg-dark text-warning border border-warning-subtle font-monospace" style="font-size: 0.60rem;">${pareceres.length} pareceres</span>
      </div>
      ${cards ? `<div class="row g-2">${cards}</div>` : `<div class="small text-white-50 py-2 dossie-pareceres-vazio">Nenhum parecer registrado para esta competência.</div>`}
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
  if (competencia) competencia.innerText = `Competência: ${formatarRotuloMes(mesFechamentoAtivo)}`;

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
  const pareceresAtualizados = [...(cachePareceresGestor[mesFechamentoAtivo] || []), parecer];
  const token = (typeof utilizadorAutenticado !== 'undefined' && utilizadorAutenticado) ? utilizadorAutenticado.idToken : '';

  botao.disabled = true;
  botao.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Salvando...`;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const resp = await fetch(`${FIRESTORE_BASE_DOSSIE}/${mesFechamentoAtivo}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        fields: {
          mes_ano: { stringValue: mesFechamentoAtivo },
          pareceres: { arrayValue: { values: pareceresAtualizados.map(serializarParecerFirestore) } },
          atualizado_em: { timestampValue: parecer.criadoEm }
        }
      })
    });
    if (!resp.ok) throw new Error(`Erro HTTP ${resp.status}`);

    cachePareceresGestor[mesFechamentoAtivo] = pareceresAtualizados;
    mesesDossieCarregados.add(mesFechamentoAtivo);
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
    return `<tr><td colspan="10" style="color: #94a3b8 !important; padding: 16px;">Nenhum posto faturado com acordo ativo no mês selecionado.</td></tr>`;
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
      </tr>
    `;
  }).join('');
}

/**
 * Renderização das Linhas da Tabela de Matrizes (Garagens)
 * (Com badge explícita de estimativa caso não haja abastecimento na rua na UF)
 */
function renderizarLinhasMatrizesFechamento(linhas) {
  if (!linhas || linhas.length === 0) {
    return `<tr><td colspan="9" style="color: #94a3b8 !important; padding: 14px;">Sem registros de abastecimento interno para esta competência.</td></tr>`;
  }

  return linhas.map(g => {
    const corEfic = g.refDist > 0 ? (g.varDistPerc <= 0 ? '#4ade80' : '#f87171') : '#94a3b8';
    const sinalEfic = g.varDistPerc > 0 ? '+' : '';
    const corSpread = g.precoRuaUf > 0 ? (g.spreadRua >= 0.15 ? '#4ade80' : '#f87171') : '#94a3b8';
    const corGanho = g.ganhoTotal >= 0 ? '#4ade80' : '#f87171';

    let celulaRuaHtml = '';
    if (g.precoRuaUf > 0) {
      celulaRuaHtml = `<span class="font-monospace text-white">R$ ${g.precoRuaUf.toFixed(3)}</span>`;
    } else {
      celulaRuaHtml = `<span class="text-white-50 font-monospace" title="Sem compras externas na UF nesta competência">Sem compra externa</span>`;
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
        <td class="text-end font-monospace fw-bold" style="color: #4ade80 !important;">
          ${g.ganhoTotal > 0 ? '+' : (g.ganhoTotal < 0 ? '-' : '')} R$ ${Math.round(Math.abs(g.ganhoTotal)).toLocaleString('pt-BR')}
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Renderização dos Cards da Vitrine Tática
 */
function renderizarCardsVitrineTatica(acoes) {
  if (!acoes || acoes.length === 0) {
    return `
      <div class="col-12">
        <div class="p-2 border border-secondary rounded bg-dark text-white-50 small mb-0">
          Nenhuma manobra de rota ou ação tática registrada com vigência ativa nesta competência.
        </div>
      </div>
    `;
  }

  return acoes.map(a => {
    const ehNegativo = a.impacto.includes('- R$') || a.impacto.includes('Acréscimo');
    const classeGlow = ehNegativo ? 'glow-vermelho' : 'glow-verde';
    const corBorda = ehNegativo ? 'rgba(248, 113, 113, 0.4) !important' : 'rgba(74, 222, 128, 0.35) !important';
    const corTexto = ehNegativo ? 'text-danger' : 'text-success';

    return `
      <div class="col-12 col-md-6">
        <div class="p-2 border rounded h-100 d-flex flex-column justify-content-between ${classeGlow}" 
          style="background: #111827; border-color: ${corBorda};">
          <div>
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="badge ${a.tipo === 'BLOQUEIO' ? (ehNegativo ? 'bg-danger' : 'bg-success') : 'bg-primary'}" style="font-size: 0.58rem;">
                ${a.tipo === 'BLOQUEIO' ? 'MANOBRA DE ROTA' : 'COST AVOIDANCE'}
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

  const mesesDisponiveis = [...new Set(baseRegistrosMensais.map(r => r.MES_ANO).filter(Boolean))].sort();
  
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

    const precoMedioFrota = volumeMes > 0 ? (gastoMes / volumeMes) : 0;
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
 * Motor de Cálculo Matemático e Agrupamento da Competência
 */
function calcularMetricasFechamento(mesAlvo) {
  // Consolida apenas a competência selecionada e pareia cada ciclo com sua referência ANP.
  const regsMes = baseRegistrosMensais.filter(r => r.MES_ANO === mesAlvo);
  const mapaTrat = (typeof mapaTratativasCadastradas !== 'undefined') ? mapaTratativasCadastradas : {};

  let volumeTotalMes = 0;
  let valorTotalGastoMes = 0;
  let hardSavingTotalMes = 0;
  let somaAnpPonderada = 0;
  let volumePonderadoAnp = 0;
  let valorPonderadoAnp = 0;

  regsMes.forEach(r => {
    const v = parseFloat(r.VOLUME_CICLO || 0);
    const p = parseFloat(r.VALOR_UNITARIO || 0);
    const vt = parseFloat(r.VALOR_TOTAL_CICLO || (v * p));
    volumeTotalMes += v;
    valorTotalGastoMes += vt;

    const refAnp = obterReferenciaAnpFechamento(r, mesAlvo);
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
  let volumeSobAcordoMes = 0;
  let qtdPostosAcordadosAtivos = 0;

  const tabelaPostosMes = [];
  const postosComFuro = [];
  const postosParaRenovar = [];
  const acoesTaticas = [];

  const postosProcessadosSet = new Set();

  Object.keys(mapaTrat).forEach(docId => {
    const trat = mapaTrat[docId];
    if (!trat) return;

    const nomePosto = trat.posto;
    const ufPosto = trat.uf;
    const chaveUnica = `${nomePosto}_${ufPosto}`;
    if (postosProcessadosSet.has(chaveUnica)) return;
    postosProcessadosSet.add(chaveUnica);

    const dataFimMes = obterDataFimCompetencia(mesAlvo);
    const fichaDecisaoMes = obterFichaTratativaAteData(trat, dataFimMes);
    const statusTratativaMes = fichaDecisaoMes?.status || '';
    const vigenciaDecisaoMes = fichaDecisaoMes?.vigencia || '';
    const mesVigenciaDecisao = vigenciaDecisaoMes ? vigenciaDecisaoMes.substring(0, 7) : '';

    const regsPostoMes = regsMes.filter(r => r.POSTO === nomePosto && r.UF_POSTO === ufPosto);
    // Associa cada abastecimento ao acordo vigente na data para não somar litros de outras vigências.
    const transacoesAcordadasMes = regsPostoMes.map(registro => ({
      registro,
      ficha: obterFichaTratativaAteData(trat, (registro.DATA_FIM_CICLO || '').substring(0, 10))
    })).filter(item => item.ficha?.status === 'ACORDO_FECHADO' && Number(item.ficha.preco) > 0);
    let volPostoMes = 0;
    let ultimoPrecoBomba = 0;
    let dataUltimoBomba = "";
    let hardSavingPosto = 0;
    let impactoFuroPosto = 0;
    let costAvoidancePosto = 0;
    let fichaUltimoConsumo = null;

    transacoesAcordadasMes.forEach(({ registro: r, ficha }) => {
      const v = parseFloat(r.VOLUME_CICLO || 0);
      const p = parseFloat(r.VALOR_UNITARIO || 0);
      if (v <= 0 || p <= 0) return;
      volPostoMes += v;
      const precoAcordadoCiclo = Number(ficha.preco) || 0;
      const precoPropostoCiclo = Number(ficha.preco_proposto) || 0;
      const refAnpCiclo = obterReferenciaAnpFechamento(r, mesAlvo);

      if (refAnpCiclo > 0 && p < refAnpCiclo) {
        hardSavingPosto += (refAnpCiclo - p) * v;
      }
      if (p > precoAcordadoCiclo) impactoFuroPosto += (p - precoAcordadoCiclo) * v;
      if (precoPropostoCiclo > precoAcordadoCiclo && p <= precoAcordadoCiclo) {
        costAvoidancePosto += (precoPropostoCiclo - precoAcordadoCiclo) * v;
      }
      if (r.DATA_FIM_CICLO && r.DATA_FIM_CICLO > dataUltimoBomba) {
        dataUltimoBomba = r.DATA_FIM_CICLO;
        ultimoPrecoBomba = p;
        fichaUltimoConsumo = ficha;
      }
    });

    const vigencia = fichaUltimoConsumo?.vigencia || vigenciaDecisaoMes;
    const precoAcordado = Number(fichaUltimoConsumo?.preco) || 0;
    const precoProposto = Number(fichaUltimoConsumo?.preco_proposto) || 0;
    const refAnp = Number(anpRevenda[ufPosto]?.[mesAlvo] || 0);

    if (volPostoMes > 0 && precoAcordado > 0 && fichaUltimoConsumo) {
      volumeSobAcordoMes += volPostoMes;
      qtdPostosAcordadosAtivos++;

      costAvoidanceMes += costAvoidancePosto;
      if (costAvoidancePosto > 0 && precoProposto > precoAcordado && mesAlvo === (vigencia || '').substring(0, 7)) {
          acoesTaticas.push({
            tipo: "BLINDAGEM",
            titulo: `Blindagem de Balcão: ${nomePosto} (${ufPosto})`,
            descricao: `Tentativa do posto de subir para <strong>R$ ${precoProposto.toFixed(3)}</strong> foi barrada na mesa, mantendo o acordo em <strong>R$ ${precoAcordado.toFixed(3)}</strong>.`,
            impacto: `+ R$ ${Math.round(costAvoidancePosto).toLocaleString('pt-BR')} de Cost Avoidance no mês`
          });
      }

      if (impactoFuroPosto > 0) {
        const gapAcordo = volPostoMes > 0 ? impactoFuroPosto / volPostoMes : 0;
        postosComFuro.push({
          posto: nomePosto,
          uf: ufPosto,
          vigenciaFmt: vigencia ? vigencia.split('-').reverse().join('/') : '--',
          precoAcordado,
          precoPago: ultimoPrecoBomba,
          gap: gapAcordo,
          volume: volPostoMes,
          impactoReais: impactoFuroPosto
        });
      }

      if (statusTratativaMes === 'ACORDO_FECHADO' && vigencia) {
        const dtVig = new Date(`${vigencia.substring(0, 10)}T12:00:00Z`);
        const hoje = new Date();
        hoje.setUTCHours(12, 0, 0, 0);
        const dtFimComp = new Date(`${dataFimMes}T12:00:00Z`);
        const dtRef = dtFimComp > hoje ? hoje : dtFimComp;
        const dias = Math.round((dtRef - dtVig) / (1000 * 60 * 60 * 24));
        if (dias > 30) {
          postosParaRenovar.push({
            posto: nomePosto,
            uf: ufPosto,
            dataVigenciaFmt: vigencia.split('-').reverse().join('/'),
            diasDecorridos: dias
          });
        }
      }

      tabelaPostosMes.push({
        posto: nomePosto,
        uf: ufPosto,
        vigenciaFmt: vigencia ? vigencia.split('-').reverse().join('/') : '--',
        precoProposto,
        precoAcordado,
        ultimoPrecoBomba,
        refAnp,
        spreadAnp: ultimoPrecoBomba > 0 && refAnp > 0 ? (ultimoPrecoBomba - refAnp) : 0,
        volume: volPostoMes,
        hardSaving: hardSavingPosto
      });
    }

    // MANOBRA DE ROTA (Vigente na competência com sincronismo temporal exato entre Origem e Destino)
    if (statusTratativaMes === 'POSTO_BLOQUEADO' && fichaDecisaoMes?.posto_destino) {
      const postoDestino = fichaDecisaoMes.posto_destino;
      const ufDestino = fichaDecisaoMes.posto_destino_uf || ufPosto;
      const mesTransicao = mesVigenciaDecisao || mesAlvo;

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
          const regsDestinoMesAlvo = historicoDestino.filter(r => r.MES_ANO === mesAlvo);
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

      let descricaoManobra;
      let impactoManobra;

      if (volumeReferencia <= 0) {
        descricaoManobra = `Sem volume histórico representativo para <strong>${nomePosto} (${ufPosto})</strong> até ${mesAlvo}.`;
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
  });

  // INTEGRAÇÃO DAS MATRIZES GERENCIAIS & GARAGENS PRÓPRIAS
  const matrizesGaragem = [];
  let volInternoMes = 0;
  let gastoInternoMes = 0;
  let savingGaragemMes = 0;

  const garagensRegs = regsMes.filter(r => r.TIPO_OPERACAO === 'INTERNO');
  const garagensPorNome = new Map();
  garagensRegs.forEach(r => {
    const nomeGaragem = r.MUNICIPIO_POSTO || r.POSTO || `Unidade ${r.UF_POSTO || ''}`;
    const chaveGaragem = JSON.stringify([r.UF_POSTO, r.MUNICIPIO_POSTO, r.POSTO]);
    if (!garagensPorNome.has(chaveGaragem)) {
      garagensPorNome.set(chaveGaragem, { nome: nomeGaragem, uf: r.UF_POSTO || '', registros: [] });
    }
    garagensPorNome.get(chaveGaragem).registros.push(r);
  });

  garagensPorNome.forEach(({ registros: regsG, nome: nomeGaragem, uf: ufG }) => {
    let vG = 0;
    let vtG = 0;

    regsG.forEach(r => {
      const vol = parseFloat(r.VOLUME_CICLO || 0);
      vG += vol;
      vtG += parseFloat(r.VALOR_TOTAL_CICLO || (vol * parseFloat(r.VALOR_UNITARIO || 0)));
    });

    const custoGaragem = vG > 0 ? (vtG / vG) : 0;
    volInternoMes += vG;
    gastoInternoMes += vtG;

    // Confronto com ANP Distribuição da UF estrita ao mês alvo
    const mapaDist = (typeof anpDistribuicao !== 'undefined') ? anpDistribuicao : {};
    const refDist = (mapaDist[ufG] && mapaDist[ufG][mesAlvo]) ? mapaDist[ufG][mesAlvo] : 0;
    const varDistPerc = (custoGaragem > 0 && refDist > 0) ? (((custoGaragem - refDist) / refDist) * 100) : 0;

    // Confronto com o preço médio da rua na mesma UF naquele mês
    const regsRuaUf = regsMes.filter(r => r.TIPO_OPERACAO === 'EXTERNO' && r.UF_POSTO === ufG);
    let vRua = 0, vtRua = 0;
    regsRuaUf.forEach(r => {
      const vol = parseFloat(r.VOLUME_CICLO || 0);
      vRua += vol;
      vtRua += parseFloat(r.VALOR_TOTAL_CICLO || (vol * parseFloat(r.VALOR_UNITARIO || 0)));
    });

    let precoRuaUf = 0;

    // O ganho contra a rua só é calculado quando há compras externas reais comparáveis na mesma UF.
    if (vRua > 0) {
      precoRuaUf = vtRua / vRua;
    }

    const spreadRua = (precoRuaUf > 0 && custoGaragem > 0) ? (precoRuaUf - custoGaragem) : 0;
    const ganhoTotalGaragem = spreadRua * vG;
    savingGaragemMes += ganhoTotalGaragem;

    matrizesGaragem.push({
      nome: nomeGaragem,
      uf: ufG,
      custoGaragem,
      refDist,
      varDistPerc,
      precoRuaUf,
      spreadRua,
      volume: vG,
      ganhoTotal: ganhoTotalGaragem
    });
  });

  const percInternoMes = volumeTotalMes > 0 ? ((volInternoMes / volumeTotalMes) * 100) : 0;
  const spreadMedioGaragemMes = volInternoMes > 0 ? (savingGaragemMes / volInternoMes) : 0;

  // CÁLCULO YTD ACUMULADO DO ANO
  // Acumula de janeiro até a competência consultada, usando o benchmark próprio de cada operação.
  let savingAcumuladoYtd = 0;
  baseRegistrosMensais.forEach(r => {
    if (!r.MES_ANO || r.MES_ANO.substring(0, 4) !== mesAlvo.substring(0, 4) || r.MES_ANO > mesAlvo) return;
    const p = parseFloat(r.VALOR_UNITARIO || 0);
    const v = parseFloat(r.VOLUME_CICLO || 0);
    const refAnp = obterReferenciaAnpFechamento(r, r.MES_ANO);
    if (refAnp > 0 && p > 0 && p < refAnp) {
      savingAcumuladoYtd += ((refAnp - p) * v);
    }
  });

  const percVolumeAcordado = volumeTotalMes > 0 ? ((volumeSobAcordoMes / volumeTotalMes) * 100) : 0;

  return {
    volumeTotalMes,
    custoMedioFrotaMes,
    anpMediaPonderadaMes,
    spreadMedioMes,
    operacaoVerde,
    hardSavingTotalMes,
    costAvoidanceMes,
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
 * Troca de Mês no Seletor
 */
function trocarMesFechamento(novoMes) {
  mesFechamentoAtivo = novoMes;
  renderizarAbaFechamentoExecutivo();
}

/**
 * Formata '2026-10' para 'Outubro/2026'
 */
function formatarRotuloMes(mesAnoStr) {
  if (!mesAnoStr || !mesAnoStr.includes('-')) return mesAnoStr;
  const nomes = {
    '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
    '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
    '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro'
  };
  const [ano, mes] = mesAnoStr.split('-');
  return `${nomes[mes] || mes}/${ano}`;
}

/**
 * Leitura do Dossiê do Firestore
 */
async function carregarDossieMesFirestore(mesAno) {
  if (mesesDossieCarregados.has(mesAno)) return;

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
    console.warn("Aviso ao carregar dossiê do mês:", err);
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
 * Impressão Executiva Sem Sobreposições (Folha A4 Paisagem)
 */
async function emitirRelatorioFechamentoExecutivo() {
  const container = document.getElementById('secaoFechamentoExecutivo');
  if (!container) return;

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

  // Atualiza para o tema claro e dispara resize antes da impressão
  if (graficoEvolucaoInstancia) {
    try {
      await graficoEvolucaoInstancia.updateOptions(opcoesTemaClaro, false, false);
      window.dispatchEvent(new Event('resize'));
    } catch (e) {
      console.warn('Aviso ao aplicar tema claro no gráfico:', e);
    }
  }

  // 2) Adiciona classe auxiliar no body
  document.body.classList.add('printing-dossie');

  // 3) Limpeza e restauração após impressão (via window.onafterprint e fallback)
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
    // Fallback assíncrono para garantir restauração caso onafterprint não dispare
    setTimeout(restaurarEstadoOriginal, 1000);
  }
}
