/**
 * CARGOSOFT | Data Analytics Diesel
 * Módulo de Inteligência Geográfica: Mini Mapa do Brasil & Roteirizador de Postos
 * Arquivo: mapa.js
 */

// URL da malha GeoJSON oficial dos 27 estados do Brasil
const GEOJSON_BR_URL = "https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/brazil-states.geojson";

// Dicionário de conversão Nome do Estado -> Sigla UF da Base KMM
const DE_PARA_NOMES_UFS = {
  "ACRE": "AC", "ALAGOAS": "AL", "AMAPA": "AP", "AMAZONAS": "AM", "BAHIA": "BA",
  "CEARA": "CE", "DISTRITO FEDERAL": "DF", "ESPIRITO SANTO": "ES", "GOIAS": "GO",
  "MARANHAO": "MA", "MATO GROSSO": "MT", "MATO GROSSO DO SUL": "MS", "MINAS GERAIS": "MG",
  "PARA": "PA", "PARAIBA": "PB", "PARANA": "PR", "PERNAMBUCO": "PE", "PIAUI": "PI",
  "RIO DE JANEIRO": "RJ", "RIO GRANDE DO NORTE": "RN", "RIO GRANDE DO SUL": "RS",
  "RONDONIA": "RO", "RORAIMA": "RR", "SANTA CATARINA": "SC", "SAO PAULO": "SP",
  "SERGIPE": "SE", "TOCANTINS": "TO"
};

// Variáveis de controlo do Mini Mapa do Brasil
let miniMapaLeaflet = null;
let camadaGeoJsonBrasil = null;
let dadosGeoJsonBr = null;

// Variáveis de controlo do Roteirizador de Postos
let leafletMapInstance = null;
let routingControlInstance = null;
let markersPostosLeaflet = [];
let markersWaypoints = [];
let campoFocoAtivo = null;
let postosSugeridosUltimaRota = [];

// Cache de Geocodificação Automática
const cacheGeocodificacao = {};

// =========================================================================
// 1. MINI MAPA LEAFLET: IDENTIDADE INSTITUCIONAL CARGOSOFT & VOCTT
// =========================================================================

function normalizarTextoComparacao(txt) {
  return (txt || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
}

function extrairSiglaUf(props) {
  if (!props) return "";
  if (props.sigla && props.sigla.length === 2) return props.sigla.toUpperCase();
  if (props.UF && props.UF.length === 2) return props.UF.toUpperCase();
  if (props.id && props.id.length === 2) return props.id.toUpperCase();
  
  const nomeLimpo = normalizarTextoComparacao(props.name || props.nome || props.NOME || '');
  return DE_PARA_NOMES_UFS[nomeLimpo] || (nomeLimpo.length === 2 ? nomeLimpo : "");
}

async function inicializarMiniMapaBrasil() {
  const mapContainer = document.getElementById('miniMapaBrasil');
  if (!mapContainer || miniMapaLeaflet) return;

  miniMapaLeaflet = L.map('miniMapaBrasil', {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    touchZoom: false,
    zoomSnap: 0.05,
    zoomDelta: 0.1
  }).setView([-14.235, -51.925], 3.8);

  try {
    const resp = await fetch(GEOJSON_BR_URL);
    if (!resp.ok) throw new Error("Falha na resposta do servidor GeoJSON");
    dadosGeoJsonBr = await resp.json();
    atualizarCoresMiniMapa();
  } catch (err) {
    console.error("Erro ao carregar a malha GeoJSON oficial dos estados:", err);
  }
}

function obterCorPorVolume(vol) {
  if (!vol || vol === 0) return '#e2e8f0';
  if (vol < 50000) return '#4ade80';
  if (vol < 150000) return '#22c55e';
  if (vol < 350000) return '#1c483a';
  if (vol < 700000) return '#14352a';
  return '#062316';
}

function gerarConteudoTooltipUf(uf) {
  const mesSel = document.getElementById('filtroMesAno') ? document.getElementById('filtroMesAno').value : 'YTD';
  let regs = (typeof baseRegistrosMensais !== 'undefined' && Array.isArray(baseRegistrosMensais)) ? baseRegistrosMensais : [];
  regs = regs.filter(d => d.UF_POSTO === uf);

  if (mesSel !== 'YTD') {
    regs = regs.filter(d => d.MES_ANO === mesSel);
  }

  const litExterno = regs.filter(d => d.TIPO_OPERACAO === 'EXTERNO').reduce((a, c) => a + parseFloat(c.VOLUME_CICLO || c.LITROS_MES || 0), 0);
  const valExterno = regs.filter(d => d.TIPO_OPERACAO === 'EXTERNO').reduce((a, c) => a + parseFloat(c.VALOR_TOTAL_CICLO || c.VALOR_TOTAL_MES || 0), 0);
  const medExterno = litExterno > 0 ? (valExterno / litExterno) : 0;

  if (uf === 'SP') {
    const regsBarueri = regs.filter(d => {
      if (d.TIPO_OPERACAO !== 'INTERNO') return false;
      const m = normalizarTextoComparacao(d.MUNICIPIO_POSTO);
      const p = normalizarTextoComparacao(d.POSTO);
      return m.includes('BARUERI') || p.includes('BARUERI');
    });
    const litBarueri = regsBarueri.reduce((a, c) => a + parseFloat(c.VOLUME_CICLO || c.LITROS_MES || 0), 0);
    const valBarueri = regsBarueri.reduce((a, c) => a + parseFloat(c.VALOR_TOTAL_CICLO || c.VALOR_TOTAL_MES || 0), 0);
    const medBarueri = litBarueri > 0 ? (valBarueri / litBarueri) : 0;

    const regsRibeirao = regs.filter(d => {
      if (d.TIPO_OPERACAO !== 'INTERNO') return false;
      const m = normalizarTextoComparacao(d.MUNICIPIO_POSTO);
      const p = normalizarTextoComparacao(d.POSTO);
      return m.includes('RIBEIRAO') || p.includes('RIBEIRAO') || p.includes('RP');
    });
    const litRibeirao = regsRibeirao.reduce((a, c) => a + parseFloat(c.VOLUME_CICLO || c.LITROS_MES || 0), 0);
    const valRibeirao = regsRibeirao.reduce((a, c) => a + parseFloat(c.VALOR_TOTAL_CICLO || c.VALOR_TOTAL_MES || 0), 0);
    const medRibeirao = litRibeirao > 0 ? (valRibeirao / litRibeirao) : 0;

    const totalSp = litBarueri + litRibeirao + litExterno;

    if (totalSp === 0) {
      return `<div style="font-size:0.75rem; padding: 2px;"><strong>SP &bull; São Paulo</strong><br><span style="color:#94a3b8;">Sem movimento no período</span></div>`;
    }

    return `
      <div style="font-size:0.75rem; line-height: 1.35; padding: 2px; min-width: 185px;">
        <strong style="color: #22c55e;">SP &bull; Resumo Operacional</strong><br>
        Total: <b>${Math.round(totalSp).toLocaleString('pt-BR')} L</b><br>
        <span style="color:#86efac;">Barueri (Garagem):</span> ${Math.round(litBarueri).toLocaleString('pt-BR')} L ${medBarueri > 0 ? '(R$ ' + medBarueri.toFixed(3) + ')' : ''}<br>
        <span style="color:#86efac;">Ribeirão (Garagem):</span> ${Math.round(litRibeirao).toLocaleString('pt-BR')} L ${medRibeirao > 0 ? '(R$ ' + medRibeirao.toFixed(3) + ')' : ''}<br>
        <span style="color:#fdba74;">Rota Rodoviária:</span> ${Math.round(litExterno).toLocaleString('pt-BR')} L ${medExterno > 0 ? '(R$ ' + medExterno.toFixed(3) + ')' : ''}
      </div>
    `;
  }

  const litInterno = regs.filter(d => d.TIPO_OPERACAO === 'INTERNO').reduce((a, c) => a + parseFloat(c.VOLUME_CICLO || c.LITROS_MES || 0), 0);
  const valInterno = regs.filter(d => d.TIPO_OPERACAO === 'INTERNO').reduce((a, c) => a + parseFloat(c.VALOR_TOTAL_CICLO || c.VALOR_TOTAL_MES || 0), 0);
  const medInterno = litInterno > 0 ? (valInterno / litInterno) : 0;

  const totalL = litInterno + litExterno;

  if (totalL === 0) {
    return `<div style="font-size:0.75rem; padding: 2px;"><strong>${uf}</strong><br><span style="color:#94a3b8;">Sem movimento no período</span></div>`;
  }

  return `
    <div style="font-size:0.75rem; line-height: 1.35; padding: 2px; min-width: 175px;">
      <strong style="color: #22c55e;">${uf} &bull; Resumo Operacional</strong><br>
      Total: <b>${Math.round(totalL).toLocaleString('pt-BR')} L</b><br>
      <span style="color:#86efac;">Tanques Próprios:</span> ${Math.round(litInterno).toLocaleString('pt-BR')} L ${medInterno > 0 ? '(R$ ' + medInterno.toFixed(3) + ')' : ''}<br>
      <span style="color:#fdba74;">Rota Rodoviária:</span> ${Math.round(litExterno).toLocaleString('pt-BR')} L ${medExterno > 0 ? '(R$ ' + medExterno.toFixed(3) + ')' : ''}
    </div>
  `;
}

function atualizarCoresMiniMapa() {
  if (!miniMapaLeaflet || !dadosGeoJsonBr) return;

  if (camadaGeoJsonBrasil) {
    miniMapaLeaflet.removeLayer(camadaGeoJsonBrasil);
  }

  const mesSel = document.getElementById('filtroMesAno') ? document.getElementById('filtroMesAno').value : 'YTD';
  let regs = (typeof baseRegistrosMensais !== 'undefined' && Array.isArray(baseRegistrosMensais)) ? baseRegistrosMensais : [];

  if (mesSel !== 'YTD') {
    regs = regs.filter(d => d.MES_ANO === mesSel);
  }

  const volPorUf = {};
  regs.forEach(d => {
    if (!d.UF_POSTO) return;
    volPorUf[d.UF_POSTO] = (volPorUf[d.UF_POSTO] || 0) + parseFloat(d.VOLUME_CICLO || d.LITROS_MES || 0);
  });

  camadaGeoJsonBrasil = L.geoJSON(dadosGeoJsonBr, {
    style: function(feature) {
      const sigla = extrairSiglaUf(feature.properties);
      const vol = volPorUf[sigla] || 0;
      const selecionado = (typeof ufFiltrada !== 'undefined' && ufFiltrada === sigla);

      return {
        fillColor: obterCorPorVolume(vol),
        weight: selecionado ? 2.5 : 0.8,
        opacity: 1,
        color: selecionado ? '#f59e0b' : '#ffffff',
        fillOpacity: 0.95
      };
    },
    onEachFeature: function(feature, layer) {
      const sigla = extrairSiglaUf(feature.properties);

      const estadosSulSudeste = ['PR', 'SC', 'RS', 'SP', 'RJ', 'ES', 'MG', 'MS'];
      const direcaoTooltip = estadosSulSudeste.includes(sigla) ? 'top' : 'auto';

      layer.bindTooltip(() => gerarConteudoTooltipUf(sigla), {
        sticky: true,
        direction: direcaoTooltip,
        className: 'custom-leaflet-tooltip',
        offset: [0, -5]
      });

      layer.on('mouseover', function(e) {
        const l = e.target;
        l.setStyle({
          weight: 2,
          color: '#0f172a'
        });
        const lblHover = document.getElementById('lblHoverEstado');
        if (lblHover) lblHover.innerText = `Estado: ${sigla}`;
      });

      layer.on('mouseout', function(e) {
        camadaGeoJsonBrasil.resetStyle(e.target);
        if (typeof ufFiltrada !== 'undefined' && ufFiltrada === sigla) {
          e.target.setStyle({ weight: 2.5, color: '#f59e0b' });
        }
        const lblHover = document.getElementById('lblHoverEstado');
        if (lblHover) {
          lblHover.innerText = (typeof ufFiltrada !== 'undefined' && ufFiltrada) ? `Filtrando por ${ufFiltrada}` : 'Passe o mouse ou clique';
        }
      });

      layer.on('click', function() {
        if (typeof ufFiltrada !== 'undefined' && ufFiltrada === sigla) {
          if (typeof limparFiltroUf === 'function') limparFiltroUf();
        } else {
          ufFiltrada = sigla;
          const badgeUf = document.getElementById('badgeFiltroUf');
          const lblUf = document.getElementById('lblUfAtiva');
          if (badgeUf) badgeUf.style.display = 'inline-block';
          if (lblUf) lblUf.innerText = sigla;
          atualizarCoresMiniMapa();
          if (typeof processarPainel === 'function') processarPainel();
        }
      });
    }
  }).addTo(miniMapaLeaflet);

  setTimeout(() => {
    if (miniMapaLeaflet && camadaGeoJsonBrasil) {
      miniMapaLeaflet.invalidateSize();
      miniMapaLeaflet.fitBounds(camadaGeoJsonBrasil.getBounds(), {
        padding: [0, 0],
        maxZoom: 5.5
      });
    }
  }, 100);
}

// =========================================================================
// 2. ROTEIRIZADOR DE POSTOS & FILTRO LIVRE
// =========================================================================

function normalizarTextoBusca(txt) {
  return (txt || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Lógica de Auditoria Temporal do Preço (+30 dias)
function verificarSePrecoDesatualizado(dataString) {
  if (!dataString) return true;
  
  let dt = new Date(dataString);
  if (isNaN(dt.getTime()) && dataString.includes('/')) {
    const partes = dataString.split('/');
    if (partes.length === 3) {
      dt = new Date(`${partes[2]}-${partes[1]}-${partes[0]}T12:00:00`);
    } else if (partes.length === 2) {
      dt = new Date(`${partes[1]}-${partes[0]}-01T12:00:00`);
    }
  }
  
  if (isNaN(dt.getTime())) return true;
  
  const hoje = new Date();
  const diferencaDias = (hoje - dt) / (1000 * 60 * 60 * 24);
  return diferencaDias > 30;
}

// Interceptador para fundir Base KMM com Base de Tratativas
function aplicarTratativasNosPostos(postos) {
  postos.forEach(p => {
    p.origemPreco = "Base KMM";
    const chaveId = `${p.posto}_${p.uf}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]/g, "_").toUpperCase();
    
    if (typeof mapaTratativasCadastradas !== 'undefined' && mapaTratativasCadastradas[chaveId]) {
      const trat = mapaTratativasCadastradas[chaveId];
      if (trat.status === 'ACORDO_FECHADO' && trat.preco_acordado > 0) {
        const dataTratativa = trat.vigencia || trat.atualizado_em;
        
        let dataKmm = new Date(p.data);
        let dataTrat = new Date(dataTratativa);
        
        if (isNaN(dataKmm.getTime()) && p.data && p.data.includes('/')) {
           const pts = p.data.split('/');
           dataKmm = pts.length === 3 ? new Date(`${pts[2]}-${pts[1]}-${pts[0]}T12:00:00`) : new Date(`${pts[1]}-${pts[0]}-01T12:00:00`);
        }
        if (isNaN(dataTrat.getTime()) && dataTratativa && dataTratativa.includes('/')) {
           const pts = dataTratativa.split('/');
           dataTrat = pts.length === 3 ? new Date(`${pts[2]}-${pts[1]}-${pts[0]}T12:00:00`) : new Date(`${pts[1]}-${pts[0]}-01T12:00:00`);
        }
        
        if (isNaN(dataKmm.getTime()) || (dataTrat >= dataKmm && !isNaN(dataTrat.getTime()))) {
          p.preco = trat.preco_acordado;
          p.data = dataTratativa;
          p.origemPreco = "Acordo na Mesa";
        }
      }
    }
  });
}

// -------------------------------------------------------------------------
// GEOCODIFICAÇÃO AUTOMÁTICA (Nominatim)
// -------------------------------------------------------------------------
async function obterCoordenadasNominatim(municipio, uf) {
  if (!municipio || !uf) return null;
  const chave = `${normalizarTextoBusca(municipio)}_${normalizarTextoBusca(uf)}`;
  
  const listaCidadesRef = (typeof listaCidades !== 'undefined' && Array.isArray(listaCidades)) ? listaCidades : [];
  const achadaLocal = listaCidadesRef.find(c => normalizarTextoBusca(c.nome).includes(normalizarTextoBusca(municipio)));
  if (achadaLocal) return { lat: achadaLocal.lat, lon: achadaLocal.lon };

  if (cacheGeocodificacao[chave] !== undefined) return cacheGeocodificacao[chave];

  try {
    await new Promise(r => setTimeout(r, 600)); 
    const query = encodeURIComponent(`${municipio}, ${uf}, Brasil`);
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'VOCTT-Logistics-Consulting/1.0' } });
    const data = await resp.json();
    
    if (data && data.length > 0) {
      const coords = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      cacheGeocodificacao[chave] = coords;
      return coords;
    }
  } catch(e) {
    console.warn(`Aviso: Falha ao geocodificar ${municipio}-${uf}.`, e);
  }
  
  cacheGeocodificacao[chave] = null;
  return null;
}

function configurarAutocompletarItem(itemEl) {
  const input = itemEl.querySelector('.input-cidade-rota');
  const hiddenCoord = itemEl.querySelector('.hidden-coord-rota');
  const lista = itemEl.querySelector('.autocomplete-list');
  const listaCidadesRef = (typeof listaCidades !== 'undefined' && Array.isArray(listaCidades)) ? listaCidades : [];

  input.addEventListener('focus', () => {
    document.querySelectorAll('.input-cidade-rota').forEach(el => el.classList.remove('foco-ativo'));
    input.classList.add('foco-ativo');
    campoFocoAtivo = itemEl;
  });

  input.addEventListener('input', () => {
    const termo = normalizarTextoBusca(input.value);

    if (termo.length < 2) {
      lista.style.display = "none";
      lista.innerHTML = "";
      hiddenCoord.value = "";
      return;
    }

    const filtradas = listaCidadesRef.filter(c => normalizarTextoBusca(c.nome).includes(termo)).slice(0, 8);

    lista.innerHTML = "";
    if (filtradas.length === 0) {
      lista.style.display = "none";
      return;
    }

    filtradas.forEach(cidade => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "list-group-item list-group-item-action small py-2 text-start";
      btn.style.fontSize = "0.75rem";
      btn.innerText = cidade.nome;

      btn.onclick = () => {
        input.value = cidade.nome;
        hiddenCoord.value = `${cidade.lat},${cidade.lon}`;
        lista.style.display = "none";
        lista.innerHTML = "";
        atualizarMarcadoresWaypoints();
      };

      lista.appendChild(btn);
    });

    lista.style.display = "block";
  });
}

function adicionarCampoParada() {
  const container = document.getElementById('containerPontosRota');
  const itens = container.querySelectorAll('.ponto-rota-item');

  if (itens.length >= 10) {
    alert("Limite máximo de 10 pontos na rota atingido.");
    return;
  }

  const novoIndex = itens.length;
  const novoItem = document.createElement('div');
  novoItem.className = 'mb-2 position-relative ponto-rota-item';
  novoItem.setAttribute('data-index', novoIndex);
  novoItem.innerHTML = `
    <label class="small fw-bold text-dark mb-1 d-flex justify-content-between">
      <span>Parada Intermediária:</span>
      <span class="text-danger cursor-pointer" onclick="removerCampoParada(this)" title="Remover"><i class="bi bi-trash"></i></span>
    </label>
    <input type="text" class="form-control form-control-sm input-cidade-rota" placeholder="Digite ou clique no mapa..." autocomplete="off">
    <input type="hidden" class="hidden-coord-rota">
    <div class="autocomplete-list shadow-sm" style="display: none;"></div>
  `;

  container.insertBefore(novoItem, itens[itens.length - 1]);
  configurarAutocompletarItem(novoItem);
  renumerarRotulos();
}

function removerCampoParada(btnEl) {
  const item = btnEl.closest('.ponto-rota-item');
  item.remove();
  renumerarRotulos();
  atualizarMarcadoresWaypoints();
}

function renumerarRotulos() {
  const itens = document.querySelectorAll('#containerPontosRota .ponto-rota-item');
  itens.forEach((el, idx) => {
    const label = el.querySelector('label span');
    if (idx === 0) {
      label.innerText = "1. Cidade de Origem:";
    } else if (idx === itens.length - 1) {
      label.innerText = `${idx + 1}. Cidade de Destino:`;
    } else {
      label.innerText = `${idx + 1}. Parada Intermediária:`;
    }
  });
}

document.addEventListener("click", (e) => {
  document.querySelectorAll('.autocomplete-list').forEach(list => {
    if (!list.closest('.ponto-rota-item').contains(e.target)) {
      list.style.display = "none";
    }
  });
});

function inicializarMapaLeaflet() {
  if (!leafletMapInstance) {
    leafletMapInstance = L.map('mapLeaflet').setView([-20.0, -48.0], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(leafletMapInstance);

    document.querySelectorAll('.ponto-rota-item').forEach(configurarAutocompletarItem);

    const primeiro = document.querySelector('.ponto-rota-item');
    if (primeiro) {
      primeiro.querySelector('.input-cidade-rota').classList.add('foco-ativo');
      campoFocoAtivo = primeiro;
    }

    leafletMapInstance.on('click', function(e) {
      if (!campoFocoAtivo) return;

      const lat = parseFloat(e.latlng.lat.toFixed(4));
      const lon = parseFloat(e.latlng.lng.toFixed(4));
      const listaCidadesRef = (typeof listaCidades !== 'undefined' && Array.isArray(listaCidades)) ? listaCidades : [];

      let cidadeMaisProxima = "Ponto no Mapa";
      let menorDist = Infinity;
      listaCidadesRef.forEach(c => {
        const d = calcularDistanciaKm(lat, lon, c.lat, c.lon);
        if (d < menorDist && d < 60) {
          menorDist = d;
          cidadeMaisProxima = c.nome;
        }
      });

      const input = campoFocoAtivo.querySelector('.input-cidade-rota');
      const hidden = campoFocoAtivo.querySelector('.hidden-coord-rota');
      input.value = cidadeMaisProxima !== "Ponto no Mapa" ? cidadeMaisProxima : `Coord: ${lat}, ${lon}`;
      hidden.value = `${lat},${lon}`;

      atualizarMarcadoresWaypoints();
      avancarParaProximoCampo();
    });
  }
  setTimeout(() => {
    if (leafletMapInstance) leafletMapInstance.invalidateSize();
  }, 250);
}

function avancarParaProximoCampo() {
  const itens = document.querySelectorAll('#containerPontosRota .ponto-rota-item');
  for (const it of itens) {
    const h = it.querySelector('.hidden-coord-rota');
    if (!h.value) {
      document.querySelectorAll('.input-cidade-rota').forEach(el => el.classList.remove('foco-ativo'));
      it.querySelector('.input-cidade-rota').classList.add('foco-ativo');
      campoFocoAtivo = it;
      return;
    }
  }
}

function atualizarMarcadoresWaypoints() {
  if (!leafletMapInstance) return;
  markersWaypoints.forEach(m => leafletMapInstance.removeLayer(m));
  markersWaypoints = [];

  const itens = document.querySelectorAll('#containerPontosRota .ponto-rota-item');
  itens.forEach((it, idx) => {
    const hidden = it.querySelector('.hidden-coord-rota');
    const input = it.querySelector('.input-cidade-rota');
    if (hidden.value) {
      const [lat, lon] = hidden.value.split(',').map(Number);
      const cor = idx === 0 ? "#16a34a" : (idx === itens.length - 1 ? "#dc2626" : "#2563eb");
      const m = L.circleMarker([lat, lon], {
        radius: 8,
        fillColor: cor,
        color: "#ffffff",
        weight: 2,
        fillOpacity: 1
      }).addTo(leafletMapInstance);
      m.bindPopup(`<b>${idx + 1}. ${input.value}</b>`);
      markersWaypoints.push(m);
    }
  });
}

function obterCoordenadasItem(itemEl) {
  const hidden = itemEl.querySelector('.hidden-coord-rota');
  const input = itemEl.querySelector('.input-cidade-rota');

  if (hidden.value) {
    return hidden.value.split(',').map(Number);
  }

  if (input.value.trim()) {
    const termo = normalizarTextoBusca(input.value);
    const listaCidadesRef = (typeof listaCidades !== 'undefined' && Array.isArray(listaCidades)) ? listaCidades : [];
    const achada = listaCidadesRef.find(c => normalizarTextoBusca(c.nome).includes(termo));
    if (achada) {
      hidden.value = `${achada.lat},${achada.lon}`;
      return [achada.lat, achada.lon];
    }
  }
  return null;
}

function calcularRotaLeaflet() {
  document.querySelectorAll('.input-cidade-rota').forEach(el => {
    el.classList.remove('foco-ativo');
    el.blur();
  });
  campoFocoAtivo = null;

  if (!leafletMapInstance) return;

  const itens = document.querySelectorAll('#containerPontosRota .ponto-rota-item');
  const waypoints = [];

  itens.forEach(it => {
    const coords = obterCoordenadasItem(it);
    if (coords) {
      waypoints.push(L.latLng(coords[0], coords[1]));
    }
  });

  if (waypoints.length < 2) {
    alert("Preencha ao menos uma Cidade de Origem e uma Cidade de Destino válidas.");
    return;
  }

  if (routingControlInstance) {
    leafletMapInstance.removeControl(routingControlInstance);
  }

  routingControlInstance = L.Routing.control({
    waypoints: waypoints,
    routeWhileDragging: false,
    addWaypoints: false,
    showAlternatives: false,
    lineOptions: {
      styles: [{ color: '#1c483a', weight: 5, opacity: 0.85 }]
    }
  }).addTo(leafletMapInstance);

  routingControlInstance.on('routesfound', async function(e) {
    const routeCoords = e.routes[0].coordinates;
    await plotarPostosComDuploRaio(routeCoords);
  });
}

window.adicionarPostoComoParada = function(nomeCidade, lat, lon) {
  const container = document.getElementById('containerPontosRota');
  let itens = container.querySelectorAll('.ponto-rota-item');
  let campoVazio = null;

  for (let i = 0; i < itens.length; i++) {
    const h = itens[i].querySelector('.hidden-coord-rota');
    if (!h.value) {
      campoVazio = itens[i];
      break;
    }
  }

  if (!campoVazio) {
    if (itens.length < 10) {
      adicionarCampoParada();
      itens = container.querySelectorAll('.ponto-rota-item');
      campoVazio = itens[itens.length - 2];
    } else {
      alert("Limite máximo de 10 pontos na rota atingido.");
      return;
    }
  }

  if (campoVazio) {
    const input = campoVazio.querySelector('.input-cidade-rota');
    const hidden = campoVazio.querySelector('.hidden-coord-rota');
    input.value = nomeCidade;
    hidden.value = `${lat},${lon}`;
    
    atualizarMarcadoresWaypoints();
    calcularRotaLeaflet();
  }
};

// -------------------------------------------------------------------------
// PLOTAGEM DE POSTOS NA ROTA (ASYNC)
// -------------------------------------------------------------------------
async function plotarPostosComDuploRaio(routeCoords) {
  if (!leafletMapInstance) return;
  markersPostosLeaflet.forEach(m => leafletMapInstance.removeLayer(m));
  markersPostosLeaflet = [];
  postosSugeridosUltimaRota = [];

  const registrosRef = (typeof baseRegistrosMensais !== 'undefined' && Array.isArray(baseRegistrosMensais)) ? baseRegistrosMensais : [];

  const mapaPostosConsolidado = {};
  registrosRef.forEach(d => {
    const nome = (d.POSTO || '').trim();
    const mun = (d.MUNICIPIO_POSTO || '').trim().toUpperCase();
    const uf = (d.UF_POSTO || '').trim().toUpperCase();
    const chave = `${nome}__${mun}__${uf}`;

    const preco = parseFloat(d.VALOR_UNITARIO || d.ULTIMO_PRECO_MES || d.PRECO_MEDIO_MES || 0);
    const dataReg = d.DATA_FIM_CICLO || d.ULTIMA_DATA_MES || d.MES_ANO || "";
    const volumeAtual = parseFloat(d.VOLUME_CICLO || d.LITROS_MES || 0);

    if (!mapaPostosConsolidado[chave]) {
      mapaPostosConsolidado[chave] = {
        posto: d.POSTO, municipio: mun, uf: uf, preco: preco,
        tipo: d.TIPO_OPERACAO, data: dataReg, volumeTotal: volumeAtual
      };
    } else {
      mapaPostosConsolidado[chave].volumeTotal += volumeAtual;
      if (dataReg && dataReg > mapaPostosConsolidado[chave].data) {
        mapaPostosConsolidado[chave].data = dataReg;
        mapaPostosConsolidado[chave].preco = preco;
      }
    }
  });

  const postos = Object.values(mapaPostosConsolidado);
  
  // Aplica o cruzamento das tratativas para sobrepor preço/data
  aplicarTratativasNosPostos(postos);

  const amostraRota = [];
  const passo = Math.max(1, Math.floor(routeCoords.length / 80));
  for (let i = 0; i < routeCoords.length; i += passo) {
    amostraRota.push(routeCoords[i]);
  }

  const btnRota = document.querySelector('button[onclick="calcularRotaLeaflet()"]');
  const textoOriginalBtn = btnRota ? btnRota.innerHTML : '';
  if (btnRota) {
     btnRota.disabled = true;
     btnRota.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span> Mapeando postos...';
  }

  for (const p of postos) {
    if (!p.municipio || p.municipio === 'ND') continue;

    const coords = await obterCoordenadasNominatim(p.municipio, p.uf);
    if (!coords) continue;

    let menorDist = Infinity;
    for (const pt of amostraRota) {
      const d = calcularDistanciaKm(coords.lat, coords.lon, pt.lat, pt.lng);
      if (d < menorDist) menorDist = d;
    }

    if (menorDist <= 400) {
      const isDesatualizado = verificarSePrecoDesatualizado(p.data);
      let corPin = "#94a3b8";
      let statusTexto = "Posto em Raio Expandido de Apoio";

      if (isDesatualizado) {
        corPin = "#475569";
        statusTexto = "POSTO DESATUALIZADO";
      } else if (menorDist <= 200) {
        corPin = p.preco < 6.40 ? "#16a34a" : (p.preco < 6.75 ? "#eab308" : "#dc2626");
        statusTexto = p.preco < 6.40 ? "Recomendado (Melhor Preço)" : (p.preco < 6.75 ? "Preço Aceitável" : "Alerta de Preço Alto");
      }

      let raioDinamico = 6;
      if (p.volumeTotal > 50000) raioDinamico = 13;
      else if (p.volumeTotal > 15000) raioDinamico = 9;

      const marker = L.circleMarker([coords.lat, coords.lon], {
        radius: raioDinamico,
        fillColor: corPin,
        color: "#ffffff",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.95
      }).addTo(leafletMapInstance);

      marker.bindPopup(`
        <strong style="color:#1c483a;">${p.posto}</strong><br>
        Cidade: ${p.municipio}/${p.uf}<br>
        Último Preço: <b>R$ ${p.preco.toLocaleString('pt-BR', {minimumFractionDigits: 3, maximumFractionDigits: 3})}</b> <span style="font-size:0.6rem; color:#64748b;">(${p.origemPreco})</span><br>
        Tipo: ${p.tipo}<br>
        Status: <b>${statusTexto}</b><br>
        ${isDesatualizado ? `<span class="small text-danger">Data do Preço: ${p.data || 'Indisponível'}</span><br>` : ''}
        <span class="small text-muted d-block mb-2">Aprox. ${Math.round(menorDist)} km da rota</span>
        <button class="btn btn-sm btn-success w-100 fw-bold shadow-sm" style="font-size:0.7rem;" onclick="window.adicionarPostoComoParada('${p.municipio.replace(/'/g, "\\'")}', ${coords.lat}, ${coords.lon})">
          ➕ Incluir na Rota
        </button>
      `);

      markersPostosLeaflet.push(marker);

      if (menorDist <= 200) {
        postosSugeridosUltimaRota.push({
          posto: p.posto, cidade: `${p.municipio}/${p.uf}`, preco: p.preco,
          distancia: Math.round(menorDist), tipo: p.tipo, desatualizado: isDesatualizado, origemPreco: p.origemPreco
        });
      }
    }
  }

  postosSugeridosUltimaRota.sort((a, b) => {
    if (a.distancia !== b.distancia) return a.distancia - b.distancia;
    return a.preco - b.preco;
  });

  if (btnRota) {
     btnRota.disabled = false;
     btnRota.innerHTML = textoOriginalBtn;
  }
}

// -------------------------------------------------------------------------
// FILTRO LIVRE POR ESTADO DIRETAMENTE NO ROTEIRIZADOR
// -------------------------------------------------------------------------
window.plotarPostosPorUfLivre = async function(ufSelecionada) {
  if (!leafletMapInstance) return;

  if (routingControlInstance) {
    leafletMapInstance.removeControl(routingControlInstance);
    routingControlInstance = null;
  }
  
  markersPostosLeaflet.forEach(m => leafletMapInstance.removeLayer(m));
  markersPostosLeaflet = [];
  markersWaypoints.forEach(m => leafletMapInstance.removeLayer(m));
  markersWaypoints = [];
  postosSugeridosUltimaRota = [];

  document.querySelectorAll('.input-cidade-rota').forEach(el => el.value = '');
  document.querySelectorAll('.hidden-coord-rota').forEach(el => el.value = '');

  if (!ufSelecionada) {
     leafletMapInstance.setView([-20.0, -48.0], 5);
     return;
  }

  const registrosRef = (typeof baseRegistrosMensais !== 'undefined' && Array.isArray(baseRegistrosMensais)) ? baseRegistrosMensais : [];
  const mapaPostosConsolidado = {};
  
  registrosRef.forEach(d => {
    if((d.UF_POSTO || '').trim().toUpperCase() !== ufSelecionada) return;

    const nome = (d.POSTO || '').trim();
    const mun = (d.MUNICIPIO_POSTO || '').trim().toUpperCase();
    const uf = (d.UF_POSTO || '').trim().toUpperCase();
    const chave = `${nome}__${mun}__${uf}`;

    const preco = parseFloat(d.VALOR_UNITARIO || d.ULTIMO_PRECO_MES || d.PRECO_MEDIO_MES || 0);
    const dataReg = d.DATA_FIM_CICLO || d.ULTIMA_DATA_MES || d.MES_ANO || "";
    const volumeAtual = parseFloat(d.VOLUME_CICLO || d.LITROS_MES || 0);

    if (!mapaPostosConsolidado[chave]) {
      mapaPostosConsolidado[chave] = {
        posto: d.POSTO, municipio: mun, uf: uf, preco: preco,
        tipo: d.TIPO_OPERACAO, data: dataReg, volumeTotal: volumeAtual
      };
    } else {
      mapaPostosConsolidado[chave].volumeTotal += volumeAtual;
      if (dataReg && dataReg > mapaPostosConsolidado[chave].data) {
        mapaPostosConsolidado[chave].data = dataReg;
        mapaPostosConsolidado[chave].preco = preco;
      }
    }
  });

  const postos = Object.values(mapaPostosConsolidado);
  
  // Aplica o cruzamento das tratativas para sobrepor preço/data
  aplicarTratativasNosPostos(postos);

  if (postos.length === 0) {
    alert("Nenhum posto encontrado para a UF selecionada neste período.");
    return;
  }

  const bounds = L.latLngBounds();

  for (const p of postos) {
    if (!p.municipio || p.municipio === 'ND') continue;
    const coords = await obterCoordenadasNominatim(p.municipio, p.uf);
    if (!coords) continue;

    const isDesatualizado = verificarSePrecoDesatualizado(p.data);
    let corPin = "#94a3b8";
    let statusTexto = "";

    if (isDesatualizado) {
      corPin = "#475569";
      statusTexto = "POSTO DESATUALIZADO";
    } else {
      corPin = p.preco < 6.40 ? "#16a34a" : (p.preco < 6.75 ? "#eab308" : "#dc2626");
      statusTexto = p.preco < 6.40 ? "Recomendado (Melhor Preço)" : (p.preco < 6.75 ? "Preço Aceitável" : "Alerta de Preço Alto");
    }

    let raioDinamico = 6;
    if (p.volumeTotal > 50000) raioDinamico = 13;
    else if (p.volumeTotal > 15000) raioDinamico = 9;

    const marker = L.circleMarker([coords.lat, coords.lon], {
      radius: raioDinamico, fillColor: corPin, color: "#ffffff", weight: 2, opacity: 1, fillOpacity: 0.95
    }).addTo(leafletMapInstance);

    marker.bindPopup(`
      <strong style="color:#1c483a;">${p.posto}</strong><br>
      Cidade: ${p.municipio}/${p.uf}<br>
      Último Preço: <b>R$ ${p.preco.toLocaleString('pt-BR', {minimumFractionDigits: 3, maximumFractionDigits: 3})}</b> <span style="font-size:0.6rem; color:#64748b;">(${p.origemPreco})</span><br>
      Tipo: ${p.tipo}<br>
      Status: <b>${statusTexto}</b><br>
      ${isDesatualizado ? `<span class="small text-danger">Data do Preço: ${p.data || 'Indisponível'}</span><br>` : ''}
    `);

    markersPostosLeaflet.push(marker);
    bounds.extend([coords.lat, coords.lon]);
  }

  if (bounds.isValid()) {
     leafletMapInstance.fitBounds(bounds, { padding: [30, 30] });
  }
};

function imprimirRoteiroViagem() {
  if (postosSugeridosUltimaRota.length === 0) {
    alert("Trace uma rota primeiro para mapear os postos antes de imprimir.");
    return;
  }

  const container = document.getElementById('conteudoRoteiroImpresso');
  const area = document.getElementById('areaImpressaoRoteiro');
  if (!container || !area) return;

  let htmlTabela = `
    <table class="table table-sm table-bordered mt-2 small">
      <thead class="table-dark">
        <tr>
          <th>Posto / Bandeira</th>
          <th>Cidade / UF</th>
          <th>Preço Base Registrado</th>
          <th>Desvio da Rota</th>
          <th>Operação</th>
        </tr>
      </thead>
      <tbody>
  `;

  postosSugeridosUltimaRota.forEach(p => {
    const alertaPreco = p.desatualizado ? `<br><span style="color:#dc2626; font-size:0.7em;">(Preço Desatualizado)</span>` : '';
    htmlTabela += `
      <tr>
        <td><b>${p.posto}</b></td>
        <td>${p.cidade}</td>
        <td class="text-success fw-bold">R$ ${p.preco.toLocaleString('pt-BR', {minimumFractionDigits: 3, maximumFractionDigits: 3})} <span style="font-size:0.8em; color:#6c757d;">(${p.origemPreco})</span>${alertaPreco}</td>
        <td>${p.distancia} km</td>
        <td>${p.tipo}</td>
      </tr>
    `;
  });

  htmlTabela += `</tbody></table>`;
  container.innerHTML = htmlTabela;
  area.style.display = "block";
  window.print();
}
