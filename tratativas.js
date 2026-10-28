/* ==========================================================================
   MÓDULO DE TRATATIVAS COMERCIAIS & PERSISTÊNCIA FIRESTORE - VOCTT
   ARQUITETURA DUAL: ROLODEX DE HISTÓRICO EM LEQUE + COCKPIT DE DECISÃO & SPREAD
   ========================================================================== */

const FIRESTORE_BASE_TRATATIVAS = "https://firestore.googleapis.com/v1/projects/cargosoft-diesel/databases/(default)/documents/tratativas_diesel";

// Cache em memória das negociações
let mapaTratativasCadastradas = {};
let postoAtivoTratativa = null;

// 1. Injeção dinâmica de CSS específico e da estrutura HTML do Modal Rolodex
(function inicializarModuloTratativasVisual() {
  const cssTratativas = `
    <style id="estilosTratativasRolodex">
      /* CENTRALIZAÇÃO E CORPO DO MODAL */
      #modalTratativaComercial .modal-dialog {
        max-width: 1040px;
        margin: 1.75rem auto;
      }
      #modalTratativaComercial .modal-content {
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        box-shadow: 0 25px 60px rgba(0, 0, 0, 0.45);
        overflow: hidden;
        background: #f8fafc;
      }

      /* CABEÇALHO EXECUTIVO */
      .modal-header-tratativa {
        background: linear-gradient(135deg, #062316 0%, #0f3d26 50%, #144e31 100%);
        color: #ffffff;
        padding: 12px 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      /* LADO ESQUERDO: ROLODEX / LEQUE DE CARTÕES */
      .painel-rolodex-container {
        background: #0f172a;
        border-radius: 10px;
        padding: 16px;
        height: 100%;
        min-height: 500px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        box-shadow: inset 0 2px 8px rgba(0,0,0,0.5);
        position: relative;
        overflow: hidden;
      }
      .rolodex-deck-wrapper {
        position: relative;
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        perspective: 900px;
        cursor: ns-resize;
        user-select: none;
      }
      .rolodex-card-item {
        position: absolute;
        width: 92%;
        background: #ffffff;
        border-radius: 8px;
        padding: 12px 14px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.35);
        transition: all 0.35s cubic-bezier(0.25, 1, 0.5, 1);
        border-left: 5px solid #64748b;
        pointer-events: auto;
      }
      .rolodex-card-item.pos-0 {
        z-index: 10;
        transform: translateY(0px) scale(1) translateZ(0px);
        opacity: 1;
        box-shadow: 0 14px 30px rgba(0, 0, 0, 0.5);
      }
      .rolodex-card-item.pos-1 {
        z-index: 8;
        transform: translateY(-28px) scale(0.94) translateZ(-40px);
        opacity: 0.78;
        filter: brightness(0.92);
      }
      .rolodex-card-item.pos-2 {
        z-index: 6;
        transform: translateY(-54px) scale(0.88) translateZ(-80px);
        opacity: 0.55;
        filter: brightness(0.85);
      }
      .rolodex-card-item.pos-3 {
        z-index: 4;
        transform: translateY(-78px) scale(0.82) translateZ(-120px);
        opacity: 0.30;
        filter: brightness(0.75);
      }
      .rolodex-card-item.pos-ant {
        z-index: 12;
        transform: translateY(50px) scale(0.96) translateZ(30px);
        opacity: 0;
        pointer-events: none;
      }

      /* LADO DIREITO: COCKPIT DE DECISÃO */
      .painel-cockpit-decisao {
        background: #ffffff;
        border-radius: 10px;
        padding: 16px;
        border: 1px solid #e2e8f0;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }

      /* BOX DE PROJEÇÃO DE SPREAD / SAVING */
      .box-spread-saving {
        background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
        border: 1px dashed #22c55e;
        border-radius: 8px;
        padding: 8px 12px;
        margin-top: 8px;
        margin-bottom: 8px;
        transition: all 0.25s ease;
      }
      .box-spread-saving.modo-alerta {
        background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
        border-color: #ef4444;
      }
      .box-spread-saving.modo-avoidance {
        background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
        border-color: #0284c7;
      }
      .valor-destaque-spread {
        font-size: 1.10rem;
        font-weight: 800;
        font-family: monospace;
      }

      /* BADGES DE STATUS */
      .badge-rolodex-status {
        font-size: 0.60rem;
        font-weight: 800;
        padding: 2px 6px;
        border-radius: 4px;
        text-transform: uppercase;
      }
    </style>
  `;

  const modalHtml = `
    ${cssTratativas}
    <div class="modal fade" id="modalTratativaComercial" tabindex="-1" aria-labelledby="lblModalTratativa" aria-hidden="true" style="z-index: 100050;">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          
          <!-- TOPO DO MODAL -->
          <div class="modal-header-tratativa d-flex justify-content-between align-items-center">
            <div>
              <div class="d-flex align-items-center gap-2">
                <span class="badge bg-success text-white font-monospace" id="modalTratativaUf">--</span>
                <h6 class="modal-title fw-bold mb-0 text-white" id="modalTratativaPostoNome">Nome do Posto</h6>
              </div>
              <div class="small text-white-50 mt-1" style="font-size: 0.70rem;" id="modalTratativaSub">
                Município: -- | Operação: ROTA
              </div>
            </div>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Fechar"></button>
          </div>

          <!-- CORPO DIVIDIDO EM DUAS COLUNAS EQUILIBRADAS -->
          <div class="modal-body p-3">
            <div class="row g-3">
              
              <!-- COLUNA ESQUERDA: ROLODEX DE HISTÓRICO -->
              <div class="col-12 col-lg-5">
                <div class="painel-rolodex-container">
                  <div class="d-flex justify-content-between align-items-center border-bottom pb-2 border-secondary">
                    <span class="text-white small fw-bold text-uppercase" style="font-size: 0.68rem; letter-spacing: 0.05em;">
                      <i class="bi bi-collection-play me-1 text-success"></i> Rolodex de Negociações
                    </span>
                    <span class="badge bg-dark text-white-50 border border-secondary font-monospace" style="font-size: 0.58rem;" id="lblRolodexPosicao">
                      0 / 0
                    </span>
                  </div>

                  <!-- LEQUE DE CARTÕES NAVEGÁVEIS POR SCROLL -->
                  <div class="rolodex-deck-wrapper my-3" id="areaDeckRolodex" onwheel="rolarLequeRolodex(event)">
                    <div class="text-center text-white-50 small" id="msgDeckVazio">
                      <div class="spinner-border spinner-border-sm text-success mb-2" role="status"></div>
                      <br>Buscando histórico deste posto...
                    </div>
                  </div>

                  <!-- CONTROLES MANUAIS COM NAVEGAÇÃO CORRETA -->
                  <div class="d-flex justify-content-between align-items-center pt-2 border-top border-secondary">
                    <button type="button" class="btn btn-sm btn-outline-light py-0 px-2" style="font-size: 0.68rem;" onclick="avancarRolodex(1)">
                      <i class="bi bi-chevron-up me-1"></i> Mais Antigo
                    </button>
                    <span class="text-white-50" style="font-size: 0.58rem;">Role o mouse sobre o leque</span>
                    <button type="button" class="btn btn-sm btn-outline-light py-0 px-2" style="font-size: 0.68rem;" onclick="avancarRolodex(-1)">
                      Mais Recente <i class="bi bi-chevron-down ms-1"></i>
                    </button>
                  </div>
                </div>
              </div>

              <!-- COLUNA DIREITA: COCKPIT DA DECISÃO & CÁLCULO DE SPREAD -->
              <div class="col-12 col-lg-7">
                <div class="painel-cockpit-decisao">
                  
                  <!-- CARDS RESUMO DO POSTO AUDITADO -->
                  <div class="row g-2 mb-2">
                    <div class="col-4">
                      <div class="bg-light p-2 rounded border text-center">
                        <div class="text-muted text-uppercase fw-bold" style="font-size: 0.58rem;">Último Pago na Bomba</div>
                        <div class="fw-bold font-monospace text-dark" style="font-size: 0.88rem;" id="modalCtxPrecoMedio">R$ --</div>
                        <div class="text-muted font-monospace" style="font-size: 0.55rem;" id="modalCtxDataUltimo">--/--</div>
                      </div>
                    </div>
                    <div class="col-4">
                      <div class="bg-light p-2 rounded border text-center">
                        <div class="text-muted text-uppercase fw-bold" style="font-size: 0.58rem;">Ref. ANP (Oficial)</div>
                        <div class="fw-bold font-monospace text-primary" style="font-size: 0.88rem;" id="modalCtxRefAnp">R$ --</div>
                        <div class="text-muted" style="font-size: 0.55rem;">Mensal Vigente</div>
                      </div>
                    </div>
                    <div class="col-4">
                      <div class="bg-light p-2 rounded border text-center">
                        <div class="text-muted text-uppercase fw-bold" style="font-size: 0.58rem;">Vol. Médio Recente</div>
                        <div class="fw-bold font-monospace text-success" style="font-size: 0.88rem;" id="modalCtxVolumeMensal">-- L</div>
                        <div class="text-muted" style="font-size: 0.55rem;" id="modalCtxSubVolume">Média 3 meses ativos</div>
                      </div>
                    </div>
                  </div>

                  <div id="alertaPermissaoTratativa" class="alert alert-warning py-1 px-2 small mb-2" style="display: none; font-size: 0.70rem;">
                    <i class="bi bi-shield-lock me-1"></i> Modo apenas de consulta. Alterações restritas ao gestor da frota.
                  </div>

                  <!-- FORMULÁRIO COMERCIAL INTEGRADO -->
                  <form id="formTratativaDiesel" onsubmit="salvarTratativaFirestore(event)">
                    <div class="row g-2">
                      
                      <!-- DECISÃO ESTRATÉGICA -->
                      <div class="col-md-7">
                        <label class="form-label fw-bold text-dark small mb-1">Ação Comercial Definida:</label>
                        <select id="campoTratativaStatus" class="form-select form-select-sm" required onchange="alternarCamposDecisao()">
                          <option value="ACORDO_FECHADO">🟢 Acordo Fechado no Posto (Preço Negociado)</option>
                          <option value="POSTO_BLOQUEADO">🔴 Bloquear Posto & Realocar Demanda</option>
                          <option value="EM_ABERTO">🟡 Em Aberto (Cotação em Andamento)</option>
                          <option value="SEM_RETORNO">⚪ Sem Retorno Comercial</option>
                        </select>
                      </div>

                      <!-- INÍCIO DA VIGÊNCIA -->
                      <div class="col-md-5">
                        <label class="form-label fw-bold text-dark small mb-1">Início da Vigência:</label>
                        <input type="date" id="campoTratativaVigencia" class="form-control form-control-sm font-monospace" required>
                      </div>

                      <!-- PREÇO ACORDADO & PREÇO PROPOSTO (COST AVOIDANCE) -->
                      <div class="col-12" id="boxPrecoAcordado">
                        <div class="row g-2">
                          <div class="col-6">
                            <label class="form-label fw-bold text-dark small mb-1">Preço Negociado (R$/L):</label>
                            <input type="number" step="0.001" id="campoTratativaPrecoAcordado" class="form-control form-control-sm font-monospace" placeholder="Ex: 6.450" oninput="calcularSpreadTempoReal()">
                          </div>
                          <div class="col-6">
                            <label class="form-label fw-bold text-dark small mb-1" title="Preço pretendido pelo posto ou bomba sem negociação">
                              Preço Tabela Balcão / Pretendido:
                            </label>
                            <input type="number" step="0.001" id="campoTratativaPrecoProposto" class="form-control form-control-sm font-monospace" placeholder="Ex: 6.840 (Se novo ou alta)" oninput="calcularSpreadTempoReal()">
                            <div class="text-muted" style="font-size: 0.58rem; line-height: 1.1; margin-top: 2px;">
                              Preencha se o posto tentou reajuste ou for novo sem compras. Se foi desconto comum, deixe vazio.
                            </div>
                          </div>
                        </div>
                      </div>

                      <!-- CAMPO CONDICIONAL: REALOCAÇÃO DE POSTO -->
                      <div class="col-12" id="boxRealocacaoPosto" style="display: none;">
                        <label class="form-label fw-bold text-danger small mb-1">
                          <i class="bi bi-arrow-left-right me-1"></i> Destinar Abastecimentos Para (Posto Alternativo):
                        </label>
                        <select id="campoPostoDestinoRealocacao" class="form-select form-select-sm" onchange="calcularSpreadTempoReal()">
                          <option value="">Selecione o posto substituto no corredor...</option>
                        </select>
                      </div>

                      <!-- BOX INTELIGENTE DE CÁLCULO DE SPREAD / SAVING PROJETADO -->
                      <div class="col-12">
                        <div class="box-spread-saving" id="boxCalculoSpread">
                          <div class="d-flex justify-content-between align-items-center">
                            <div>
                              <span class="text-uppercase fw-bold text-muted" style="font-size: 0.58rem;" id="lblTituloSpread">
                                Spread & Economia Projetada
                              </span>
                              <div class="text-dark small" style="font-size: 0.70rem;" id="lblDescricaoSpread">
                                Insira o preço ou realoque o posto para calcular a projeção.
                              </div>
                            </div>
                            <div class="text-end">
                              <span class="valor-destaque-spread text-success" id="valSpreadMensal">R$ 0,00</span>
                              <div class="text-muted" style="font-size: 0.56rem;" id="lblSubSpreadMensal">Impacto Mensal Estimado</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <!-- CONTATOS -->
                      <div class="col-md-6">
                        <label class="form-label fw-bold text-dark small mb-1">Responsável / Contato:</label>
                        <input type="text" id="campoTratativaContato" class="form-control form-control-sm" placeholder="Nome do gerente comercial">
                      </div>

                      <div class="col-md-6">
                        <label class="form-label fw-bold text-dark small mb-1">Telefone / Canal:</label>
                        <input type="text" id="campoTratativaTelefone" class="form-control form-control-sm" placeholder="(00) 00000-0000">
                      </div>

                      <div class="col-12">
                        <label class="form-label fw-bold text-dark small mb-1">Condições & Motivo da Decisão:</label>
                        <textarea id="campoTratativaNotas" class="form-control form-control-sm" rows="2" placeholder="Prazo faturado (D+X), motivo do bloqueio, desvios ou observações..."></textarea>
                      </div>
                    </div>

                    <!-- RODAPÉ COM AÇÕES -->
                    <div class="d-flex justify-content-between align-items-center mt-3 pt-2 border-top">
                      <span class="text-muted font-monospace" style="font-size: 0.62rem;" id="modalTratativaInfoData">
                        Nova decisão estratégica
                      </span>
                      <div class="d-flex gap-2">
                        <button type="button" class="btn btn-sm btn-outline-secondary" data-bs-dismiss="modal">Fechar</button>
                        <button type="submit" id="btnSalvarTratativa" class="btn btn-sm btn-success fw-bold px-3">
                          <span id="txtBtnSalvarTratativa"><i class="bi bi-check-circle me-1"></i> Gravar Decisão</span>
                          <span id="spinnerBtnSalvarTratativa" class="spinner-border spinner-border-sm ms-1" style="display: none;" role="status"></span>
                        </button>
                      </div>
                    </div>
                  </form>

                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
})();

// 2. Normalização de identificador de documento
function gerarDocumentIdPosto(posto, uf) {
  const chave = `${posto}_${uf}`;
  return chave.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]/g, "_").toUpperCase();
}

// 3. Leitura em lote de todas as tratativas do Firestore (Garantindo posto, uf e municipio em memória)
async function carregarTodasTratativasFirestore() {
  try {
    const token = (typeof utilizadorAutenticado !== 'undefined' && utilizadorAutenticado) ? utilizadorAutenticado.idToken : "";
    const headers = token ? { "Authorization": `Bearer ${token}` } : {};

    const resp = await fetch(FIRESTORE_BASE_TRATATIVAS, { headers });
    if (!resp.ok) return;

    const json = await resp.json();
    if (json && json.documents && Array.isArray(json.documents)) {
      mapaTratativasCadastradas = {};
      json.documents.forEach(doc => {
        const partes = doc.name.split('/');
        const docId = partes[partes.length - 1];
        const f = doc.fields || {};

        let historicoCards = [];
        if (f.historico && f.historico.arrayValue && f.historico.arrayValue.values) {
          historicoCards = f.historico.arrayValue.values.map(v => {
            const m = v.mapValue?.fields || {};
            return {
              data: m.data?.stringValue || "",
              vigencia: m.vigencia?.stringValue || "",
              autor: m.autor?.stringValue || "",
              status: m.status?.stringValue || "EM_ABERTO",
              preco: parseFloat(m.preco?.doubleValue || m.preco?.integerValue || 0),
              preco_proposto: parseFloat(m.preco_proposto?.doubleValue || m.preco_proposto?.integerValue || 0),
              saving: parseFloat(m.saving?.doubleValue || m.saving?.integerValue || 0),
              notas: m.notas?.stringValue || "",
              contato: m.contato?.stringValue || "",
              posto_destino: m.posto_destino?.stringValue || ""
            };
          });
        } else if (f.atualizado_em) {
          historicoCards.push({
            data: f.atualizado_em?.timestampValue || "",
            vigencia: f.vigencia?.stringValue || (f.atualizado_em?.timestampValue ? f.atualizado_em.timestampValue.substring(0, 10) : ""),
            autor: f.autor?.stringValue || "Gestor",
            status: f.status?.stringValue || "EM_ABERTO",
            preco: parseFloat(f.preco_acordado?.doubleValue || f.preco_acordado?.integerValue || 0),
            preco_proposto: parseFloat(f.preco_proposto?.doubleValue || f.preco_proposto?.integerValue || 0),
            saving: 0,
            notas: f.notas?.stringValue || "",
            contato: f.contato?.stringValue || "",
            posto_destino: f.posto_destino?.stringValue || ""
          });
        }

        mapaTratativasCadastradas[docId] = {
          posto: f.posto?.stringValue || "",
          uf: f.uf?.stringValue || "",
          municipio: f.municipio?.stringValue || "",
          status: f.status?.stringValue || "EM_ABERTO",
          preco_acordado: parseFloat(f.preco_acordado?.doubleValue || f.preco_acordado?.integerValue || 0),
          preco_proposto: parseFloat(f.preco_proposto?.doubleValue || f.preco_proposto?.integerValue || 0),
          posto_destino: f.posto_destino?.stringValue || "",
          contato: f.contato?.stringValue || "",
          telefone: f.telefone?.stringValue || "",
          notas: f.notas?.stringValue || "",
          vigencia: f.vigencia?.stringValue || "",
          atualizado_em: f.atualizado_em?.timestampValue || "",
          historico: historicoCards
        };
      });
    }
  } catch (err) {
    console.warn("Aviso ao carregar lote de tratativas:", err);
  }
}

// 4. Retorna a tratativa ativa do posto
function obterTratativaPosto(posto, uf) {
  const docId = gerarDocumentIdPosto(posto, uf);
  return mapaTratativasCadastradas[docId] || null;
}

// 5. Variáveis de controle do Leque Rolodex
let listaHistoricoAtiva = [];
let indiceRolodexAtivo = 0;

// 6. Abertura do Cockpit de Decisão com agregação real de VOLUME_CICLO
async function abrirModalTratativa(nomePosto, uf, municipio, precoMedio, refAnp, ultimoPago) {
  const mesFiltroAtivo = document.getElementById('filtroMesAno') ? document.getElementById('filtroMesAno').value : 'YTD';
  
  let volumeMesCalculo = 0;
  let subVolumeTexto = "Média 3 meses ativos";
  let ultimoPrecoNaBomba = ultimoPago || precoMedio || 0;
  let dataUltimoNaBomba = "--/--";

  if (typeof baseRegistrosMensais !== 'undefined' && Array.isArray(baseRegistrosMensais)) {
    const registrosDoPosto = baseRegistrosMensais.filter(d => d.POSTO === nomePosto && d.UF_POSTO === uf);

    if (mesFiltroAtivo !== 'YTD') {
      const ciclosDoMes = registrosDoPosto.filter(d => d.MES_ANO === mesFiltroAtivo);
      if (ciclosDoMes.length > 0) {
        volumeMesCalculo = ciclosDoMes.reduce((acc, c) => acc + parseFloat(c.VOLUME_CICLO || 0), 0);

        ciclosDoMes.sort((a, b) => (b.DATA_FIM_CICLO || '').localeCompare(a.DATA_FIM_CICLO || ''));
        const ultCiclo = ciclosDoMes[0];
        ultimoPrecoNaBomba = parseFloat(ultCiclo.VALOR_UNITARIO || 0);

        if (typeof formatarDataDiaMes === 'function') {
          dataUltimoNaBomba = formatarDataDiaMes(ultCiclo.DATA_FIM_CICLO);
        } else {
          dataUltimoNaBomba = (ultCiclo.DATA_FIM_CICLO || '').substring(0, 10);
        }
      }
      subVolumeTexto = `Litragem em ${mesFiltroAtivo}`;
    } else {
      const volPorMes = {};
      registrosDoPosto.forEach(d => {
        const m = d.MES_ANO;
        if (m) {
          volPorMes[m] = (volPorMes[m] || 0) + parseFloat(d.VOLUME_CICLO || 0);
        }
      });

      const mesesComConsumo = Object.keys(volPorMes)
        .filter(m => volPorMes[m] > 0)
        .sort()
        .reverse()
        .slice(0, 3);

      if (mesesComConsumo.length > 0) {
        const somaVolUltimos3 = mesesComConsumo.reduce((acc, m) => acc + volPorMes[m], 0);
        volumeMesCalculo = somaVolUltimos3 / mesesComConsumo.length;
        subVolumeTexto = `Média de ${mesesComConsumo.length} ${mesesComConsumo.length === 1 ? 'mês ativo' : 'meses ativos'}`;
      }

      let ultCicloGeral = null;
      registrosDoPosto.forEach(d => {
        if (!ultCicloGeral || (d.DATA_FIM_CICLO || '') > (ultCicloGeral.DATA_FIM_CICLO || '')) {
          ultCicloGeral = d;
        }
      });

      if (ultCicloGeral) {
        ultimoPrecoNaBomba = parseFloat(ultCicloGeral.VALOR_UNITARIO || 0);
        if (typeof formatarDataDiaMes === 'function') {
          dataUltimoNaBomba = formatarDataDiaMes(ultCicloGeral.DATA_FIM_CICLO);
        } else {
          dataUltimoNaBomba = (ultCicloGeral.DATA_FIM_CICLO || '').substring(0, 10);
        }
      }
    }
  }

  postoAtivoTratativa = { 
    nomePosto, 
    uf, 
    municipio, 
    precoMedio: precoMedio || 0, 
    refAnp: refAnp || 0, 
    ultimoPago: ultimoPrecoNaBomba,
    volumeMes: volumeMesCalculo
  };

  // Preenchimento dos dados visuais no cabeçalho
  document.getElementById('modalTratativaPostoNome').innerText = nomePosto;
  document.getElementById('modalTratativaUf').innerText = uf || '--';
  document.getElementById('modalTratativaSub').innerText = `Município: ${municipio || 'Não Identificado'} | Operação: ROTA`;

  document.getElementById('modalCtxPrecoMedio').innerText = ultimoPrecoNaBomba > 0 ? `R$ ${ultimoPrecoNaBomba.toFixed(3)}` : '--';
  document.getElementById('modalCtxDataUltimo').innerText = `em ${dataUltimoNaBomba}`;
  document.getElementById('modalCtxRefAnp').innerText = refAnp > 0 ? `R$ ${refAnp.toFixed(3)}` : '--';
  document.getElementById('modalCtxVolumeMensal').innerText = volumeMesCalculo > 0 ? `${Math.round(volumeMesCalculo).toLocaleString('pt-BR')} L` : '--';
  document.getElementById('modalCtxSubVolume').innerText = subVolumeTexto;

  popularSeletorPostosDestino(nomePosto, uf);

  const hojeStr = new Date().toISOString().substring(0, 10);
  document.getElementById('campoTratativaVigencia').value = hojeStr;

  const modalEl = document.getElementById('modalTratativaComercial');
  const bsModal = new bootstrap.Modal(modalEl);
  bsModal.show();

  let trat = obterTratativaPosto(nomePosto, uf);

  if (!trat) {
    const docId = gerarDocumentIdPosto(nomePosto, uf);
    try {
      const token = (typeof utilizadorAutenticado !== 'undefined' && utilizadorAutenticado) ? utilizadorAutenticado.idToken : "";
      const headers = token ? { "Authorization": `Bearer ${token}` } : {};
      const resp = await fetch(`${FIRESTORE_BASE_TRATATIVAS}/${docId}`, { headers });
      
      if (resp.ok) {
        const docJson = await resp.json();
        const f = docJson.fields || {};

        let historicoResgatado = [];
        if (f.historico && f.historico.arrayValue && f.historico.arrayValue.values) {
          historicoResgatado = f.historico.arrayValue.values.map(v => {
            const m = v.mapValue?.fields || {};
            return {
              data: m.data?.stringValue || "",
              vigencia: m.vigencia?.stringValue || "",
              autor: m.autor?.stringValue || "",
              status: m.status?.stringValue || "EM_ABERTO",
              preco: parseFloat(m.preco?.doubleValue || m.preco?.integerValue || 0),
              preco_proposto: parseFloat(m.preco_proposto?.doubleValue || m.preco_proposto?.integerValue || 0),
              saving: parseFloat(m.saving?.doubleValue || m.saving?.integerValue || 0),
              notas: m.notas?.stringValue || "",
              contato: m.contato?.stringValue || "",
              posto_destino: m.posto_destino?.stringValue || ""
            };
          });
        } else if (f.atualizado_em || f.preco_acordado) {
          historicoResgatado.push({
            data: f.atualizado_em?.timestampValue || new Date().toISOString(),
            vigencia: f.vigencia?.stringValue || (f.atualizado_em?.timestampValue ? f.atualizado_em.timestampValue.substring(0, 10) : hojeStr),
            autor: f.autor?.stringValue || "willian.klapowsko@cargosoft.com.br",
            status: f.status?.stringValue || "ACORDO_FECHADO",
            preco: parseFloat(f.preco_acordado?.doubleValue || f.preco_acordado?.integerValue || 0),
            preco_proposto: parseFloat(f.preco_proposto?.doubleValue || f.preco_proposto?.integerValue || 0),
            saving: 0,
            notas: f.notas?.stringValue || "",
            contato: f.contato?.stringValue || "",
            posto_destino: f.posto_destino?.stringValue || ""
          });
        }

        trat = {
          posto: f.posto?.stringValue || nomePosto,
          uf: f.uf?.stringValue || uf,
          municipio: f.municipio?.stringValue || municipio,
          status: f.status?.stringValue || "ACORDO_FECHADO",
          preco_acordado: parseFloat(f.preco_acordado?.doubleValue || f.preco_acordado?.integerValue || 0),
          preco_proposto: parseFloat(f.preco_proposto?.doubleValue || f.preco_proposto?.integerValue || 0),
          posto_destino: f.posto_destino?.stringValue || "",
          contato: f.contato?.stringValue || "",
          telefone: f.telefone?.stringValue || "",
          notas: f.notas?.stringValue || "",
          vigencia: f.vigencia?.stringValue || hojeStr,
          atualizado_em: f.atualizado_em?.timestampValue || "",
          historico: historicoResgatado
        };
        mapaTratativasCadastradas[docId] = trat;
      }
    } catch (e) {
      console.warn("Falha na consulta pontual do posto:", e);
    }
  }

  listaHistoricoAtiva = (trat && Array.isArray(trat.historico)) ? [...trat.historico] : [];
  indiceRolodexAtivo = 0;
  renderizarLequeRolodex();

  if (trat) {
    document.getElementById('campoTratativaStatus').value = trat.status || "ACORDO_FECHADO";
    document.getElementById('campoTratativaPrecoAcordado').value = trat.preco_acordado > 0 ? trat.preco_acordado : "";
    document.getElementById('campoTratativaPrecoProposto').value = trat.preco_proposto > 0 ? trat.preco_proposto : "";
    document.getElementById('campoPostoDestinoRealocacao').value = trat.posto_destino || "";
    document.getElementById('campoTratativaContato').value = trat.contato || "";
    document.getElementById('campoTratativaTelefone').value = trat.telefone || "";
    document.getElementById('campoTratativaNotas').value = trat.notas || "";
    if (trat.vigencia) {
      document.getElementById('campoTratativaVigencia').value = trat.vigencia;
    }
  } else {
    document.getElementById('campoTratativaStatus').value = "ACORDO_FECHADO";
    document.getElementById('campoTratativaPrecoAcordado').value = "";
    document.getElementById('campoTratativaPrecoProposto').value = "";
    document.getElementById('campoPostoDestinoRealocacao').value = "";
    document.getElementById('campoTratativaContato').value = "";
    document.getElementById('campoTratativaTelefone').value = "";
    document.getElementById('campoTratativaNotas').value = "";
  }

  alternarCamposDecisao();
  calcularSpreadTempoReal();

  // Controle de permissão RBAC
  const emailLogado = (typeof utilizadorAutenticado !== 'undefined' && utilizadorAutenticado) ? utilizadorAutenticado.email : "";
  const ehAdmin = emailLogado.toLowerCase().includes("willian") || emailLogado.toLowerCase().includes("thayane");

  const btnSalvar = document.getElementById('btnSalvarTratativa');
  const alertaPermissao = document.getElementById('alertaPermissaoTratativa');
  const campos = document.querySelectorAll('#formTratativaDiesel input, #formTratativaDiesel select, #formTratativaDiesel textarea');

  if (ehAdmin) {
    alertaPermissao.style.display = 'none';
    btnSalvar.style.display = 'inline-block';
    campos.forEach(c => c.removeAttribute('disabled'));
  } else {
    alertaPermissao.style.display = 'block';
    btnSalvar.style.display = 'none';
    campos.forEach(c => c.setAttribute('disabled', 'disabled'));
  }
}

// 7. Popula a lista de postos para realocação de volume
function popularSeletorPostosDestino(postoExcluido, uf) {
  const select = document.getElementById('campoPostoDestinoRealocacao');
  select.innerHTML = '<option value="">Selecione o posto substituto no corredor...</option>';

  if (typeof baseRegistrosMensais === 'undefined') return;

  const postosCandidatos = {};
  baseRegistrosMensais.forEach(d => {
    if (d.POSTO !== postoExcluido && d.TIPO_OPERACAO === 'EXTERNO') {
      const preco = parseFloat(d.VALOR_UNITARIO || 0);
      if (!postosCandidatos[d.POSTO] || (d.DATA_FIM_CICLO || '') > (postosCandidatos[d.POSTO].data || '')) {
        postosCandidatos[d.POSTO] = {
          nome: d.POSTO,
          uf: d.UF_POSTO,
          municipio: d.MUNICIPIO_POSTO,
          preco: preco,
          data: d.DATA_FIM_CICLO || ''
        };
      }
    }
  });

  Object.values(postosCandidatos)
    .sort((a, b) => a.preco - b.preco)
    .forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.nome;
      opt.dataset.preco = p.preco;
      opt.innerText = `[${p.uf}] ${p.nome} - R$ ${p.preco.toFixed(3)}`;
      select.appendChild(opt);
    });
}

// 8. Alterna visibilidade entre Acordo Direto ou Realocação
function alternarCamposDecisao() {
  const status = document.getElementById('campoTratativaStatus').value;
  const boxPreco = document.getElementById('boxPrecoAcordado');
  const boxRealocacao = document.getElementById('boxRealocacaoPosto');

  if (status === 'POSTO_BLOQUEADO') {
    boxPreco.style.display = 'none';
    boxRealocacao.style.display = 'block';
  } else {
    boxPreco.style.display = 'block';
    boxRealocacao.style.display = 'none';
  }
  calcularSpreadTempoReal();
}

// 9. Cálculo em tempo real do Spread, Cost Avoidance e Saving Projetado (Sem inventar números)
function calcularSpreadTempoReal() {
  if (!postoAtivoTratativa) return;

  const status = document.getElementById('campoTratativaStatus').value;
  const precoBase = postoAtivoTratativa.ultimoPago > 0 ? postoAtivoTratativa.ultimoPago : postoAtivoTratativa.precoMedio;
  const volume = postoAtivoTratativa.volumeMes || 0;

  const box = document.getElementById('boxCalculoSpread');
  const lblTitulo = document.getElementById('lblTituloSpread');
  const lblDesc = document.getElementById('lblDescricaoSpread');
  const valSpread = document.getElementById('valSpreadMensal');
  const lblSub = document.getElementById('lblSubSpreadMensal');

  box.classList.remove('modo-alerta', 'modo-avoidance');

  if (status === 'ACORDO_FECHADO') {
    const precoAcordado = parseFloat(document.getElementById('campoTratativaPrecoAcordado').value) || 0;
    const precoProposto = parseFloat(document.getElementById('campoTratativaPrecoProposto').value) || 0;

    if (precoAcordado > 0) {
      // CENÁRIO A: COST AVOIDANCE (Quando o posto pediu um valor maior de balcão e travamos abaixo)
      if (precoProposto > precoAcordado) {
        const diffAvoidance = precoProposto - precoAcordado;
        const totalAvoidance = diffAvoidance * (volume > 0 ? volume : 1);

        box.classList.add('modo-avoidance');
        lblTitulo.innerText = "🛡️ Proteção de Caixa (Cost Avoidance)";
        lblDesc.innerHTML = `Alta evitada de <strong>R$ ${diffAvoidance.toFixed(3)}/L</strong> frente ao balcão/proposta pretendida.`;
        valSpread.innerText = volume > 0 ? `+ R$ ${Math.round(totalAvoidance).toLocaleString('pt-BR')}` : `R$ ${diffAvoidance.toFixed(3)}/L`;
        valSpread.className = "valor-destaque-spread text-primary";
        lblSub.innerText = volume > 0 ? "Custo Evitado Projetado" : "Saving Unitário (Sem volume no mês)";
        return;
      }

      // CENÁRIO B: SPREAD DIRETO VS ÚLTIMO PAGO (Histórico real)
      if (precoBase > 0) {
        const diffPorLitro = precoBase - precoAcordado;
        const savingTotal = diffPorLitro * (volume > 0 ? volume : 1);

        if (diffPorLitro >= 0) {
          lblTitulo.innerText = "Spread de Redução de Preço";
          lblDesc.innerHTML = `Desconto de <strong>R$ ${diffPorLitro.toFixed(3)}/L</strong> sobre o último preço pago.`;
          valSpread.innerText = volume > 0 ? `+ R$ ${Math.round(savingTotal).toLocaleString('pt-BR')}` : `R$ ${diffPorLitro.toFixed(3)}/L`;
          valSpread.className = "valor-destaque-spread text-success";
          lblSub.innerText = volume > 0 ? "Impacto Mensal Estimado" : "Desconto Unitário (Sem volume no mês)";
        } else {
          box.classList.add('modo-alerta');
          lblTitulo.innerText = "Reajuste Aceito na Mesa";
          lblDesc.innerHTML = `Preço acordado é <strong>R$ ${Math.abs(diffPorLitro).toFixed(3)}/L superior</strong> ao último pago.`;
          valSpread.innerText = volume > 0 ? `- R$ ${Math.round(Math.abs(savingTotal)).toLocaleString('pt-BR')}` : `- R$ ${Math.abs(diffPorLitro).toFixed(3)}/L`;
          valSpread.className = "valor-destaque-spread text-danger";
          lblSub.innerText = volume > 0 ? "Acréscimo de Custo" : "Acréscimo Unitário";
        }
        return;
      }

      // CENÁRIO C: POSTO NOVO SEM HISTÓRICO E SEM BALCÃO INFORMADO (Zero chute)
      lblTitulo.innerText = "Base Inaugural";
      lblDesc.innerHTML = "Posto sem histórico prévio de compras e sem preço balcão preenchido. Saving será apurado após histórico.";
      valSpread.innerText = "R$ 0,00";
      valSpread.className = "valor-destaque-spread text-muted";
      lblSub.innerText = "Sem histórico comparativo";
      return;
    }
  } else if (status === 'POSTO_BLOQUEADO') {
    const sel = document.getElementById('campoPostoDestinoRealocacao');
    const opt = sel.options[sel.selectedIndex];
    const precoDestino = opt ? parseFloat(opt.dataset.preco || 0) : 0;

    if (precoDestino > 0 && precoBase > 0) {
      const diffPorLitro = precoBase - precoDestino;
      const savingTotal = diffPorLitro * (volume > 0 ? volume : 1);

      lblTitulo.innerText = "Saving por Realocação de Rota";
      lblDesc.innerHTML = `Migração de volume para posto mais barato (-R$ ${diffPorLitro.toFixed(3)}/L).`;
      valSpread.innerText = volume > 0 ? `+ R$ ${Math.round(savingTotal).toLocaleString('pt-BR')}` : `R$ ${diffPorLitro.toFixed(3)}/L`;
      valSpread.className = "valor-destaque-spread text-success";
      lblSub.innerText = volume > 0 ? "Impacto Mensal Estimado" : "Diferencial Unitário";
      return;
    }
  }

  lblTitulo.innerText = "Projeção de Saving em Aberto";
  lblDesc.innerText = "Defina o valor acordado ou selecione o posto substituto.";
  valSpread.innerText = "R$ 0,00";
  valSpread.className = "valor-destaque-spread text-muted";
  lblSub.innerText = "Impacto Mensal Estimado";
}

// 10. Motor Visual do Leque Rolodex (Wheel & Click)
function rolarLequeRolodex(event) {
  event.preventDefault();
  if (listaHistoricoAtiva.length <= 1) return;

  if (event.deltaY > 0) {
    avancarRolodex(1);
  } else {
    avancarRolodex(-1);
  }
}

function avancarRolodex(direcao) {
  if (listaHistoricoAtiva.length <= 1) return;
  indiceRolodexAtivo += direcao;
  if (indiceRolodexAtivo < 0) indiceRolodexAtivo = 0;
  if (indiceRolodexAtivo >= listaHistoricoAtiva.length) indiceRolodexAtivo = listaHistoricoAtiva.length - 1;
  renderizarLequeRolodex();
}

function renderizarLequeRolodex() {
  const container = document.getElementById('areaDeckRolodex');
  const lblPosicao = document.getElementById('lblRolodexPosicao');

  if (!listaHistoricoAtiva || listaHistoricoAtiva.length === 0) {
    container.innerHTML = `
      <div class="text-center text-white-50 small" id="msgDeckVazio">
        <i class="bi bi-clock-history d-block fs-3 mb-2"></i>
        Nenhuma negociação passada registrada.<br>
        O registro atual inaugurará o histórico deste posto.
      </div>
    `;
    lblPosicao.innerText = "0 / 0";
    return;
  }

  lblPosicao.innerText = `${indiceRolodexAtivo + 1} / ${listaHistoricoAtiva.length}`;

  let htmlCards = "";
  listaHistoricoAtiva.forEach((card, idx) => {
    const distancia = idx - indiceRolodexAtivo;
    let classePosicao = "pos-ant";

    if (distancia === 0) classePosicao = "pos-0";
    else if (distancia === 1) classePosicao = "pos-1";
    else if (distancia === 2) classePosicao = "pos-2";
    else if (distancia === 3) classePosicao = "pos-3";

    const corBorda = card.status === 'ACORDO_FECHADO' ? '#22c55e' : (card.status === 'POSTO_BLOQUEADO' ? '#ef4444' : '#eab308');
    const badgeStatus = card.status === 'ACORDO_FECHADO' 
      ? '<span class="badge bg-success badge-rolodex-status">Acordo Fechado</span>' 
      : (card.status === 'POSTO_BLOQUEADO' ? '<span class="badge bg-danger badge-rolodex-status">Bloqueado</span>' : '<span class="badge bg-warning text-dark badge-rolodex-status">Em Cotação</span>');

    const dataRegFmt = card.data ? new Date(card.data).toLocaleDateString('pt-BR') : "--";
    const vigenciaFmt = card.vigencia ? card.vigencia.split('-').reverse().join('/') : dataRegFmt;

    let tagAvoidanceHtml = "";
    if (card.preco_proposto && card.preco_proposto > card.preco) {
      const avoid = card.preco_proposto - card.preco;
      tagAvoidanceHtml = `<span class="badge bg-primary-subtle text-primary border border-primary-subtle ms-1" style="font-size:0.55rem;">Avoidance: -R$ ${avoid.toFixed(3)}</span>`;
    }

    htmlCards += `
      <div class="rolodex-card-item ${classePosicao}" style="border-left-color: ${corBorda};" onclick="indiceRolodexAtivo = ${idx}; renderizarLequeRolodex();">
        <div class="d-flex justify-content-between align-items-center mb-1">
          <div>
            ${badgeStatus}
            ${tagAvoidanceHtml}
          </div>
          <span class="badge bg-light text-dark border font-monospace" style="font-size: 0.58rem;" title="Data de Início da Vigência">
            Vigência: ${vigenciaFmt}
          </span>
        </div>
        <div class="d-flex justify-content-between align-items-baseline">
          <span class="fw-bold font-monospace text-dark" style="font-size: 0.95rem;">
            ${card.preco > 0 ? `R$ ${card.preco.toFixed(3)}` : (card.posto_destino ? 'Migrado' : 'Sem Preço')}
          </span>
          <span class="text-muted" style="font-size: 0.60rem;">Por: ${(card.autor || 'Gestor').split('@')[0]}</span>
        </div>
        ${card.posto_destino ? `<div class="text-danger fw-bold mt-1" style="font-size:0.62rem;"><i class="bi bi-arrow-right me-1"></i>Destino: ${card.posto_destino}</div>` : ''}
        <div class="text-secondary small mt-1 text-truncate" style="font-size: 0.65rem;" title="${card.notas}">
          ${card.notas || 'Sem observações adicionais.'}
        </div>
      </div>
    `;
  });

  container.innerHTML = htmlCards;
}

// 11. Gravação Completa no Firestore com acúmulo no histórico e vigência (Preservando schema exato)
async function salvarTratativaFirestore(event) {
  event.preventDefault();
  if (!postoAtivoTratativa) return;

  const btn = document.getElementById('btnSalvarTratativa');
  const txtBtn = document.getElementById('txtBtnSalvarTratativa');
  const spinner = document.getElementById('spinnerBtnSalvarTratativa');

  btn.disabled = true;
  txtBtn.innerText = "A gravar decisão...";
  spinner.style.display = 'inline-block';

  const docId = gerarDocumentIdPosto(postoAtivoTratativa.nomePosto, postoAtivoTratativa.uf);
  const status = document.getElementById('campoTratativaStatus').value;
  const vigencia = document.getElementById('campoTratativaVigencia').value || new Date().toISOString().substring(0, 10);
  const precoAcordado = parseFloat(document.getElementById('campoTratativaPrecoAcordado').value) || 0;
  const precoProposto = parseFloat(document.getElementById('campoTratativaPrecoProposto').value) || 0;
  const postoDestino = document.getElementById('campoPostoDestinoRealocacao').value;
  const contato = document.getElementById('campoTratativaContato').value.trim();
  const telefone = document.getElementById('campoTratativaTelefone').value.trim();
  const notas = document.getElementById('campoTratativaNotas').value.trim();
  const autorEmail = (typeof utilizadorAutenticado !== 'undefined' && utilizadorAutenticado) ? utilizadorAutenticado.email : "ADMIN";
  const token = (typeof utilizadorAutenticado !== 'undefined' && utilizadorAutenticado) ? utilizadorAutenticado.idToken : "";

  // Cálculo auditável do saving financeiro projetado para gravação no histórico
  let savingCalculado = 0;
  const volCalc = postoAtivoTratativa.volumeMes || 0;
  const pBase = postoAtivoTratativa.ultimoPago > 0 ? postoAtivoTratativa.ultimoPago : postoAtivoTratativa.precoMedio;

  if (status === 'ACORDO_FECHADO') {
    if (precoProposto > precoAcordado && precoAcordado > 0) {
      savingCalculado = (precoProposto - precoAcordado) * volCalc;
    } else if (pBase > precoAcordado && precoAcordado > 0) {
      savingCalculado = (pBase - precoAcordado) * volCalc;
    }
  } else if (status === 'POSTO_BLOQUEADO') {
    const sel = document.getElementById('campoPostoDestinoRealocacao');
    const opt = sel ? sel.options[sel.selectedIndex] : null;
    const pDest = opt ? parseFloat(opt.dataset.preco || 0) : 0;
    if (pDest > 0 && pBase > pDest) {
      savingCalculado = (pBase - pDest) * volCalc;
    }
  }

  // Nova ficha adicionada no topo do leque Rolodex
  const novaFicha = {
    data: new Date().toISOString(),
    vigencia: vigencia,
    autor: autorEmail,
    status: status,
    preco: precoAcordado,
    preco_proposto: precoProposto,
    saving: savingCalculado,
    notas: notas,
    contato: contato,
    posto_destino: postoDestino
  };

  const historicoAtualizado = [novaFicha, ...listaHistoricoAtiva].slice(0, 15);

  const arrayHistoricoFirestore = historicoAtualizado.map(h => ({
    mapValue: {
      fields: {
        data: { stringValue: h.data },
        vigencia: { stringValue: h.vigencia || "" },
        autor: { stringValue: h.autor },
        status: { stringValue: h.status },
        preco: { doubleValue: h.preco },
        preco_proposto: { doubleValue: h.preco_proposto || 0 },
        saving: { doubleValue: h.saving },
        notas: { stringValue: h.notas },
        contato: { stringValue: h.contato },
        posto_destino: { stringValue: h.posto_destino }
      }
    }
  }));

  const payload = {
    fields: {
      posto: { stringValue: postoAtivoTratativa.nomePosto },
      uf: { stringValue: postoAtivoTratativa.uf },
      municipio: { stringValue: postoAtivoTratativa.municipio || "" },
      status: { stringValue: status },
      vigencia: { stringValue: vigencia },
      preco_acordado: { doubleValue: precoAcordado },
      preco_proposto: { doubleValue: precoProposto },
      posto_destino: { stringValue: postoDestino },
      contato: { stringValue: contato },
      telefone: { stringValue: telefone },
      notas: { stringValue: notas },
      atualizado_em: { timestampValue: new Date().toISOString() },
      autor: { stringValue: autorEmail },
      historico: { arrayValue: { values: arrayHistoricoFirestore } }
    }
  };

  try {
    const url = `${FIRESTORE_BASE_TRATATIVAS}/${docId}`;
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const resp = await fetch(url, {
      method: "PATCH",
      headers: headers,
      body: JSON.stringify(payload)
    });

    if (!resp.ok) throw new Error(`Falha ao gravar no Firestore: HTTP ${resp.status}`);

    mapaTratativasCadastradas[docId] = {
      posto: postoAtivoTratativa.nomePosto,
      uf: postoAtivoTratativa.uf,
      municipio: postoAtivoTratativa.municipio || "",
      status,
      vigencia,
      preco_acordado: precoAcordado,
      preco_proposto: precoProposto,
      posto_destino: postoDestino,
      contato,
      telefone,
      notas,
      atualizado_em: new Date().toISOString(),
      historico: historicoAtualizado
    };

    txtBtn.innerHTML = `<i class="bi bi-check-all me-1"></i> Decisão Gravada!`;

    if (typeof processarPainel === 'function') {
      processarPainel();
    }

    setTimeout(() => {
      const modalEl = document.getElementById('modalTratativaComercial');
      const inst = bootstrap.Modal.getInstance(modalEl);
      if (inst) inst.hide();
    }, 600);

  } catch (err) {
    alert("Erro ao gravar tratativa: " + err.message);
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      txtBtn.innerHTML = `<i class="bi bi-check-circle me-1"></i> Gravar Decisão`;
      spinner.style.display = 'none';
    }, 800);
  }
}
