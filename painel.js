/* ==========================================================================
   MÓDULO DO PAINEL PRINCIPAL & TERMÔMETRO OPERACIONAL KMM
   CARGOSOFT | VOCTT DATA ANALYTICS DIESEL
   ========================================================================== */

const WORKER_URL = "https://api-abastecimentos.klapowsko.workers.dev";
const FIRESTORE_REST_URL = "https://firestore.googleapis.com/v1/projects/cargosoft-diesel/databases/(default)/documents/anp_consolidada/mensal_2026";

let baseRegistrosMensais = [];
let dadosAnpBaseGlobal = null;
let sparklineInstances = {};
let sparkVolumeCardInstance = null;
let modoAtual = "TODOS";
let ufFiltrada = "";
let postoFiltrado = "";
let redeFiltrada = "";

const listaCidades = (typeof baseCidadesBrasil !== 'undefined' && Array.isArray(baseCidadesBrasil)) ? baseCidadesBrasil : [];

let anpDistribuicao = {};
let anpRevenda = {};

function alternarVisibilidadeFluxoMetodologia() {
  const box = document.getElementById('boxFluxoMetodologia');
  if (box) {
    box.style.display = (box.style.display === 'none' || box.style.display === '') ? 'block' : 'none';
  }
}

function normalizarTexto(txt) {
  return (txt || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}

function decodificarCampoFirestore(valorBruto) {
  if (!valorBruto || typeof valorBruto !== 'object') return null;
  if ('stringValue' in valorBruto) return valorBruto.stringValue;
  if ('doubleValue' in valorBruto) return parseFloat(valorBruto.doubleValue);
  if ('integerValue' in valorBruto) return parseInt(valorBruto.integerValue, 10);
  if ('timestampValue' in valorBruto) return valorBruto.timestampValue;
  if ('mapValue' in valorBruto && valorBruto.mapValue.fields) {
    const resultado = {};
    for (const [k, v] of Object.entries(valorBruto.mapValue.fields)) {
      resultado[k] = decodificarCampoFirestore(v);
    }
    return resultado;
  }
  return null;
}

function identificarNomePonto(posto, municipio, uf, tipo) {
  if (tipo === 'INTERNO') {
    const mun = normalizarTexto(municipio);
    const pos = normalizarTexto(posto);

    if (mun.includes('BARUERI') || pos.includes('BARUERI')) return "Filial Barueri";
    if (mun.includes('RIBEIRAO') || pos.includes('RIBEIRAO') || pos.includes('RP')) return "Filial Ribeirão Preto";
    if (mun.includes('COLOMBO') || uf === 'PR') return "Filial Colombo (Matriz)";
    if (mun.includes('EUSEBIO') || mun.includes('FORTALEZA') || uf === 'CE') return "Filial Eusébio";
    if (mun.includes('SIMOES') || mun.includes('SALVADOR') || uf === 'BA') return "Filial Simões Filho";
    if (mun.includes('GOIANIA') || mun.includes('APARECIDA') || uf === 'GO') return "Filial Goiânia";
    return `Garagem ${municipio || 'Interna'}`;
  }
  return posto || 'NÃO IDENTIFICADO';
}

function formatarDataDiaMes(dataStr) {
  if (!dataStr) return "--/--";
  
  const nomesMesesAbrev = {
    '01': 'Jan', '02': 'Fev', '03': 'Mar', '04': 'Abr',
    '05': 'Mai', '06': 'Jun', '07': 'Jul', '08': 'Ago',
    '09': 'Set', '10': 'Out', '11': 'Nov', '12': 'Dez'
  };

  const match = dataStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const dia = match[3];
    const mes = match[2];
    return `${dia}/${nomesMesesAbrev[mes] || mes}`;
  }

  const matchBarra = dataStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (matchBarra) {
    const dia = matchBarra[1];
    const mes = matchBarra[2];
    return `${dia}/${nomesMesesAbrev[mes] || mes}`;
  }

  return dataStr.substring(0, 5);
}

async function buscarDadosAnpFirestore() {
  try {
    const resp = await fetch(FIRESTORE_REST_URL);
    if (!resp.ok) throw new Error(`Status ${resp.status}`);
    const json = await resp.json();

    if (json && json.fields) {
      dadosAnpBaseGlobal = {};
      for (const [campo, valorObj] of Object.entries(json.fields)) {
        dadosAnpBaseGlobal[campo] = decodificarCampoFirestore(valorObj);
      }

      if (dadosAnpBaseGlobal.revenda) anpRevenda = dadosAnpBaseGlobal.revenda;
      if (dadosAnpBaseGlobal.distribuicao) anpDistribuicao = dadosAnpBaseGlobal.distribuicao;

      atualizarCardAnttOficial();
      return;
    }
  } catch (err) {
    console.warn("Falha ao buscar via Firestore REST:", err);
  }
  definirCardAnttIndisponivel();
}

async function carregarDados() {
  const btn = document.getElementById('btnSincronizar');
  if (btn) {
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Buscando...`;
    btn.disabled = true;
  }

  try {
    await Promise.all([
      buscarDadosAnpFirestore(),
      (typeof carregarTodasTratativasFirestore === 'function') ? carregarTodasTratativasFirestore() : Promise.resolve()
    ]);

    const resp = await fetch(WORKER_URL);
    const json = await resp.json();

    if (json && json.status === "sucesso" && Array.isArray(json.dados)) {
      baseRegistrosMensais = json.dados;
      if (typeof inicializarMiniMapaBrasil === 'function') {
        await inicializarMiniMapaBrasil();
      }
      popularFiltrosDinamicos();
      processarPainel();
    } else {
      const container = document.getElementById('listaTermometroPostos');
      if (container) {
        container.innerHTML = `
          <div class="alert alert-danger">Erro no banco: ${json.mensagem || 'Dados inválidos'}</div>
        `;
      }
    }
  } catch (err) {
    const container = document.getElementById('listaTermometroPostos');
    if (container) {
      container.innerHTML = `
        <div class="alert alert-danger">Falha de conexão: ${err.message}</div>
      `;
    }
  } finally {
    if (btn) {
      btn.innerHTML = `<i class="bi bi-arrow-repeat me-1"></i> Sincronizar Base KMM`;
      btn.disabled = false;
    }
  }
}

function atualizarCardAnttOficial() {
  const elCard = document.getElementById('cardAnpAntt');
  const elSub = document.getElementById('cardAnpAnttSub');

  if (dadosAnpBaseGlobal && dadosAnpBaseGlobal.referencia_antt) {
    const ref = dadosAnpBaseGlobal.referencia_antt;
    const precoNum = parseFloat(ref.valor);
    if (!isNaN(precoNum) && precoNum > 0) {
      if (elCard) elCard.innerText = 'R$ ' + precoNum.toFixed(2).replace('.', ',');
      const periodo = ref.periodo || 'Publicação Vigente';
      if (elSub) elSub.innerHTML = `<i class="bi bi-file-earmark-check me-1"></i>${periodo}`;
      return;
    }
  }
  definirCardAnttIndisponivel();
}

function definirCardAnttIndisponivel() {
  const elCard = document.getElementById('cardAnpAntt');
  const elSub = document.getElementById('cardAnpAnttSub');
  if (elCard) elCard.innerText = "Indisponível";
  if (elSub) elSub.innerHTML = `<i class="bi bi-exclamation-circle me-1"></i>Sem publicação localizada`;
}

function popularFiltrosDinamicos() {
  const meses = [...new Set(baseRegistrosMensais.map(d => d.MES_ANO).filter(Boolean))].sort().reverse();
  const selectMes = document.getElementById('filtroMesAno');
  if (selectMes) {
    selectMes.innerHTML = '<option value="YTD">Ano Completo 2026 (Consolidado)</option>';
    
    const nomesMes = {
      '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
      '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
      '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro'
    };

    meses.forEach(m => {
      const [ano, mes] = m.split('-');
      const opt = document.createElement('option');
      opt.value = m;
      opt.innerText = `${nomesMes[mes] || mes}/${ano} (Competência)`;
      selectMes.appendChild(opt);
    });
  }

  const ufsUnicas = [...new Set(baseRegistrosMensais.map(d => d.UF_POSTO).filter(Boolean))].sort();
  const selectUf = document.getElementById('filtroUfSelect');
  if (selectUf) {
    selectUf.innerHTML = '<option value="">Todas</option>';
    ufsUnicas.forEach(uf => {
      const opt = document.createElement('option');
      opt.value = uf;
      opt.innerText = uf;
      selectUf.appendChild(opt);
    });
  }

  const selectAuditoriaUf = document.getElementById('filtroAuditoriaUf');
  if (selectAuditoriaUf) {
    selectAuditoriaUf.innerHTML = '<option value="">Todas</option>';
    ufsUnicas.forEach(uf => {
      const opt = document.createElement('option');
      opt.value = uf;
      opt.innerText = uf;
      selectAuditoriaUf.appendChild(opt);
    });
  }

  const contagemRedes = {
    'MARAJO': new Set(),
    'GRAAL': new Set(),
    'SIM': new Set(),
    'HG': new Set(),
    'OUTROS': new Set()
  };

  baseRegistrosMensais.forEach(d => {
    const p = normalizarTexto(d.POSTO);
    if (p.includes('MARAJO')) contagemRedes['MARAJO'].add(d.POSTO);
    else if (p.includes('GRAAL')) contagemRedes['GRAAL'].add(d.POSTO);
    else if (p.includes('SIM ') || p.includes('REDE SIM')) contagemRedes['SIM'].add(d.POSTO);
    else if (p.startsWith('HG ') || p.includes(' REDE HG')) contagemRedes['HG'].add(d.POSTO);
    else contagemRedes['OUTROS'].add(d.POSTO);
  });

  const htmlOpcoesRede = `
    <option value="">Todas as Redes</option>
    <option value="MARAJO">Rede Marajó (${contagemRedes['MARAJO'].size})</option>
    <option value="GRAAL">Rede Graal (${contagemRedes['GRAAL'].size})</option>
    <option value="SIM">Rede SIM (${contagemRedes['SIM'].size})</option>
    <option value="HG">Rede HG (${contagemRedes['HG'].size})</option>
    <option value="OUTROS">Outros / Avulsos (${contagemRedes['OUTROS'].size})</option>
  `;

  const filtroRede = document.getElementById('filtroRede');
  if (filtroRede) filtroRede.innerHTML = htmlOpcoesRede;

  const selectAuditoriaRede = document.getElementById('filtroAuditoriaRede');
  if (selectAuditoriaRede) selectAuditoriaRede.innerHTML = htmlOpcoesRede;

  const postosUnicos = [...new Set(baseRegistrosMensais.map(d => d.POSTO).filter(Boolean))].sort();
  const selectPosto = document.getElementById('filtroPosto');
  if (selectPosto) {
    selectPosto.innerHTML = '<option value="">Todos os Postos</option>';
    postosUnicos.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.innerText = p;
      selectPosto.appendChild(opt);
    });
  }
}

function alternarModoOperacao(modo) {
  modoAtual = modo;
  document.querySelectorAll('.btn-toggle-tipo').forEach(b => b.classList.remove('active'));

  if (modo === 'TODOS') document.getElementById('btnModoGeral')?.classList.add('active');
  if (modo === 'INTERNO') document.getElementById('btnModoInterno')?.classList.add('active');
  if (modo === 'EXTERNO') document.getElementById('btnModoExterno')?.classList.add('active');
  if (modo === 'ROTEIRIZADOR') document.getElementById('btnModoRota')?.classList.add('active');
  if (modo === 'MATRIZES') document.getElementById('btnModoMatrizes')?.classList.add('active');
  if (modo === 'AUDITORIA') document.getElementById('btnModoAuditoria')?.classList.add('active');

  const gridKpis = document.getElementById('gridKpisPrincipais');
  if (gridKpis) {
    gridKpis.style.display = (modo === 'AUDITORIA' || modo === 'ROTEIRIZADOR' || modo === 'MATRIZES') ? 'none' : 'flex';
  }

  const painelPrinc = document.getElementById('secaoPainelPrincipal');
  const roteirizador = document.getElementById('secaoRoteirizador');
  const matrizes = document.getElementById('secaoMatrizesGerenciais');
  const auditoria = document.getElementById('secaoAuditoriaComercial');

  if (painelPrinc) painelPrinc.style.display = 'none';
  if (roteirizador) roteirizador.style.display = 'none';
  if (matrizes) matrizes.style.display = 'none';
  if (auditoria) auditoria.style.display = 'none';

  if (modo === 'ROTEIRIZADOR') {
    if (roteirizador) roteirizador.style.display = 'block';
    if (typeof inicializarMapaLeaflet === 'function') inicializarMapaLeaflet();
  } else if (modo === 'MATRIZES') {
    if (matrizes) matrizes.style.display = 'block';
    if (typeof renderizarAbaMatrizes === 'function') renderizarAbaMatrizes();
  } else if (modo === 'AUDITORIA') {
    if (auditoria) auditoria.style.display = 'block';
    if (typeof renderizarAbaAuditoriaComercial === 'function') renderizarAbaAuditoriaComercial();
  } else {
    if (painelPrinc) painelPrinc.style.display = 'block';
    atualizarTextosHeaderPainel();
    processarPainel();
  }
}

function atualizarTextosHeaderPainel() {
  const lblTitulo = document.getElementById('lblTituloPainel');
  if (!lblTitulo) return;

  if (modoAtual === 'INTERNO') {
    lblTitulo.innerHTML = `<i class="bi bi-fuel-pump-fill me-1 text-success"></i> Termômetro de Garagens & Tanques Próprios`;
  } else if (modoAtual === 'EXTERNO') {
    lblTitulo.innerHTML = `<i class="bi bi-truck me-1 text-danger"></i> Painel de Negociação de Rota Rodoviária`;
  } else {
    lblTitulo.innerHTML = `<i class="bi bi-speedometer2 me-1 text-success"></i> Painel Consolidado &bull; Visão Integrada da Frota`;
  }
}

function aplicarFiltroUfSelect() {
  const val = document.getElementById('filtroUfSelect').value;
  ufFiltrada = val;
  const badgeUf = document.getElementById('badgeFiltroUf');
  if (val) {
    if (badgeUf) badgeUf.style.display = 'inline-block';
    const lblUf = document.getElementById('lblUfAtiva');
    if (lblUf) lblUf.innerText = val;
  } else {
    if (badgeUf) badgeUf.style.display = 'none';
  }
  if (typeof atualizarCoresMiniMapa === 'function') atualizarCoresMiniMapa();
  processarPainel();
}

function aplicarFiltroRede() {
  redeFiltrada = document.getElementById('filtroRede').value;
  processarPainel();
}

function filtrarPorPostoClique(nomePosto) {
  postoFiltrado = nomePosto;
  const filtroPosto = document.getElementById('filtroPosto');
  if (filtroPosto) filtroPosto.value = nomePosto;

  const badgePosto = document.getElementById('badgeFiltroPosto');
  if (badgePosto) badgePosto.style.display = 'inline-block';

  const lblPosto = document.getElementById('lblPostoAtivo');
  if (lblPosto) lblPosto.innerText = nomePosto;

  processarPainel();
}

function aplicarFiltroPostoSelect() {
  const val = document.getElementById('filtroPosto').value;
  if (val) {
    filtrarPorPostoClique(val);
  } else {
    limparFiltroPosto();
  }
}

function limparFiltroPosto() {
  postoFiltrado = "";
  const filtroPosto = document.getElementById('filtroPosto');
  if (filtroPosto) filtroPosto.value = "";

  const badgePosto = document.getElementById('badgeFiltroPosto');
  if (badgePosto) badgePosto.style.display = 'none';

  processarPainel();
}

function limparFiltroUf() {
  ufFiltrada = "";
  const filtroUf = document.getElementById('filtroUfSelect');
  if (filtroUf) filtroUf.value = "";

  const badgeUf = document.getElementById('badgeFiltroUf');
  if (badgeUf) badgeUf.style.display = 'none';

  if (typeof atualizarCoresMiniMapa === 'function') atualizarCoresMiniMapa();
  processarPainel();
}

function processarPainel() {
  const mesSel = document.getElementById('filtroMesAno') ? document.getElementById('filtroMesAno').value : 'YTD';

  let registros = baseRegistrosMensais;

  if (ufFiltrada) {
    registros = registros.filter(d => d.UF_POSTO === ufFiltrada);
  }
  if (postoFiltrado) {
    registros = registros.filter(d => d.POSTO === postoFiltrado);
  }
  if (redeFiltrada) {
    if (redeFiltrada === 'OUTROS') {
      registros = registros.filter(d => {
        const p = normalizarTexto(d.POSTO);
        return !p.includes('MARAJO') && !p.startsWith('HG ') && !p.includes('SIM ') && !p.includes('GRAAL');
      });
    } else {
      registros = registros.filter(d => normalizarTexto(d.POSTO).includes(redeFiltrada));
    }
  }

  let baseCalculoGeral = registros;
  if (mesSel !== 'YTD') {
    baseCalculoGeral = registros.filter(d => d.MES_ANO === mesSel);
  }

  // 1. Tabela Sintética de Conferência (Agora soma os ciclos)
  let qtdRota = 0, volRota = 0, gastoRota = 0;
  let qtdInterno = 0, volInterno = 0, gastoInterno = 0;

  baseCalculoGeral.forEach(d => {
    const l = parseFloat(d.VOLUME_CICLO || 0);
    const v = parseFloat(d.VALOR_TOTAL_CICLO || 0);
    const q = parseInt(d.QTD_ABASTECIMENTOS || 0, 10);

    if (d.TIPO_OPERACAO === 'INTERNO') {
      qtdInterno += q;
      volInterno += l;
      gastoInterno += v;
    } else {
      qtdRota += q;
      volRota += l;
      gastoRota += v;
    }
  });

  const qtdTotal = qtdRota + qtdInterno;
  const volTotal = volRota + volInterno;
  const gastoTotal = gastoRota + gastoInterno;

  const tbQtdRota = document.getElementById('tbResumoQtdRota');
  const tbVolRota = document.getElementById('tbResumoVolRota');
  const tbGastoRota = document.getElementById('tbResumoGastoRota');
  if (tbQtdRota) tbQtdRota.innerText = qtdRota.toLocaleString('pt-BR');
  if (tbVolRota) tbVolRota.innerText = Math.round(volRota).toLocaleString('pt-BR');
  if (tbGastoRota) tbGastoRota.innerText = "R$ " + Math.round(gastoRota).toLocaleString('pt-BR');

  const tbQtdInt = document.getElementById('tbResumoQtdInterno');
  const tbVolInt = document.getElementById('tbResumoVolInterno');
  const tbGastoInt = document.getElementById('tbResumoGastoInterno');
  if (tbQtdInt) tbQtdInt.innerText = qtdInterno.toLocaleString('pt-BR');
  if (tbVolInt) tbVolInt.innerText = Math.round(volInterno).toLocaleString('pt-BR');
  if (tbGastoInt) tbGastoInt.innerText = "R$ " + Math.round(gastoInterno).toLocaleString('pt-BR');

  const tbQtdTot = document.getElementById('tbResumoQtdTotal');
  const tbVolTot = document.getElementById('tbResumoVolTotal');
  const tbGastoTot = document.getElementById('tbResumoGastoTotal');
  if (tbQtdTot) tbQtdTot.innerText = qtdTotal.toLocaleString('pt-BR');
  if (tbVolTot) tbVolTot.innerText = Math.round(volTotal).toLocaleString('pt-BR');
  if (tbGastoTot) tbGastoTot.innerText = "R$ " + Math.round(gastoTotal).toLocaleString('pt-BR');

  // 2. Filtro dos postos e listagem
  let registrosModo = registros;
  if (modoAtual !== 'TODOS' && modoAtual !== 'ROTEIRIZADOR' && modoAtual !== 'MATRIZES' && modoAtual !== 'AUDITORIA') {
    registrosModo = registros.filter(d => d.TIPO_OPERACAO === modoAtual);
  }

  const mesesDisponiveis = [...new Set(baseRegistrosMensais.map(d => d.MES_ANO).filter(Boolean))].sort();
  const mesMaisRecenteGeral = mesesDisponiveis[mesesDisponiveis.length - 1] || '2026-10';

  const postosMap = {};
  let somaLitrosCards = 0;
  let somaGastoCards = 0;

  let baseCalculo = registrosModo;
  if (mesSel !== 'YTD') {
    baseCalculo = registrosModo.filter(d => d.MES_ANO === mesSel);
  }

  let amostraTempoLocal = baseCalculo;
  if (mesSel === 'YTD') {
    let maxDataGeral = "";
    baseCalculo.forEach(d => {
      if (d.DATA_FIM_CICLO > maxDataGeral) maxDataGeral = d.DATA_FIM_CICLO;
    });
    if (maxDataGeral) {
      const match = maxDataGeral.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const dtCorte = new Date(new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00Z`).getTime() - (30 * 24 * 60 * 60 * 1000));
        const strCorte = dtCorte.toISOString().slice(0, 10);
        amostraTempoLocal = baseCalculo.filter(d => (d.DATA_FIM_CICLO || '').substring(0, 10) >= strCorte);
      }
    }
  }

  const melhorConcorrenteMunicipio = {};
  amostraTempoLocal.forEach(d => {
    const preco = parseFloat(d.VALOR_UNITARIO || 0);
    const mun = normalizarTexto(d.MUNICIPIO_POSTO);
    if (preco > 0 && mun && d.TIPO_OPERACAO === 'EXTERNO') {
      if (!melhorConcorrenteMunicipio[mun] || preco < melhorConcorrenteMunicipio[mun].preco) {
        melhorConcorrenteMunicipio[mun] = {
          posto: d.POSTO,
          preco: preco,
          data: d.DATA_FIM_CICLO
        };
      }
    }
  });

  // Agregação dos ciclos por posto
  baseCalculo.forEach(d => {
    const chave = d.TIPO_OPERACAO === 'INTERNO' 
      ? `${d.POSTO}_${d.UF_POSTO}_${d.MUNICIPIO_POSTO}` 
      : `${d.POSTO}_${d.UF_POSTO}`;

    const litros = parseFloat(d.VOLUME_CICLO || 0);
    const valor = parseFloat(d.VALOR_TOTAL_CICLO || 0);

    somaLitrosCards += litros;
    somaGastoCards += valor;

    if (!postosMap[chave]) {
      postosMap[chave] = {
        POSTO: d.POSTO,
        UF_POSTO: d.UF_POSTO,
        MUNICIPIO_POSTO: d.MUNICIPIO_POSTO,
        TIPO_OPERACAO: d.TIPO_OPERACAO,
        LITROS_TOTAL: 0,
        VALOR_TOTAL: 0,
        ULTIMO_PRECO: parseFloat(d.VALOR_UNITARIO || 0),
        DATA_MAIS_RECENTE: d.DATA_FIM_CICLO || "",
        MES_MAIS_RECENTE: d.MES_ANO
      };
    }

    postosMap[chave].LITROS_TOTAL += litros;
    postosMap[chave].VALOR_TOTAL += valor;

    if ((d.DATA_FIM_CICLO || "") > postosMap[chave].DATA_MAIS_RECENTE) {
      postosMap[chave].DATA_MAIS_RECENTE = d.DATA_FIM_CICLO;
      postosMap[chave].ULTIMO_PRECO = parseFloat(d.VALOR_UNITARIO || 0);
      postosMap[chave].MES_MAIS_RECENTE = d.MES_ANO;
    }
  });

  const listaPostos = Object.values(postosMap).map(p => {
    let precoMedioExibicao = 0;
    
    if (mesSel === 'YTD') {
      const ciclosVigentes = baseRegistrosMensais.filter(r => 
        r.POSTO === p.POSTO && r.UF_POSTO === p.UF_POSTO && r.MES_ANO === p.MES_MAIS_RECENTE &&
        (p.TIPO_OPERACAO !== 'INTERNO' || r.MUNICIPIO_POSTO === p.MUNICIPIO_POSTO)
      );
      const litMes = ciclosVigentes.reduce((acc, c) => acc + parseFloat(c.VOLUME_CICLO || 0), 0);
      const valMes = ciclosVigentes.reduce((acc, c) => acc + parseFloat(c.VALOR_TOTAL_CICLO || 0), 0);
      precoMedioExibicao = litMes > 0 ? (valMes / litMes) : 0;
    } else {
      precoMedioExibicao = p.LITROS_TOTAL > 0 ? (p.VALOR_TOTAL / p.LITROS_TOTAL) : 0;
    }

    const tabelaReferencia = (p.TIPO_OPERACAO === 'INTERNO') ? anpDistribuicao : anpRevenda;
    const anpUf = tabelaReferencia[p.UF_POSTO] || null;
    const mesRefAnp = (mesSel === 'YTD') ? p.MES_MAIS_RECENTE : mesSel;
    const refAnpValor = (anpUf && anpUf[mesRefAnp]) ? anpUf[mesRefAnp] : 0;
    const gapMercado = (precoMedioExibicao > 0 && refAnpValor > 0) ? (precoMedioExibicao - refAnpValor) : 0;
    const gapPerc = refAnpValor > 0 ? ((gapMercado / refAnpValor) * 100) : 0;

    const impactoTotalReais = (gapMercado > 0 && p.LITROS_TOTAL > 0) ? (gapMercado * p.LITROS_TOTAL) : 0;

    const munNorm = normalizarTexto(p.MUNICIPIO_POSTO);
    const melhorLocal = melhorConcorrenteMunicipio[munNorm];
    let diffLocal = 0;
    let nomeMelhorLocal = "";
    let precoMelhorLocal = 0;

    if (p.TIPO_OPERACAO === 'EXTERNO' && melhorLocal && melhorLocal.posto !== p.POSTO) {
      const precoRefComp = (mesSel === 'YTD') ? p.ULTIMO_PRECO : precoMedioExibicao;
      if (precoRefComp > (melhorLocal.preco + 0.05)) {
        diffLocal = precoRefComp - melhorLocal.preco;
        nomeMelhorLocal = melhorLocal.posto;
        precoMelhorLocal = melhorLocal.preco;
      }
    }

    return {
      ...p,
      NOME_EXIBICAO: identificarNomePonto(p.POSTO, p.MUNICIPIO_POSTO, p.UF_POSTO, p.TIPO_OPERACAO),
      PRECO_MEDIO_EXIBICAO: precoMedioExibicao,
      REF_ANP: refAnpValor,
      GAP_MERCADO: gapMercado,
      GAP_PERC: gapPerc,
      IMPACTO_REAIS: impactoTotalReais,
      DIFF_LOCAL: diffLocal,
      NOME_MELHOR_LOCAL: nomeMelhorLocal,
      PRECO_MELHOR_LOCAL: precoMelhorLocal
    };
  });

  listaPostos.sort((a, b) => b.LITROS_TOTAL - a.LITROS_TOTAL);

  let precoMedioCard = 0;
  if (mesSel === 'YTD') {
    const regsMesRecente = registrosModo.filter(d => d.MES_ANO === mesMaisRecenteGeral);
    const litRec = regsMesRecente.reduce((acc, c) => acc + parseFloat(c.VOLUME_CICLO || 0), 0);
    const valRec = regsMesRecente.reduce((acc, c) => acc + parseFloat(c.VALOR_TOTAL_CICLO || 0), 0);
    precoMedioCard = litRec > 0 ? (valRec / litRec) : 0;
  } else {
    precoMedioCard = somaLitrosCards > 0 ? (somaGastoCards / somaLitrosCards) : 0;
  }

  const elCardVol = document.getElementById('cardVolume');
  const elCardGasto = document.getElementById('cardGasto');
  const elCardPm = document.getElementById('cardPrecoMedio');

  if (elCardVol) elCardVol.innerText = somaLitrosCards.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + " L";
  if (elCardGasto) elCardGasto.innerText = "R$ " + somaGastoCards.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (elCardPm) {
    elCardPm.innerText = precoMedioCard > 0
      ? "R$ " + precoMedioCard.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
      : "R$ 0,000";
  }

  const postosComDesvio = listaPostos
    .filter(p => p.TIPO_OPERACAO === 'EXTERNO' && p.IMPACTO_REAIS > 0)
    .sort((a, b) => b.IMPACTO_REAIS - a.IMPACTO_REAIS)
    .slice(0, 3);

  const containerTop3 = document.getElementById('listaTop3Acao');
  if (containerTop3) {
    if (postosComDesvio.length > 0) {
      containerTop3.innerHTML = postosComDesvio.map(p => {
        const dataFmt = formatarDataDiaMes(p.DATA_MAIS_RECENTE);
        return `
          <div class="item-top3-acao">
            <div class="item-top3-dados">
              <span class="badge bg-dark text-white p-1" style="font-size:0.58rem;">${p.UF_POSTO}</span>
              <span class="item-top3-nome" title="${p.NOME_EXIBICAO}">${p.NOME_EXIBICAO}</span>
              <span class="item-top3-historico">R$ ${p.ULTIMO_PRECO.toFixed(2)} (${dataFmt})</span>
            </div>
            <span class="item-top3-val">+R$ ${Math.round(p.IMPACTO_REAIS).toLocaleString('pt-BR')}</span>
          </div>
        `;
      }).join('');
    } else {
      containerTop3.innerHTML = `<div class="text-muted small" style="font-size: 0.65rem;">Nenhum posto com ágio no filtro atual.</div>`;
    }
  }

  renderizarSparklineVolumeCard(mesesDisponiveis, registrosModo);
  atualizarCardsExtremosSemPonderada(registros, mesSel);
  renderizarTermometroPostos(listaPostos, mesesDisponiveis);

  if (typeof atualizarCoresMiniMapa === 'function') atualizarCoresMiniMapa();
}

function renderizarSparklineVolumeCard(mesesDisponiveis, registros) {
  const container = document.getElementById('sparkVolumeBg');
  if (!container) return;

  const dadosVolume = mesesDisponiveis.map(m => {
    const regs = registros.filter(r => r.MES_ANO === m);
    return Math.round(regs.reduce((acc, c) => acc + parseFloat(c.VOLUME_CICLO || 0), 0));
  });

  if (sparkVolumeCardInstance) {
    try { sparkVolumeCardInstance.destroy(); } catch(e){}
  }

  const options = {
    series: [{ data: dadosVolume }],
    chart: {
      type: 'area',
      height: '100%',
      width: '100%',
      sparkline: { enabled: true },
      animations: { enabled: false }
    },
    colors: ['#1c483a'],
    stroke: { curve: 'smooth', width: 1.5 },
    fill: {
      type: 'solid',
      opacity: 0.16
    },
    tooltip: { enabled: false }
  };

  sparkVolumeCardInstance = new ApexCharts(container, options);
  sparkVolumeCardInstance.render();
}

function atualizarCardsExtremosSemPonderada(todosRegistros, mesSel) {
  const containerMaior = document.getElementById('cardMaiorConteudo');
  const containerMenor = document.getElementById('cardMenorConteudo');
  const lblMaiorSub = document.getElementById('cardMaiorUfSub');
  const lblMenorSub = document.getElementById('cardMenorUfSub');

  if (!containerMaior || !containerMenor) return;

  let amostra = todosRegistros.filter(d => parseFloat(d.VALOR_UNITARIO || 0) > 0 && d.DATA_FIM_CICLO);

  if (mesSel !== 'YTD') {
    amostra = amostra.filter(d => d.MES_ANO === mesSel);
  } else {
    let maxDataStr = "";
    amostra.forEach(d => {
      if (d.DATA_FIM_CICLO > maxDataStr) maxDataStr = d.DATA_FIM_CICLO;
    });

    if (maxDataStr) {
      const match = maxDataStr.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const maxDate = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00Z`);
        const dataCorte = new Date(maxDate.getTime() - (20 * 24 * 60 * 60 * 1000));
        const dataCorteStr = dataCorte.toISOString().slice(0, 10);
        amostra = amostra.filter(d => (d.DATA_FIM_CICLO || '').substring(0, 10) >= dataCorteStr);
      }
    }
  }

  function extrairExtremos(lista) {
    if (!lista || lista.length === 0) return { max: null, min: null };
    let maxReg = lista[0];
    let minReg = lista[0];
    lista.forEach(item => {
      const p = parseFloat(item.VALOR_UNITARIO);
      if (p > parseFloat(maxReg.VALOR_UNITARIO)) maxReg = item;
      if (p < parseFloat(minReg.VALOR_UNITARIO)) minReg = item;
    });
    return {
      max: {
        uf: maxReg.UF_POSTO,
        posto: identificarNomePonto(maxReg.POSTO, maxReg.MUNICIPIO_POSTO, maxReg.UF_POSTO, maxReg.TIPO_OPERACAO),
        preco: parseFloat(maxReg.VALOR_UNITARIO)
      },
      min: {
        uf: minReg.UF_POSTO,
        posto: identificarNomePonto(minReg.POSTO, minReg.MUNICIPIO_POSTO, minReg.UF_POSTO, minReg.TIPO_OPERACAO),
        preco: parseFloat(minReg.VALOR_UNITARIO)
      }
    };
  }

  if (modoAtual === 'TODOS') {
    const rotaRegs = amostra.filter(d => d.TIPO_OPERACAO === 'EXTERNO');
    const internoRegs = amostra.filter(d => d.TIPO_OPERACAO === 'INTERNO');

    const extRota = extrairExtremos(rotaRegs);
    const extInterno = extrairExtremos(internoRegs);

    if (extRota.max || extInterno.max) {
      containerMaior.innerHTML = `
        <div class="kpi-val-split text-danger" title="Pico Rota: ${extRota.max ? extRota.max.posto : 'ND'}">
          <span class="d-flex align-items-center gap-1">
            <span class="badge-tipo tipo-rota">ROTA</span>
            <span style="color: #334155; font-weight: 800;">${extRota.max ? extRota.max.uf : '--'}</span>
          </span>
          <span>R$ ${extRota.max ? extRota.max.preco.toFixed(3) : '--'}</span>
        </div>
        <div class="kpi-val-split text-danger pt-1 mt-1" style="border-top: 1px dotted #fecaca;" title="Maior Garagem: ${extInterno.max ? extInterno.max.posto : 'ND'}">
          <span class="d-flex align-items-center gap-1">
            <span class="badge-tipo tipo-interno">GARAGEM</span>
            <span style="color: #334155; font-weight: 800;">${extInterno.max ? extInterno.max.uf : '--'}</span>
          </span>
          <span>R$ ${extInterno.max ? extInterno.max.preco.toFixed(3) : '--'}</span>
        </div>
      `;
      if (lblMaiorSub) lblMaiorSub.innerText = mesSel === 'YTD' ? "Últimos 20 dias ativos" : "Extremos da competência";
    } else {
      containerMaior.innerHTML = `<div class="kpi-val text-danger">--</div>`;
      if (lblMaiorSub) lblMaiorSub.innerText = "Sem compras recentes";
    }

    if (extRota.min || extInterno.min) {
      containerMenor.innerHTML = `
        <div class="kpi-val-split text-success" title="Menor Posto Rota: ${extRota.min ? extRota.min.posto : 'ND'}">
          <span class="d-flex align-items-center gap-1">
            <span class="badge-tipo tipo-rota">ROTA</span>
            <span style="color: #334155; font-weight: 800;">${extRota.min ? extRota.min.uf : '--'}</span>
          </span>
          <span>R$ ${extRota.min ? extRota.min.preco.toFixed(3) : '--'}</span>
        </div>
        <div class="kpi-val-split text-success pt-1 mt-1" style="border-top: 1px dotted #bbf7d0;" title="Menor Garagem Ativa: ${extInterno.min ? extInterno.min.posto : 'ND'}">
          <span class="d-flex align-items-center gap-1">
            <span class="badge-tipo tipo-interno">GARAGEM</span>
            <span style="color: #334155; font-weight: 800;">${extInterno.min ? extInterno.min.uf : '--'}</span>
          </span>
          <span>R$ ${extInterno.min ? extInterno.min.preco.toFixed(3) : '--'}</span>
        </div>
      `;
      if (lblMenorSub) lblMenorSub.innerText = mesSel === 'YTD' ? "Últimos 20 dias ativos" : "Extremos da competência";
    } else {
      containerMenor.innerHTML = `<div class="kpi-val text-success">--</div>`;
      if (lblMenorSub) lblMenorSub.innerText = "Sem compras recentes";
    }

  } else {
    const registrosModo = amostra.filter(d => d.TIPO_OPERACAO === modoAtual);
    const ext = extrairExtremos(registrosModo);
    const rotuloTipo = modoAtual === 'INTERNO' ? 'Garagem' : 'Rota';

    if (ext.max) {
      containerMaior.innerHTML = `
        <div class="kpi-val text-danger" title="${ext.max.posto}">
          <span style="color: #334155;">${ext.max.uf}</span> - R$ ${ext.max.preco.toFixed(3)}
        </div>
      `;
      if (lblMaiorSub) lblMaiorSub.innerText = `${rotuloTipo} • ${ext.max.posto}`;
    } else {
      containerMaior.innerHTML = `<div class="kpi-val text-danger">--</div>`;
      if (lblMaiorSub) lblMaiorSub.innerText = "Sem compras recentes";
    }

    if (ext.min) {
      containerMenor.innerHTML = `
        <div class="kpi-val text-success" title="${ext.min.posto}">
          <span style="color: #334155;">${ext.min.uf}</span> - R$ ${ext.min.preco.toFixed(3)}
        </div>
      `;
      if (lblMenorSub) lblMenorSub.innerText = `${rotuloTipo} • ${ext.min.posto}`;
    } else {
      containerMenor.innerHTML = `<div class="kpi-val text-success">--</div>`;
      if (lblMenorSub) lblMenorSub.innerText = "Sem compras recentes";
    }
  }
}

function renderizarTermometroPostos(postos, mesesDisponiveis) {
  const container = document.getElementById('listaTermometroPostos');
  if (!container) return;
  container.innerHTML = "";

  const lblList = document.getElementById('lblListando');
  if (lblList) lblList.innerText = `A listar ${postos.length} postos`;

  if (postos.length === 0) {
    container.innerHTML = `<div class="text-center py-5 text-muted">Nenhum posto com movimentação no filtro atual.</div>`;
    return;
  }

  Object.values(sparklineInstances).forEach(chart => {
    try { chart.destroy(); } catch(e){}
  });
  sparklineInstances = {};

  postos.forEach((p, idx) => {
    const chartDomId = `chart-bg-${idx}`;
    const ehInterno = (p.TIPO_OPERACAO === 'INTERNO');
    const badgeTipo = ehInterno 
      ? `<span class="badge-tipo tipo-interno">GARAGEM</span>`
      : `<span class="badge-tipo tipo-rota">ROTA</span>`;

    let gapHtml = `<span class="text-muted small">--</span>`;
    if (p.REF_ANP > 0) {
      const sinal = p.GAP_MERCADO >= 0 ? "+" : "-";
      const corGap = p.GAP_MERCADO > 0.05 ? "text-danger" : "text-success";
      // Correção da máscara monetária com toLocaleString para utilizar vírgula
      gapHtml = `<span class="${corGap} fw-bold small">${sinal}R$ ${Math.abs(p.GAP_MERCADO).toLocaleString('pt-BR', {minimumFractionDigits: 3, maximumFractionDigits: 3})} (${sinal}${Math.abs(p.GAP_PERC).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1})}%)</span>`;
    }

    let impactoHtml = `<span class="text-muted small">R$ 0,00</span>`;
    if (p.IMPACTO_REAIS > 0) {
      impactoHtml = `<span class="text-danger fw-bold small">+R$ ${Math.round(p.IMPACTO_REAIS).toLocaleString('pt-BR')}</span>`;
    } else if (p.REF_ANP > 0 && p.GAP_MERCADO < 0) {
      const economia = Math.abs(p.GAP_MERCADO * p.LITROS_TOTAL);
      impactoHtml = `<span class="text-success fw-bold small">-R$ ${Math.round(economia).toLocaleString('pt-BR')}</span>`;
    }

    let tagDispersao = "";
    if (p.DIFF_LOCAL > 0) {
      const titleTexto = `Opção mais barata no mesmo período: ${p.NOME_MELHOR_LOCAL} a R$ ${p.PRECO_MELHOR_LOCAL.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
      tagDispersao = `<span class="badge-dispersao-local" title="${titleTexto}">Opção local -R$ ${p.DIFF_LOCAL.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>`;
    }

    const dataUltimoFormatada = formatarDataDiaMes(p.DATA_MAIS_RECENTE);

    const indicesAbastecidos = [];
    const dadosKmmMes = [];
    const dadosAnpMes = [];

    mesesDisponiveis.forEach((m, mIdx) => {
      // Agrupa os ciclos do posto no mês específico para achar o Preço Médio ponderado daquele mês para o gráfico
      const ciclosMes = baseRegistrosMensais.filter(r => 
        r.POSTO === p.POSTO && r.UF_POSTO === p.UF_POSTO && r.MES_ANO === m &&
        (p.TIPO_OPERACAO !== 'INTERNO' || r.MUNICIPIO_POSTO === p.MUNICIPIO_POSTO)
      );
      
      let precoKmmMes = null;
      if (ciclosMes.length > 0) {
        const litrosMes = ciclosMes.reduce((acc, c) => acc + parseFloat(c.VOLUME_CICLO || 0), 0);
        const valorMes = ciclosMes.reduce((acc, c) => acc + parseFloat(c.VALOR_TOTAL_CICLO || 0), 0);
        if (litrosMes > 0) precoKmmMes = (valorMes / litrosMes);
      }

      if (precoKmmMes > 0) {
        indicesAbastecidos.push(mIdx);
        dadosKmmMes.push(parseFloat(precoKmmMes.toFixed(3)));
      } else {
        dadosKmmMes.push(null);
      }

      const tabelaRef = ehInterno ? anpDistribuicao : anpRevenda;
      const anpUf = tabelaRef[p.UF_POSTO] || null;
      dadosAnpMes.push((anpUf && anpUf[m]) ? parseFloat(anpUf[m].toFixed(3)) : null);
    });

    let marcadoresLinhasHtml = "";
    const totalMeses = Math.max(1, mesesDisponiveis.length - 1);
    if (indicesAbastecidos.length > 0) {
      const primeiroMesIdx = indicesAbastecidos[0];
      const ultimoMesIdx = indicesAbastecidos[indicesAbastecidos.length - 1];

      const posIniPerc = (primeiroMesIdx / totalMeses) * 100;
      const posFimPerc = (ultimoMesIdx / totalMeses) * 100;

      marcadoresLinhasHtml = `
        <div class="linha-corte-tempo" style="left: ${posIniPerc}%;" title="Início de Abastecimento: ${mesesDisponiveis[primeiroMesIdx]}"></div>
        <div class="linha-corte-tempo" style="left: ${posFimPerc}%;" title="Último Abastecimento: ${mesesDisponiveis[ultimoMesIdx]}"></div>
      `;
    }

    const ehZebrado = (idx % 2 === 1) ? 'zebrado-sutil' : '';

    const card = document.createElement('div');
    card.className = `card-posto-termometro ${ehZebrado}`;
    
    // Tratamento de destruição do tooltip fantasma ao tirar o mouse do card

    card.innerHTML = `
      <div class="col-posto-identificacao">
        <span class="badge-uf">${p.UF_POSTO || '--'}</span>
        <div style="min-width: 0;">
          <div class="nome-posto-completo clickable-posto" onclick="filtrarPorPostoClique('${p.POSTO.replace(/'/g, "\\'")}')" title="${p.NOME_EXIBICAO}">
            ${p.NOME_EXIBICAO}
          </div>
          <div class="small text-muted" style="font-size: 0.66rem;">
            ${p.MUNICIPIO_POSTO || 'ND'} &bull; ${badgeTipo}
            ${tagDispersao}
          </div>
        </div>
      </div>

      <div class="col-posto-grafico">
        ${marcadoresLinhasHtml}
        <div id="${chartDomId}" style="width: 100%; height: 100%;"></div>
      </div>

      <div class="col-posto-metricas">
        <div class="col-m-vol">
          <div class="small text-muted text-uppercase" style="font-size: 0.58rem; font-weight: 800;">Volume</div>
          <div class="font-monospace fw-bold" style="font-size: 0.78rem;">${Math.round(p.LITROS_TOTAL).toLocaleString('pt-BR')} L</div>
        </div>

        <div class="col-m-pm">
          <div class="small text-muted text-uppercase" style="font-size: 0.58rem; font-weight: 800;">Preço Médio</div>
          <div class="font-monospace fw-bold text-dark" style="font-size: 0.78rem;">
            R$ ${p.PRECO_MEDIO_EXIBICAO.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
          </div>
        </div>

        <div class="col-m-anp">
          <div class="small text-muted text-uppercase" style="font-size: 0.58rem; font-weight: 800;">Ref. ANP</div>
          <div class="font-monospace text-secondary fw-semibold" style="font-size: 0.78rem;">
            ${p.REF_ANP > 0 ? "R$ " + p.REF_ANP.toLocaleString('pt-BR', {minimumFractionDigits: 3, maximumFractionDigits: 3}) : "--"}
          </div>
        </div>

        <div class="col-m-gap">
          <div class="small text-muted text-uppercase" style="font-size: 0.58rem; font-weight: 800;">GAP ANP</div>
          <div class="font-monospace" style="font-size: 0.74rem;">${gapHtml}</div>
        </div>

        <div class="col-m-ult">
          <div class="small text-muted text-uppercase" style="font-size: 0.58rem; font-weight: 800;">Último Pago</div>
          <div class="font-monospace fw-bold" style="font-size: 0.78rem;">R$ ${p.ULTIMO_PRECO.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</div>
          <div class="font-monospace text-muted" style="font-size: 0.60rem; line-height: 1;">em ${dataUltimoFormatada}</div>
        </div>

        <div class="col-m-impacto">
          <div class="small text-muted text-uppercase" style="font-size: 0.58rem; font-weight: 800;">Impacto R$</div>
          <div class="font-monospace">${impactoHtml}</div>
        </div>

        <div class="col-m-btn">
          <button class="btn-tratativa" onclick="abrirModalTratativa('${p.POSTO.replace(/'/g, "\\'")}', '${p.UF_POSTO}', '${(p.MUNICIPIO_POSTO || '').replace(/'/g, "\\'")}', ${p.PRECO_MEDIO_EXIBICAO}, ${p.REF_ANP}, ${p.ULTIMO_PRECO})">
            <i class="bi bi-journal-check"></i> Tratativa
          </button>
        </div>
      </div>
    `;

    container.appendChild(card);

    const corPago = ehInterno ? '#2563eb' : '#ea580c';
    const corAnpTracejado = '#64748b';

    const optionsSpark = {
      series: [
        { name: ehInterno ? "Custo Interno" : "Preço Pago", data: dadosKmmMes },
        { name: "Referência ANP", data: dadosAnpMes }
      ],
      xaxis: {
        categories: mesesDisponiveis
      },
      chart: {
        type: 'area',
        height: 48,
        sparkline: { enabled: true },
        animations: { enabled: false }
      },
      colors: [corPago, corAnpTracejado],
      stroke: { 
        curve: 'smooth', 
        width: [1.2, 1.2], 
        dashArray: [0, 4]
      },
      fill: {
        type: ['solid', 'none'],
        opacity: [0.24, 0]
      },
      tooltip: {
        enabled: true,
        theme: 'dark',
        followCursor: true,
        x: {
          show: true,
          formatter: function(val, opt) {
            return opt && opt.dataPointIndex !== undefined ? mesesDisponiveis[opt.dataPointIndex] : val;
          }
        },
        y: {
          formatter: function(val) {
            return val ? `R$ ${val.toLocaleString('pt-BR', {minimumFractionDigits: 3, maximumFractionDigits: 3})}` : "Sem reg.";
          }
        }
      }
    };

    const sparkChart = new ApexCharts(document.getElementById(chartDomId), optionsSpark);
    sparkChart.render();
    sparklineInstances[chartDomId] = sparkChart;
  });
}

function filtrarTabelaTexto() {
  const busca = document.getElementById('campoBusca').value.trim().toLowerCase();
  document.querySelectorAll('.card-posto-termometro').forEach(card => {
    const texto = card.innerText.toLowerCase();
    card.style.display = texto.includes(busca) ? "flex" : "none";
  });
}
