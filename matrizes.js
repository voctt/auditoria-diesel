// Módulo de Matrizes Gerenciais e Auditoria Estratégica (Power BI Engine Alinhado)
// Utiliza agregação Gaps and Islands (VOLUME_CICLO e VALOR_TOTAL_CICLO) para Média Ponderada Real

let cacheAnpBase = null;

async function obterBaseAnpOficial() {
  if (cacheAnpBase) return cacheAnpBase;

  // 1. Aproveita dados já carregados pelo index.html via Firestore
  if (typeof dadosAnpBaseGlobal !== 'undefined' && dadosAnpBaseGlobal && dadosAnpBaseGlobal.revenda) {
    cacheAnpBase = dadosAnpBaseGlobal;
    return cacheAnpBase;
  }

  // 2. Consulta direta via REST API do Firestore
  try {
    const FIRESTORE_REST_URL = "https://firestore.googleapis.com/v1/projects/cargosoft-diesel/databases/(default)/documents/anp_consolidada/mensal_2026";
    const resp = await fetch(FIRESTORE_REST_URL);
    if (!resp.ok) throw new Error("Erro ao consultar Firestore REST");
    const json = await resp.json();

    function decodificar(v) {
      if (!v || typeof v !== 'object') return null;
      if ('stringValue' in v) return v.stringValue;
      if ('doubleValue' in v) return parseFloat(v.doubleValue);
      if ('integerValue' in v) return parseInt(v.integerValue, 10);
      if ('mapValue' in v && v.mapValue.fields) {
        const res = {};
        for (const [k, val] of Object.entries(v.mapValue.fields)) {
          res[k] = decodificar(val);
        }
        return res;
      }
      return null;
    }

    if (json && json.fields) {
      cacheAnpBase = {};
      for (const [k, val] of Object.entries(json.fields)) {
        cacheAnpBase[k] = decodificar(val);
      }
      return cacheAnpBase;
    }
  } catch (err) {
    console.error("Falha ao carregar dados oficiais ANP do Firestore:", err);
  }

  return { revenda: {}, distribuicao: {} };
}

function alternarPainelAuditoria() {
  const painel = document.getElementById('painelChecagemBruta');
  const btn = document.getElementById('btnToggleAuditoria');
  if (!painel || !btn) return;

  if (painel.style.display === 'none' || painel.classList.contains('d-none')) {
    painel.style.display = 'block';
    painel.classList.remove('d-none');
    btn.innerHTML = `<i class="bi bi-eye-slash-fill me-1"></i> Ocultar Tabelas de Auditoria Bruta (4)`;
    btn.classList.replace('btn-outline-secondary', 'btn-secondary');
  } else {
    painel.style.display = 'none';
    painel.classList.add('d-none');
    btn.innerHTML = `<i class="bi bi-shield-check me-1"></i> Exibir Tabelas de Auditoria Bruta (4)`;
    btn.classList.replace('btn-secondary', 'btn-outline-secondary');
  }
}

function emitirRelatorioMatrizes() {
  const secao = document.getElementById('secaoMatrizesGerenciais');
  if (!secao) return;

  const conteudo = secao.cloneNode(true);
  const botoes = conteudo.querySelectorAll('button, #btnToggleAuditoria, #btnEmitirRelatorio');
  botoes.forEach(b => b.remove());

  const janela = window.open('', '_blank', 'width=1100,height=850');
  janela.document.write(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Relatório Executivo - Matrizes Gerenciais de Combustível</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
        @page { size: A4 landscape; margin: 8mm; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #fff; color: #1e293b; padding: 5px; }
        .table { font-size: 0.65rem !important; }
        .table th, .table td { padding: 3px 4px !important; }
        .card { border: 1px solid #e2e8f0 !important; box-shadow: none !important; margin-bottom: 12px !important; page-break-inside: avoid !important; break-inside: avoid !important; }
        table { page-break-inside: avoid !important; break-inside: avoid !important; }
        .no-print { display: none !important; }
      </style>
    </head>
    <body onload="window.print(); window.close();">
      <div class="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
        <div>
          <h4 class="fw-bold mb-0 text-dark">Cargosoft - Relatório Executivo de Auditoria de Combustível</h4>
          <span class="text-muted small">Confronto de Compras em Rota e Tanques Próprios vs. Indicadores Oficiais ANP</span>
        </div>
        <div class="text-end text-muted small">
          Data de Emissão: ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}<br>
          Base Homologada KMM & ANP/ANTT
        </div>
      </div>
      ${conteudo.innerHTML}
    </body>
    </html>
  `);
  janela.document.close();
}

function gerarInsightsInteligentes(analiseExterna, analiseInterna, analiseSpread) {
  const cards = [];

  if (analiseExterna.melhorUf) {
    cards.push(`
      <div class="col-12 col-md-4">
        <div class="border-start border-4 border-success bg-white p-3 rounded shadow-sm h-100">
          <div class="d-flex align-items-center mb-1">
            <i class="bi bi-trophy-fill text-success fs-5 me-2"></i>
            <span class="fw-bold text-dark small">Maior Eficiência em Rota (Volume Relevante)</span>
          </div>
          <p class="mb-0 text-muted" style="font-size: 0.78rem;">
            O estado do <strong>${analiseExterna.melhorUf}</strong> lidera o poder de compra da frota com 
            <strong class="text-success">${analiseExterna.melhorVar.toFixed(2).replace('.', ',')}%</strong> abaixo da ANP Revenda 
            (${analiseExterna.melhorQtd.toLocaleString('pt-BR')} transações no período).
          </p>
        </div>
      </div>
    `);
  }

  if (analiseExterna.piorUf && analiseExterna.piorVar > 0) {
    cards.push(`
      <div class="col-12 col-md-4">
        <div class="border-start border-4 border-danger bg-white p-3 rounded shadow-sm h-100">
          <div class="d-flex align-items-center mb-1">
            <i class="bi bi-exclamation-triangle-fill text-danger fs-5 me-2"></i>
            <span class="fw-bold text-dark small">Atenção Prioritária: Ágio em Rota</span>
          </div>
          <p class="mb-0 text-muted" style="font-size: 0.78rem;">
            A praça da <strong>${analiseExterna.piorUf}</strong> encerrou o período acumulando 
            <strong class="text-danger">+${analiseExterna.piorVar.toFixed(2).replace('.', ',')}%</strong> acima da ANP 
            (${analiseExterna.piorQtd.toLocaleString('pt-BR')} transações). Ponto crítico para revisão imediata de acordos e postos homologados.
          </p>
        </div>
      </div>
    `);
  } else {
    cards.push(`
      <div class="col-12 col-md-4">
        <div class="border-start border-4 border-primary bg-white p-3 rounded shadow-sm h-100">
          <div class="d-flex align-items-center mb-1">
            <i class="bi bi-patch-check-fill text-primary fs-5 me-2"></i>
            <span class="fw-bold text-dark small">Controle de Rede Externa</span>
          </div>
          <p class="mb-0 text-muted" style="font-size: 0.78rem;">
            Nenhum estado com volume expressivo operou com ágio fora dos limites acordados, mantendo aderência ao teto de negociação de rota.
          </p>
        </div>
      </div>
    `);
  }

  if (analiseSpread.ufMenorSpread) {
    const spreadAbaixo = analiseSpread.menorSpreadVal < 0.15;
    const corBorda = spreadAbaixo ? 'border-danger' : 'border-warning';
    const corTexto = spreadAbaixo ? 'text-danger' : 'text-warning';
    const icone = spreadAbaixo ? 'bi-x-octagon-fill' : 'bi-lightning-charge-fill';

    cards.push(`
      <div class="col-12 col-md-4">
        <div class="border-start border-4 ${corBorda} bg-white p-3 rounded shadow-sm h-100">
          <div class="d-flex align-items-center mb-1">
            <i class="bi ${icone} ${corTexto} fs-5 me-2"></i>
            <span class="fw-bold text-dark small">Margem Interna (Spread Garagem)</span>
          </div>
          <p class="mb-0 text-muted" style="font-size: 0.78rem;">
            ${spreadAbaixo 
              ? `Atenção na praça <strong>${analiseSpread.ufMenorSpread}</strong>: Spread de apenas <strong class="${corTexto}">R$ ${analiseSpread.menorSpreadVal.toFixed(2).replace('.', ',')}/L</strong>, operando abaixo da margem mínima recomendada de R$ 0,15/L.` 
              : `A praça com menor margem é <strong>${analiseSpread.ufMenorSpread}</strong> (Spread de <strong>R$ ${analiseSpread.menorSpreadVal.toFixed(2).replace('.', ',')}/L</strong>). A garagem do <strong>${analiseSpread.ufMaiorSpread}</strong> gera a maior vantagem: <strong>R$ ${analiseSpread.maiorSpreadVal.toFixed(2).replace('.', ',')}/L</strong>.`}
          </p>
        </div>
      </div>
    `);
  }

  return `
    <div class="card border-0 shadow-sm p-3 mb-3 bg-light">
      <div class="d-flex justify-content-between align-items-center mb-2 pb-1 border-bottom">
        <div class="d-flex align-items-center">
          <i class="bi bi-cpu text-primary fs-5 me-2"></i>
          <h6 class="fw-bold mb-0 text-dark">Diagnóstico e Recomendações Estratégicas</h6>
        </div>
        <span class="badge bg-white text-secondary border small">Volume Significativo (> 30 abastecimentos)</span>
      </div>
      <div class="row g-2">
        ${cards.join('')}
      </div>
    </div>
  `;
}

function obterChaveInternaUnidade(registro) {
  if (registro.TIPO_OPERACAO !== 'INTERNO') return registro.UF_POSTO;
  const uf = registro.UF_POSTO;
  if (uf === 'SP') {
    const mun = (registro.MUNICIPIO_POSTO || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    const pos = (registro.POSTO || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    if (mun.includes('RIBEIRAO') || pos.includes('RIBEIRAO') || pos.includes('RP')) {
      return 'SP_RP';
    }
    return 'SP_BAR';
  }
  return uf;
}

function obterRotuloInterno(chave) {
  if (chave === 'SP_BAR') return 'SP (Barueri)';
  if (chave === 'SP_RP') return 'SP (Rib. Preto)';
  return chave;
}

function obterUfPai(chave) {
  if (chave.startsWith('SP_')) return 'SP';
  return chave;
}

function obterPostoVilao(registros, chaveUnidade, mes, tipoOperacao, refAnp) {
  if (!refAnp || refAnp <= 0) return null;

  const regs = registros.filter(r => {
    if (r.MES_ANO !== mes || r.TIPO_OPERACAO !== tipoOperacao) return false;
    if (tipoOperacao === 'INTERNO') {
      return obterChaveInternaUnidade(r) === chaveUnidade;
    }
    return r.UF_POSTO === chaveUnidade;
  });

  let piorPosto = null;
  let maiorDesvioTotal = 0;

  regs.forEach(r => {
    const preco = parseFloat(r.VALOR_UNITARIO || 0);
    const litros = parseFloat(r.VOLUME_CICLO || 0);
    if (preco > refAnp && litros > 0) {
      const desvioReais = (preco - refAnp) * litros;
      if (desvioReais > maiorDesvioTotal) {
        maiorDesvioTotal = desvioReais;
        piorPosto = {
          nome: r.POSTO,
          preco: preco,
          litros: litros,
          desvio: desvioReais
        };
      }
    }
  });

  return piorPosto;
}

async function calcularMatrizesGerenciais(registros) {
  const dadosAnp = await obterBaseAnpOficial();
  const mapaRevenda = dadosAnp.revenda || {};
  const mapaDistribuicao = dadosAnp.distribuicao || {};

  const mesesDisponiveis = [...new Set(registros.map(r => r.MES_ANO).filter(Boolean))].sort();

  const nomesAbrev = {
    '01': 'JAN', '02': 'FEV', '03': 'MAR', '04': 'ABR',
    '05': 'MAI', '06': 'JUN', '07': 'JUL', '08': 'AGO',
    '09': 'SET', '10': 'OUT', '11': 'NOV', '12': 'DEZ'
  };

  const mesesColunas = mesesDisponiveis.map(m => {
    const [ano, mes] = m.split('-');
    return {
      id: m,
      rotulo: `${nomesAbrev[mes] || mes} - ${ano.slice(2)}`
    };
  });

  const ufsExterno = [...new Set(registros.filter(r => r.TIPO_OPERACAO === 'EXTERNO').map(r => r.UF_POSTO).filter(Boolean))].sort();

  const chavesInternasSet = new Set();
  registros.filter(r => r.TIPO_OPERACAO === 'INTERNO').forEach(r => {
    chavesInternasSet.add(obterChaveInternaUnidade(r));
  });

  const chavesInterno = [...chavesInternasSet].sort((a, b) => {
    if (a.startsWith('SP_') && !b.startsWith('SP_')) return 1;
    if (!a.startsWith('SP_') && b.startsWith('SP_')) return -1;
    return a.localeCompare(b);
  });

  // Novo motor de Agregação (Média Ponderada Real)
  const dadosAgrupados = {};

  registros.forEach(r => {
    const chaveUnidade = r.TIPO_OPERACAO === 'INTERNO' ? obterChaveInternaUnidade(r) : r.UF_POSTO;
    const chave = `${chaveUnidade}_${r.MES_ANO}_${r.TIPO_OPERACAO}`;
    if (!dadosAgrupados[chave]) {
      dadosAgrupados[chave] = { somaValor: 0, somaVolume: 0, totalAbastecimentos: 0 };
    }

    const volume = parseFloat(r.VOLUME_CICLO || 0);
    const valorTotal = parseFloat(r.VALOR_TOTAL_CICLO || 0);
    const qtd = parseInt(r.QTD_ABASTECIMENTOS || 0, 10);

    if (volume > 0 && valorTotal > 0) {
      dadosAgrupados[chave].somaValor += valorTotal;
      dadosAgrupados[chave].somaVolume += volume;
      dadosAgrupados[chave].totalAbastecimentos += qtd;
    }
  });

  function getPrecoMedioSimples(chaveUnidade, mes, tipo) {
    const d = dadosAgrupados[`${chaveUnidade}_${mes}_${tipo}`];
    if (!d || d.somaVolume === 0) return null;
    return d.somaValor / d.somaVolume;
  }

  function getTotalUfSimples(chaveUnidade, tipo) {
    let somaValor = 0;
    let somaVolume = 0;

    mesesColunas.forEach(m => {
      const d = dadosAgrupados[`${chaveUnidade}_${m.id}_${tipo}`];
      if (d && d.somaVolume > 0) {
        somaValor += d.somaValor;
        somaVolume += d.somaVolume;
      }
    });

    return somaVolume > 0 ? (somaValor / somaVolume) : null;
  }

  function getQtdTotalUf(chaveUnidade, tipo) {
    let qtdTotal = 0;
    mesesColunas.forEach(m => {
      const d = dadosAgrupados[`${chaveUnidade}_${m.id}_${tipo}`];
      if (d) qtdTotal += d.totalAbastecimentos;
    });
    return qtdTotal;
  }

  // 1. MATRIZ EXECUTIVA EXTERNA (ROTA POR UF)
  let htmlExterna = `
    <table class="table table-sm table-bordered text-center align-middle mb-0" style="font-size: 0.72rem; white-space: nowrap;">
      <thead class="table-light">
        <tr>
          <th style="width: 48px; background-color: #f8fafc;">UF</th>
          ${mesesColunas.map(m => `<th>${m.rotulo}</th>`).join('')}
          <th style="background-color: #f1f5f9; color: #334155; border-left: 2px solid #cbd5e1; width: 68px; font-weight: 700;">Total</th>
        </tr>
      </thead>
      <tbody>
  `;

  let melhorUfExt = null;
  let melhorVarExt = 999;
  let melhorQtdExt = 0;

  let piorUfExt = null;
  let piorVarExt = -999;
  let piorQtdExt = 0;

  ufsExterno.forEach(uf => {
    let tds = `<td class="fw-bold bg-light">${uf}</td>`;
    const precosAnpAno = [];

    mesesColunas.forEach(m => {
      const precoPago = getPrecoMedioSimples(uf, m.id, 'EXTERNO');
      const refAnp = (mapaRevenda[uf] && mapaRevenda[uf][m.id]) ? mapaRevenda[uf][m.id] : null;

      if (precoPago && refAnp) {
        precosAnpAno.push(refAnp);
        const varPerc = ((precoPago - refAnp) / refAnp) * 100;
        
        const bgCor = varPerc <= 0 ? '#ecfdf5' : '#fef2f2';
        const txtCor = varPerc <= 0 ? '#047857' : '#b91c1c';
        const textoSinal = (varPerc > 0 ? '+' : '') + varPerc.toFixed(2).replace('.', ',') + '%';
        
        let tooltipAttr = "";
        if (varPerc > 0) {
          const vilao = obterPostoVilao(registros, uf, m.id, 'EXTERNO', refAnp);
          if (vilao) {
            tooltipAttr = `title="⚠️ Posto Vilão da Praça: ${vilao.nome} | Pago: R$ ${vilao.preco.toFixed(2)} vs ANP R$ ${refAnp.toFixed(2)} | Desvio: +R$ ${Math.round(vilao.desvio).toLocaleString('pt-BR')} (${Math.round(vilao.litros).toLocaleString('pt-BR')} L)" style="cursor:help; background-color: ${bgCor}; color: ${txtCor}; font-weight: 600;"`;
          } else {
            tooltipAttr = `style="background-color: ${bgCor}; color: ${txtCor}; font-weight: 600;"`;
          }
        } else {
          tooltipAttr = `style="background-color: ${bgCor}; color: ${txtCor}; font-weight: 600;"`;
        }

        tds += `<td ${tooltipAttr}>${textoSinal}</td>`;
      } else {
        tds += `<td class="text-muted" style="background:#fafafa;">-</td>`;
      }
    });

    const totalPago = getTotalUfSimples(uf, 'EXTERNO');
    const qtdTotal = getQtdTotalUf(uf, 'EXTERNO');

    if (totalPago && precosAnpAno.length > 0) {
      const mediaAnpAno = precosAnpAno.reduce((a, b) => a + b, 0) / precosAnpAno.length;
      const varTotal = ((totalPago - mediaAnpAno) / mediaAnpAno) * 100;

      if (qtdTotal >= 30) {
        if (varTotal < melhorVarExt) {
          melhorVarExt = varTotal;
          melhorUfExt = uf;
          melhorQtdExt = qtdTotal;
        }
        if (varTotal > piorVarExt) {
          piorVarExt = varTotal;
          piorUfExt = uf;
          piorQtdExt = qtdTotal;
        }
      }

      const bgTotal = varTotal <= 0 ? '#d1fae5' : '#fee2e2';
      const textCorTotal = varTotal <= 0 ? '#065f46' : '#991b1b';
      const textTotal = (varTotal > 0 ? '+' : '') + varTotal.toFixed(2).replace('.', ',') + '%';
      tds += `<td style="background-color: ${bgTotal}; color: ${textCorTotal}; font-weight: 700; font-size: 0.74rem; border-left: 2px solid #cbd5e1;">${textTotal}</td>`;
    } else {
      tds += `<td class="text-muted" style="border-left: 2px solid #cbd5e1;">-</td>`;
    }

    htmlExterna += `<tr>${tds}</tr>`;
  });
  htmlExterna += `</tbody></table>`;

  // 2. MATRIZ EXECUTIVA INTERNA (DIVIDINDO SP EM BARUERI E RIB. PRETO)
  let htmlInterna = `
    <table class="table table-sm table-bordered text-center align-middle mb-0" style="font-size: 0.72rem; white-space: nowrap;">
      <thead class="table-light">
        <tr>
          <th style="min-width: 80px; background-color: #f8fafc;">Filial / UF</th>
          ${mesesColunas.map(m => `<th>${m.rotulo}</th>`).join('')}
          <th style="background-color: #f1f5f9; color: #334155; border-left: 2px solid #cbd5e1; width: 68px; font-weight: 700;">Total</th>
        </tr>
      </thead>
      <tbody>
  `;

  chavesInterno.forEach(chave => {
    const rotulo = obterRotuloInterno(chave);
    const ufPai = obterUfPai(chave);
    let tds = `<td class="fw-bold bg-light text-start ps-2" style="white-space: nowrap;">${rotulo}</td>`;
    const precosAnpAno = [];

    mesesColunas.forEach(m => {
      const precoPago = getPrecoMedioSimples(chave, m.id, 'INTERNO');
      const refAnp = (mapaDistribuicao[ufPai] && mapaDistribuicao[ufPai][m.id]) ? mapaDistribuicao[ufPai][m.id] : null;

      if (precoPago && refAnp) {
        precosAnpAno.push(refAnp);
        const varPerc = ((precoPago - refAnp) / refAnp) * 100;
        const bgCor = varPerc <= 0 ? '#ecfdf5' : '#fef2f2';
        const txtCor = varPerc <= 0 ? '#047857' : '#b91c1c';
        const textoSinal = (varPerc > 0 ? '+' : '') + varPerc.toFixed(2).replace('.', ',') + '%';
        
        let tooltipAttr = "";
        if (varPerc > 0) {
          const vilao = obterPostoVilao(registros, chave, m.id, 'INTERNO', refAnp);
          if (vilao) {
            tooltipAttr = `title="⚠️ Garagem: ${vilao.nome} | Custo: R$ ${vilao.preco.toFixed(2)} vs ANP R$ ${refAnp.toFixed(2)} | Impacto: +R$ ${Math.round(vilao.desvio).toLocaleString('pt-BR')}" style="cursor:help; background-color: ${bgCor}; color: ${txtCor}; font-weight: 600;"`;
          } else {
            tooltipAttr = `style="background-color: ${bgCor}; color: ${txtCor}; font-weight: 600;"`;
          }
        } else {
          tooltipAttr = `style="background-color: ${bgCor}; color: ${txtCor}; font-weight: 600;"`;
        }

        tds += `<td ${tooltipAttr}>${textoSinal}</td>`;
      } else {
        tds += `<td class="text-muted" style="background:#fafafa;">-</td>`;
      }
    });

    const totalPago = getTotalUfSimples(chave, 'INTERNO');
    if (totalPago && precosAnpAno.length > 0) {
      const mediaAnpAno = precosAnpAno.reduce((a, b) => a + b, 0) / precosAnpAno.length;
      const varTotal = ((totalPago - mediaAnpAno) / mediaAnpAno) * 100;
      const bgTotal = varTotal <= 0 ? '#d1fae5' : '#fee2e2';
      const textCorTotal = varTotal <= 0 ? '#065f46' : '#991b1b';
      const textTotal = (varTotal > 0 ? '+' : '') + varTotal.toFixed(2).replace('.', ',') + '%';
      tds += `<td style="background-color: ${bgTotal}; color: ${textCorTotal}; font-weight: 700; font-size: 0.74rem; border-left: 2px solid #cbd5e1;">${textTotal}</td>`;
    } else {
      tds += `<td class="text-muted" style="border-left: 2px solid #cbd5e1;">-</td>`;
    }

    htmlInterna += `<tr>${tds}</tr>`;
  });
  htmlInterna += `</tbody></table>`;

  // 3. MATRIZ EXECUTIVA DE SPREAD (DIVIDINDO SP EM BARUERI E RIB. PRETO)
  let htmlSpread = `
    <table class="table table-sm table-bordered text-center align-middle mb-0" style="font-size: 0.72rem; white-space: nowrap;">
      <thead class="table-light">
        <tr>
          <th style="min-width: 80px; background-color: #f8fafc;">Filial / UF</th>
          ${mesesColunas.map(m => `<th>${m.rotulo}</th>`).join('')}
          <th style="background-color: #f1f5f9; color: #334155; border-left: 2px solid #cbd5e1; width: 72px; font-weight: 700;">Total</th>
        </tr>
      </thead>
      <tbody>
  `;

  let ufMenorSpread = null;
  let menorSpreadVal = 999;
  let ufMaiorSpread = null;
  let maiorSpreadVal = -999;

  chavesInterno.forEach(chave => {
    const rotulo = obterRotuloInterno(chave);
    const ufPai = obterUfPai(chave);
    let tds = `<td class="fw-bold bg-light text-start ps-2" style="white-space: nowrap;">${rotulo}</td>`;
    const totInt = getTotalUfSimples(chave, 'INTERNO');
    const totExt = getTotalUfSimples(ufPai, 'EXTERNO');

    mesesColunas.forEach(m => {
      const pInt = getPrecoMedioSimples(chave, m.id, 'INTERNO');
      const pExt = getPrecoMedioSimples(ufPai, m.id, 'EXTERNO');

      if (pInt && pExt) {
        const spread = pExt - pInt;
        let bgCor = '#fffbeb';
        let txtCor = '#b45309';

        if (spread >= 0.50) {
          bgCor = '#ecfdf5';
          txtCor = '#047857';
        } else if (spread < 0.15) {
          bgCor = '#fef2f2';
          txtCor = '#b91c1c';
        }

        tds += `<td style="background-color: ${bgCor}; color: ${txtCor}; font-weight: 600;">R$ ${spread.toFixed(2).replace('.', ',')}</td>`;
      } else {
        tds += `<td class="text-muted" style="background:#fafafa;">-</td>`;
      }
    });

    if (totInt && totExt) {
      const spreadTot = totExt - totInt;
      if (spreadTot < menorSpreadVal) {
        menorSpreadVal = spreadTot;
        ufMenorSpread = rotulo;
      }
      if (spreadTot > maiorSpreadVal) {
        maiorSpreadVal = spreadTot;
        ufMaiorSpread = rotulo;
      }

      let bgTotal = '#fef3c7';
      let txtTotal = '#92400e';
      if (spreadTot >= 0.50) {
        bgTotal = '#d1fae5';
        txtTotal = '#065f46';
      } else if (spreadTot < 0.15) {
        bgTotal = '#fee2e2';
        txtTotal = '#991b1b';
      }

      tds += `<td style="background-color: ${bgTotal}; color: ${txtTotal}; font-weight: 700; font-size: 0.74rem; border-left: 2px solid #cbd5e1;">R$ ${spreadTot.toFixed(2).replace('.', ',')}</td>`;
    } else {
      tds += `<td class="text-muted" style="border-left: 2px solid #cbd5e1;">-</td>`;
    }

    htmlSpread += `<tr>${tds}</tr>`;
  });
  htmlSpread += `</tbody></table>`;

  // CHECAGEM 1: Custo Médio Externo Pago (R$/L)
  let htmlCheckPago = `
    <table class="table table-sm table-bordered text-center align-middle mb-0" style="font-size: 0.70rem; white-space: nowrap;">
      <thead class="table-dark">
        <tr>
          <th style="width: 45px;">UF</th>
          ${mesesColunas.map(m => `<th>${m.rotulo}</th>`).join('')}
          <th class="fw-bold bg-primary text-white" style="border-left: 2px solid #64748b;">Total</th>
        </tr>
      </thead>
      <tbody>
  `;

  ufsExterno.forEach(uf => {
    let tds = `<td class="fw-bold">${uf}</td>`;
    mesesColunas.forEach(m => {
      const p = getPrecoMedioSimples(uf, m.id, 'EXTERNO');
      tds += `<td>${p ? p.toFixed(2).replace('.', ',') : '-'}</td>`;
    });
    const tot = getTotalUfSimples(uf, 'EXTERNO');
    tds += `<td class="fw-bold bg-light" style="border-left: 2px solid #64748b;">${tot ? tot.toFixed(2).replace('.', ',') : '-'}</td>`;
    htmlCheckPago += `<tr>${tds}</tr>`;
  });
  htmlCheckPago += `</tbody></table>`;

  // CHECAGEM 2: Custo Médio ANP Revenda (R$/L)
  const ufsAnpRevenda = Object.keys(mapaRevenda).sort();
  let htmlCheckAnp = `
    <table class="table table-sm table-bordered text-center align-middle mb-0" style="font-size: 0.70rem; white-space: nowrap;">
      <thead class="table-dark">
        <tr>
          <th style="width: 45px;">UF</th>
          ${mesesColunas.map(m => `<th>${m.rotulo}</th>`).join('')}
          <th class="fw-bold bg-success text-white" style="border-left: 2px solid #64748b;">Total</th>
        </tr>
      </thead>
      <tbody>
  `;

  ufsAnpRevenda.forEach(uf => {
    let tds = `<td class="fw-bold">${uf}</td>`;
    const valoresUf = [];
    mesesColunas.forEach(m => {
      const v = (mapaRevenda[uf] && mapaRevenda[uf][m.id]) ? mapaRevenda[uf][m.id] : null;
      if (v) valoresUf.push(v);
      tds += `<td>${v ? v.toFixed(2).replace('.', ',') : '-'}</td>`;
    });
    const mediaUf = valoresUf.length > 0 ? (valoresUf.reduce((a, b) => a + b, 0) / valoresUf.length) : null;
    tds += `<td class="fw-bold bg-light" style="border-left: 2px solid #64748b;">${mediaUf ? mediaUf.toFixed(2).replace('.', ',') : '-'}</td>`;
    htmlCheckAnp += `<tr>${tds}</tr>`;
  });
  htmlCheckAnp += `</tbody></table>`;

  // CHECAGEM 3: Custo Médio Interno Pago (R$/L)
  let htmlCheckInternoPago = `
    <table class="table table-sm table-bordered text-center align-middle mb-0" style="font-size: 0.70rem; white-space: nowrap;">
      <thead class="table-dark">
        <tr>
          <th style="min-width: 80px;">Filial / UF</th>
          ${mesesColunas.map(m => `<th>${m.rotulo}</th>`).join('')}
          <th class="fw-bold bg-primary text-white" style="border-left: 2px solid #64748b;">Total</th>
        </tr>
      </thead>
      <tbody>
  `;

  chavesInterno.forEach(chave => {
    const rotulo = obterRotuloInterno(chave);
    let tds = `<td class="fw-bold text-start ps-2" style="white-space: nowrap;">${rotulo}</td>`;
    mesesColunas.forEach(m => {
      const p = getPrecoMedioSimples(chave, m.id, 'INTERNO');
      tds += `<td>${p ? p.toFixed(2).replace('.', ',') : '-'}</td>`;
    });
    const tot = getTotalUfSimples(chave, 'INTERNO');
    tds += `<td class="fw-bold bg-light" style="border-left: 2px solid #64748b;">${tot ? tot.toFixed(2).replace('.', ',') : '-'}</td>`;
    htmlCheckInternoPago += `<tr>${tds}</tr>`;
  });
  htmlCheckInternoPago += `</tbody></table>`;

  // CHECAGEM 4: Custo Médio ANP Distribuição (R$/L)
  const ufsAnpDist = Object.keys(mapaDistribuicao).sort();
  let htmlCheckAnpDist = `
    <table class="table table-sm table-bordered text-center align-middle mb-0" style="font-size: 0.70rem; white-space: nowrap;">
      <thead class="table-dark">
        <tr>
          <th style="width: 45px;">UF</th>
          ${mesesColunas.map(m => `<th>${m.rotulo}</th>`).join('')}
          <th class="fw-bold bg-success text-white" style="border-left: 2px solid #64748b;">Total</th>
        </tr>
      </thead>
      <tbody>
  `;

  ufsAnpDist.forEach(uf => {
    let tds = `<td class="fw-bold">${uf}</td>`;
    const valoresUf = [];
    mesesColunas.forEach(m => {
      const v = (mapaDistribuicao[uf] && mapaDistribuicao[uf][m.id]) ? mapaDistribuicao[uf][m.id] : null;
      if (v) valoresUf.push(v);
      tds += `<td>${v ? v.toFixed(2).replace('.', ',') : '-'}</td>`;
    });
    const mediaUf = valoresUf.length > 0 ? (valoresUf.reduce((a, b) => a + b, 0) / valoresUf.length) : null;
    tds += `<td class="fw-bold bg-light" style="border-left: 2px solid #64748b;">${mediaUf ? mediaUf.toFixed(2).replace('.', ',') : '-'}</td>`;
    htmlCheckAnpDist += `<tr>${tds}</tr>`;
  });
  htmlCheckAnpDist += `</tbody></table>`;

  const htmlInsights = gerarInsightsInteligentes(
    { melhorUf: melhorUfExt, melhorVar: melhorVarExt, melhorQtd: melhorQtdExt, piorUf: piorUfExt, piorVar: piorVarExt, piorQtd: piorQtdExt },
    {},
    { ufMenorSpread, menorSpreadVal, ufMaiorSpread, maiorSpreadVal }
  );

  return {
    htmlExterna,
    htmlInterna,
    htmlSpread,
    htmlInsights,
    htmlCheckPago,
    htmlCheckAnp,
    htmlCheckInternoPago,
    htmlCheckAnpDist
  };
}

async function renderizarAbaMatrizes() {
  const container = document.getElementById('secaoMatrizesGerenciais');
  if (!container) return;

  container.innerHTML = `
    <div class="text-center py-5 text-muted">
      <div class="spinner-border spinner-border-sm text-success me-2" role="status"></div>
      A consolidar matrizes gerenciais com a base do Firestore...
    </div>
  `;

  if (!baseRegistrosMensais || baseRegistrosMensais.length === 0) {
    container.innerHTML = `<div class="alert alert-warning">Aguardando carregamento da base KMM...</div>`;
    return;
  }

  const matrizes = await calcularMatrizesGerenciais(baseRegistrosMensais);

  container.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <div>
        <h5 class="fw-bold mb-0 text-dark">Matrizes Gerenciais de Combustível</h5>
        <span class="small text-muted">Auditoria de Preços de Bomba de Rua e Tanques Próprios vs. ANP Oficial</span>
      </div>
      <div>
        <button id="btnEmitirRelatorio" class="btn btn-sm btn-primary shadow-sm px-3" onclick="emitirRelatorioMatrizes()">
          <i class="bi bi-printer-fill me-1"></i> Emitir Relatório Executivo
        </button>
      </div>
    </div>

    <!-- 1. MATRIZ EXTERNA (LARGURA TOTAL 100% PARA RESPIRAR OS 12 MESES) -->
    <div class="row g-3 mb-3">
      <div class="col-12">
        <div class="card p-3 shadow-sm border-0 bg-white">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div class="d-flex align-items-center">
              <i class="bi bi-graph-down-arrow text-primary fs-5 me-2"></i>
              <h6 class="fw-bold mb-0 text-dark">Auditoria Externa: Variação do Custo Pago vs. ANP Revenda (%)</h6>
            </div>
            <span class="badge bg-light text-dark border">Rota Rodoviária</span>
          </div>
          <div class="table-responsive">
            ${matrizes.htmlExterna}
          </div>
          <div class="alert alert-light border mt-2 py-2 px-3 small text-muted" style="font-size: 0.72rem;">
            <em>💡 <strong>Como interpretar:</strong> Mede o poder de compra da frota na estrada contra a bomba oficial da ANP. Células em <strong>vermelho com ágio</strong> possuem tooltip indicando o <strong>Posto Vilão</strong> que causou o maior sangramento financeiro na praça.</em>
          </div>
        </div>
      </div>
    </div>

    <!-- 2. MATRIZES INTERNAS E SPREAD LADO A LADO (50% / 50% COM ALTURAS EQUILIBRADAS) -->
    <div class="row g-3 mb-3">
      <div class="col-12 col-xl-6">
        <div class="card p-3 shadow-sm border-0 h-100 bg-white">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div class="d-flex align-items-center">
              <i class="bi bi-fuel-pump-fill text-success fs-5 me-2"></i>
              <h6 class="fw-bold mb-0 text-dark">Auditoria Interna: Variação do Custo Pago vs. ANP Distribuição (%)</h6>
            </div>
            <span class="badge bg-light text-dark border">Tanques Próprios</span>
          </div>
          <div class="table-responsive">
            ${matrizes.htmlInterna}
          </div>
          <div class="alert alert-light border mt-2 py-1 px-2 text-muted" style="font-size: 0.69rem;">
            <em>💡 <strong>Como interpretar:</strong> Eficiência nas compras de atacado das garagens em relação ao Levantamento Oficial de Preços de Distribuição (PDC/ANP). Barueri e Ribeirão Preto agora auditados individualmente.</em>
          </div>
        </div>
      </div>

      <div class="col-12 col-xl-6">
        <div class="card p-3 shadow-sm border-0 h-100 bg-white">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div class="d-flex align-items-center">
              <i class="bi bi-cash-stack text-warning fs-5 me-2"></i>
              <h6 class="fw-bold mb-0 text-dark">Spread Interno X Externo (R$/L)</h6>
            </div>
            <span class="badge bg-light text-dark border">Margem Garagem vs Bomba</span>
          </div>
          <div class="table-responsive">
            ${matrizes.htmlSpread}
          </div>
          <div class="alert alert-light border mt-2 py-1 px-2 text-muted" style="font-size: 0.69rem;">
            <em>💡 <strong>Como interpretar:</strong> Ganho unitário líquido por abastecer na garagem em vez da rua. Números em <strong>vermelho (abaixo de R$ 0,15/L)</strong> alertam para margem insuficiente.</em>
          </div>
        </div>
      </div>
    </div>

    <!-- 3. DIAGNÓSTICO E RECOMENDAÇÕES ESTRATÉGICAS -->
    ${matrizes.htmlInsights}

    <!-- 4. CONTROLE DE AUDITORIA BRUTA SOB DEMANDA -->
    <div class="d-flex justify-content-center my-3">
      <button id="btnToggleAuditoria" class="btn btn-sm btn-outline-secondary px-4 shadow-sm" onclick="alternarPainelAuditoria()">
        <i class="bi bi-shield-check me-1"></i> Exibir Tabelas de Auditoria Bruta (4)
      </button>
    </div>

    <div id="painelChecagemBruta" class="card p-3 shadow-sm border-0 bg-light d-none" style="display: none;">
      <div class="d-flex justify-content-between align-items-center mb-3 border-bottom pb-2">
        <div>
          <h6 class="fw-bold text-dark mb-0"><i class="bi bi-ui-checks-grid me-2 text-secondary fs-5"></i> Painel de Checagem: Confronto de Preços Brutos em Reais (R$/L)</h6>
          <span class="small text-muted">Valores médios ponderados por transação (KMM) e preços oficiais da ANP (Revenda e Distribuição PDC)</span>
        </div>
        <span class="badge bg-secondary text-white font-monospace">Auditoria Interna de Dados</span>
      </div>

      <div class="row g-3 mb-3">
        <div class="col-12 col-xl-6">
          <div class="card p-2 bg-white border h-100">
            <span class="fw-bold small text-dark mb-2 d-block">1. Custo Médio Externo Pago (R$/L) - Bomba de Rua</span>
            <div class="table-responsive">
              ${matrizes.htmlCheckPago}
            </div>
          </div>
        </div>

        <div class="col-12 col-xl-6">
          <div class="card p-2 bg-white border h-100">
            <span class="fw-bold small text-dark mb-2 d-block">2. Custo Médio ANP Revenda (R$/L) - Base Oficial</span>
            <div class="table-responsive">
              ${matrizes.htmlCheckAnp}
            </div>
          </div>
        </div>
      </div>

      <div class="row g-3">
        <div class="col-12 col-xl-6">
          <div class="card p-2 bg-white border h-100">
            <span class="fw-bold small text-dark mb-2 d-block">3. Custo Médio Interno Pago (R$/L) - Garagens / Tanques</span>
            <div class="table-responsive">
              ${matrizes.htmlCheckInternoPago}
            </div>
          </div>
        </div>

        <div class="col-12 col-xl-6">
          <div class="card p-2 bg-white border h-100">
            <span class="fw-bold small text-dark mb-2 d-block">4. Custo Médio ANP Distribuição (R$/L) - Base Oficial PDC</span>
            <div class="table-responsive">
              ${matrizes.htmlCheckAnpDist}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
