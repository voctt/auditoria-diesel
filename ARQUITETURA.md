# Arquitetura do projeto

Inventário compacto dos módulos da raiz; descrições baseadas nos cabeçalhos dos arquivos.

## `atualizar_anp.py`
Fontes oficiais ANP; extrai preços de revenda/distribuição e consolida a referência nacional para o Firestore.
- Assinaturas: `inicializar_firebase()`; `extrair_revenda_estados()`; `extrair_distribuicao_estados()`; `extrair_referencia_anp_brasil()`; `executar_atualizacao()`.
- Dados/serviços: planilhas XLSX oficiais ANP; Firestore `anp_consolidada/mensal_{ANO_REFERENCIA}`.

## `auditoria.js`
Controla auditoria de abastecimentos, savings, spread vs. ANP, filtros, ordenação e detalhamento KMM.
- Assinaturas: `formatarDataCompactaDMA(strIso)`; `ordenarTabelaAuditoriaPor(coluna)`; `alternarGavetaMicro(id)`; `filtrarTabelaAuditoriaTexto()`; `atualizarCardsAuditoriaKPIs(aderenciaPerc, savingTotal, desviosQtd, margemPreservadaQtd, listaInfratores)`; `gerarParecerExecutivoPosto(p)`; `renderizarAbaAuditoriaComercial()`; `atualizarIconesOrdenacaoCabecalho()`.
- IDs/classes: `corpoTabelaAuditoria`, `filtroAuditoriaRede`, `filtroAuditoriaUf`, `filtroAuditoriaStatus`, `buscaAuditoriaTexto`, `lblAuditoriaContador`, `kpiAuditoria*`, `.tabela-auditoria`, `.linha-detalhe-gaveta`.

## `cidades.js`
Base expandida de cidades e polos rodoviários/logísticos do Brasil; catálogo de coordenadas geográficas para mapa e rotas.
- Dados: `baseCidadesBrasil` (nome, latitude e longitude por cidade/UF).

## `fechamento.js`
Controla dossiê executivo mensal, relatórios gerenciais, consolidação KMM/ANP, pareceres e sincronização Firestore.
- Assinaturas: `obterReferenciaAnpFechamento(registro, mes)`; `obterFichaTratativaAteData(tratativa, dataLimite)`; `obterDataFimCompetencia(mes)`; `renderizarAbaFechamentoExecutivo()`; `renderizarConteudoFechamentoExecutivo()`; `renderizarPareceresGestor()`; `abrirModalParecer()`; `adicionarIndicadorParecer()`; `removerIndicadorParecer(botao)`; `salvarParecerGestor(event)`; `renderizarLinhasTabelaFechamento(linhas)`; `renderizarLinhasMatrizesFechamento(linhas)`; `renderizarCardsVitrineTatica(acoes)`; `renderizarGraficoEvolucaoSavings()`.
- IDs/classes/endpoints: `secaoFechamentoExecutivo`, `seletorMesFechamento`, `graficoEvolucaoSavings`, `modalParecerGestor`, `formParecerGestor`, `.card-exec-dark`, `.tabela-fechamento-dark`; Firestore `fechamentos_dossie/{mes}`.

## `index.html`
Interface principal SPA; layout mestre, navegação por módulos, bibliotecas externas e estrutura DOM dos painéis.
- Handlers: `carregarDados()`; `processarPainel()`; `alternarModoOperacao(modo)`.
- IDs: `filtroMesAno`, `btnModoGeral`, `btnModoInterno`, `btnModoExterno`, `btnModoRota`, `btnModoMatrizes`, `btnModoAuditoria`, `btnModoFechamento`, `gridKpisPrincipais`, `miniMapaBrasil`, `secaoPainelPrincipal`, `secaoRoteirizador`.
- Classes/libs: `.container-fluid`, `.btn-toggle-tipo`; Bootstrap, ApexCharts, Leaflet e Leaflet Routing Machine.

## `login.css`
Controla os estilos da tela de bloqueio, modal de login, inputs e animações do portal de autenticação.
- Seletores: `#telaBloqueioLogin`, `.card-login-voctt`, `.brand-logo-central`, `.form-floating-custom`, `.input-login-voctt`, `.btn-login-entrar`, `#msgErroLogin`.

## `login.js`
Controla autenticação Firebase, validação de sessão, injeção do formulário e proteção das telas.
- Assinaturas: `executarLoginFirebase(event)`; `liberarAcessoDashboard()`.
- IDs/classes/endpoints: `telaBloqueioLogin`, `formAcessoVoctt`, `campoEmailVoctt`, `campoSenhaVoctt`, `btnSubmeterLogin`, `msgErroLogin`, `.container-fluid`; Firebase Auth `identitytoolkit.googleapis.com/v1/accounts:signInWithPassword`.

## `mapa.js`
Controla mapa Leaflet, malha dos estados, geolocalização de postos e roteirização logística.
- Assinaturas: `normalizarTextoComparacao(txt)`; `extrairSiglaUf(props)`; `inicializarMiniMapaBrasil()`; `calcularFaixasConcentracao(min, max)`; `gerarConteudoTooltipUf(uf)`; `atualizarCoresMiniMapa()`; `calcularDistanciaKm(lat1, lon1, lat2, lon2)`; `obterReferenciaAnpPorUf(uf, dataString, tipoOperacao)`; `obterCoordenadasNominatim(municipio, uf)`; `inicializarMapaLeaflet()`; `calcularRotaLeaflet()`; `limparRoteirizador()`.
- IDs/classes/endpoints: `miniMapaBrasil`, `legendaConcentracao`, `mapLeaflet`, `containerPontosRota`, `filtroMapaLivreUf`, `.input-cidade-rota`, `.ponto-rota-item`; GeoJSON estadual, tiles OpenStreetMap, Nominatim e Leaflet Routing Machine.

## `matrizes.js`
Controla matrizes estratégicas de garagens/postos e médias ponderadas via integração ANP/KMM (Gaps and Islands).
- Assinaturas: `obterBaseAnpOficial()`; `alternarPainelAuditoria()`; `emitirRelatorioMatrizes()`; `gerarInsightsInteligentes(analiseExterna, analiseInterna, analiseSpread)`; `obterChaveInternaUnidade(registro)`; `obterPostoVilao(registros, chaveUnidade, mes, tipoOperacao, refAnp)`; `calcularMatrizesGerenciais(registros)`.
- IDs/endpoints: `painelChecagemBruta`, `btnToggleAuditoria`, `secaoMatrizesGerenciais`; Firestore REST `anp_consolidada/mensal_{ano}`.

## `painel.js`
Controla KPIs, consumo por frota/placa, gráficos de volume e integração KMM/ANP.
- Assinaturas: `obterAnoMaisRecenteBase(registros)`; `filtrarRegistrosYtd(registros)`; `obterDiasAteVencimentoTratativa(vigencia, hoje)`; `complementarPostosPrioritariosComTratativas(postosPrioritarios, listaPostos, obterTratativa, hoje)`; `classificarRedePosto(nomePosto)`; `buscarDadosAnpFirestore()`; `carregarDados()`; `popularFiltrosDinamicos()`; `alternarModoOperacao(modo)`; `processarPainel()`; `limparFiltroUf()`.
- IDs/classes/endpoints: `btnSincronizar`, `filtroMesAno`, `filtroUfSelect`, `filtroRede`, `filtroPosto`, `listaTermometroPostos`, `secaoPainelPrincipal`, `secaoAuditoriaComercial`, `secaoFechamentoExecutivo`; API KMM Worker e Firestore REST `anp_consolidada/mensal_{ano}`.

## `style.css`
Controla identidade visual global, tipografia, temas, cards executivos, tabelas, badges e componentes responsivos.
- Seletores: `:root`, `body`, `.header-bar`, `.cockpit-bar-mestre`, `.btn-toggle-tipo`, `.card-kpi`, `.panel-box`, `.tabela-sintetica`.

## `tratativas.js`
Controla cadastro, histórico Rolodex e negociações comerciais de preços por posto com persistência Firestore.
- Assinaturas: `gerarDocumentIdPosto(posto, uf)`; `carregarTodasTratativasFirestore()`; `obterTratativaPosto(posto, uf)`; `abrirModalTratativa(nomePosto, uf, municipio, precoMedio, refAnp, ultimoPago, tipoOperacao)`; `renderizarLequeRolodex()`; `salvarTratativaFirestore(event)`; `calcularSpreadTempoReal()`; `alternarCamposDecisao()`.
- IDs/classes/endpoints: `modalTratativaComercial`, `formTratativaDiesel`, `campoTratativaStatus`, `campoTratativaVigencia`, `campoTratativaPrecoAcordado`, `campoPostoDestinoRealocacao`, `boxCalculoSpread`, `.painel-rolodex-container`, `.painel-cockpit-decisao`; Firestore REST `tratativas_diesel`.
