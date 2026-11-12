/* ==========================================================================
   MÓDULO DO PAINEL PRINCIPAL & TERMÔMETRO OPERACIONAL KMM
   CARGOSOFT | VOCTT DATA ANALYTICS DIESEL
   Controla os KPIs do dashboard principal, consumo por frota/placa, gráficos
   de volume e integração das APIs de abastecimento KMM e dados ANP.
   ========================================================================== */

const WORKER_URL = "https://api-abastecimentos.klapowsko.workers.dev";
// O documento ANP acompanha o ano corrente, igual ao ano processado pela rotina de atualização.
const FIRESTORE_REST_URL = `https://firestore.googleapis.com/v1/projects/cargosoft-diesel/databases/(default)/documents/anp_consolidada/mensal_${new Date().getFullYear()}`;

let baseRegistrosMensais = [];
let dadosAnpBaseGlobal = null;
let sparklineInstances = {};
let sparkVolumeCardInstance = null;
let resumoVolumeCharts = {};
let resumoVolumeResizeTimer = null;
let modoAtual = "TODOS";
let ufFiltrada = "";
let postoFiltrado = "";
let redeFiltrada = "";
let postosExternosExpandidos = false;
let animacaoInicialKpisExecutada = false;
let sequenciaAnimacaoCards = 0;

window.addEventListener('resize', () => {
  clearTimeout(resumoVolumeResizeTimer);
  resumoVolumeResizeTimer = setTimeout(() => {
    Object.entries(resumoVolumeCharts).forEach(([id, chart]) => {
      const container = document.getElementById(id);
      const canvas = container && container.querySelector('.apexcharts-canvas');
      const largura = container && Math.round(container.clientWidth);
      if (canvas && largura > 0 && Math.round(canvas.getBoundingClientRect().width) !== largura) {
        chart.updateOptions({ chart: { width: largura } }, false, false, false);
      }
    });
  }, 150);
});

const DIAS_LIMITE_TRATATIVA = 25;
const JANELA_TRATATIVA_PROXIMA_DO_VENCIMENTO = 5;
const MAX_POSTOS_PRIORIDADE = 5;

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

// Usa o ano da competência mais recente da base para definir o período YTD disponível.
function obterAnoMaisRecenteBase(registros = baseRegistrosMensais) {
  const meses = [...new Set(registros.map(d => d.MES_ANO).filter(Boolean))].sort();
  return meses.length ? meses[meses.length - 1].slice(0, 4) : '';
}

// Retorna somente transações do ano-base; o resultado alimenta totais, gráficos e mapa.
function filtrarRegistrosYtd(registros) {
  const ano = obterAnoMaisRecenteBase();
  return ano ? registros.filter(d => d.MES_ANO && d.MES_ANO.startsWith(`${ano}-`)) : [];
}

function obterDiasAteVencimentoTratativa(vigencia, hoje = new Date()) {
  const dataVigencia = String(vigencia || '').slice(0, 10);
  const partes = dataVigencia.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!partes) return null;

  const dataVigenciaMs = Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
  if (new Date(dataVigenciaMs).toISOString().slice(0, 10) !== dataVigencia) return null;

  const hojeMs = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const diasDesdeVigencia = Math.floor((hojeMs - dataVigenciaMs) / 86400000);
  return DIAS_LIMITE_TRATATIVA - diasDesdeVigencia;
}

function complementarPostosPrioritariosComTratativas(postosPrioritarios, listaPostos, obterTratativa, hoje = new Date()) {
  const vagas = MAX_POSTOS_PRIORIDADE - postosPrioritarios.length;
  if (vagas <= 0 || typeof obterTratativa !== 'function') return postosPrioritarios;

  const chavesPrioritarias = new Set(postosPrioritarios.map(p => `${p.TIPO_OPERACAO}|${p.POSTO}|${p.UF_POSTO}`));
  const postosComTratativaProxima = listaPostos
    .filter(p => p.TIPO_OPERACAO === 'EXTERNO' && !chavesPrioritarias.has(`${p.TIPO_OPERACAO}|${p.POSTO}|${p.UF_POSTO}`))
    .map(p => {
      const tratativa = obterTratativa(p.POSTO, p.UF_POSTO);
      const diasAteVencimento = obterDiasAteVencimentoTratativa(tratativa?.vigencia, hoje);
      return { posto: p, diasAteVencimento };
    })
    .filter(item => item.diasAteVencimento !== null && item.diasAteVencimento >= 0 && item.diasAteVencimento <= JANELA_TRATATIVA_PROXIMA_DO_VENCIMENTO)
    .sort((a, b) => a.diasAteVencimento - b.diasAteVencimento || b.posto.IMPACTO_REAIS - a.posto.IMPACTO_REAIS)
    .slice(0, vagas)
    .map(item => ({
      ...item.posto,
      ORIGEM_PRIORIDADE: 'TRATATIVA',
      DIAS_ATE_VENCIMENTO: item.diasAteVencimento
    }));

  return [...postosPrioritarios, ...postosComTratativaProxima];
}

// Centraliza a classificação para que contagens e filtros produzam os mesmos grupos.
function classificarRedePosto(nomePosto) {
  const posto = normalizarTexto(nomePosto);
  if (posto.includes('MARAJO')) return 'MARAJO';
  if (posto.includes('GRAAL')) return 'GRAAL';
  if (posto.includes('SIM ') || posto.includes('REDE SIM')) return 'SIM';
  if (posto.startsWith('HG ') || posto.includes(' REDE HG')) return 'HG';
  return 'OUTROS';
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
    if (mun.includes('COLOMBO') || pos.includes('COLOMBO')) return "Filial Colombo (Matriz)";
    if (mun.includes('EUSEBIO') || mun.includes('FORTALEZA') || pos.includes('EUSEBIO')) return "Filial Eusébio";
    if (mun.includes('SIMOES') || mun.includes('SALVADOR') || pos.includes('SIMOES')) return "Filial Simões Filho";
    if (mun.includes('GOIANIA') || mun.includes('APARECIDA') || pos.includes('GOIANIA')) return "Filial Goiânia";
    return `Garagem ${municipio || posto || 'Interna'}`;
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

      atualizarCardAnpBrasil();
      return;
    }
  } catch (err) {
    console.warn("Falha ao buscar via Firestore REST:", err);
  }
  definirCardAnpBrasilIndisponivel();
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
      try {
        if (typeof inicializarMiniMapaBrasil === 'function') {
          await inicializarMiniMapaBrasil();
        }
      } catch (mapaErr) {
        console.warn("Aviso ao carregar mini-mapa do Brasil:", mapaErr);
      }
      popularFiltrosDinamicos();
      processarPainel();
      if (!animacaoInicialKpisExecutada) {
        animacaoInicialKpisExecutada = true;
        animarEntradaKpis();
      }
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

function animarEntradaKpis() {
  const grade = document.getElementById('gridKpisPrincipais');
  if (!grade) return;

  const cards = Array.from(grade.querySelectorAll('.card-kpi, .card-tabela-resumo'));
  animarEntradaCards(cards, '.kpi-val, .kpi-val-grande');
}

function animarEntradaKpisAuditoria() {
  const cards = Array.from(document.querySelectorAll('#secaoAuditoriaComercial .card-kpi'));
  animarEntradaCards(cards, '.kpi-val-grande');
}

function animarEntradaKpisFechamento() {
  const cards = Array.from(document.querySelectorAll('#secaoFechamentoExecutivo .cards-fechamento-principais .card-exec-dark'));
  animarEntradaCards(cards, '.num-kpi-grande');
}

function animarEntradaCards(cards, seletorNumeros) {
  if (cards.length === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const sequencia = ++sequenciaAnimacaoCards;
  cards.forEach((card, indice) => {
    const atraso = indice * 45;
    card.style.setProperty('--atraso-entrada-kpi', `${atraso}ms`);
    card.classList.remove('card-animacao-entrada');
    if (seletorNumeros) card.querySelectorAll(seletorNumeros).forEach(elemento => {
      animarContagemKpi(elemento, 100 + atraso, sequencia);
    });
  });

  if (cards[0]) void cards[0].offsetWidth;
  setTimeout(() => {
    if (sequencia !== sequenciaAnimacaoCards) return;
    cards.forEach(card => card.classList.add('card-animacao-entrada'));
  }, 100);
  setTimeout(() => {
    if (sequencia !== sequenciaAnimacaoCards) return;
    cards.forEach(card => {
      card.classList.remove('card-animacao-entrada');
      card.style.removeProperty('--atraso-entrada-kpi');
    });
  }, 100 + 360 + (cards.length - 1) * 45 + 50);
}

function animarContagemKpi(elemento, atraso, sequencia) {
  const textoFinal = elemento.innerText;
  const correspondencia = textoFinal.match(/-?\d[\d.]*,\d+|-?\d[\d.]*/);
  if (!correspondencia) return;

  const textoNumero = correspondencia[0];
  const valorFinal = parseFloat(textoNumero.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(valorFinal)) return;

  const casasDecimais = textoNumero.includes(',') ? textoNumero.split(',')[1].length : 0;
  const formatar = valor => valor.toLocaleString('pt-BR', {
    minimumFractionDigits: casasDecimais,
    maximumFractionDigits: casasDecimais
  });

  setTimeout(() => {
    const inicio = performance.now();
    const atualizar = agora => {
      if (sequencia !== sequenciaAnimacaoCards) return;
      const progresso = Math.min((agora - inicio) / 360, 1);
      const suavizado = 1 - Math.pow(1 - progresso, 3);
      elemento.innerText = textoFinal.replace(textoNumero, formatar(valorFinal * suavizado));

      if (progresso < 1) requestAnimationFrame(atualizar);
      else elemento.innerText = textoFinal;
    };

    requestAnimationFrame(atualizar);
  }, 100 + atraso);
}

function atualizarCardAnpBrasil() {
  const elCard = document.getElementById('cardAnpBrasil');
  const elSub = document.getElementById('cardAnpBrasilSub');

  const referenciaBrasil = dadosAnpBaseGlobal?.referencia_anp_brasil || dadosAnpBaseGlobal?.referencia_antt;
  if (referenciaBrasil) {
    const ref = referenciaBrasil;
    const precoNum = parseFloat(ref.valor);
    if (!isNaN(precoNum) && precoNum > 0) {
      if (elCard) elCard.innerText = 'R$ ' + precoNum.toFixed(2).replace('.', ',');
      const periodo = ref.periodo || 'Publicação Vigente';
      if (elSub) elSub.innerHTML = `<i class="bi bi-file-earmark-check me-1"></i>${periodo}`;
      return;
    }
  }
  definirCardAnpBrasilIndisponivel();
}

function definirCardAnpBrasilIndisponivel() {
  const elCard = document.getElementById('cardAnpBrasil');
  const elSub = document.getElementById('cardAnpBrasilSub');
  if (elCard) elCard.innerText = "Indisponível";
  if (elSub) elSub.innerHTML = `<i class="bi bi-exclamation-circle me-1"></i>Sem publicação localizada`;
}

function popularFiltrosDinamicos() {
  const meses = [...new Set(baseRegistrosMensais.map(d => d.MES_ANO).filter(Boolean))].sort().reverse();
  const selectMes = document.getElementById('filtroMesAno');
  if (selectMes) {
    const anoYtd = obterAnoMaisRecenteBase();
    selectMes.innerHTML = `<option value="YTD">Ano Completo${anoYtd ? ` ${anoYtd}` : ''} (Consolidado)</option>`;
    
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
    if (!d.POSTO) return;
    contagemRedes[classificarRedePosto(d.POSTO)].add(d.POSTO);
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
  const modoAnterior = modoAtual;
  modoAtual = modo;
  document.querySelectorAll('.btn-toggle-tipo').forEach(b => b.classList.remove('active'));

  if (modo === 'TODOS') document.getElementById('btnModoGeral')?.classList.add('active');
  if (modo === 'INTERNO') document.getElementById('btnModoInterno')?.classList.add('active');
  if (modo === 'EXTERNO') document.getElementById('btnModoExterno')?.classList.add('active');
  if (modo === 'ROTEIRIZADOR') document.getElementById('btnModoRota')?.classList.add('active');
  if (modo === 'MATRIZES') document.getElementById('btnModoMatrizes')?.classList.add('active');
  if (modo === 'AUDITORIA') document.getElementById('btnModoAuditoria')?.classList.add('active');
  if (modo === 'FECHAMENTO') document.getElementById('btnModoFechamento')?.classList.add('active');

  const gridKpis = document.getElementById('gridKpisPrincipais');
  if (gridKpis) {
    const ocultarGrid = ['AUDITORIA', 'ROTEIRIZADOR', 'MATRIZES', 'FECHAMENTO'].includes(modo);
    gridKpis.style.display = ocultarGrid ? 'none' : '';
  }

  const painelPrinc = document.getElementById('secaoPainelPrincipal');
  const roteirizador = document.getElementById('secaoRoteirizador');
  const matrizes = document.getElementById('secaoMatrizesGerenciais');
  const auditoria = document.getElementById('secaoAuditoriaComercial');
  const fechamento = document.getElementById('secaoFechamentoExecutivo');

  if (painelPrinc) painelPrinc.style.display = 'none';
  if (roteirizador) roteirizador.style.display = 'none';
  if (matrizes) matrizes.style.display = 'none';
  if (auditoria) auditoria.style.display = 'none';
  if (fechamento) fechamento.style.display = 'none';

  if (modo === 'ROTEIRIZADOR') {
    if (roteirizador) roteirizador.style.display = 'block';
    if (typeof inicializarMapaLeaflet === 'function') inicializarMapaLeaflet();
  } else if (modo === 'MATRIZES') {
    if (matrizes) matrizes.style.display = 'block';
    if (typeof renderizarAbaMatrizes === 'function') renderizarAbaMatrizes();
  } else if (modo === 'AUDITORIA') {
    if (auditoria) auditoria.style.display = 'block';
    if (typeof renderizarAbaAuditoriaComercial === 'function') {
      renderizarAbaAuditoriaComercial();
      animarEntradaKpisAuditoria();
    }
  } else if (modo === 'FECHAMENTO') {
    if (fechamento) fechamento.style.display = 'block';
    if (typeof renderizarAbaFechamentoExecutivo === 'function') {
      renderizarAbaFechamentoExecutivo().then(animarEntradaKpisFechamento);
    }
  } else {
    if (painelPrinc) painelPrinc.style.display = 'block';
    atualizarTextosHeaderPainel();
    processarPainel();
    if (animacaoInicialKpisExecutada && ['ROTEIRIZADOR', 'MATRIZES', 'AUDITORIA', 'FECHAMENTO'].includes(modoAnterior)) {
      animarEntradaKpis();
    }
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
  if (postoFiltrado === nomePosto) {
    limparFiltroPosto();
    return;
  }

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

  let registros = mesSel === 'YTD' ? filtrarRegistrosYtd(baseRegistrosMensais) : baseRegistrosMensais;

  if (ufFiltrada) {
    registros = registros.filter(d => d.UF_POSTO === ufFiltrada);
  }
  if (postoFiltrado) {
    registros = registros.filter(d => d.POSTO === postoFiltrado);
  }
  if (redeFiltrada) {
    registros = registros.filter(d => classificarRedePosto(d.POSTO) === redeFiltrada);
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
  if (modoAtual !== 'TODOS' && modoAtual !== 'ROTEIRIZADOR' && modoAtual !== 'MATRIZES' && modoAtual !== 'AUDITORIA' && modoAtual !== 'FECHAMENTO') {
    registrosModo = registros.filter(d => d.TIPO_OPERACAO === modoAtual);
  }

  const mesesDisponiveis = [...new Set(baseRegistrosMensais.map(d => d.MES_ANO).filter(Boolean))].sort();
  const mesesDisponiveisModo = [...new Set(registrosModo.map(d => d.MES_ANO).filter(Boolean))].sort();
  const mesMaisRecenteModo = mesesDisponiveisModo[mesesDisponiveisModo.length - 1] || '';

  const postosMap = {};
  let somaLitrosCards = 0;
  let somaGastoCards = 0;

  // YTD cobre todos os meses do ano-base; uma competência selecionada restringe ao mês correspondente.
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

  // Agrega litros e gasto por posto; impacto/economia somam cada ciclo contra sua ANP mensal.
  baseCalculo.forEach(d => {
    const chave = d.TIPO_OPERACAO === 'INTERNO' 
      ? `${d.POSTO}_${d.UF_POSTO}_${d.MUNICIPIO_POSTO}` 
      : `${d.POSTO}_${d.UF_POSTO}`;

    const litros = parseFloat(d.VOLUME_CICLO || 0);
    const precoUnitarioInformado = parseFloat(d.VALOR_UNITARIO || 0);
    const valorTotalInformado = parseFloat(d.VALOR_TOTAL_CICLO || 0);
    const valor = valorTotalInformado > 0 ? valorTotalInformado : litros * precoUnitarioInformado;

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
        IMPACTO_REAIS: 0,
        ULTIMO_PRECO: parseFloat(d.VALOR_UNITARIO || 0),
        DATA_MAIS_RECENTE: d.DATA_FIM_CICLO || "",
        MES_MAIS_RECENTE: d.MES_ANO
      };
    }

    postosMap[chave].LITROS_TOTAL += litros;
    postosMap[chave].VALOR_TOTAL += valor;

    const tabelaAnpCiclo = d.TIPO_OPERACAO === 'INTERNO' ? anpDistribuicao : anpRevenda;
    const referenciaAnpCiclo = tabelaAnpCiclo[d.UF_POSTO]?.[d.MES_ANO] || 0;
    const precoPagoCiclo = litros > 0 ? valor / litros : precoUnitarioInformado;
    if (referenciaAnpCiclo > 0 && precoPagoCiclo > 0 && litros > 0) {
      // Soma assinada: sobrepreços aumentam o impacto e compras abaixo da ANP o reduzem.
      const diferencaCiclo = (precoPagoCiclo - referenciaAnpCiclo) * litros;
      postosMap[chave].IMPACTO_REAIS += diferencaCiclo;
    }

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
      const valMes = ciclosVigentes.reduce((acc, c) => {
        const litros = parseFloat(c.VOLUME_CICLO || 0);
        const total = parseFloat(c.VALOR_TOTAL_CICLO || 0);
        return acc + (total > 0 ? total : litros * parseFloat(c.VALOR_UNITARIO || 0));
      }, 0);
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
      IMPACTO_REAIS: p.IMPACTO_REAIS,
      DIFF_LOCAL: diffLocal,
      NOME_MELHOR_LOCAL: nomeMelhorLocal,
      PRECO_MELHOR_LOCAL: precoMelhorLocal,
      OPORTUNIDADE_REPASSE_ANP: mesSel === 'YTD' && p.TIPO_OPERACAO === 'EXTERNO'
        ? calcularOportunidadeRepasseAnp(p.POSTO, p.UF_POSTO)
        : null
    };
  });

  listaPostos.sort((a, b) => b.LITROS_TOTAL - a.LITROS_TOTAL);

  const precoMedioCard = somaLitrosCards > 0 ? somaGastoCards / somaLitrosCards : 0;

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
  const elCardPmLabel = document.getElementById('cardPrecoMedioLabel');
  if (elCardPmLabel) {
    elCardPmLabel.innerText = mesSel === 'YTD' ? 'PREÇO MÉDIO ACUMULADO' : 'PREÇO MÉDIO MENSAL';
  }
  const elCardPmSub = document.getElementById('cardPrecoMedioSub');
  if (elCardPmSub) {
    elCardPmSub.innerText = mesSel === 'YTD'
      ? `Média acumulada até ${mesMaisRecenteModo || '--'}`
      : `Média da competência ${mesSel}`;
    elCardPmSub.title = elCardPmSub.innerText;
  }

  const postosComDesvio = listaPostos
    .filter(p => p.TIPO_OPERACAO === 'EXTERNO' && p.IMPACTO_REAIS > 0)
    .sort((a, b) => b.IMPACTO_REAIS - a.IMPACTO_REAIS)
    .slice(0, MAX_POSTOS_PRIORIDADE);
  const postosPrioritarios = complementarPostosPrioritariosComTratativas(
    postosComDesvio,
    listaPostos,
    typeof obterTratativaPosto === 'function' ? obterTratativaPosto : null
  );

  const containerPrioridade = document.getElementById('listaPrioridadeAcao');
  if (containerPrioridade) {
    if (postosPrioritarios.length > 0) {
      containerPrioridade.innerHTML = postosPrioritarios.map(p => {
        const dataFmt = formatarDataDiaMes(p.DATA_MAIS_RECENTE);
        const detalhesPrioridade = p.ORIGEM_PRIORIDADE === 'TRATATIVA'
          ? `<span class="item-prioridade-status">Vence ${p.DIAS_ATE_VENCIMENTO === 0 ? 'hoje' : `em ${p.DIAS_ATE_VENCIMENTO} ${p.DIAS_ATE_VENCIMENTO === 1 ? 'dia' : 'dias'}`}</span>`
          : `<span class="item-prioridade-valor">+R$ ${Math.round(p.IMPACTO_REAIS).toLocaleString('pt-BR')}</span>`;
        return `
          <div class="item-prioridade-acao${p.ORIGEM_PRIORIDADE === 'TRATATIVA' ? ' item-prioridade-tratativa' : ''}">
            <div class="item-prioridade-dados">
              <span class="badge bg-dark text-white p-1" style="font-size:0.58rem;">${p.UF_POSTO}</span>
              <span class="item-prioridade-nome" title="${p.NOME_EXIBICAO}">${p.NOME_EXIBICAO}</span>
              <span class="item-prioridade-historico">R$ ${p.ULTIMO_PRECO.toFixed(2)} (${dataFmt})</span>
            </div>
            ${detalhesPrioridade}
          </div>
        `;
      }).join('');
    } else {
      containerPrioridade.innerHTML = `<div class="text-muted small" style="font-size: 0.65rem;">Nenhum posto com ágio no filtro atual.</div>`;
    }
  }

  const mesesGrafico = mesSel === 'YTD'
    ? mesesDisponiveis.filter(mes => mes.startsWith(`${obterAnoMaisRecenteBase()}-`))
    : mesesDisponiveis;
  renderizarSparklineVolumeCard(mesesGrafico, registrosModo);
  renderizarSparklinesResumo(mesesGrafico, registros);
  atualizarCardsExtremosSemPonderada(registros, mesSel);
  renderizarTermometroPostos(listaPostos, mesesGrafico);
  renderizarResumoAnualPosto(listaPostos);

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

function renderizarSparklinesResumo(mesesDisponiveis, registros) {
  Object.values(resumoVolumeCharts).forEach(chart => chart.destroy());
  resumoVolumeCharts = {};

  const seriesResumo = [
    { id: 'sparkResumoVolumeRota', operacao: 'EXTERNO', cor: '#f97316' },
    { id: 'sparkResumoVolumeInterno', operacao: 'INTERNO', cor: '#22c55e' }
  ];

  seriesResumo.forEach(({ id, operacao, cor }) => {
    const container = document.getElementById(id);
    if (!container) return;

    const dadosVolume = mesesDisponiveis.map(mes => Math.round(
      registros
        .filter(registro => registro.MES_ANO === mes && registro.TIPO_OPERACAO === operacao)
        .reduce((total, registro) => total + (parseFloat(registro.VOLUME_CICLO || 0) || 0), 0)
    ));

    const chart = new ApexCharts(container, {
      series: [{ name: 'Volume mensal', data: dadosVolume }],
      chart: {
        type: 'area',
        height: '100%',
        width: '100%',
        sparkline: { enabled: true },
        animations: { enabled: false },
        parentHeightOffset: 0
      },
      colors: [cor],
      stroke: { curve: 'smooth', width: 2 },
      fill: {
        type: 'gradient',
        gradient: { shadeIntensity: 0, opacityFrom: 0.62, opacityTo: 0.08, stops: [0, 100] }
      },
      dataLabels: { enabled: false },
      markers: { size: 0 },
      xaxis: { categories: mesesDisponiveis },
      tooltip: { enabled: false }
    });

    chart.render();
    resumoVolumeCharts[id] = chart;
  });
}

function gerarSilhuetaUfSvg(uf, compacta = false, classeAdicional = '') {
  if (!uf || !Array.isArray(dadosGeoJsonBr?.features) || typeof extrairSiglaUf !== 'function') return '';

  const geometria = dadosGeoJsonBr.features.find(feature => extrairSiglaUf(feature.properties) === uf)?.geometry;
  if (!geometria) return '';

  const aneis = geometria.type === 'Polygon'
    ? geometria.coordinates
    : geometria.type === 'MultiPolygon'
      ? geometria.coordinates.flat()
      : [];
  const pontos = aneis.flat().filter(ponto => Array.isArray(ponto) && Number.isFinite(ponto[0]) && Number.isFinite(ponto[1]));
  if (pontos.length === 0) return '';

  const largura = 140;
  const altura = 100;
  const margem = 8;
  const longitudes = pontos.map(ponto => ponto[0]);
  const latitudes = pontos.map(ponto => ponto[1]);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const escala = Math.min(
    (largura - margem * 2) / Math.max(maxLon - minLon, 0.0001),
    (altura - margem * 2) / Math.max(maxLat - minLat, 0.0001)
  );
  const larguraForma = (maxLon - minLon) * escala;
  const alturaForma = (maxLat - minLat) * escala;
  const deslocamentoX = (largura - larguraForma) / 2;
  const deslocamentoY = (altura - alturaForma) / 2;
  const caminho = aneis.map(anel => anel.map((ponto, indice) => {
    const x = (deslocamentoX + (ponto[0] - minLon) * escala).toFixed(1);
    const y = (altura - deslocamentoY - (ponto[1] - minLat) * escala).toFixed(1);
    return `${indice === 0 ? 'M' : 'L'}${x} ${y}`;
  }).join(' ') + ' Z').join(' ');
  const classe = `${compacta ? ' kpi-uf-silhueta-compacta' : ''}${classeAdicional ? ` ${classeAdicional}` : ''}`;

  return `<svg class="kpi-uf-silhueta${classe}" viewBox="0 0 ${largura} ${altura}" aria-hidden="true" focusable="false"><path d="${caminho}" fill-rule="evenodd"/></svg>`;
}

function gerarHtmlExtremoUnico(extremo, classeCor) {
  if (!extremo) return `<div class="kpi-val ${classeCor}">--</div>`;

  return `
    <div class="kpi-extremo-unico" title="${extremo.posto}">
      ${gerarSilhuetaUfSvg(extremo.uf, false, 'kpi-uf-silhueta-unica')}
      <div class="kpi-extremo-valor ${classeCor}">
        <span>${extremo.uf || '--'}</span> - R$ ${extremo.preco.toFixed(3).replace('.', ',')}
      </div>
    </div>
  `;
}

function escaparTextoHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, caractere => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[caractere]);
}

function gerarHtmlExtremoConsolidado(extremo, tipo, posicao, classeCor, rotulo, mostrarSilhueta = true) {
  const ehRota = tipo === 'ROTA';
  const posto = escaparTextoHtml(extremo?.posto || 'Sem posto com preço válido');
  const uf = escaparTextoHtml(extremo?.uf || '--');
  const preco = extremo ? `R$ ${extremo.preco.toFixed(3).replace('.', ',')}` : '--';
  const titulo = escaparTextoHtml(`${rotulo}: ${posto} (${uf}) · ${preco}`);
  const separador = posicao === 'segundo' ? ' kpi-extremo-split-separador' : '';

  return `
    <div class="kpi-val-split kpi-extremo-split${separador} ${classeCor}" title="${titulo}" aria-label="${titulo}">
      ${extremo && mostrarSilhueta ? gerarSilhuetaUfSvg(extremo.uf, true) : ''}
      <div class="kpi-extremo-split-top">
        <span class="kpi-extremo-identificacao">
          <span class="badge-tipo ${ehRota ? 'tipo-rota' : 'tipo-interno'}">${tipo}</span>
          <span class="kpi-extremo-uf">${uf}</span>
        </span>
        <span class="kpi-extremo-preco">${preco}</span>
      </div>
      <span class="kpi-extremo-posto">${posto}</span>
    </div>
  `;
}

function atualizarCardsExtremosSemPonderada(todosRegistros, mesSel) {
  const containerMaior = document.getElementById('cardMaiorConteudo');
  const containerMenor = document.getElementById('cardMenorConteudo');
  const lblMaiorSub = document.getElementById('cardMaiorUfSub');
  const lblMenorSub = document.getElementById('cardMenorUfSub');

  if (!containerMaior || !containerMenor) return;
  containerMaior.classList.remove('kpi-extremos-consolidados-compartilhados');
  containerMenor.classList.remove('kpi-extremos-consolidados-compartilhados');

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

  // Saneamento de outliers na amostra usando referência ANP histórica (ou mediana por UF/competência como fallback)
  const gruposUfComp = {};
  amostra.forEach(d => {
    const uf = (d.UF_POSTO || '').toUpperCase().trim();
    const comp = d.MES_ANO || (d.DATA_FIM_CICLO ? d.DATA_FIM_CICLO.substring(0, 7) : '');
    const chave = `${uf}_${comp}`;
    if (!gruposUfComp[chave]) gruposUfComp[chave] = [];
    const val = parseFloat(d.VALOR_UNITARIO);
    if (!isNaN(val) && val > 0) gruposUfComp[chave].push(val);
  });

  const medianasUfComp = {};
  Object.keys(gruposUfComp).forEach(chave => {
    const vals = gruposUfComp[chave].slice().sort((a, b) => a - b);
    if (vals.length > 0) {
      const mid = Math.floor(vals.length / 2);
      medianasUfComp[chave] = vals.length % 2 !== 0 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
    }
  });

  amostra = amostra.filter(d => {
    const val = parseFloat(d.VALOR_UNITARIO);
    if (isNaN(val) || val <= 0) return false;
    const uf = (d.UF_POSTO || '').toUpperCase().trim();
    const comp = d.MES_ANO || (d.DATA_FIM_CICLO ? d.DATA_FIM_CICLO.substring(0, 7) : '');

    let refPreco = null;

    if (typeof obterPrecoMedioANP === 'function') {
      const pAnp = obterPrecoMedioANP(uf, d.DATA_FIM_CICLO || comp);
      if (typeof pAnp === 'number' && !isNaN(pAnp) && pAnp > 0) refPreco = pAnp;
    }

    if (!refPreco && typeof tabelaANP !== 'undefined' && tabelaANP) {
      const registroUf = tabelaANP[uf];
      if (registroUf) {
        if (typeof registroUf === 'number') {
          refPreco = registroUf;
        } else if (typeof registroUf === 'object') {
          refPreco = registroUf[comp] || registroUf.preco || registroUf.PRECO_MEDIO || null;
        }
      }
    }

    if (!refPreco) {
      const chave = `${uf}_${comp}`;
      refPreco = medianasUfComp[chave] || null;
    }

    if (!refPreco || refPreco <= 0) return true;

    return val >= refPreco * 0.70 && val <= refPreco * 1.40;
  });

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
    const ufMaiorCompartilhada = extRota.max?.uf && extRota.max.uf === extInterno.max?.uf;
    const ufMenorCompartilhada = extRota.min?.uf && extRota.min.uf === extInterno.min?.uf;

    if (extRota.max || extInterno.max) {
      containerMaior.innerHTML = `
        ${ufMaiorCompartilhada ? gerarSilhuetaUfSvg(extRota.max.uf, false, 'kpi-uf-silhueta-compartilhada') : ''}
        ${gerarHtmlExtremoConsolidado(extRota.max, 'ROTA', 'primeiro', 'text-danger', 'Pico Rota', !ufMaiorCompartilhada)}
        ${gerarHtmlExtremoConsolidado(extInterno.max, 'GARAGEM', 'segundo', 'text-danger', 'Maior Garagem', !ufMaiorCompartilhada)}
      `;
      containerMaior.classList.toggle('kpi-extremos-consolidados-compartilhados', Boolean(ufMaiorCompartilhada));
      if (lblMaiorSub) lblMaiorSub.innerText = mesSel === 'YTD' ? "Últimos 20 dias ativos" : "Extremos da competência";
    } else {
      containerMaior.innerHTML = `<div class="kpi-val text-danger">--</div>`;
      if (lblMaiorSub) lblMaiorSub.innerText = "Sem compras recentes";
    }

    if (extRota.min || extInterno.min) {
      containerMenor.innerHTML = `
        ${ufMenorCompartilhada ? gerarSilhuetaUfSvg(extRota.min.uf, false, 'kpi-uf-silhueta-compartilhada') : ''}
        ${gerarHtmlExtremoConsolidado(extRota.min, 'ROTA', 'primeiro', 'text-success', 'Menor Posto Rota', !ufMenorCompartilhada)}
        ${gerarHtmlExtremoConsolidado(extInterno.min, 'GARAGEM', 'segundo', 'text-success', 'Menor Garagem Ativa', !ufMenorCompartilhada)}
      `;
      containerMenor.classList.toggle('kpi-extremos-consolidados-compartilhados', Boolean(ufMenorCompartilhada));
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
      containerMaior.innerHTML = gerarHtmlExtremoUnico(ext.max, 'text-danger');
      if (lblMaiorSub) lblMaiorSub.innerText = `${rotuloTipo} • ${ext.max.posto}`;
    } else {
      containerMaior.innerHTML = `<div class="kpi-val text-danger">--</div>`;
      if (lblMaiorSub) lblMaiorSub.innerText = "Sem compras recentes";
    }

    if (ext.min) {
      containerMenor.innerHTML = gerarHtmlExtremoUnico(ext.min, 'text-success');
      if (lblMenorSub) lblMenorSub.innerText = `${rotuloTipo} • ${ext.min.posto}`;
    } else {
      containerMenor.innerHTML = `<div class="kpi-val text-success">--</div>`;
      if (lblMenorSub) lblMenorSub.innerText = "Sem compras recentes";
    }
  }
}

const QUEDA_MINIMA_ANP_REPASSE = 0.15;
const REPASSE_PENDENTE_MINIMO = 0.10;
const UM_DIA_MS = 24 * 60 * 60 * 1000;
const MAX_DIAS_COMPRA_RECENTE = 45;

function converterDataPrecoPosto(valor) {
  if (!valor) return null;
  const texto = String(valor).trim();
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));

  const brasileira = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (brasileira) return new Date(Date.UTC(Number(brasileira[3]), Number(brasileira[2]) - 1, Number(brasileira[1])));
  return null;
}

function calcularOportunidadeRepasseAnp(nomePosto, ufPosto) {
  const comprasPosto = baseRegistrosMensais
    .filter(registro => registro.TIPO_OPERACAO === 'EXTERNO' && registro.POSTO === nomePosto && registro.UF_POSTO === ufPosto)
    .map(registro => ({
      data: converterDataPrecoPosto(registro.DATA_FIM_CICLO),
      preco: Number(registro.VALOR_UNITARIO || 0),
      volume: Number(registro.VOLUME_CICLO || 0)
    }))
    .filter(compra => compra.data && Number.isFinite(compra.preco) && compra.preco > 0 && Number.isFinite(compra.volume) && compra.volume > 0)
    .sort((a, b) => a.data - b.data);
  const ultimaCompra = comprasPosto[comprasPosto.length - 1];
  if (!ultimaCompra) return null;

  const hoje = new Date();
  const hojeUtc = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const diasDesdeCompra = (hojeUtc - ultimaCompra.data.getTime()) / UM_DIA_MS;
  if (diasDesdeCompra < 0 || diasDesdeCompra > MAX_DIAS_COMPRA_RECENTE) return null;

  const mesUltimaCompra = `${ultimaCompra.data.getUTCFullYear()}-${String(ultimaCompra.data.getUTCMonth() + 1).padStart(2, '0')}`;
  const referenciasAnp = Object.entries(anpRevenda[ufPosto] || {})
    .map(([mes, preco]) => ({ mes, preco: Number(preco) }))
    .filter(referencia => referencia.mes <= mesUltimaCompra && Number.isFinite(referencia.preco) && referencia.preco > 0)
    .sort((a, b) => a.mes.localeCompare(b.mes));
  if (referenciasAnp.length < 2) return null;

  const referenciaAtual = referenciasAnp[referenciasAnp.length - 1];
  const referenciaAnterior = referenciasAnp[referenciasAnp.length - 2];
  const [anoAtual, mesAtual] = referenciaAtual.mes.split('-').map(Number);
  const [anoAnterior, mesAnterior] = referenciaAnterior.mes.split('-').map(Number);
  const distanciaMeses = (anoAtual - anoAnterior) * 12 + mesAtual - mesAnterior;
  if (distanciaMeses !== 1) return null;

  const fimMesAnterior = Date.UTC(anoAnterior, mesAnterior, 0);
  const compraAnterior = [...comprasPosto].reverse().find(compra => compra.data.getTime() <= fimMesAnterior);
  if (!compraAnterior || compraAnterior.data >= ultimaCompra.data) return null;
  const intervaloEntreCompras = (ultimaCompra.data.getTime() - compraAnterior.data.getTime()) / UM_DIA_MS;
  if (intervaloEntreCompras > 60) return null;

  const quedaAnp = referenciaAnterior.preco - referenciaAtual.preco;
  if (quedaAnp < QUEDA_MINIMA_ANP_REPASSE) return null;

  const quedaPosto = compraAnterior.preco - ultimaCompra.preco;
  const repassePendente = quedaAnp - quedaPosto;
  if (repassePendente < REPASSE_PENDENTE_MINIMO) return null;

  return {
    quedaAnp,
    quedaPosto,
    repassePendente,
    precoAnterior: compraAnterior.preco,
    precoAtual: ultimaCompra.preco,
    dataPrecoAnterior: compraAnterior.data,
    dataUltimaCompra: ultimaCompra.data,
    referenciaAnpAnterior: referenciaAnterior.preco,
    referenciaAnpAtual: referenciaAtual.preco,
    mesAnpAnterior: referenciaAnterior.mes,
    mesAnpAtual: referenciaAtual.mes
  };
}

function formatarValorRepasse(valor) {
  return Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatarMesReferenciaAnp(mesAno) {
  const nomesMeses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const [ano, mes] = mesAno.split('-');
  return `${nomesMeses[Number(mes) - 1] || mes}/${ano}`;
}

function alternarResumoRepasseAnp(idResumo, botao) {
  const resumo = document.getElementById(idResumo);
  if (!resumo) return;
  resumo.hidden = !resumo.hidden;
  botao.setAttribute('aria-expanded', String(!resumo.hidden));
}

function renderizarTermometroPostos(postos, mesesDisponiveis) {
  const container = document.getElementById('listaTermometroPostos');
  if (!container) return;
  container.innerHTML = "";

  const ehConsolidado = modoAtual === 'TODOS';
  if (!ehConsolidado) postosExternosExpandidos = false;
  const postosExternos = ehConsolidado ? postos.filter(p => p.TIPO_OPERACAO === 'EXTERNO') : [];
  const postosInternos = ehConsolidado ? postos.filter(p => p.TIPO_OPERACAO === 'INTERNO') : [];
  const postosOrdenados = ehConsolidado ? [...postosExternos, ...postosInternos] : postos;
  const limitePostosExternos = 10;
  // Indexa uma vez os ciclos por posto/mês para reaproveitá-los nas séries de todos os cards.
  const ciclosPorPostoMes = new Map();
  baseRegistrosMensais.forEach(registro => {
    const chave = JSON.stringify([
      registro.POSTO,
      registro.UF_POSTO,
      registro.MES_ANO,
      registro.TIPO_OPERACAO === 'INTERNO' ? registro.MUNICIPIO_POSTO : ''
    ]);
    if (!ciclosPorPostoMes.has(chave)) ciclosPorPostoMes.set(chave, []);
    ciclosPorPostoMes.get(chave).push(registro);
  });

  const lblList = document.getElementById('lblListando');
  if (lblList) lblList.innerText = `A listar ${postosOrdenados.length} postos`;

  if (postosOrdenados.length === 0) {
    container.innerHTML = `<div class="text-center py-5 text-muted">Nenhum posto com movimentação no filtro atual.</div>`;
    return;
  }

  Object.values(sparklineInstances).forEach(chart => {
    try { chart.destroy(); } catch(e){}
  });
  sparklineInstances = {};

  if (ehConsolidado && postosExternos.length > 0) {
    const tituloExternos = document.createElement('div');
    tituloExternos.className = 'cabecalho-grupo-postos titulo-grupo-externo';
    tituloExternos.textContent = postosExternos.length > limitePostosExternos
      ? `Rota rodoviária · 10 maiores volumes de ${postosExternos.length}`
      : `Rota rodoviária · ${postosExternos.length} postos`;
    container.appendChild(tituloExternos);
  }

  let botaoExpansaoInserido = false;
  let cabecalhoInternosInserido = false;
  postosOrdenados.forEach((p, idx) => {
    if (ehConsolidado && p.TIPO_OPERACAO === 'EXTERNO' && idx === limitePostosExternos && !botaoExpansaoInserido) {
      const botaoExpansao = document.createElement('button');
      botaoExpansao.type = 'button';
      botaoExpansao.className = 'btn-expandir-postos-externos';
      botaoExpansao.dataset.quantidade = String(postosExternos.length - limitePostosExternos);
      botaoExpansao.onclick = alternarExpansaoPostosExternos;
      container.appendChild(botaoExpansao);
      botaoExpansaoInserido = true;
    }

    if (ehConsolidado && p.TIPO_OPERACAO === 'INTERNO' && !cabecalhoInternosInserido) {
      const tituloInternos = document.createElement('div');
      tituloInternos.className = 'cabecalho-grupo-postos titulo-grupo-interno';
      tituloInternos.textContent = `Tanques próprios · ${postosInternos.length} filiais`;
      container.appendChild(tituloInternos);
      cabecalhoInternosInserido = true;
    }

    const chartDomId = `chart-bg-${idx}`;
    const ehInterno = (p.TIPO_OPERACAO === 'INTERNO');
    const badgeTipo = ehInterno 
      ? `<span class="badge-tipo tipo-interno">GARAGEM</span>`
      : `<span class="badge-tipo tipo-rota">ROTA</span>`;

    let gapHtml = `<span class="text-muted small">--</span>`;
    if (p.REF_ANP > 0) {
      const sinal = p.GAP_MERCADO >= 0 ? "+" : "-";
      const corGap = p.GAP_MERCADO > 0.05 ? "text-danger" : "text-success";
      gapHtml = `<span class="${corGap} fw-bold small">${sinal}R$ ${Math.abs(p.GAP_MERCADO).toLocaleString('pt-BR', {minimumFractionDigits: 3, maximumFractionDigits: 3})} (${sinal}${Math.abs(p.GAP_PERC).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1})}%)</span>`;
    }

    let impactoHtml = `<span class="text-muted small">R$ 0,00</span>`;
    if (p.IMPACTO_REAIS > 0) {
      impactoHtml = `<span class="text-danger fw-bold small">+R$ ${Math.round(p.IMPACTO_REAIS).toLocaleString('pt-BR')}</span>`;
    } else if (p.IMPACTO_REAIS < 0) {
      impactoHtml = `<span class="text-success fw-bold small">-R$ ${Math.round(Math.abs(p.IMPACTO_REAIS)).toLocaleString('pt-BR')}</span>`;
    }

    let tagDispersao = "";
    if (p.DIFF_LOCAL > 0) {
      const titleTexto = `Opção mais barata no mesmo período: ${p.NOME_MELHOR_LOCAL} a R$ ${p.PRECO_MELHOR_LOCAL.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
      tagDispersao = `<span class="badge-dispersao-local" title="${titleTexto}">Opção local -R$ ${p.DIFF_LOCAL.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>`;
    }

    let tagRepasseAnp = '';
    if (p.OPORTUNIDADE_REPASSE_ANP) {
      const oportunidade = p.OPORTUNIDADE_REPASSE_ANP;
      const idResumo = `resumo-repasse-anp-${idx}`;
      const resumo = `A referência mensal da ANP no ${p.UF_POSTO} caiu R$ ${formatarValorRepasse(oportunidade.quedaAnp)}/L de ${formatarMesReferenciaAnp(oportunidade.mesAnpAnterior)} para ${formatarMesReferenciaAnp(oportunidade.mesAnpAtual)}. O último preço pago foi R$ ${oportunidade.precoAtual.toFixed(3)} em ${formatarDataDiaMes(oportunidade.dataUltimaCompra.toISOString().slice(0, 10))}; antes, era R$ ${oportunidade.precoAnterior.toFixed(3)} em ${formatarDataDiaMes(oportunidade.dataPrecoAnterior.toISOString().slice(0, 10))}. Potencial de repasse não acompanhado: R$ ${formatarValorRepasse(oportunidade.repassePendente)}/L. Avalie revisar a negociação.`;
      tagRepasseAnp = `
        <button type="button" class="badge-oportunidade-anp" title="${resumo}" aria-expanded="false" aria-controls="${idResumo}" onclick="alternarResumoRepasseAnp('${idResumo}', this)">
          <i class="bi bi-exclamation-circle-fill" aria-hidden="true"></i> Revisar repasse
        </button>
        <div id="${idResumo}" class="resumo-oportunidade-anp" hidden>${resumo}</div>
      `;
    }

    const dataUltimoFormatada = formatarDataDiaMes(p.DATA_MAIS_RECENTE);
    const tratativaAtual = typeof obterTratativaPosto === 'function'
      ? obterTratativaPosto(p.POSTO, p.UF_POSTO)
      : null;
    let classeBotaoTratativa = '';
    let tituloBotaoTratativa = 'Registrar tratativa';

    if (tratativaAtual?.vigencia) {
      const dataVigencia = tratativaAtual.vigencia.substring(0, 10);
      const dataVigenciaMs = Date.parse(`${dataVigencia}T00:00:00Z`);

      if (Number.isFinite(dataVigenciaMs) && new Date(dataVigenciaMs).toISOString().substring(0, 10) === dataVigencia) {
        const agora = new Date();
        const hojeMs = Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate());
        const diasDesdeTratativa = Math.floor((hojeMs - dataVigenciaMs) / 86400000);
        classeBotaoTratativa = diasDesdeTratativa > DIAS_LIMITE_TRATATIVA ? 'tratativa-atrasada' : 'tratativa-recente';
        tituloBotaoTratativa = `Última tratativa registrada há ${diasDesdeTratativa} dias`;
      }
    }

    const indicesAbastecidos = [];
    const dadosKmmMes = [];
    const dadosAnpMes = [];

    mesesDisponiveis.forEach((m, mIdx) => {
      const chave = JSON.stringify([
        p.POSTO,
        p.UF_POSTO,
        m,
        p.TIPO_OPERACAO === 'INTERNO' ? p.MUNICIPIO_POSTO : ''
      ]);
      const ciclosMes = ciclosPorPostoMes.get(chave) || [];
      
      let precoKmmMes = null;
      if (ciclosMes.length > 0) {
        const litrosMes = ciclosMes.reduce((acc, c) => acc + parseFloat(c.VOLUME_CICLO || 0), 0);
        const valorMes = ciclosMes.reduce((acc, c) => {
          const litros = parseFloat(c.VOLUME_CICLO || 0);
          const total = parseFloat(c.VALOR_TOTAL_CICLO || 0);
          return acc + (total > 0 ? total : litros * parseFloat(c.VALOR_UNITARIO || 0));
        }, 0);
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
    card.dataset.tipoOperacao = p.TIPO_OPERACAO;
    if (ehConsolidado && p.TIPO_OPERACAO === 'EXTERNO' && idx >= limitePostosExternos) {
      card.classList.add('posto-externo-expandivel');
    }

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
            ${tagRepasseAnp}
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
          <div class="small text-muted text-uppercase" style="font-size: 0.58rem; font-weight: 800;">Impacto líquido</div>
          <div class="font-monospace">${impactoHtml}</div>
        </div>

        <div class="col-m-btn">
          <button class="btn-tratativa ${classeBotaoTratativa}" title="${tituloBotaoTratativa}" onclick="abrirModalTratativa('${p.POSTO.replace(/'/g, "\\'")}', '${p.UF_POSTO}', '${(p.MUNICIPIO_POSTO || '').replace(/'/g, "\\'")}', ${p.PRECO_MEDIO_EXIBICAO}, ${p.REF_ANP}, ${p.ULTIMO_PRECO}, '${p.TIPO_OPERACAO}')">
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

  atualizarVisibilidadeListaPostos();
}

let resumoPostoAnualChartInstances = [];

function renderizarResumoAnualPosto(postos) {
  const secao = document.getElementById('resumoPostoAnual');
  const containerCustos = document.getElementById('graficoResumoCustos');
  const containerVolumes = document.getElementById('graficoResumoVolumes');
  if (!secao || !containerCustos || !containerVolumes) return;

  const destruirGraficos = () => {
    resumoPostoAnualChartInstances.forEach(grafico => {
      try { grafico.destroy(); } catch (e) {}
    });
    resumoPostoAnualChartInstances = [];
  };

  const ocultarResumo = () => {
    secao.style.display = 'none';
    destruirGraficos();
  };

  if (!postoFiltrado || !postos.length || typeof ApexCharts === 'undefined') {
    ocultarResumo();
    return;
  }

  const posto = postos.find(p => p.POSTO === postoFiltrado) || postos[0];
  const agora = new Date();
  const ano = agora.getFullYear();
  const limiteMes = agora.getMonth() + 1;
  const nomesMeses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const meses = nomesMeses.slice(0, limiteMes);
  const dadosMes = meses.map(() => ({ litros: 0, valor: 0, valorCiclo: 0 }));

  const registrosAno = baseRegistrosMensais.filter(registro => {
    const mes = String(registro.MES_ANO || registro.DATA_FIM_CICLO || '').slice(0, 7);
    return registro.POSTO === posto.POSTO &&
      registro.UF_POSTO === posto.UF_POSTO &&
      registro.TIPO_OPERACAO === posto.TIPO_OPERACAO &&
      (posto.TIPO_OPERACAO !== 'INTERNO' || registro.MUNICIPIO_POSTO === posto.MUNICIPIO_POSTO) &&
      mes.startsWith(`${ano}-`);
  });

  registrosAno.forEach(registro => {
    const mes = String(registro.MES_ANO || registro.DATA_FIM_CICLO || '').slice(0, 7);
    const indiceMes = parseInt(mes.slice(5, 7), 10) - 1;
    if (indiceMes < 0 || indiceMes >= limiteMes) return;

    const litros = parseFloat(registro.VOLUME_CICLO || 0) || 0;
    const valorInformado = parseFloat(registro.VALOR_TOTAL_CICLO || 0) || 0;
    const precoUnitario = parseFloat(registro.VALOR_UNITARIO || 0) || 0;
    dadosMes[indiceMes].litros += litros;
    dadosMes[indiceMes].valor += valorInformado > 0 ? valorInformado : litros * precoUnitario;
    dadosMes[indiceMes].valorCiclo += valorInformado > 0 ? valorInformado : litros * precoUnitario;
  });

  const totalLitros = dadosMes.reduce((total, mes) => total + mes.litros, 0);
  const totalValor = dadosMes.reduce((total, mes) => total + mes.valor, 0);
  const formatarReais = (valor, casas = 2) => Number(valor || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas
  });
  const formatarCompacto = valor => {
    const absoluto = Math.abs(valor);
    if (absoluto >= 1000000) return `${(valor / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
    if (absoluto >= 1000) return `${(valor / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
    return Math.round(valor).toLocaleString('pt-BR');
  };

  document.getElementById('resumoPostoAnualNome').textContent = posto.NOME_EXIBICAO || posto.POSTO;
  document.getElementById('resumoPostoAnualAno').textContent = `Ano vigente: ${ano}`;
  document.getElementById('resumoPostoAnualLitros').textContent = `${Math.round(totalLitros).toLocaleString('pt-BR')} L`;
  document.getElementById('resumoPostoAnualTotal').textContent = `R$ ${formatarReais(totalValor)}`;

  const tratativaPosto = typeof obterTratativaPosto === 'function'
    ? obterTratativaPosto(posto.POSTO, posto.UF_POSTO)
    : null;
  const historicoTratativas = Array.isArray(tratativaPosto?.historico) && tratativaPosto.historico.length
    ? tratativaPosto.historico
    : (tratativaPosto ? [tratativaPosto] : []);
  const obterDataRegistro = tratativa => {
    const valorData = String(tratativa.data || '');
    if (/^\d{4}-\d{2}-\d{2}T/.test(valorData)) {
      const dataLocal = new Date(valorData);
      if (Number.isFinite(dataLocal.getTime())) {
        const anoLocal = dataLocal.getFullYear();
        const mesLocal = String(dataLocal.getMonth() + 1).padStart(2, '0');
        const diaLocal = String(dataLocal.getDate()).padStart(2, '0');
        return `${anoLocal}-${mesLocal}-${diaLocal}`;
      }
    }
    const dataRegistro = valorData.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(dataRegistro)
      ? dataRegistro
      : String(tratativa.vigencia || '').slice(0, 10);
  };
  const obterDataVigencia = tratativa => String(tratativa.vigencia || obterDataRegistro(tratativa)).slice(0, 10);
  const tratativasAno = historicoTratativas.filter(tratativa => {
    const dataVigencia = obterDataVigencia(tratativa);
    const numeroMes = parseInt(dataVigencia.slice(5, 7), 10);
    return dataVigencia.startsWith(`${ano}-`) && numeroMes > 0 && numeroMes <= limiteMes && meses[numeroMes - 1];
  });

  const escaparHtml = valor => {
    const elemento = document.createElement('span');
    elemento.textContent = String(valor ?? '');
    return elemento.innerHTML;
  };
  const tratativasPorMes = new Map();
  tratativasAno.forEach(tratativa => {
    const mesIndice = parseInt(obterDataVigencia(tratativa).slice(5, 7), 10) - 1;
    if (!tratativasPorMes.has(mesIndice)) tratativasPorMes.set(mesIndice, []);
    tratativasPorMes.get(mesIndice).push(tratativa);
  });
  const pontosTratativas = meses.map((mes, mesIndice) => {
    const tratativas = tratativasPorMes.get(mesIndice) || [];
    if (tratativas.length === 0) return { x: mes, y: null, tratativas: [] };
    const tratativa = tratativas[0];
    const precoRegistrado = parseFloat(tratativa.preco || 0) || parseFloat(tratativa.preco_proposto || 0);
    const precoMes = dadosMes[mesIndice].litros > 0 ? dadosMes[mesIndice].valorCiclo / dadosMes[mesIndice].litros : 0;
    return { x: mes, y: precoRegistrado || precoMes, tratativas };
  });
  const tabelaAnp = posto.TIPO_OPERACAO === 'INTERNO' ? anpDistribuicao : anpRevenda;
  const anpUf = tabelaAnp?.[posto.UF_POSTO] || {};
  const dadosAnpMes = meses.map((_, indice) => {
    const mesChave = `${ano}-${String(indice + 1).padStart(2, '0')}`;
    const precoAnp = parseFloat(anpUf[mesChave] || 0);
    return precoAnp > 0 ? precoAnp : null;
  });

  destruirGraficos();

  secao.style.display = 'block';
  containerCustos.innerHTML = '';
  containerVolumes.innerHTML = '';
  const temDadosAnp = dadosAnpMes.some(valor => valor !== null);
  if (totalLitros <= 0 && totalValor <= 0 && tratativasAno.length === 0 && !temDadosAnp) {
    containerCustos.innerHTML = '<div class="text-center text-muted small py-4">Sem registros do posto no ano vigente.</div>';
    return;
  }

  const tooltipCusto = ({ seriesIndex, dataPointIndex, w }) => {
    const serie = w.config.series[seriesIndex];
    const ponto = serie.data[dataPointIndex] || {};
    const mes = escaparHtml(ponto.x || meses[dataPointIndex] || '');
    if (serie.name === 'Tratativas') {
      const detalhes = (ponto.tratativas || []).map((tratativa, indiceTratativa) => {
        const dataRegistro = obterDataRegistro(tratativa).split('-').reverse().join('/') || 'Sem data';
        const vigencia = String(tratativa.vigencia || '').slice(0, 10).split('-').reverse().join('/') || 'Sem data';
        const status = escaparHtml(String(tratativa.status || 'Sem status').replace(/_/g, ' '));
        const preco = parseFloat(tratativa.preco || 0) || parseFloat(tratativa.preco_proposto || 0);
        const notas = tratativa.notas ? `<div class="mt-1">${escaparHtml(tratativa.notas).replace(/\n/g, '<br>')}</div>` : '';
        const separador = indiceTratativa > 0 ? 'mt-2 pt-2 border-top' : '';
        return `<div class="${separador}"><div>Registrada em: ${escaparHtml(dataRegistro)}</div><div>Vigência: ${escaparHtml(vigencia)}</div><div>Status: ${status}</div>${preco > 0 ? `<div>Preço: R$ ${formatarReais(preco, 3)}</div>` : ''}${notas}</div>`;
      }).join('');
      return `<div class="p-2 small"><strong>Tratativas • ${mes}</strong>${detalhes}</div>`;
    }

    const valor = Number(ponto.y || 0);
    return `<div class="p-2 small"><strong>${mes}</strong><div>${escaparHtml(serie.name)}: R$ ${formatarReais(valor, 3)}/L</div></div>`;
  };
  const tooltipVolume = ({ seriesIndex, dataPointIndex, w }) => {
    const serie = w.config.series[seriesIndex];
    const ponto = serie.data[dataPointIndex] || {};
    const mes = escaparHtml(ponto.x || meses[dataPointIndex] || '');
    const valor = Number(ponto.y || 0);
    const valorFormatado = serie.name === 'Litros'
      ? `${Math.round(valor).toLocaleString('pt-BR')} L`
      : `R$ ${formatarReais(valor, 2)}`;
    return `<div class="p-2 small"><strong>${mes}</strong><div>${escaparHtml(serie.name)}: ${valorFormatado}</div></div>`;
  };

  const custosMediosPosto = dadosMes.map(mes => mes.litros > 0 ? mes.valorCiclo / mes.litros : null);
  const valoresEscalaPreco = [
    ...custosMediosPosto,
    ...dadosAnpMes,
    ...pontosTratativas.map(ponto => ponto.y)
  ].filter(valor => Number.isFinite(valor) && valor > 0);
  const precoEscalaMin = valoresEscalaPreco.length > 0
    ? Math.max(0, Math.floor(Math.min(...valoresEscalaPreco) * 2) / 2)
    : 0;
  const precoEscalaMaxCalculado = valoresEscalaPreco.length > 0
    ? Math.ceil(Math.max(...valoresEscalaPreco) * 2) / 2
    : 1;
  const precoEscalaMax = precoEscalaMaxCalculado > precoEscalaMin
    ? precoEscalaMaxCalculado
    : precoEscalaMin + 0.5;

  const opcoesCustos = {
    series: [
      { name: 'Custo médio do posto', type: 'line', data: custosMediosPosto.map((valor, indice) => ({ x: meses[indice], y: valor })) },
      { name: 'Média ANP (R$/L)', type: 'line', data: dadosAnpMes.map((valor, indice) => ({ x: meses[indice], y: valor })) },
      { name: 'Tratativas', type: 'line', data: pontosTratativas }
    ],
    chart: {
      type: 'line',
      height: 190,
      toolbar: { show: false },
      animations: { enabled: false },
      fontFamily: 'inherit',
      parentHeightOffset: 0
    },
    colors: ['#15803d', '#475569', '#eab308'],
    stroke: { curve: 'smooth', width: [3, 2, 0], dashArray: [0, 5, 0] },
    markers: { size: [3, 3, 8], strokeColors: ['#15803d', '#475569', '#ffffff'], strokeWidth: 2, hover: { sizeOffset: 3 } },
    dataLabels: {
      enabled: true,
      enabledOnSeries: [0, 1, 2],
      formatter: (valor, opcoes) => {
        if (valor === null || valor === undefined) return '';
        if (opcoes.seriesIndex === 2) return '!';
        return `R$ ${formatarReais(valor, 3)}`;
      },
      offsetY: -7,
      style: { fontSize: '10px', fontWeight: 600, colors: ['#166534', '#475569', '#92400e'] },
      background: { enabled: true, foreColor: '#ffffff', borderRadius: 3, padding: 3, borderWidth: 0, opacity: 0.46 }
    },
    xaxis: {
      type: 'category',
      categories: meses,
      labels: { show: false },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: [
      {
        seriesName: 'Custo médio do posto',
        min: precoEscalaMin,
        max: precoEscalaMax,
        tickAmount: 4,
        labels: { show: true, minWidth: 64, maxWidth: 64, formatter: valor => `R$ ${formatarReais(valor, 2)}` },
        title: { text: 'Custo médio (R$/L)' }
      },
      {
        seriesName: 'Média ANP (R$/L)',
        opposite: true,
        min: precoEscalaMin,
        max: precoEscalaMax,
        tickAmount: 4,
        labels: { show: true, minWidth: 80, maxWidth: 80, formatter: valor => `R$ ${formatarReais(valor, 2)}` },
        title: { text: 'Média ANP (R$/L)' }
      }
    ],
    grid: { borderColor: '#e2e8f0', strokeDashArray: 3, padding: { left: 12, right: 12, top: 16, bottom: 0 } },
    legend: { show: false },
    tooltip: { shared: false, intersect: true, custom: tooltipCusto },
    noData: { text: 'Sem dados de custo para o ano vigente' }
  };

  const opcoesVolumes = {
    series: [
      { name: 'Litros', type: 'column', data: dadosMes.map((mes, indice) => ({ x: meses[indice], y: mes.litros > 0 ? Math.round(mes.litros) : null })) },
      { name: 'Total abastecido', type: 'line', data: dadosMes.map((mes, indice) => ({ x: meses[indice], y: mes.valor > 0 ? mes.valor : null })) }
    ],
    chart: {
      type: 'line',
      height: 230,
      toolbar: { show: false },
      animations: { enabled: false },
      fontFamily: 'inherit',
      parentHeightOffset: 0
    },
    colors: ['#94a3b8', '#ea580c'],
    plotOptions: { bar: { columnWidth: '34%', borderRadius: 3 } },
    stroke: { curve: 'smooth', width: [0, 3] },
    markers: { size: [0, 3], strokeColors: ['#94a3b8', '#ea580c'], strokeWidth: 2, hover: { sizeOffset: 3 } },
    dataLabels: {
      enabled: true,
      formatter: (valor, opcoes) => {
        if (valor === null || valor === undefined) return '';
        const larguraGrafico = Number(opcoes.w.globals.gridWidth || 0);
        if (opcoes.seriesIndex === 0) {
          const litros = larguraGrafico >= 1000 ? Math.round(valor).toLocaleString('pt-BR') : formatarCompacto(valor);
          return `${litros} L`;
        }
        const total = larguraGrafico >= 1000 ? formatarReais(valor, 0) : formatarCompacto(valor);
        return `R$ ${total}`;
      },
      offsetY: -7,
      style: { fontSize: '10px', fontWeight: 600, colors: ['#475569', '#c2410c'] },
      background: { enabled: true, foreColor: '#ffffff', borderRadius: 3, padding: 3, borderWidth: 0, opacity: 0.46 }
    },
    xaxis: {
      type: 'category',
      categories: meses,
      labels: { rotate: 0, trim: false },
      axisBorder: { color: '#e2e8f0' },
      axisTicks: { color: '#e2e8f0' }
    },
    yaxis: [
      {
        seriesName: 'Litros',
        tickAmount: 4,
        labels: { show: true, minWidth: 64, maxWidth: 64, formatter: valor => `${formatarCompacto(valor)} L` },
        title: { text: 'Volume (L)' }
      },
      {
        seriesName: 'Total abastecido',
        opposite: true,
        tickAmount: 4,
        labels: { show: true, minWidth: 80, maxWidth: 80, formatter: valor => `R$ ${formatarCompacto(valor)}` },
        title: { text: 'Total (R$)' }
      }
    ],
    grid: { borderColor: '#e2e8f0', strokeDashArray: 3, padding: { left: 12, right: 12, top: 14, bottom: 0 } },
    legend: { show: false },
    tooltip: { shared: false, intersect: true, custom: tooltipVolume },
    noData: { text: 'Sem dados para o ano vigente' }
  };

  resumoPostoAnualChartInstances = [
    new ApexCharts(containerCustos, opcoesCustos),
    new ApexCharts(containerVolumes, opcoesVolumes)
  ];
  resumoPostoAnualChartInstances.forEach(grafico => grafico.render());
}

function atualizarVisibilidadeListaPostos() {
  const busca = (document.getElementById('campoBusca')?.value || '').trim().toLowerCase();
  const cards = Array.from(document.querySelectorAll('#listaTermometroPostos .card-posto-termometro'));

  cards.forEach(card => {
    const correspondeBusca = !busca || card.textContent.toLowerCase().includes(busca);
    const recolhido = card.classList.contains('posto-externo-expandivel') && !postosExternosExpandidos && !busca;
    card.style.display = correspondeBusca && !recolhido ? 'flex' : 'none';
  });

  const botaoExpansao = document.querySelector('#listaTermometroPostos .btn-expandir-postos-externos');
  if (botaoExpansao) {
    botaoExpansao.hidden = Boolean(busca);
    botaoExpansao.innerHTML = postosExternosExpandidos
      ? `<i class="bi bi-chevron-up me-1"></i> Recolher postos externos`
      : `<i class="bi bi-chevron-down me-1"></i> Expandir demais postos externos (${botaoExpansao.dataset.quantidade || 0})`;
  }

  const cabecalhoExternos = document.querySelector('#listaTermometroPostos .titulo-grupo-externo');
  if (cabecalhoExternos) {
    const temExternoVisivel = cards.some(card => card.dataset.tipoOperacao === 'EXTERNO' && card.style.display !== 'none');
    cabecalhoExternos.style.display = temExternoVisivel ? 'flex' : 'none';
  }

  const cabecalhoInternos = document.querySelector('#listaTermometroPostos .titulo-grupo-interno');
  if (cabecalhoInternos) {
    const temInternoVisivel = cards.some(card => card.dataset.tipoOperacao === 'INTERNO' && card.style.display !== 'none');
    cabecalhoInternos.style.display = temInternoVisivel ? 'flex' : 'none';
  }

  const lblListando = document.getElementById('lblListando');
  if (lblListando) {
    const visiveis = cards.filter(card => card.style.display !== 'none').length;
    lblListando.innerText = `A listar ${visiveis} postos`;
  }
}

function filtrarTabelaTexto() {
  atualizarVisibilidadeListaPostos();
}

function alternarExpansaoPostosExternos() {
  postosExternosExpandidos = !postosExternosExpandidos;
  atualizarVisibilidadeListaPostos();
}
