import io
import os
import json
from datetime import datetime
import requests
import pandas as pd
import firebase_admin
from firebase_admin import credentials, firestore

# ==============================================================================
# FONTES OFICIAIS ANP
# ==============================================================================
URL_REVENDA_ESTADOS = (
    "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/precos/"
    "precos-revenda-e-de-distribuicao-combustiveis/shlp/semanal/"
    "semanal-estados-desde-2013.xlsx"
)

URL_DISTRIBUICAO_ESTADOS = (
    "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/precos/"
    "pdc/semanal/combustiveis-liquidos-estados.xlsx"
)

URL_ANP_BRASIL = (
    "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/precos/"
    "precos-revenda-e-de-distribuicao-combustiveis/shlp/semanal/"
    "semanal-brasil-desde-2013.xlsx"
)
# Limita a carga ao ano corrente; o mesmo valor identifica o documento consumido pelo painel.
ANO_REFERENCIA = datetime.now().year

MAPA_ESTADOS = {
    "ACRE": "AC", "ALAGOAS": "AL", "AMAPA": "AP", "AMAZONAS": "AM", "BAHIA": "BA",
    "CEARA": "CE", "DISTRITO FEDERAL": "DF", "ESPIRITO SANTO": "ES", "GOIAS": "GO",
    "MARANHAO": "MA", "MATO GROSSO": "MT", "MATO GROSSO DO SUL": "MS", "MINAS GERAIS": "MG",
    "PARA": "PA", "PARAIBA": "PB", "PARANA": "PR", "PERNAMBUCO": "PE", "PIAUI": "PI",
    "RIO DE JANEIRO": "RJ", "RIO GRANDE DO NORTE": "RN", "RIO GRANDE DO SUL": "RS",
    "RONDONIA": "RO", "RORAIMA": "RR", "SANTA CATARINA": "SC", "SAO PAULO": "SP",
    "SERGIPE": "SE", "TOCANTINS": "TO"
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

def inicializar_firebase():
    if not firebase_admin._apps:
        secret_env = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
        if secret_env:
            cred_dict = json.loads(secret_env)
            cred = credentials.Certificate(cred_dict)
            firebase_admin.initialize_app(cred)
        elif os.path.exists("serviceAccountKey.json"):
            cred = credentials.Certificate("serviceAccountKey.json")
            firebase_admin.initialize_app(cred)
        else:
            firebase_admin.initialize_app()
    return firestore.client()

def extrair_revenda_estados():
    print("Descarregando Revenda Semanal por Estado...")
    resp = requests.get(URL_REVENDA_ESTADOS, headers=HEADERS, timeout=180)
    resp.raise_for_status()

    # Cabecalho da planilha de Revenda Estados esta na linha 18 (skiprows=17)
    df = pd.read_excel(io.BytesIO(resp.content), skiprows=17)
    df.columns = [str(c).strip().upper() for c in df.columns]

    col_prod = [c for c in df.columns if "PRODUTO" in c][0]
    col_data_fim = [c for c in df.columns if "DATA FINAL" in c][0]
    col_estado = [c for c in df.columns if "ESTADO" in c][0]
    col_preco = [c for c in df.columns if "PREÇO MÉDIO REVENDA" in c or "PRECO MEDIO REVENDA" in c][0]

    df_diesel = df[df[col_prod].astype(str).str.upper().str.contains("DIESEL S10")].copy()
    df_diesel["DATA FINAL"] = pd.to_datetime(df_diesel[col_data_fim], errors="coerce")
    df_diesel = df_diesel.dropna(subset=["DATA FINAL"])
    df_diesel["MES_ANO"] = df_diesel["DATA FINAL"].dt.strftime("%Y-%m")
    df_diesel = df_diesel[df_diesel["MES_ANO"].str.startswith(str(ANO_REFERENCIA))].copy()

    df_diesel["PRECO_NUM"] = pd.to_numeric(
        df_diesel[col_preco].astype(str).str.replace(",", "."),
        errors="coerce"
    )
    df_diesel = df_diesel.dropna(subset=["PRECO_NUM"])

    df_diesel["UF"] = df_diesel[col_estado].astype(str).str.strip().str.upper().map(MAPA_ESTADOS)
    df_diesel = df_diesel.dropna(subset=["UF"])

    resumo = df_diesel.groupby(["UF", "MES_ANO"])["PRECO_NUM"].mean().round(3).reset_index()

    resultado = {}
    for _, row in resumo.iterrows():
        uf = row["UF"]
        mes = row["MES_ANO"]
        preco = float(row["PRECO_NUM"])
        if uf not in resultado:
            resultado[uf] = {}
        resultado[uf][mes] = preco

    return resultado

def extrair_distribuicao_estados():
    print("Descarregando Distribuicao Semanal por Estado...")
    resp = requests.get(URL_DISTRIBUICAO_ESTADOS, headers=HEADERS, timeout=180)
    resp.raise_for_status()

    # Cabecalho da distribuicao na aba ESTADOS esta na linha 9 (skiprows=8)
    df = pd.read_excel(io.BytesIO(resp.content), sheet_name="ESTADOS", skiprows=8)
    df.columns = [str(c).strip().upper() for c in df.columns]

    col_prod = [c for c in df.columns if "PRODUTO" in c][0]
    col_data_fim = [c for c in df.columns if "DATA FINAL" in c][0]
    col_estado = [c for c in df.columns if "ESTADO" in c][0]
    col_preco = [c for c in df.columns if "PREÇO MÉDIO DISTRIBUIÇÃO" in c or "PRECO MEDIO DISTRIBUICAO" in c][0]

    df_diesel = df[df[col_prod].astype(str).str.upper().str.contains("DIESEL B S10")].copy()
    df_diesel["DATA FINAL"] = pd.to_datetime(df_diesel[col_data_fim], errors="coerce")
    df_diesel = df_diesel.dropna(subset=["DATA FINAL"])
    df_diesel["MES_ANO"] = df_diesel["DATA FINAL"].dt.strftime("%Y-%m")
    df_diesel = df_diesel[df_diesel["MES_ANO"].str.startswith(str(ANO_REFERENCIA))].copy()

    df_diesel["PRECO_NUM"] = pd.to_numeric(
        df_diesel[col_preco].astype(str).str.replace(",", "."),
        errors="coerce"
    )
    df_diesel = df_diesel.dropna(subset=["PRECO_NUM"])

    df_diesel["UF"] = df_diesel[col_estado].astype(str).str.strip().str.upper().map(MAPA_ESTADOS)
    df_diesel = df_diesel.dropna(subset=["UF"])

    resumo = df_diesel.groupby(["UF", "MES_ANO"])["PRECO_NUM"].mean().round(3).reset_index()

    resultado = {}
    for _, row in resumo.iterrows():
        uf = row["UF"]
        mes = row["MES_ANO"]
        preco = float(row["PRECO_NUM"])
        if uf not in resultado:
            resultado[uf] = {}
        resultado[uf][mes] = preco

    return resultado

def extrair_referencia_anp_brasil():
    print("Descarregando Media Brasil (ANTT)...")
    resp = requests.get(URL_ANP_BRASIL, headers=HEADERS, timeout=180)
    resp.raise_for_status()

    # Cabecalho da serie Brasil esta na linha 18 (skiprows=17)
    df = pd.read_excel(io.BytesIO(resp.content), skiprows=17)
    df.columns = [str(c).strip().upper() for c in df.columns]

    col_prod = [c for c in df.columns if "PRODUTO" in c][0]
    col_data_fim = [c for c in df.columns if "DATA FINAL" in c][0]
    col_preco = [c for c in df.columns if "PREÇO MÉDIO REVENDA" in c or "PRECO MEDIO REVENDA" in c][0]

    df_diesel = df[df[col_prod].astype(str).str.upper().str.contains("DIESEL S10")].copy()
    df_diesel["DATA FINAL"] = pd.to_datetime(df_diesel[col_data_fim], errors="coerce")
    df_diesel = df_diesel.dropna(subset=["DATA FINAL"])

    df_diesel["PRECO_NUM"] = pd.to_numeric(
        df_diesel[col_preco].astype(str).str.replace(",", "."),
        errors="coerce"
    )
    df_diesel = df_diesel.dropna(subset=["PRECO_NUM"])
    df_diesel = df_diesel.sort_values(by="DATA FINAL", ascending=False)

    if not df_diesel.empty:
        ultima_linha = df_diesel.iloc[0]
        data_formatada = ultima_linha["DATA FINAL"].strftime("%d/%m/%Y")
        preco_brasil = float(round(ultima_linha["PRECO_NUM"], 3))
        return {
            "valor": preco_brasil,
            "periodo": f"Semana ate {data_formatada}"
        }
    return None

def executar_atualizacao():
    dados_revenda = extrair_revenda_estados()
    dados_distribuicao = extrair_distribuicao_estados()
    dados_anp_brasil = extrair_referencia_anp_brasil()

    db = inicializar_firebase()
    doc_ref = db.collection("anp_consolidada").document(f"mensal_{ANO_REFERENCIA}")

    carga = {
        "revenda": dados_revenda,
        "distribuicao": dados_distribuicao,
        "atualizado_em": firestore.SERVER_TIMESTAMP
    }

    if dados_anp_brasil:
        carga["referencia_anp_brasil"] = dados_anp_brasil

    print("Gravando documento consolidado no Firestore...")
    doc_ref.set(carga, merge=True)
    print("Processamento concluido com sucesso!")

if __name__ == "__main__":
    executar_atualizacao()
