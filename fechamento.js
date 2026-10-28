/* ==========================================================================
   MÓDULO DE FECHAMENTO MENSAL EXECUTIVO & DOSSIÊ DA DIRETORIA
   CARGOSOFT | VOCTT INTELIGÊNCIA DE FROTAS
   Consolida KMM, Tratativas do Rolodex, Matrizes ANP e Notas Persistidas
   ========================================================================== */

const FIRESTORE_BASE_DOSSIE = "https://firestore.googleapis.com/v1/projects/cargosoft-diesel/databases/(default)/documents/fechamentos_dossie";

let mesFechamentoAtivo = "2026-10";
let cacheDossieMes = {};

/**
 * Inicialização e renderização principal da aba de Fechamento Executivo
 */
async function renderizarAbaFechamentoExecutivo() {
  const container = document.getElementById('secaoFechamentoExecutivo');
  if (!container) return;

  if (typeof baseRegistrosMensais === 'undefined' || !Array.isArray(baseRegistrosMensais) || baseRegistrosMensais.length === 0) {
    container.innerHTML = `
      <div class="alert alert-warning p-3 rounded shadow-sm text-center">
        <i class="bi bi-hourglass-split me-2"></i> Aguardando o carregamento dos registros transacionais do KMM...
      </div>
    `;
    return;
  }

  // Lista de competências disponíveis no KMM (ordenadas da mais recente para a mais antiga)
  const mesesDisponiveis = [...new Set(baseRegistrosMensais.map(r => r.MES_ANO).filter(Boolean))].sort().reverse();
  if (mesesDisponiveis.length > 0 && !mesesDisponiveis.includes(mesFechamentoAtivo)) {
    mesFechamentoAtivo = mesesDisponiveis[0];
  }

  container.innerHTML = `
    <div class="text-center py-5 text-muted">
      <div class="spinner-border spinner-border-sm text-success me-2" role="status"></div>
      Consolidando indicadores executivos, dossiê tático e bases oficiais...
    </div>
  `;

  // Carrega as notas do gestor salvas no Firestore para este mês
  await carregarDossieMesFirestore(mesFechamentoAtivo);

  // Executa os cálculos matemáticos reais
  const dados = calcularMetricasFechamento(mesFechamentoAtivo);

  // Renderiza a estrutura executiva completa
  container.innerHTML = `
    <!-- CABEÇALHO DO FECHAMENTO & SELETOR DE MÊS -->
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3 pb-2 border-bottom">
      <div>
        <h5 class="fw-bold mb-0 text-dark">
          <i class="bi bi-briefcase-fill text-success me-2"></i>Fechamento Executivo & Prestação de Contas da Frota
        </h5>
        <span class="small text-muted">Consolidação Operacional, Manobras de Rota e Economia Real no Caixa</span>
      </div>

      <div class="d-flex align-items-center gap-2">
        <label class="small fw-bold text-dark text-nowrap mb-0">Competência:</label>
        <select id="seletorMesFechamento" class="form-select form-select-sm font-monospace fw-bold" style="width: 140px;" onchange="trocarMesFechamento(this.value)">
          ${mesesDisponiveis.map(m => `<option value="${m}" ${m === mesFechamentoAtivo ? 'selected' : ''}>${formatarRotuloMes(m)}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-primary shadow-sm text-nowrap px-3" onclick="emitirRelatorioFechamentoExecutivo()">
          <i class="bi bi-printer-fill me-1"></i> Imprimir Dossiê
        </button>
      </div>
    </div>

    <!-- BLOCO 1: TERMÔMETRO MACRO & CARDS DE IMPACTO -->
    <div class="row g-2 mb-3">
      <!-- TERMÔMETRO MACRO DO MÊS -->
      <div class="col-12 col-md-3">
        <div class="card p-3 shadow-sm border-0 h-100 ${dados.operacaoVerde ? 'bg-success text-white' : 'bg-danger text-white'}">
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="text-uppercase fw-bold" style="font-size: 0.65rem; letter-spacing: 0.05em;">Termômetro da Frota</span>
            <i class="bi ${dados.operacaoVerde ? 'bi-shield-check' : 'bi-shield-exclamation'} fs-5"></i>
          </div>
          <div class="fw-bold fs-4">${dados.operacaoVerde ? 'OPERAÇÃO NO VERDE' : 'ALERTA DE ÁGIO'}</div>
          <div style="font-size: 0.72rem; opacity: 0.9;">
            ${dados.operacaoVerde 
              ? `Diesel comprado <strong>R$ ${Math.abs(dados.spreadMedioMes).toFixed(3)}/L abaixo da média ANP</strong> no mês.` 
              : `Diesel comprado R$ ${dados.spreadMedioMes.toFixed(3)}/L acima da ANP na média.`}
          </div>
          <div class="mt-auto pt-2 border-top border-white-50 font-monospace" style="font-size: 0.65rem;">
            Acumulado do Ano (YTD): <strong>R$ ${Math.round(dados.savingAcumuladoYtd).toLocaleString('pt-BR')}</strong> retidos
          </div>
        </div>
      </div>

      <!-- HARD SAVING (CAIXA REAL RETIDO NO MÊS) -->
      <div class="col-12 col-md-3">
        <div class="card p-3 shadow-sm border-0 h-100 bg-white border-start border-4 border-success">
          <div class="text-muted text-uppercase fw-bold" style="font-size: 0.62rem;">Hard Saving (Efetivo no Caixa)</div>
          <div class="fw-bold font-monospace text-success fs-4 my-1">
            + R$ ${Math.round(dados.hardSavingMes).toLocaleString('pt-BR')}
          </div>
          <div class="text-muted small" style="font-size: 0.70rem;">
            Economia auditada vs. média estadual da ANP na competência.
          </div>
          <div class="mt-auto pt-1 font-monospace text-muted" style="font-size: 0.62rem;">
            Litros Faturados: <strong>${Math.round(dados.volumeTotalMes).toLocaleString('pt-BR')} L</strong>
          </div>
        </div>
      </div>

      <!-- COST AVOIDANCE (AUMENTOS BARRADOS) -->
      <div class="col-12 col-md-3">
        <div class="card p-3 shadow-sm border-0 h-100 bg-white border-start border-4 border-primary">
          <div class="text-muted text-uppercase fw-bold" style="font-size: 0.62rem;">Cost Avoidance de Tabela</div>
          <div class="fw-bold font-monospace text-primary fs-4 my-1">
            + R$ ${Math.round(dados.costAvoidanceMes).toLocaleString('pt-BR')}
          </div>
          <div class="text-muted small" style="font-size: 0.70rem;">
            Aumentos e propostas de balcão barrados na mesa de compras.
          </div>
          <div class="mt-auto pt-1 font-monospace text-muted" style="font-size: 0.62rem;">
            Blindagem ativa no mês selecionado
          </div>
        </div>
      </div>

      <!-- VOLUME SOB ACORDO ATIVO -->
      <div class="col-12 col-md-3">
        <div class="card p-3 shadow-sm border-0 h-100 bg-white border-start border-4 border-dark">
          <div class="text-muted text-uppercase fw-bold" style="font-size: 0.62rem;">Volume Sob Gestão Direta</div>
          <div class="fw-bold font-monospace text-dark fs-4 my-1">
            ${Math.round(dados.volumeSobAcordoMes).toLocaleString('pt-BR')} L
          </div>
          <div class="text-muted small" style="font-size: 0.70rem;">
            <strong>${dados.percVolumeAcordado.toFixed(1).replace('.', ',')}%</strong> do consumo do mês rodou sob postos com acordo ativo.
          </div>
          <div class="mt-auto pt-1 font-monospace text-muted" style="font-size: 0.62rem;">
            ${dados.qtdPostosAcordadosAtivos} postos com tratativa homologada
          </div>
        </div>
      </div>
    </div>

    <!-- BLOCO 2: VITRINE TÁTICA (MANOBRAS DE ROTA & NEGOCIAÇÕES BARRADAS) -->
    <div class="card p-3 shadow-sm border-0 bg-white mb-3">
      <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom">
        <div class="d-flex align-items-center">
          <i class="bi bi-signpost-split-fill text-primary fs-5 me-2"></i>
          <h6 class="fw-bold mb-0 text-dark">Vitrine Tática: Manobras de Rota & Blindagem Comercial</h6>
        </div>
        <span class="badge bg-light text-dark border small">Ações Registradas no Rolodex</span>
      </div>
      
      <div class="row g-2">
        ${renderizarCardsVitrineTatica(dados.acoesTaticas)}
      </div>
    </div>

    <!-- BLOCO 3: NOTAS DO GESTOR DE FROTA (DOSSIÊ OPERACIONAL PERSISTIDO) -->
    <div class="card p-3 shadow-sm border-0 mb-3" style="background: #0f172a; border-radius: 10px; color: #f8fafc;">
      <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom border-secondary">
        <div class="d-flex align-items-center">
          <i class="bi bi-journal-check text-success fs-5 me-2"></i>
          <div>
            <h6 class="fw-bold mb-0 text-white">Dossiê Estratégico do Gestor de Frota</h6>
            <span class="small text-white-50" style="font-size: 0.68rem;">Justificativas operacionais, prazos negociados e impacto que vão direto para a Diretoria</span>
          </div>
        </div>
        <button id="btnSalvarDossie" class="btn btn-sm btn-success fw-bold px-3 shadow-sm" onclick="salvarDossieMesFirestore()">
          <i class="bi bi-cloud-arrow-up-fill me-1"></i> Salvar Dossiê
        </button>
      </div>

      <textarea id="textoDossieGestor" class="form-control font-monospace border-secondary" rows="4" 
        placeholder="Escreva aqui as ações táticas do mês (ex: 'Intensificamos o abastecimento interno em Barueri pelo spread favorável; nas rotas externas negociamos prazo faturado D+15 sem acréscimo de taxa; bloqueamos o posto X e migramos o fluxo para o posto Y com economia imediata...')"
        style="background: #1e293b; color: #f1f5f9; font-size: 0.78rem; line-height: 1.45;">${cacheDossieMes[mesFechamentoAtivo] || ''}</textarea>
      
      <div class="d-flex justify-content-between align-items-center mt-2 small text-white-50" style="font-size: 0.65rem;">
        <span><i class="bi bi-info-circle me-1"></i> As anotações acima ficam vinculadas permanentemente à competência <strong>${formatarRotuloMes(mesFechamentoAtivo)}</strong> no banco de dados.</span>
        <span id="lblStatusSalvarDossie" class="text-success fw-bold"></span>
      </div>
    </div>

    <!-- BLOCO 4: RESUMO DE NEGOCIAÇÕES ATIVAS DO MÊS -->
    <div class="card p-3 shadow-sm border-0 bg-white mb-3">
      <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom">
        <h6 class="fw-bold mb-0 text-dark">
          <i class="bi bi-table text-secondary me-2"></i>Resumo dos Postos Sob Gestão na Competência
        </h6>
        <span class="badge bg-light text-secondary border font-monospace">${dados.tabelaPostosMes.length} postos auditados</span>
      </div>

      <div class="table-responsive">
        <table class="table table-sm table-bordered align-middle text-center mb-0" style="font-size: 0.72rem;">
          <thead class="table-light">
            <tr>
              <th class="text-start" style="min-width: 200px;">Posto / Praça</th>
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

    <!-- BLOCO 5: GOVERNANÇA, GLOSAS & PLANO DE AÇÃO PARA O PRÓXIMO MÊS -->
    <div class="row g-3">
      <!-- GLOSAS E FUROS A CONTESTAR -->
      <div class="col-12 col-md-6">
        <div class="card p-3 shadow-sm border-0 bg-white h-100 border-start border-4 border-danger">
          <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom">
            <h6 class="fw-bold mb-0 text-danger">
              <i class="bi bi-exclamation-octagon-fill me-1"></i> Desvios do Mês: Passíveis de Glosa Quinzenal
            </h6>
            <span class="badge bg-danger">${dados.postosComFuro.length} desvios</span>
          </div>

          ${dados.postosComFuro.length === 0 
            ? `<div class="alert alert-success py-2 px-3 small mb-0"><i class="bi bi-check-circle-fill me-1"></i> Nenhum furo comercial identificado no mês. Todos os postos faturaram em estrita conformidade com o combinado.</div>` 
            : `<div class="d-flex flex-column gap-2">
                ${dados.postosComFuro.map(f => `
                  <div class="p-2 border rounded bg-light" style="font-size: 0.72rem;">
                    <div class="d-flex justify-content-between">
                      <strong class="text-dark">${f.posto} (${f.uf})</strong>
                      <span class="badge bg-danger font-monospace">+R$ ${f.gap.toFixed(3)}/L</span>
                    </div>
                    <div class="text-muted mt-1">
                      Acordado: R$ ${f.precoAcordado.toFixed(3)} | Cobrado na bomba: <strong class="text-danger">R$ ${f.precoPago.toFixed(3)}</strong>
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
        <div class="card p-3 shadow-sm border-0 bg-white h-100 border-start border-4 border-warning">
          <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom">
            <h6 class="fw-bold mb-0 text-dark">
              <i class="bi bi-clock-history text-warning me-1"></i> Foco de Compras: Renovar Negociação (SLA > 30d)
            </h6>
            <span class="badge bg-warning text-dark">${dados.postosParaRenovar.length} acordos</span>
          </div>

          ${dados.postosParaRenovar.length === 0 
            ? `<div class="alert alert-light border py-2 px-3 small mb-0 text-muted"><i class="bi bi-shield-check text-success me-1"></i> Todas as tabelas ativas estão vigentes e dentro do prazo operacional de 30 dias.</div>` 
            : `<div class="d-flex flex-column gap-2" style="max-height: 240px; overflow-y: auto;">
                ${dados.postosParaRenovar.map(p => `
                  <div class="p-2 border rounded bg-light d-flex justify-content-between align-items-center" style="font-size: 0.72rem;">
                    <div>
                      <strong class="text-dark d-block">${p.posto} (${p.uf})</strong>
                      <span class="text-muted">Vigência desde: ${p.dataVigenciaFmt} (+${p.diasDecorridos} dias rodando)</span>
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
}

/**
 * Motor de Cálculo Matemático e Agrupamento da Competência
 */
function calcularMetricasFechamento(mesAlvo) {
  const regsMes = baseRegistrosMensais.filter(r => r.MES_ANO === mesAlvo);
  const mapaTrat = mapaTratativasCadastradas || {};

  // Volume Total e Custo Médio do Mês
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

  // Referência Média ANP Ponderada da Frota no Mês
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

  // Varredura dos postos com tratativas no mês
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

      // Hard Saving vs ANP
      if (refAnp > 0 && ultimoPrecoBomba > 0 && ultimoPrecoBomba < refAnp) {
        hardSavingPosto = (refAnp - ultimoPrecoBomba) * volPostoMes;
        hardSavingMes += hardSavingPosto;
      }

      // Cost Avoidance de Balcão Barrado
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

      // Identificação de Furos no Mês
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

      // SLA de Renovação (>30 dias rodando)
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

    // Ação Tática: Posto Bloqueado com Realocação
    if (trat.status === 'POSTO_BLOQUEADO' && trat.posto_destino) {
      acoesTaticas.push({
        tipo: "BLOQUEIO",
        titulo: `Manobra de Rota: Bloqueio de Posto`,
        descricao: `Abastecimentos suspensos em <strong>${nomePosto} (${ufPosto})</strong> com redirecionamento estratégico do fluxo da frota para <strong>${trat.posto_destino}</strong>.`,
        impacto: `Preservação da margem de compras no corredor rodoviário`
      });
    }
  });

  // Cálculo do Hard Saving Acumulado YTD do Ano Todo
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
        <div class="alert alert-light border text-muted small mb-0 py-2">
          Nenhuma manobra de rota ou bloqueio cadastrado para exibição na vitrine deste mês.
        </div>
      </div>
    `;
  }

  return acoes.map(a => `
    <div class="col-12 col-md-6">
      <div class="p-2 border rounded bg-light h-100 d-flex flex-column justify-content-between">
        <div>
          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="badge ${a.tipo === 'BLOQUEIO' ? 'bg-danger' : 'bg-primary'}" style="font-size: 0.58rem;">
              ${a.tipo === 'BLOQUEIO' ? 'MANOBRA DE ROTA' : 'COST AVOIDANCE'}
            </span>
          </div>
          <strong class="text-dark small d-block mb-1">${a.titulo}</strong>
          <div class="text-muted" style="font-size: 0.72rem; line-height: 1.35;">${a.descricao}</div>
        </div>
        <div class="mt-2 pt-1 border-top font-monospace fw-bold ${a.tipo === 'BLOQUEIO' ? 'text-danger' : 'text-primary'}" style="font-size: 0.70rem;">
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
        <td class="text-start fw-bold text-dark text-truncate" style="max-width: 260px;" title="${l.posto}">${l.posto}</td>
        <td><span class="badge bg-light text-dark border font-monospace">${l.uf}</span></td>
        <td class="font-monospace text-muted">${l.vigenciaFmt}</td>
        <td class="text-end font-monospace">${l.precoProposto > 0 ? `R$ ${l.precoProposto.toFixed(3)}` : '--'}</td>
        <td class="text-end font-monospace fw-bold text-dark">${l.precoAcordado > 0 ? `R$ ${l.precoAcordado.toFixed(3)}` : '--'}</td>
        <td class="text-end font-monospace">${l.ultimoPrecoBomba > 0 ? `R$ ${l.ultimoPrecoBomba.toFixed(3)}` : '--'}</td>
        <td class="text-end font-monospace text-primary">${l.refAnp > 0 ? `R$ ${l.refAnp.toFixed(3)}` : '--'}</td>
        <td class="text-end font-monospace ${corSpread}">${l.refAnp > 0 ? `${sinalSpread}R$ ${l.spreadAnp.toFixed(3)}` : '--'}</td>
        <td class="text-end font-monospace">${Math.round(l.volume).toLocaleString('pt-BR')} L</td>
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
 * Impressão Executiva em Folha A4 Paisagem (PDF da Diretoria)
 */
function emitirRelatorioFechamentoExecutivo() {
  const container = document.getElementById('secaoFechamentoExecutivo');
  if (!container) return;

  const conteudo = container.cloneNode(true);
  const botoes = conteudo.querySelectorAll('button, #btnSalvarDossie, select');
  botoes.forEach(b => b.remove());

  const janela = window.open('', '_blank', 'width=1100,height=850');
  janela.document.write(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Relatório Executivo Mensal - Cargosoft</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
        @page { size: A4 landscape; margin: 8mm; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #fff; color: #0f172a; padding: 5px; }
        .card { border: 1px solid #cbd5e1 !important; box-shadow: none !important; margin-bottom: 10px !important; break-inside: avoid !important; }
        .table { font-size: 0.65rem !important; }
        .table th, .table td { padding: 3px 4px !important; }
      </style>
    </head>
    <body onload="window.print(); window.close();">
      <div class="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
        <div>
          <h4 class="fw-bold mb-0 text-dark">Cargosoft Transportes - Fechamento Executivo de Combustível</h4>
          <span class="text-muted small">Competência Auditada: ${formatarRotuloMes(mesFechamentoAtivo)} | Emissão: ${new Date().toLocaleDateString('pt-BR')}</span>
        </div>
        <div class="text-end text-muted small">
          Base Homologada KMM, ANP & Rolodex de Negociações
        </div>
      </div>
      ${conteudo.innerHTML}
    </body>
    </html>
  `);
  janela.document.close();
}
