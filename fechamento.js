/* ==========================================================================
   MÓDULO DE FECHAMENTO MENSAL EXECUTIVO & DOSSIÊ DA DIRETORIA (DARK MODE)
   CARGOSOFT | VOCTT INTELIGÊNCIA DE FROTAS
   Consolidação KMM, Rolodex, Curva de Eficiência ANP e Dossiê Persistido
   ========================================================================== */

const FIRESTORE_BASE_DOSSIE = "https://firestore.googleapis.com/v1/projects/cargosoft-diesel/databases/(default)/documents/fechamentos_dossie";

let mesFechamentoAtivo = "2026-10";
let cacheDossieMes = {};
let graficoEvolucaoInstancia = null;

/**
 * Injeção de Estilos CSS Dark Mode Executivo & Ajustes de Impressão
 */
(function injetarEstilosFechamentoExecutivo() {
  const idEstilo = "estilosFechamentoExecutivoDark";
  if (document.getElementById(idEstilo)) return;

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
      border: 1px solid rgba(74, 222, 128, 0.35);
      box-shadow: 0 0 18px rgba(74, 222, 128, 0.08);
    }
    .glow-azul {
      border: 1px solid rgba(56, 189, 248, 0.35);
      box-shadow: 0 0 18px rgba(56, 189, 248, 0.08);
    }
    .glow-laranja {
      border: 1px solid rgba(251, 146, 60, 0.35);
      box-shadow: 0 0 18px rgba(251, 146, 60, 0.08);
    }
    .glow-vermelho {
      border: 1px solid rgba(248, 113, 113, 0.4);
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
      color: #4ade80;
      text-shadow: 0 0 12px rgba(74, 222, 128, 0.35);
    }
    .num-neon-azul {
      color: #38bdf8;
      text-shadow: 0 0 12px rgba(56, 189, 248, 0.35);
    }
    .num-neon-branco {
      color: #f8fafc;
      text-shadow: 0 0 10px rgba(248, 250, 252, 0.2);
    }

    /* BOTÃO CLEAN DARK IMPRIMIR */
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

    /* TABELA DARK */
    .tabela-fechamento-dark {
      color: #cbd5e1;
      margin-bottom: 0;
    }
    .tabela-fechamento-dark thead th {
      background: #0f172a;
      color: #94a3b8;
      border-bottom: 2px solid #334155;
      font-size: 0.68rem;
      text-transform: uppercase;
      padding: 8px 6px;
    }
    .tabela-fechamento-dark tbody td {
      border-color: rgba(255, 255, 255, 0.05);
      padding: 7px 6px;
      font-size: 0.72rem;
    }
    .tabela-fechamento-dark tbody tr:hover {
      background: rgba(255, 255, 255, 0.02);
    }
  `;
  document.head.appendChild(styleEl);
})();

/**
 * Inicialização e renderização principal da aba de Fechamento Executivo
 */
async function renderizarAbaFechamentoExecutivo() {
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
  if (mesesDisponiveis.length > 0 && !mesesDisponiveis.includes(mesFechamentoAtivo)) {
    mesFechamentoAtivo = mesesDisponiveis[0];
  }

  container.innerHTML = `
    <div class="text-center py-5 text-muted">
      <div class="spinner-border spinner-border-sm text-success me-2" role="status"></div>
      Consolidando indicadores executivos, matrizes e curva temporal de savings...
    </div>
  `;

  await carregarDossieMesFirestore(mesFechamentoAtivo);
  const dados = calcularMetricasFechamento(mesFechamentoAtivo);

  container.innerHTML = `
    <!-- TOPO EXECUTIVO: TÍTULO, SELETOR E BOTÃO CLEAN DARK -->
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 pb-2 border-bottom border-secondary">
      <div>
        <h5 class="fw-bold mb-0 text-white d-flex align-items-center gap-2">
          <i class="bi bi-briefcase-fill text-success fs-4"></i>
          <span>Fechamento Executivo & Prestação de Contas da Frota</span>
        </h5>
        <span class="small text-muted" style="font-size: 0.72rem;">
          Consolidação Operacional, Curva de Eficiência e Economia Real Auditada no Caixa da Cargosoft
        </span>
      </div>

      <div class="d-flex align-items-center gap-2">
        <label class="small fw-bold text-white-50 text-nowrap mb-0" style="font-size: 0.68rem;">Competência:</label>
        <select id="seletorMesFechamento" class="form-select form-select-sm font-monospace fw-bold" 
          style="width: 145px; background: #1e293b; color: #f8fafc; border-color: #475569;" 
          onchange="trocarMesFechamento(this.value)">
          ${mesesDisponiveis.map(m => `<option value="${m}" ${m === mesFechamentoAtivo ? 'selected' : ''}>${formatarRotuloMes(m)}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-clean-dark shadow-sm text-nowrap px-3" onclick="emitirRelatorioFechamentoExecutivo()">
          <i class="bi bi-printer me-1 text-secondary"></i> Imprimir Dossiê
        </button>
      </div>
    </div>

    <!-- BLOCO 1: CARDS DE IMPACTO COM NÚMEROS AMPLIADOS & NEON GLOW -->
    <div class="row g-2 mb-3">
      <!-- TERMÔMETRO MACRO DO MÊS -->
      <div class="col-12 col-md-3">
        <div class="card-exec-dark h-100 ${dados.operacaoVerde ? 'glow-verde' : 'glow-vermelho'} d-flex flex-column justify-content-between">
          <div>
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="text-uppercase fw-bold text-white-50" style="font-size: 0.62rem; letter-spacing: 0.05em;">Termômetro da Frota</span>
              <i class="bi ${dados.operacaoVerde ? 'bi-shield-check text-success' : 'bi-shield-exclamation text-danger'} fs-5"></i>
            </div>
            <div class="num-kpi-grande ${dados.operacaoVerde ? 'num-neon-verde' : 'text-danger'} my-1">
              ${dados.operacaoVerde ? 'OPERAÇÃO NO VERDE' : 'ALERTA DE ÁGIO'}
            </div>
            <div class="text-white-50 small" style="font-size: 0.70rem; line-height: 1.3;">
              ${dados.operacaoVerde 
                ? `Preço médio da frota ficou <strong>R$ ${Math.abs(dados.spreadMedioMes).toFixed(3)}/L abaixo da média oficial ANP</strong>.` 
                : `Diesel comprado R$ ${dados.spreadMedioMes.toFixed(3)}/L acima da ANP na média.`}
            </div>
          </div>
          <div class="pt-2 mt-2 border-top border-secondary font-monospace text-white-50" style="font-size: 0.65rem;">
            Acumulado do Ano (YTD): <strong class="text-success">+R$ ${Math.round(dados.savingAcumuladoYtd).toLocaleString('pt-BR')}</strong>
          </div>
        </div>
      </div>

      <!-- HARD SAVING (CAIXA REAL RETIDO) -->
      <div class="col-12 col-md-3">
        <div class="card-exec-dark h-100 glow-verde d-flex flex-column justify-content-between">
          <div>
            <span class="text-uppercase fw-bold text-white-50" style="font-size: 0.62rem; letter-spacing: 0.05em;">Hard Saving (Efetivo no Caixa)</span>
            <div class="num-kpi-grande num-neon-verde my-1">
              + R$ ${Math.round(dados.hardSavingMes).toLocaleString('pt-BR')}
            </div>
            <div class="text-white-50 small" style="font-size: 0.70rem;">
              Economia real retida vs. preço oficial da ANP no mês.
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
              <strong>${dados.percVolumeAcordado.toFixed(1).replace('.', ',')}%</strong> do diesel da frota consumido em postos sob acordo.
            </div>
          </div>
          <div class="pt-2 mt-2 border-top border-secondary font-monospace text-white-50" style="font-size: 0.65rem;">
            ${dados.qtdPostosAcordadosAtivos} postos homologados na competência
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
          <span class="small text-muted" style="font-size: 0.68rem;">
            Evidência temporal do descolamento de custos a partir da atuação estratégica de compras na frota
          </span>
        </div>
        <span class="badge bg-dark text-success border border-success font-monospace" style="font-size: 0.60rem;">
          YTD 2026 Auditado
        </span>
      </div>
      <div id="graficoEvolucaoSavings" style="min-height: 230px; width: 100%;"></div>
    </div>

    <!-- BLOCO 3: VITRINE TÁTICA (MANOBRAS DE ROTA & AÇÕES DE COMPRAS) -->
    <div class="card-exec-dark mb-3 p-3">
      <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom border-secondary">
        <h6 class="fw-bold mb-0 text-white" style="font-size: 0.85rem;">
          <i class="bi bi-signpost-split-fill text-primary me-2"></i>Vitrine Tática: Manobras de Rota & Blindagem Comercial
        </h6>
        <span class="badge bg-dark text-white-50 border border-secondary font-monospace" style="font-size: 0.60rem;">Decisões do Rolodex</span>
      </div>
      <div class="row g-2">
        ${renderizarCardsVitrineTatica(dados.acoesTaticas)}
      </div>
    </div>

    <!-- BLOCO 4: NOTAS DO GESTOR DE FROTA (DOSSIÊ OPERACIONAL PERSISTIDO) -->
    <div class="card-exec-dark mb-3 p-3" style="background: #0f172a; border-color: rgba(74, 222, 128, 0.25);">
      <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom border-secondary">
        <div class="d-flex align-items-center">
          <i class="bi bi-journal-check text-success fs-5 me-2"></i>
          <div>
            <h6 class="fw-bold mb-0 text-white" style="font-size: 0.85rem;">Dossiê Estratégico do Gestor de Frota</h6>
            <span class="small text-white-50" style="font-size: 0.68rem;">Anotações operacionais, justificativas e prazos que fundamentam o resultado para a Diretoria</span>
          </div>
        </div>
        <button id="btnSalvarDossie" class="btn btn-sm btn-success fw-bold px-3 shadow-sm" onclick="salvarDossieMesFirestore()">
          <i class="bi bi-cloud-arrow-up-fill me-1"></i> Salvar Dossiê
        </button>
      </div>

      <textarea id="textoDossieGestor" class="form-control font-monospace border-secondary" rows="4" 
        placeholder="Escreva aqui as ações do mês (ex: 'Intensificamos o abastecimento interno em Barueri pelo spread favorável; nas rotas externas negociamos prazo faturado D+15 sem acréscimo de taxa; bloqueamos o posto X e migramos o fluxo para o posto Y com economia imediata...')"
        style="background: #1e293b; color: #f1f5f9; font-size: 0.78rem; line-height: 1.45;">${cacheDossieMes[mesFechamentoAtivo] || ''}</textarea>
      
      <div class="d-flex justify-content-between align-items-center mt-2 small text-white-50" style="font-size: 0.65rem;">
        <span><i class="bi bi-info-circle me-1"></i> As anotações acima ficam vinculadas à competência <strong>${formatarRotuloMes(mesFechamentoAtivo)}</strong> no banco de dados.</span>
        <span id="lblStatusSalvarDossie" class="text-success fw-bold"></span>
      </div>
    </div>

    <!-- BLOCO 5: RESUMO DE NEGOCIAÇÕES ATIVAS DO MÊS -->
    <div class="card-exec-dark mb-3 p-3">
      <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom border-secondary">
        <h6 class="fw-bold mb-0 text-white" style="font-size: 0.85rem;">
          <i class="bi bi-table text-secondary me-2"></i>Resumo dos Postos Sob Gestão na Competência
        </h6>
        <span class="badge bg-dark text-white-50 border border-secondary font-monospace" style="font-size: 0.60rem;">${dados.tabelaPostosMes.length} postos auditados</span>
      </div>

      <div class="table-responsive">
        <table class="table tabela-fechamento-dark align-middle text-center" style="white-space: nowrap;">
          <thead>
            <tr>
              <th class="text-start" style="min-width: 220px;">Posto / Praça</th>
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

    <!-- BLOCO 6: GOVERNANÇA, GLOSAS & PLANO DE AÇÃO PARA O PRÓXIMO MÊS -->
    <div class="row g-2">
      <!-- GLOSAS E FUROS A CONTESTAR -->
      <div class="col-12 col-md-6">
        <div class="card-exec-dark glow-vermelho h-100 p-3">
          <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom border-secondary">
            <h6 class="fw-bold mb-0 text-danger" style="font-size: 0.85rem;">
              <i class="bi bi-exclamation-octagon-fill me-1"></i> Desvios do Mês: Passíveis de Glosa Quinzenal
            </h6>
            <span class="badge bg-danger font-monospace" style="font-size: 0.60rem;">${dados.postosComFuro.length} desvios</span>
          </div>

          ${dados.postosComFuro.length === 0 
            ? `<div class="p-2 border border-success rounded bg-dark text-success small mb-0"><i class="bi bi-check-circle-fill me-1"></i> Nenhum furo comercial no mês. Todos os postos faturaram em conformidade.</div>` 
            : `<div class="d-flex flex-column gap-2">
                ${dados.postosComFuro.map(f => `
                  <div class="p-2 border rounded" style="background: rgba(239, 68, 68, 0.08); border-color: rgba(239, 68, 68, 0.3) !important; font-size: 0.72rem;">
                    <div class="d-flex justify-content-between">
                      <strong class="text-white">${f.posto} (${f.uf})</strong>
                      <span class="badge bg-danger font-monospace">+R$ ${f.gap.toFixed(3)}/L</span>
                    </div>
                    <div class="text-white-50 mt-1">
                      Acordado: R$ ${f.precoAcordado.toFixed(3)} | Pago: <strong class="text-danger">R$ ${f.precoPago.toFixed(3)}</strong>
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
        <div class="card-exec-dark glow-laranja h-100 p-3">
          <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom border-secondary">
            <h6 class="fw-bold mb-0 text-warning" style="font-size: 0.85rem;">
              <i class="bi bi-clock-history text-warning me-1"></i> Foco de Compras: Renovar Negociação (SLA > 30d)
            </h6>
            <span class="badge bg-warning text-dark font-monospace" style="font-size: 0.60rem;">${dados.postosParaRenovar.length} acordos</span>
          </div>

          ${dados.postosParaRenovar.length === 0 
            ? `<div class="p-2 border border-secondary rounded bg-dark text-white-50 small mb-0"><i class="bi bi-shield-check text-success me-1"></i> Todas as tabelas ativas estão vigentes e dentro do SLA de 30 dias.</div>` 
            : `<div class="d-flex flex-column gap-2" style="max-height: 220px; overflow-y: auto;">
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

  // Renderiza o gráfico ApexCharts de evolução após o DOM estar pronto
  renderizarGraficoEvolucaoSavings();
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
    let somaAnpMes = 0;

    regsMes.forEach(r => {
      const v = parseFloat(r.VOLUME_CICLO || 0);
      const p = parseFloat(r.VALOR_UNITARIO || 0);
      const anpUf = (typeof anpRevenda !== 'undefined' && anpRevenda[r.UF_POSTO]) ? anpRevenda[r.UF_POSTO] : {};
      const refAnp = anpUf[m] || anpUf['2026-10'] || 0;

      volumeMes += v;
      gastoMes += (p * v);
      if (refAnp > 0) {
        somaAnpMes += (refAnp * v);
        if (p < refAnp) {
          savingMes += ((refAnp - p) * v);
        }
      }
    });

    const precoMedioFrota = volumeMes > 0 ? (gastoMes / volumeMes) : 0;
    const anpMedioFrota = volumeMes > 0 ? (somaAnpMes / volumeMes) : 0;
    const spreadMedio = (precoMedioFrota > 0 && anpMedioFrota > 0) ? (precoMedioFrota - anpMedioFrota) : 0;

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
    plotOptions: {
      bar: {
        columnWidth: '40%',
        borderRadius: 4
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
      position: 'top',
      horizontalAlign: 'right',
      labels: { colors: '#cbd5e1' }
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
  const regsMes = baseRegistrosMensais.filter(r => r.MES_ANO === mesAlvo);
  const mapaTrat = (typeof mapaTratativasCadastradas !== 'undefined') ? mapaTratativasCadastradas : {};

  let volumeTotalMes = 0;
  let valorTotalGastoMes = 0;

  regsMes.forEach(r => {
    const v = parseFloat(r.VOLUME_CICLO || 0);
    const p = parseFloat(r.VALOR_UNITARIO || 0);
    const vt = parseFloat(r.VALOR_TOTAL_CICLO || (v * p));
    volumeTotalMes += v;
    valorTotalGastoMes += vt;
  });

  const custoMedioFrotaMes = volumeTotalMes > 0 ? (valorTotalGastoMes / volumeTotalMes) : 0;

  let somaAnpPonderada = 0;
  regsMes.forEach(r => {
    const v = parseFloat(r.VOLUME_CICLO || 0);
    const anpUf = (typeof anpRevenda !== 'undefined' && anpRevenda[r.UF_POSTO]) ? anpRevenda[r.UF_POSTO] : {};
    const refAnp = anpUf[mesAlvo] || anpUf['2026-10'] || 0;
    if (refAnp > 0) {
      somaAnpPonderada += (refAnp * v);
    }
  });

  const anpMediaPonderadaMes = volumeTotalMes > 0 ? (somaAnpPonderada / volumeTotalMes) : 0;
  const spreadMedioMes = custoMedioFrotaMes - anpMediaPonderadaMes;
  const operacaoVerde = spreadMedioMes <= 0;

  let hardSavingMes = 0;
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

    const regsPostoMes = regsMes.filter(r => r.POSTO === nomePosto && r.UF_POSTO === ufPosto);
    let volPostoMes = 0;
    let ultimoPrecoBomba = 0;
    let dataUltimoBomba = "";

    regsPostoMes.forEach(r => {
      const v = parseFloat(r.VOLUME_CICLO || 0);
      const p = parseFloat(r.VALOR_UNITARIO || 0);
      volPostoMes += v;
      if (r.DATA_FIM_CICLO && r.DATA_FIM_CICLO > dataUltimoBomba) {
        dataUltimoBomba = r.DATA_FIM_CICLO;
        ultimoPrecoBomba = p;
      }
    });

    const precoAcordado = trat.preco_acordado || 0;
    const precoProposto = trat.preco_proposto || 0;
    const vigencia = trat.vigencia || "";

    const anpUf = (typeof anpRevenda !== 'undefined' && anpRevenda[ufPosto]) ? anpRevenda[ufPosto] : {};
    const refAnp = anpUf[mesAlvo] || anpUf['2026-10'] || 0;

    let hardSavingPosto = 0;
    let avoidancePosto = 0;

    if (volPostoMes > 0 && precoAcordado > 0) {
      volumeSobAcordoMes += volPostoMes;
      qtdPostosAcordadosAtivos++;

      if (refAnp > 0 && ultimoPrecoBomba > 0 && ultimoPrecoBomba < refAnp) {
        hardSavingPosto = (refAnp - ultimoPrecoBomba) * volPostoMes;
        hardSavingMes += hardSavingPosto;
      }

      if (precoProposto > precoAcordado && ultimoPrecoBomba <= precoAcordado) {
        avoidancePosto = (precoProposto - precoAcordado) * volPostoMes;
        costAvoidanceMes += avoidancePosto;

        acoesTaticas.push({
          tipo: "BLINDAGEM",
          titulo: `Blindagem de Balcão: ${nomePosto} (${ufPosto})`,
          descricao: `Tentativa do posto de subir para <strong>R$ ${precoProposto.toFixed(3)}</strong> foi barrada na mesa, mantendo o acordo em <strong>R$ ${precoAcordado.toFixed(3)}</strong>.`,
          impacto: `+ R$ ${Math.round(avoidancePosto).toLocaleString('pt-BR')} de Cost Avoidance no mês`
        });
      }

      const gapAcordo = (ultimoPrecoBomba - precoAcordado);
      if (gapAcordo > 0.005) {
        postosComFuro.push({
          posto: nomePosto,
          uf: ufPosto,
          precoAcordado,
          precoPago: ultimoPrecoBomba,
          gap: gapAcordo,
          volume: volPostoMes,
          impactoReais: gapAcordo * volPostoMes
        });
      }

      if (vigencia) {
        const dtVig = new Date(`${vigencia}T12:00:00Z`);
        const dtRef = new Date();
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

    if (trat.status === 'POSTO_BLOQUEADO' && trat.posto_destino) {
      acoesTaticas.push({
        tipo: "BLOQUEIO",
        titulo: `Manobra de Rota: Bloqueio de Posto`,
        descricao: `Abastecimentos suspensos em <strong>${nomePosto} (${ufPosto})</strong> com redirecionamento estratégico do fluxo da frota para <strong>${trat.posto_destino}</strong>.`,
        impacto: `Preservação da margem de compras no corredor rodoviário`
      });
    }
  });

  let savingAcumuladoYtd = 0;
  baseRegistrosMensais.forEach(r => {
    const p = parseFloat(r.VALOR_UNITARIO || 0);
    const v = parseFloat(r.VOLUME_CICLO || 0);
    const anpUf = (typeof anpRevenda !== 'undefined' && anpRevenda[r.UF_POSTO]) ? anpRevenda[r.UF_POSTO] : {};
    const refAnp = anpUf[r.MES_ANO] || anpUf['2026-10'] || 0;
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
    hardSavingMes,
    costAvoidanceMes,
    volumeSobAcordoMes,
    percVolumeAcordado,
    qtdPostosAcordadosAtivos,
    savingAcumuladoYtd,
    tabelaPostosMes,
    postosComFuro,
    postosParaRenovar,
    acoesTaticas
  };
}

/**
 * Renderização dos Cards da Vitrine Tática
 */
function renderizarCardsVitrineTatica(acoes) {
  if (!acoes || acoes.length === 0) {
    return `
      <div class="col-12">
        <div class="p-2 border border-secondary rounded bg-dark text-white-50 small mb-0">
          Nenhuma manobra de rota ou bloqueio cadastrado para exibição na vitrine deste mês.
        </div>
      </div>
    `;
  }

  return acoes.map(a => `
    <div class="col-12 col-md-6">
      <div class="p-2 border rounded h-100 d-flex flex-column justify-content-between" 
        style="background: #1e293b; border-color: ${a.tipo === 'BLOQUEIO' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(56, 189, 248, 0.4)'} !important;">
        <div>
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="badge ${a.tipo === 'BLOQUEIO' ? 'bg-danger' : 'bg-primary'}" style="font-size: 0.58rem;">
              ${a.tipo === 'BLOQUEIO' ? 'MANOBRA DE ROTA' : 'COST AVOIDANCE'}
            </span>
          </div>
          <strong class="text-white small d-block mb-1">${a.titulo}</strong>
          <div class="text-white-50" style="font-size: 0.72rem; line-height: 1.35;">${a.descricao}</div>
        </div>
        <div class="mt-2 pt-1 border-top border-secondary font-monospace fw-bold ${a.tipo === 'BLOQUEIO' ? 'text-danger' : 'text-info'}" style="font-size: 0.70rem;">
          ${a.impacto}
        </div>
      </div>
    </div>
  `).join('');
}

/**
 * Renderização das Linhas da Tabela de Postos Auditados
 */
function renderizarLinhasTabelaFechamento(linhas) {
  if (!linhas || linhas.length === 0) {
    return `<tr><td colspan="10" class="text-muted py-3">Nenhum posto faturado com acordo ativo no mês selecionado.</td></tr>`;
  }

  return linhas.map(l => {
    const corSpread = l.spreadAnp < 0 ? 'text-success fw-bold' : (l.spreadAnp > 0 ? 'text-danger' : 'text-muted');
    const sinalSpread = l.spreadAnp > 0 ? '+' : '';

    return `
      <tr>
        <td class="text-start fw-bold text-white text-truncate" style="max-width: 250px;" title="${l.posto}">${l.posto}</td>
        <td><span class="badge bg-dark text-white border border-secondary font-monospace">${l.uf}</span></td>
        <td class="font-monospace text-muted">${l.vigenciaFmt}</td>
        <td class="text-end font-monospace text-white-50">${l.precoProposto > 0 ? `R$ ${l.precoProposto.toFixed(3)}` : '--'}</td>
        <td class="text-end font-monospace fw-bold text-white">${l.precoAcordado > 0 ? `R$ ${l.precoAcordado.toFixed(3)}` : '--'}</td>
        <td class="text-end font-monospace text-white-50">${l.ultimoPrecoBomba > 0 ? `R$ ${l.ultimoPrecoBomba.toFixed(3)}` : '--'}</td>
        <td class="text-end font-monospace text-primary">${l.refAnp > 0 ? `R$ ${l.refAnp.toFixed(3)}` : '--'}</td>
        <td class="text-end font-monospace ${corSpread}">${l.refAnp > 0 ? `${sinalSpread}R$ ${l.spreadAnp.toFixed(3)}` : '--'}</td>
        <td class="text-end font-monospace text-white">${Math.round(l.volume).toLocaleString('pt-BR')} L</td>
        <td class="text-end font-monospace text-success fw-bold">+ R$ ${Math.round(l.hardSaving).toLocaleString('pt-BR')}</td>
      </tr>
    `;
  }).join('');
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
 * Leitura das Notas do Gestor salvas no Firestore para a competência
 */
async function carregarDossieMesFirestore(mesAno) {
  if (cacheDossieMes[mesAno]) return;

  try {
    const token = (typeof utilizadorAutenticado !== 'undefined' && utilizadorAutenticado) ? utilizadorAutenticado.idToken : "";
    const headers = token ? { "Authorization": `Bearer ${token}` } : {};

    const resp = await fetch(`${FIRESTORE_BASE_DOSSIE}/${mesAno}`, { headers });
    if (resp.ok) {
      const json = await resp.json();
      cacheDossieMes[mesAno] = json.fields?.notas_gestor?.stringValue || "";
    }
  } catch (err) {
    console.warn("Aviso ao carregar dossiê do mês:", err);
  }
}

/**
 * Gravação das Notas do Gestor no Firestore
 */
async function salvarDossieMesFirestore() {
  const txtArea = document.getElementById('textoDossieGestor');
  const btn = document.getElementById('btnSalvarDossie');
  const lblStatus = document.getElementById('lblStatusSalvarDossie');
  if (!txtArea || !btn) return;

  const texto = txtArea.value.trim();
  const token = (typeof utilizadorAutenticado !== 'undefined' && utilizadorAutenticado) ? utilizadorAutenticado.idToken : "";
  const autorEmail = (typeof utilizadorAutenticado !== 'undefined' && utilizadorAutenticado) ? utilizadorAutenticado.email : "Gestor";

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Gravando...`;

  const payload = {
    fields: {
      mes_ano: { stringValue: mesFechamentoAtivo },
      notas_gestor: { stringValue: texto },
      atualizado_em: { timestampValue: new Date().toISOString() },
      autor: { stringValue: autorEmail }
    }
  };

  try {
    const url = `${FIRESTORE_BASE_DOSSIE}/${mesFechamentoAtivo}`;
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const resp = await fetch(url, {
      method: "PATCH",
      headers: headers,
      body: JSON.stringify(payload)
    });

    if (!resp.ok) throw new Error("Erro HTTP " + resp.status);

    cacheDossieMes[mesFechamentoAtivo] = texto;
    if (lblStatus) {
      lblStatus.innerText = "✓ Dossiê gravado com sucesso no Firestore!";
      setTimeout(() => { lblStatus.innerText = ""; }, 4000);
    }
  } catch (err) {
    alert("Falha ao salvar dossiê: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="bi bi-cloud-arrow-up-fill me-1"></i> Salvar Dossiê`;
  }
}

/**
 * Impressão Executiva Sem Sobreposições (Folha A4 Paisagem Limpa)
 */
function emitirRelatorioFechamentoExecutivo() {
  const container = document.getElementById('secaoFechamentoExecutivo');
  if (!container) return;

  const conteudo = container.cloneNode(true);
  const botoes = conteudo.querySelectorAll('button, #btnSalvarDossie, select, #graficoEvolucaoSavings');
  botoes.forEach(b => b.remove());

  const janela = window.open('', '_blank', 'width=1150,height=850');
  janela.document.write(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Relatório Executivo Mensal - Cargosoft</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
        @page { size: A4 landscape; margin: 8mm; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #ffffff; color: #0f172a; padding: 4px; }
        
        /* CORREÇÃO DEFINITIVA DE SOBREPOSIÇÃO NA IMPRESSÃO */
        .row { display: block !important; margin: 0 !important; }
        .col-12, .col-md-3, .col-md-6 { 
          display: block !important; 
          width: 100% !important; 
          float: none !important; 
          position: static !important;
          margin-bottom: 12px !important;
          break-inside: avoid !important;
          page-break-inside: avoid !important;
        }

        .card-exec-dark {
          background: #ffffff !important;
          color: #0f172a !important;
          border: 1px solid #cbd5e1 !important;
          box-shadow: none !important;
          padding: 10px !important;
          margin-bottom: 10px !important;
          break-inside: avoid !important;
        }

        .num-kpi-grande { font-size: 1.4rem !important; color: #0f172a !important; text-shadow: none !important; }
        .num-neon-verde { color: #15803d !important; }
        .num-neon-azul { color: #0369a1 !important; }
        .text-white, .text-white-50 { color: #334155 !important; }
        .text-muted { color: #64748b !important; }

        .tabela-fechamento-dark { color: #0f172a !important; font-size: 0.64rem !important; }
        .tabela-fechamento-dark thead th { background: #f1f5f9 !important; color: #1e293b !important; border-bottom: 1px solid #94a3b8 !important; }
        .tabela-fechamento-dark tbody td { border-color: #e2e8f0 !important; color: #0f172a !important; padding: 3px 4px !important; }
        
        textarea {
          background: #f8fafc !important;
          color: #0f172a !important;
          border: 1px solid #cbd5e1 !important;
          font-size: 0.72rem !important;
        }
      </style>
    </head>
    <body onload="window.print(); window.close();">
      <div class="d-flex justify-content-between align-items-center border-bottom pb-2 mb-2">
        <div>
          <h4 class="fw-bold mb-0 text-dark">Cargosoft Transportes - Fechamento Executivo de Combustível</h4>
          <span class="text-muted small">Competência Auditada: ${formatarRotuloMes(mesFechamentoAtivo)} | Emissão: ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}</span>
        </div>
        <div class="text-end text-muted small">
          Base Homologada KMM, ANP Oficial & Rolodex
        </div>
      </div>
      ${conteudo.innerHTML}
    </body>
    </html>
  `);
  janela.document.close();
}
