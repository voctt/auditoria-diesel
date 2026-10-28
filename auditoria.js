/* ==========================================================================
   MÓDULO DE AUDITORIA COMERCIAL, GOVERNANÇA DE SPREADS & MICRO-DRILLDOWN
   CARGOSOFT | VOCTT INTELIGÊNCIA DE FROTAS
   ========================================================================== */

// Estado global de ordenação da tabela master de auditoria
let auditoriaColunaOrdenacao = "savingItem"; // Padrão: maior saving no topo
let auditoriaDirecaoOrdenacao = "desc";

/**
 * Alterna a coluna de ordenação ou inverte a direção
 */
function ordenarTabelaAuditoriaPor(coluna) {
  if (auditoriaColunaOrdenacao === coluna) {
    auditoriaDirecaoOrdenacao = auditoriaDirecaoOrdenacao === "asc" ? "desc" : "asc";
  } else {
    auditoriaColunaOrdenacao = coluna;
    // Volume e Saving ordenam decrescente por padrão no primeiro clique
    auditoriaDirecaoOrdenacao = (coluna === "volumeAuditado" || coluna === "savingItem") ? "desc" : "asc";
  }
  renderizarAbaAuditoriaComercial();
}

/**
 * Alterna a visibilidade da gaveta analítica (drill-down micro)
 */
function alternarGavetaMicro(id) {
  const el = document.getElementById(id);
  if (el) {
    el.style.display = (el.style.display === 'none' || el.style.display === '') ? 'table-row' : 'none';
  }
}

/**
 * Filtro de texto instantâneo da aba de auditoria
 */
function filtrarTabelaAuditoriaTexto() {
  renderizarAbaAuditoriaComercial();
}

/**
 * Atualiza os cards superiores (KPIs de Governança)
 */
function atualizarCardsAuditoriaKPIs(aderenciaPerc, savingTotal, desviosQtd, margemPreservadaQtd) {
  const elAderencia = document.getElementById('kpiAuditoriaAderencia');
  const elSaving = document.getElementById('kpiAuditoriaSavingTotal');
  const elDesvios = document.getElementById('kpiAuditoriaDesviosQtd');
  const elMargem = document.getElementById('kpiAuditoriaMargemPreservada');
  const subPerda = document.getElementById('kpiAuditoriaPerdaSub');

  if (elAderencia) elAderencia.innerText = `${aderenciaPerc.toFixed(1).replace('.', ',')}%`;
  if (elSaving) elSaving.innerText = `R$ ${Math.round(savingTotal).toLocaleString('pt-BR')}`;
  if (elDesvios) elDesvios.innerText = desviosQtd;
  if (elMargem) elMargem.innerText = margemPreservadaQtd;

  if (subPerda) {
    if (desviosQtd > 0) {
      subPerda.innerText = `${desviosQtd} postos com cobrança acima do combinado`;
      subPerda.className = "kpi-sub text-danger fw-bold";
    } else {
      subPerda.innerText = "Nenhum furo de preço identificado";
      subPerda.className = "kpi-sub text-success";
    }
  }
}

/**
 * Gera o texto do Parecer Executivo Dinâmico para o Box do Micro
 */
function gerarParecerExecutivoPosto(p) {
  const volFmt = Math.round(p.volumeAuditado).toLocaleString('pt-BR');
  const precoFmt = p.ultimoPrecoBomba > 0 ? p.ultimoPrecoBomba.toFixed(3) : p.precoAcordado.toFixed(3);
  const anpFmt = p.refAnpValor > 0 ? p.refAnpValor.toFixed(3) : '--';
  const savingFmt = Math.round(p.savingItem).toLocaleString('pt-BR');

  if (p.tipoConformidade === 'CONFORME') {
    return `Nesta praça, foram auditados <strong>${volFmt} L</strong> faturados exatamente no preço acordado (<strong>R$ ${precoFmt}/L</strong>). Frente à média estadual da ANP de <strong>R$ ${anpFmt}/L</strong>, a negociação sustentou um spread de <strong>${p.gapAnp.toFixed(3)}/L</strong>, garantindo <strong>+R$ ${savingFmt}</strong> direto no caixa da Cargosoft.`;
  }

  if (p.tipoConformidade === 'BLINDADO') {
    return `O posto acompanhou repasses de alta das distribuidoras, chegando a <strong>R$ ${precoFmt}/L</strong>. Porém, o acordo de volume manteve o combustível <strong>R$ ${Math.abs(p.gapAnp).toFixed(3)}/L abaixo da média oficial da ANP (R$ ${anpFmt}/L)</strong>, protegendo <strong>+R$ ${savingFmt}</strong> contra o preço de bomba comum.`;
  }

  if (p.tipoConformidade === 'EXPIRADO') {
    return `Alerta de SLA Operacional: Acordo firmado há mais de 30 dias. O posto subiu a bomba para <strong>R$ ${precoFmt}/L</strong> (+R$ ${p.gapAcordo.toFixed(3)}/L acima do acordo inicial). Necessário chamar o gerente para <strong>renovar a negociação</strong> e travar nova tabela.`;
  }

  if (p.tipoConformidade === 'QUEBRA') {
    const perdaEstimada = Math.round(p.gapAcordo * p.volumeAuditado).toLocaleString('pt-BR');
    return `Furo Comercial Imediato: O posto cobrou <strong>R$ ${precoFmt}/L</strong> (<strong>+R$ ${p.gapAcordo.toFixed(3)}/L acima do combinado</strong>) logo após o fechamento da tabela. Desvio faturado de <strong>R$ ${perdaEstimada}</strong> passível de contestação e desconto na fatura quinzenal.`;
  }

  if (p.tipoConformidade === 'REAJUSTE') {
    return `Praça em acompanhamento: O posto reajustou para <strong>R$ ${precoFmt}/L</strong>, reduzindo a vantagem negociada frente à ANP (<strong>R$ ${anpFmt}/L</strong>). Recomendado contatar o posto para alinhar a condição comercial.`;
  }

  if (p.tipoConformidade === 'INAUGURAL') {
    return `Posto com acordo cadastrado e sem histórico prévio recente de abastecimento. Volume de <strong>${volFmt} L</strong> faturado a <strong>R$ ${precoFmt}/L</strong>. Base inaugural para comparação nos próximos fechamentos.`;
  }

  return `Posto com tratativa cadastrada aguardando registro de consumo pós-vigência para consolidação dos números de auditoria.`;
}

/**
 * Motor Principal de Renderização da Aba de Auditoria Comercial
 */
function renderizarAbaAuditoriaComercial() {
  const corpoTabela = document.getElementById('corpoTabelaAuditoria');
  if (!corpoTabela) return;

  const redeSel = document.getElementById('filtroAuditoriaRede') ? document.getElementById('filtroAuditoriaRede').value : "";
  const ufSel = document.getElementById('filtroAuditoriaUf') ? document.getElementById('filtroAuditoriaUf').value : "";
  const statusSel = document.getElementById('filtroAuditoriaStatus') ? document.getElementById('filtroAuditoriaStatus').value : "";
  const buscaTxt = document.getElementById('buscaAuditoriaTexto') ? document.getElementById('buscaAuditoriaTexto').value.trim().toLowerCase() : "";

  const mapaTrat = (typeof mapaTratativasCadastradas !== 'undefined') ? mapaTratativasCadastradas : {};
  const chavesTratativas = Object.keys(mapaTrat);

  if (chavesTratativas.length === 0) {
    corpoTabela.innerHTML = `
      <tr>
        <td colspan="11" class="text-center py-5 text-muted">
          <i class="bi bi-journal-x fs-2 d-block mb-2 text-secondary"></i>
          Nenhuma negociação foi registrada ainda.<br>
          Acesse o painel principal e clique no botão <strong>Tratativa</strong> em qualquer posto para cadastrar acordos.
        </td>
      </tr>
    `;
    const lblContador = document.getElementById('lblAuditoriaContador');
    if (lblContador) lblContador.innerText = "0 postos com tratativa";
    atualizarCardsAuditoriaKPIs(0, 0, 0, 0);
    return;
  }

  let listaAuditoria = [];
  let somaSavingRealizadoTotal = 0;
  let totalAbastecimentosAuditados = 0;
  let totalAbastecimentosConformes = 0;
  let qtdDesviosPosVigencia = 0;
  let qtdMargemPreservada = 0;

  chavesTratativas.forEach(docId => {
    const trat = mapaTrat[docId];
    if (!trat) return;

    // Resgate exato dos dados do posto gravados na tratativa (Sem fatiar docId)
    const partesDoc = docId.split('_');
    const ufFallback = partesDoc[partesDoc.length - 1];
    const nomeFallback = partesDoc.slice(0, partesDoc.length - 1).join(' ');

    const nomePostoAlvo = trat.posto || nomeFallback;
    const ufPostoAlvo = trat.uf || ufFallback;

    // VÍNCULO ESTRITO E CIRÚRGICO: Exige nome idêntico e mesma UF (Evita cruzar Cariri com Wanderlândia)
    const regsPosto = (typeof baseRegistrosMensais !== 'undefined' && Array.isArray(baseRegistrosMensais))
      ? baseRegistrosMensais.filter(d => 
          d.POSTO === nomePostoAlvo && d.UF_POSTO === ufPostoAlvo
        )
      : [];

    let ultimoPrecoBomba = 0;
    let dataUltimoBomba = "";
    let volumeAuditado = 0;
    let precoBaseHistorico = 0;
    let dataPrecoBaseHistorico = "";

    const strDataVigencia = trat.vigencia || "";

    // Varredura cronológica precisa das transações do posto
    regsPosto.forEach(r => {
      const p = parseFloat(r.VALOR_UNITARIO || 0);
      const v = parseFloat(r.VOLUME_CICLO || 0);
      const dataCiclo = r.DATA_FIM_CICLO || "";

      if (dataCiclo && dataCiclo > dataUltimoBomba) {
        dataUltimoBomba = dataCiclo;
        ultimoPrecoBomba = p;
      }

      if (strDataVigencia && dataCiclo && dataCiclo.substring(0, 10) >= strDataVigencia) {
        volumeAuditado += v;
      } else if (strDataVigencia && dataCiclo && dataCiclo.substring(0, 10) < strDataVigencia) {
        // Encontra o abastecimento pré-acordo mais recente
        if (dataCiclo > dataPrecoBaseHistorico) {
          dataPrecoBaseHistorico = dataCiclo;
          precoBaseHistorico = p;
        }
      }
    });

    // VALIDADE DO BASELINE HISTÓRICO: Descarta preços com mais de 45 dias antes da vigência
    let historicoValido = false;
    if (precoBaseHistorico > 0 && dataPrecoBaseHistorico && strDataVigencia) {
      const dtVig = new Date(`${strDataVigencia}T12:00:00Z`);
      const dtHist = new Date(`${dataPrecoBaseHistorico.substring(0, 10)}T12:00:00Z`);
      const diasDistancia = Math.round((dtVig - dtHist) / (1000 * 60 * 60 * 24));
      if (diasDistancia >= 0 && diasDistancia <= 45) {
        historicoValido = true;
      } else {
        precoBaseHistorico = 0; // Descartado por obsolescência
      }
    }

    const anpUf = (typeof anpRevenda !== 'undefined' && anpRevenda[ufPostoAlvo]) ? anpRevenda[ufPostoAlvo] : {};
    const mesChave = dataUltimoBomba ? dataUltimoBomba.substring(0, 7) : '2026-10';
    const refAnpValor = anpUf[mesChave] || anpUf['2026-10'] || 0;

    const precoAcordado = trat.preco_acordado || 0;
    const precoProposto = trat.preco_proposto || 0;
    const strDataCompra = (dataUltimoBomba || "").substring(0, 10);
    const ehAbastecimentoPosVigencia = (strDataVigencia && strDataCompra && strDataCompra >= strDataVigencia);

    let statusClass = "conf-ok";
    let statusTexto = "🟢 Em Conformidade";
    let tipoConformidade = "CONFORME";
    let gapAcordo = 0;
    let savingItem = 0;

    const gapAnp = (ultimoPrecoBomba > 0 && refAnpValor > 0) ? (ultimoPrecoBomba - refAnpValor) : 0;

    if (trat.status === 'POSTO_BLOQUEADO') {
      statusClass = "conf-quebra";
      statusTexto = "🔴 Posto Bloqueado";
      tipoConformidade = "BLOQUEADO";
    } else if (trat.status === 'EM_ABERTO') {
      statusClass = "conf-alerta";
      statusTexto = "🟡 Em Cotação";
      tipoConformidade = "COTACAO";
    } else if (!ehAbastecimentoPosVigencia) {
      statusClass = "conf-espera";
      statusTexto = "⚪ Aguardando Consumo";
      tipoConformidade = "ESPERA";
      gapAcordo = 0;
      savingItem = 0;
    } else {
      gapAcordo = (ultimoPrecoBomba > 0 && precoAcordado > 0) ? (ultimoPrecoBomba - precoAcordado) : 0;

      const dtVig = new Date(`${strDataVigencia}T12:00:00Z`);
      const dtComp = new Date(`${strDataCompra}T12:00:00Z`);
      const diasDecorridos = Math.max(0, Math.round((dtComp - dtVig) / (1000 * 60 * 60 * 24)));

      if (gapAcordo > 0.005) {
        // Posto subiu o valor além do acordo inicial
        if (diasDecorridos <= 2) {
          statusClass = "conf-quebra";
          statusTexto = `🔴 Furo Imediato (${diasDecorridos}d)`;
          tipoConformidade = "QUEBRA";
          qtdDesviosPosVigencia++;
        } else if (diasDecorridos > 30) {
          // ALERTA DE SLA: Acordo vencido há mais de 30 dias que precisa de renovação
          statusClass = "conf-alerta";
          statusTexto = `🟠 Acordo Vencido (+${diasDecorridos}d) • Renovar Negociação`;
          tipoConformidade = "EXPIRADO";
          qtdDesviosPosVigencia++;

          if (volumeAuditado > 0 && refAnpValor > 0 && gapAnp < -0.05) {
            savingItem = (refAnpValor - ultimoPrecoBomba) * volumeAuditado;
          }
        } else if (gapAnp < -0.05) {
          statusClass = "conf-blindado";
          statusTexto = `🔵 Margem Preservada (+${diasDecorridos}d)`;
          tipoConformidade = "BLINDADO";
          qtdMargemPreservada++;
          totalAbastecimentosConformes++;

          if (volumeAuditado > 0 && refAnpValor > 0) {
            savingItem = (refAnpValor - ultimoPrecoBomba) * volumeAuditado;
          }
        } else {
          statusClass = "conf-alerta";
          statusTexto = `🟠 Reajuste em Avaliação (+${diasDecorridos}d)`;
          tipoConformidade = "REAJUSTE";
          qtdDesviosPosVigencia++;
        }
      } else {
        // Preço faturado está estritamente dentro ou abaixo do acordo
        statusClass = "conf-ok";
        statusTexto = "🟢 Em Conformidade";
        tipoConformidade = "CONFORME";
        totalAbastecimentosConformes++;

        // HIERARQUIA AUDITÁVEL DE SAVING (ZERO NÚMEROS INVENTADOS)
        if (volumeAuditado > 0) {
          if (historicoValido && precoBaseHistorico > ultimoPrecoBomba) {
            // Cenário A: Desconto sobre compra real recente (<45 dias)
            savingItem = (precoBaseHistorico - ultimoPrecoBomba) * volumeAuditado;
          } else if (precoProposto > precoAcordado) {
            // Cenário B: Cost Avoidance (Aumento ou tabela de balcão barrada)
            savingItem = (precoProposto - ultimoPrecoBomba) * volumeAuditado;
          } else if (refAnpValor > 0 && ultimoPrecoBomba < refAnpValor) {
            // Cenário C: Benchmark oficial contra média da ANP
            savingItem = (refAnpValor - ultimoPrecoBomba) * volumeAuditado;
          } else {
            // Cenário D: Posto novo sem histórico recente e sem tabela informada
            savingItem = 0;
            tipoConformidade = "INAUGURAL";
          }
        }
      }

      totalAbastecimentosAuditados++;
      if (savingItem > 0) somaSavingRealizadoTotal += savingItem;
    }

    // Ordenação cronológica estrita da gaveta micro (Mais recente para o mais antigo)
    const historicoOrdenado = [...regsPosto].sort((a, b) => {
      const dtA = a.DATA_FIM_CICLO || "";
      const dtB = b.DATA_FIM_CICLO || "";
      return dtB.localeCompare(dtA);
    });

    listaAuditoria.push({
      docId,
      posto: nomePostoAlvo,
      uf: ufPostoAlvo,
      statusTexto,
      statusClass,
      tipoConformidade,
      refAnpValor,
      precoAcordado,
      ultimoPrecoBomba,
      dataUltimoBomba,
      gapAcordo,
      gapAnp,
      ehPosVigencia: ehAbastecimentoPosVigencia,
      vigencia: trat.vigencia || "--",
      volumeAuditado,
      savingItem,
      notas: trat.notas || "",
      historicoTransacoes: historicoOrdenado
    });
  });

  // Filtros de seleção de tela
  let listaFiltrada = listaAuditoria;

  if (ufSel) {
    listaFiltrada = listaFiltrada.filter(item => item.uf === ufSel);
  }
  if (redeSel) {
    if (redeSel === 'OUTROS') {
      listaFiltrada = listaFiltrada.filter(item => {
        const p = normalizarTexto(item.posto);
        return !p.includes('MARAJO') && !p.startsWith('HG ') && !p.includes('SIM ') && !p.includes('GRAAL');
      });
    } else {
      listaFiltrada = listaFiltrada.filter(item => normalizarTexto(item.posto).includes(redeSel));
    }
  }
  if (statusSel) {
    listaFiltrada = listaFiltrada.filter(item => item.tipoConformidade === statusSel);
  }
  if (buscaTxt) {
    listaFiltrada = listaFiltrada.filter(item => 
      item.posto.toLowerCase().includes(buscaTxt) || 
      item.uf.toLowerCase().includes(buscaTxt) || 
      item.notas.toLowerCase().includes(buscaTxt)
    );
  }

  // Ordenação dinâmica multi-colunas
  listaFiltrada.sort((a, b) => {
    let valA = a[auditoriaColunaOrdenacao];
    let valB = b[auditoriaColunaOrdenacao];

    if (typeof valA === 'string') {
      valA = valA.toLowerCase();
      valB = (valB || '').toLowerCase();
      return auditoriaDirecaoOrdenacao === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }

    valA = valA || 0;
    valB = valB || 0;
    return auditoriaDirecaoOrdenacao === 'asc' ? (valA - valB) : (valB - valA);
  });

  const lblContador = document.getElementById('lblAuditoriaContador');
  if (lblContador) lblContador.innerText = `${listaFiltrada.length} postos auditados`;

  const aderenciaPerc = totalAbastecimentosAuditados > 0 ? ((totalAbastecimentosConformes / totalAbastecimentosAuditados) * 100) : 100;
  atualizarCardsAuditoriaKPIs(aderenciaPerc, somaSavingRealizadoTotal, qtdDesviosPosVigencia, qtdMargemPreservada);

  // Atualização dos indicadores visuais (setinhas) nos cabeçalhos
  atualizarIconesOrdenacaoCabecalho();

  if (listaFiltrada.length === 0) {
    corpoTabela.innerHTML = `
      <tr>
        <td colspan="11" class="text-center py-4 text-muted">
          Nenhum posto encontrado para a combinação de filtros selecionada.
        </td>
      </tr>
    `;
    return;
  }

  corpoTabela.innerHTML = listaFiltrada.map((p, idx) => {
    const idGaveta = `gaveta-micro-${idx}`;
    const dataVigenciaFmt = p.vigencia !== '--' ? p.vigencia.split('-').reverse().join('/') : '--';
    const dataBombaFmt = formatarDataDiaMes(p.dataUltimoBomba);

    const precoAcordadoComVigenciaHtml = `
      <div class="fw-bold font-monospace text-dark" style="font-size: 0.85rem;">
        ${p.precoAcordado > 0 ? `R$ ${p.precoAcordado.toFixed(3)}` : '--'}
      </div>
      <div class="text-muted font-monospace" style="font-size: 0.58rem; line-height: 1;">
        vigência: ${dataVigenciaFmt}
      </div>
    `;

    let gapAcordoHtml = `<span class="text-muted font-monospace" style="font-size:0.68rem;">R$ 0,000</span>`;
    if (p.ehPosVigencia && p.precoAcordado > 0 && p.ultimoPrecoBomba > 0) {
      if (p.gapAcordo > 0.005) {
        gapAcordoHtml = `<span class="text-danger fw-bold font-monospace" style="font-size:0.75rem;">+R$ ${p.gapAcordo.toFixed(3)}</span>`;
      } else if (p.gapAcordo < -0.005) {
        gapAcordoHtml = `<span class="text-success fw-bold font-monospace" style="font-size:0.75rem;">-R$ ${Math.abs(p.gapAcordo).toFixed(3)}</span>`;
      } else {
        gapAcordoHtml = `<span class="text-success font-monospace" style="font-size:0.68rem;">R$ 0,000</span>`;
      }
    }

    let gapAnpHtml = `<span class="text-muted font-monospace" style="font-size:0.68rem;">--</span>`;
    if (p.refAnpValor > 0 && p.ultimoPrecoBomba > 0) {
      const sinal = p.gapAnp >= 0 ? "+" : "-";
      const corAnp = p.gapAnp > 0.05 ? "text-danger" : "text-success";
      gapAnpHtml = `<span class="${corAnp} fw-bold font-monospace" style="font-size:0.72rem;">${sinal}R$ ${Math.abs(p.gapAnp).toFixed(3)}</span>`;
    }

    let savingHtml = `<span class="text-muted font-monospace" style="font-size:0.70rem;">R$ 0,00</span>`;
    if (p.ehPosVigencia) {
      if (p.savingItem > 0) {
        savingHtml = `<span class="text-success fw-bold font-monospace" style="font-size:0.78rem;">+R$ ${Math.round(p.savingItem).toLocaleString('pt-BR')}</span>`;
      } else if (p.tipoConformidade === 'QUEBRA' && p.volumeAuditado > 0) {
        const perda = p.gapAcordo * p.volumeAuditado;
        savingHtml = `<span class="text-danger fw-bold font-monospace" style="font-size:0.78rem;">-R$ ${Math.round(perda).toLocaleString('pt-BR')}</span>`;
      }
    }

    // Linhas da gaveta analítica micro (com dados ordenados do mais novo ao mais velho)
    let linhasMicroHtml = "";
    if (Array.isArray(p.historicoTransacoes) && p.historicoTransacoes.length > 0) {
      linhasMicroHtml = p.historicoTransacoes.map(t => {
        const valorUnitario = parseFloat(t.VALOR_UNITARIO || 0);
        const lts = parseFloat(t.VOLUME_CICLO || 0);
        const dtFmt = formatarDataDiaMes(t.DATA_FIM_CICLO);
        const ehPos = (p.vigencia && t.DATA_FIM_CICLO && t.DATA_FIM_CICLO.substring(0, 10) >= p.vigencia);
        
        const anpMes = (typeof anpRevenda !== 'undefined' && anpRevenda[p.uf] && anpRevenda[p.uf][t.MES_ANO]) 
          ? anpRevenda[p.uf][t.MES_ANO] 
          : p.refAnpValor;
        const diffAnp = (valorUnitario > 0 && anpMes > 0) ? (valorUnitario - anpMes) : 0;
        const savingMicro = diffAnp < 0 ? Math.abs(diffAnp * lts) : 0;

        return `
          <tr>
            <td class="font-monospace text-dark fw-bold">${t.MES_ANO}</td>
            <td class="font-monospace text-muted">${dtFmt}</td>
            <td class="text-end font-monospace">${Math.round(lts).toLocaleString('pt-BR')} L</td>
            <td class="text-end font-monospace fw-bold text-dark">R$ ${valorUnitario.toFixed(3)}</td>
            <td class="text-end font-monospace text-secondary">R$ ${valorUnitario.toFixed(3)}</td>
            <td class="text-end font-monospace text-primary">${anpMes > 0 ? `R$ ${anpMes.toFixed(3)}` : '--'}</td>
            <td class="text-center">${ehPos ? '<span class="badge bg-success" style="font-size:0.55rem;">PÓS-ACORDO</span>' : '<span class="badge bg-secondary" style="font-size:0.55rem;">PRÉ-ACORDO</span>'}</td>
            <td class="text-end font-monospace ${diffAnp < 0 ? 'text-success fw-bold' : 'text-danger'}">
              ${diffAnp < 0 ? `+R$ ${Math.round(savingMicro).toLocaleString('pt-BR')}` : (diffAnp > 0 ? `-R$ ${Math.round(diffAnp * lts).toLocaleString('pt-BR')}` : 'R$ 0')}
            </td>
          </tr>
        `;
      }).join('');
    } else {
      linhasMicroHtml = `<tr><td colspan="8" class="text-center text-muted">Sem detalhamento transacional registrado no KMM.</td></tr>`;
    }

    const parecerTexto = gerarParecerExecutivoPosto(p);

    return `
      <tr>
        <td class="text-start">
          <span class="fw-bold text-dark d-block text-truncate" style="max-width: 230px;" title="${p.posto}">${p.posto}</span>
          <span class="small text-muted" style="font-size: 0.65rem;" title="${p.notas}">${p.notas ? p.notas.substring(0, 38) + '...' : 'Sem notas adicionais'}</span>
        </td>
        <td><span class="badge-uf">${p.uf}</span></td>
        <td><span class="badge-conformidade ${p.statusClass}">${p.statusTexto}</span></td>
        <td class="text-end font-monospace text-primary fw-semibold" style="font-size: 0.78rem;">
          ${p.refAnpValor > 0 ? `R$ ${p.refAnpValor.toFixed(3)}` : '--'}
        </td>
        <td class="text-end">
          ${precoAcordadoComVigenciaHtml}
        </td>
        <td class="text-end font-monospace">
          <span class="fw-bold text-dark" style="font-size: 0.85rem;">${p.ultimoPrecoBomba > 0 ? `R$ ${p.ultimoPrecoBomba.toFixed(3)}` : '--'}</span>
          <div class="text-muted" style="font-size: 0.58rem;">em ${dataBombaFmt}</div>
        </td>
        <td class="text-end">${gapAcordoHtml}</td>
        <td class="text-end">${gapAnpHtml}</td>
        <td class="text-end font-monospace fw-semibold" style="font-size: 0.76rem;">
          ${p.ehPosVigencia ? Math.round(p.volumeAuditado).toLocaleString('pt-BR') : 0} L
        </td>
        <td class="text-end">${savingHtml}</td>
        <td class="text-center">
          <div class="d-flex justify-content-center gap-1">
            <button class="btn btn-sm btn-outline-secondary py-0 px-2 fw-bold" style="font-size: 0.65rem;" onclick="alternarGavetaMicro('${idGaveta}')" title="Ver Detalhes Transacionais e Parecer">
              <i class="bi bi-search me-1"></i> Micro
            </button>
            <button class="btn btn-sm btn-outline-success py-0 px-2 fw-bold" style="font-size: 0.65rem;" onclick="abrirModalTratativa('${p.posto.replace(/'/g, "\\'")}', '${p.uf}', '', ${p.ultimoPrecoBomba}, ${p.refAnpValor}, ${p.ultimoPrecoBomba})">
              <i class="bi bi-journal-text me-1"></i> Rolodex
            </button>
          </div>
        </td>
      </tr>

      <!-- GAVETA OCULTA DE AUDITORIA MICRO (PARECER EXECUTIVO + TRANSACIONAIS) -->
      <tr id="${idGaveta}" class="linha-detalhe-gaveta" style="display: none;">
        <td colspan="11" class="p-3">
          
          <!-- BOX EXECUTIVO DE SÍNTESE DO POSTO -->
          <div class="alert alert-dark border-secondary p-2 mb-2 d-flex align-items-start gap-2 shadow-sm" style="background:#0f172a; border-radius:6px; color:#e2e8f0;">
            <i class="bi bi-chat-left-quote-fill fs-5 text-success mt-1"></i>
            <div>
              <div class="fw-bold text-uppercase" style="font-size:0.65rem; color:#4ade80; letter-spacing:0.04em;">
                Síntese da Gestão &bull; ${p.posto} (${p.uf})
              </div>
              <div style="font-size:0.72rem; line-height:1.35; color:#cbd5e1;">
                ${parecerTexto}
              </div>
            </div>
          </div>

          <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="fw-bold text-dark small" style="font-size:0.70rem;">
              <i class="bi bi-clock-history me-1 text-primary"></i> Linha do Tempo de Abastecimentos no KMM
            </span>
            <span class="badge bg-light text-secondary border font-monospace" style="font-size:0.58rem;">
              Ordenação Cronológica Decrescente
            </span>
          </div>

          <table class="table tabela-micro-gaveta">
            <thead>
              <tr>
                <th>Competência</th>
                <th>Última Data</th>
                <th class="text-end">Volume Auditado</th>
                <th class="text-end">Preço Médio</th>
                <th class="text-end">Último Pago</th>
                <th class="text-end">Ref. ANP Mês</th>
                <th class="text-center">Enquadramento</th>
                <th class="text-end">Saving Real (vs ANP)</th>
              </tr>
            </thead>
            <tbody>
              ${linhasMicroHtml}
            </tbody>
          </table>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Atualiza as setinhas e o cursor nos cabeçalhos clicáveis
 */
function atualizarIconesOrdenacaoCabecalho() {
  const mapaColunas = {
    "posto": 0,
    "uf": 1,
    "tipoConformidade": 2,
    "volumeAuditado": 8,
    "savingItem": 9
  };

  const ths = document.querySelectorAll('.tabela-auditoria thead th');
  if (!ths || ths.length === 0) return;

  ths.forEach((th, idx) => {
    th.style.cursor = "pointer";
    th.title = "Clique para ordenar esta coluna";
    
    // Remove setinhas antigas
    th.innerHTML = th.innerHTML.replace(/\s*<span class="icone-sort">.*?<\/span>/g, '');

    // Procura se essa coluna é a ativa
    for (const [col, thIdx] of Object.entries(mapaColunas)) {
      if (thIdx === idx) {
        if (auditoriaColunaOrdenacao === col) {
          const icone = auditoriaDirecaoOrdenacao === 'asc' ? '▲' : '▼';
          th.innerHTML += ` <span class="icone-sort text-success fw-bold">${icone}</span>`;
        }
      }
    }
  });
}
