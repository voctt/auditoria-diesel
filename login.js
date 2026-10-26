/* ==========================================================================
   LÓGICA E INJEÇÃO VISUAL DO LOGIN - VOCTT FUEL INTELLIGENCE
   ========================================================================== */

const FIREBASE_API_KEY = "AIzaSyDT2fbjOk1TvkzJhiw_Wm5Xf9sIO1WH-PA";
let utilizadorAutenticado = null;

(function () {
  // 1. Injeta o ecrã de bloqueio e o formulário de acesso no documento
  const telaLoginHtml = `
    <div id="telaBloqueioLogin">
      <div class="card-login-voctt text-center">
        <img src="logo_voctt.png" alt="VOCTT" class="brand-logo-central">
        
        <div class="login-subtitulo-marca">Fuel Intelligence Suite</div>

        <div id="msgErroLogin"></div>

        <form id="formAcessoVoctt" onsubmit="executarLoginFirebase(event)">
          <div class="form-floating-custom">
            <label for="campoEmailVoctt">E-mail Corporativo</label>
            <input type="email" id="campoEmailVoctt" class="input-login-voctt" placeholder="seu.email@empresa.com.br" required autocomplete="username">
          </div>

          <div class="form-floating-custom">
            <label for="campoSenhaVoctt">Chave de Acesso / Senha</label>
            <input type="password" id="campoSenhaVoctt" class="input-login-voctt" placeholder="••••••••••••" required autocomplete="current-password">
          </div>

          <button type="submit" id="btnSubmeterLogin" class="btn-login-entrar">
            <span id="txtBtnLogin"><i class="bi bi-shield-lock me-1"></i> Acessar Ambiente</span>
            <span id="spinnerBtnLogin" class="spinner-border spinner-border-sm ms-1" style="display: none;" role="status"></span>
          </button>
        </form>

        <div class="login-rodape-privacidade">
          <i class="bi bi-lock-fill me-1"></i> Plataforma Exclusiva &bull; Ambiente Seguro Auditado<br>
          VOCTT Inteligência & Consultoria de Frotas &copy; 2026
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('afterbegin', telaLoginHtml);

  // Garante que o painel principal fica invisível antes da autenticação
  const containerDashboard = document.querySelector('.container-fluid');
  if (containerDashboard) {
    containerDashboard.style.display = 'none';
  }
})();

// 2. Validação direta através do endpoint REST do Firebase Authentication
async function executarLoginFirebase(event) {
  event.preventDefault();

  const email = document.getElementById('campoEmailVoctt').value.trim();
  const password = document.getElementById('campoSenhaVoctt').value.trim();
  const boxErro = document.getElementById('msgErroLogin');
  const btn = document.getElementById('btnSubmeterLogin');
  const txtBtn = document.getElementById('txtBtnLogin');
  const spinnerBtn = document.getElementById('spinnerBtnLogin');

  boxErro.style.display = 'none';
  btn.disabled = true;
  txtBtn.innerText = "Autenticando...";
  spinnerBtn.style.display = 'inline-block';

  try {
    const urlAuth = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
    const response = await fetch(urlAuth, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email,
        password: password,
        returnSecureToken: true
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const codigoErro = data.error?.message || "ERRO_DESCONHECIDO";
      let mensagemAmigavel = "Erro ao validar credenciais. Tente novamente.";

      if (codigoErro.includes("EMAIL_NOT_FOUND") || codigoErro.includes("INVALID_LOGIN_CREDENTIALS") || codigoErro.includes("INVALID_PASSWORD")) {
        mensagemAmigavel = "E-mail corporativo ou senha incorretos.";
      } else if (codigoErro.includes("USER_DISABLED")) {
        mensagemAmigavel = "Acesso temporariamente bloqueado pela administração.";
      } else if (codigoErro.includes("TOO_MANY_ATTEMPTS_TRY_LATER")) {
        mensagemAmigavel = "Muitas tentativas sem sucesso. Aguarde alguns instantes.";
      }

      throw new Error(mensagemAmigavel);
    }

    // Guarda os dados da sessão autenticada
    utilizadorAutenticado = {
      email: data.email,
      idToken: data.idToken,
      localId: data.localId
    };

    // Remove o ecrã de login e exibe o dashboard com os dados sincronizados
    liberarAcessoDashboard();

  } catch (err) {
    boxErro.innerText = err.message;
    boxErro.style.display = 'block';
  } finally {
    btn.disabled = false;
    txtBtn.innerHTML = `<i class="bi bi-shield-lock me-1"></i> Acessar Ambiente`;
    spinnerBtn.style.display = 'none';
  }
}

function liberarAcessoDashboard() {
  const tela = document.getElementById('telaBloqueioLogin');
  const containerDashboard = document.querySelector('.container-fluid');

  if (tela) {
    tela.style.opacity = '0';
    setTimeout(() => {
      tela.remove();
      if (containerDashboard) {
        containerDashboard.style.display = 'block';
      }
      // Inicializa o carregamento dos abastecimentos do KMM e ANP
      if (typeof carregarDados === 'function') {
        carregarDados();
      }
    }, 400);
  }
}
