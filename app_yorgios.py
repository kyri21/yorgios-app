import time
import streamlit as st
import json
import locale
import textwrap
import re
from datetime import date, datetime, timedelta
import pandas as pd
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from gspread.exceptions import SpreadsheetNotFound, WorksheetNotFound
import pytz
from io import BytesIO
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import landscape, A4
from reportlab.lib.units import cm
import urllib.parse
import unicodedata
import requests  # API HTTP Drive (txt + upload photo)

# ———————————————————————————————
# FONCTIONS UTILITAIRES GÉNÉRALES
# ———————————————————————————————
def normalize_text_no_accents(s: str) -> str:
    if not isinstance(s, str):
        s = str(s or "")
    s = s.strip().lower()
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return s

def normalize_col(c: str) -> str:
    nfkd = unicodedata.normalize("NFKD", c)
    return (
        nfkd.encode("ascii", "ignore")
        .decode()
        .strip()
        .lower()
        .replace(" ", "_")
    )

# ———————————————————————————————
# FONCTION DE GÉNÉRATION DU PDF Contrôle Hygiène (pagination auto)
# ———————————————————————————————
def generate_controle_hygiene_pdf(temp_df, hygiene_df, vitrine_df, date_debut, date_fin):
    pdf_path = "/tmp/controle_hygiene.pdf"
    c = canvas.Canvas(pdf_path, pagesize=landscape(A4))
    width, height = landscape(A4)

    def draw_title():
        c.setFont("Helvetica-Bold", 14)
        c.drawCentredString(width/2, height-1.5*cm, "Export Contrôle Hygiène Yorgios")
        c.setFont("Helvetica", 10)
        c.drawCentredString(
            width/2,
            height-2.2*cm,
            f"Période : {date_debut.strftime('%d/%m/%Y')} au {date_fin.strftime('%d/%m/%Y')}"
        )

    def draw_chunked_table(title, df):
        if df.empty:
            return
        chunk_size = 20
        for start in range(0, len(df), chunk_size):
            chunk = df.iloc[start : start + chunk_size]
            y = height - 3.5 * cm
            draw_title()
            c.setFont("Helvetica-Bold", 11)
            suffix = "" if start == 0 else " (suite)"
            c.drawString(2*cm, y, title + suffix)
            y -= 0.5*cm
            c.setFont("Helvetica", 8)
            for i, col in enumerate(chunk.columns[:6]):
                c.drawString((i+1)*3*cm, y, str(col)[:15])
            y -= 0.4*cm
            for row in chunk.values:
                for i, val in enumerate(row[:6]):
                    c.drawString((i+1)*3*cm, y, str(val)[:15])
                y -= 0.35*cm
            c.showPage()

    draw_chunked_table("🌡️ Températures relevées", temp_df)
    draw_chunked_table("🧼 Relevés Hygiène", hygiene_df)
    draw_chunked_table("🖥️ Articles en Vitrine", vitrine_df)

    c.save()
    return pdf_path

# Flag d'activation de l'auth (piloté par les secrets)
AUTH_ENABLED = str(st.secrets.get("AUTH_ENABLED", "true")).strip().lower() in ("true", "1", "yes", "on")

# 🔐 ———————————————————————————————————————————
# Auth simple par mot de passe (stocké dans st.secrets["APP_PASSWORD"])
# ——————————————————————————————————————————————
def require_auth():
    """
    Si AUTH_ENABLED = false dans les secrets → pas de mot de passe.
    Si AUTH_ENABLED = true               → écran de login classique.
    """
    if not AUTH_ENABLED:
        return

    expected_pwd = st.secrets.get("APP_PASSWORD", "christelle").strip()

    if not expected_pwd:
        st.title("🔐 Accès restreint")
        st.error(
            "Mot de passe non configuré.\n"
            "Ajoutez APP_PASSWORD dans vos secrets (Streamlit Cloud > Settings > Secrets)."
        )
        st.stop()

    if st.session_state.get("auth_ok", False):
        with st.sidebar:
            st.caption("🔒 Accès privé")
            if st.button("Se déconnecter"):
                for k in list(st.session_state.keys()):
                    del st.session_state[k]
                st.rerun()
        return

    st.title("🔐 Accès réservé")
    pwd = st.text_input("Mot de passe", type="password", placeholder="Entrez le mot de passe")

    colA, colB = st.columns([1, 5])
    with colA:
        login = st.button("Se connecter", type="primary")

    if login or (pwd and "last_try_pwd" not in st.session_state):
        st.session_state["last_try_pwd"] = pwd
        if pwd == expected_pwd:
            st.session_state["auth_ok"] = True
            st.rerun()
        elif login:
            st.error("Mot de passe incorrect.")

    st.stop()

# ———————————————————————————————
# CONFIG STREAMLIT
# ———————————————————————————————
st.set_page_config(page_title="Yorgios V1", layout="wide")
try:
    locale.setlocale(locale.LC_TIME, 'fr_FR.UTF-8')
except locale.Error:
    pass

require_auth()

# ———————————————————————————————
# AUTHENTIFICATION GOOGLE SHEETS
# ———————————————————————————————
def gsheets_client():
    sa_info = json.loads(st.secrets["GOOGLE_SERVICE_ACCOUNT_JSON"])
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/drive.readonly"
    ]
    creds = ServiceAccountCredentials.from_json_keyfile_dict(sa_info, scopes)
    return gspread.authorize(creds)

gc = gsheets_client()

# ———————————————————————————————
# CACHES LECTURE SHEETS
# ———————————————————————————————
@st.cache_resource
def _open_by_key_cached(key: str):
    last_err = None
    for i in range(3):
        try:
            return gc.open_by_key(key)
        except Exception as e:
            last_err = e
            time.sleep(0.7 * (i + 1))
    raise last_err

@st.cache_data(ttl=60)
def ws_titles(key: str):
    sh = _open_by_key_cached(key)
    return [w.title for w in sh.worksheets()]

@st.cache_data(ttl=60)
def ws_values(key: str, title: str):
    sh = _open_by_key_cached(key)
    return sh.worksheet(title).get_all_values()

def ws_values_safe(key: str, title: str, retries: int = 3, base_delay: float = 0.7):
    for i in range(retries):
        try:
            return ws_values(key, title)
        except Exception:
            if i == retries - 1:
                raise
            time.sleep(base_delay * (i + 1))

# ———————————————————————————————
# RETRY POUR open_by_key
# ———————————————————————————————
def open_sheet_retry(client, key, retries=3, delay=2):
    for attempt in range(1, retries+1):
        try:
            return client.open_by_key(key)
        except Exception as e:
            if attempt < retries:
                time.sleep(delay)
            else:
                st.error(f"❌ Impossible de charger le sheet {key} après {retries} tentatives.\n{e}")
                st.stop()

# ———————————————————————————————
# TOKEN & LECTURE PROTOCOLES DRIVE
# ———————————————————————————————
def _get_sa_token(scopes=None):
    if scopes is None:
        scopes = ["https://www.googleapis.com/auth/drive.readonly"]
    sa_info = json.loads(st.secrets["GOOGLE_SERVICE_ACCOUNT_JSON"])
    creds = ServiceAccountCredentials.from_json_keyfile_dict(sa_info, scopes)
    return creds.get_access_token().access_token

def _drive_q_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")

def read_txt_from_drive(file_name, folder_id="14Pa-svM3uF9JQtjKysP0-awxK0BDi35E"):
    token = _get_sa_token()
    headers = {"Authorization": f"Bearer {token}"}

    name_q   = _drive_q_escape(str(file_name))
    folder_q = _drive_q_escape(str(folder_id))
    q = "name = '{name}' and '{folder}' in parents and trashed = false".format(
        name=name_q, folder=folder_q
    )
    params = {"q": q, "fields": "files(id, mimeType)", "pageSize": 1}

    resp = requests.get(
        "https://www.googleapis.com/drive/v3/files",
        headers=headers,
        params=params,
        timeout=30
    )
    if resp.status_code != 200:
        return None

    items = resp.json().get("files", [])
    if not items:
        return None

    file_id = items[0]["id"]
    mime    = items[0]["mimeType"]

    if mime == "text/plain":
        r = requests.get(
            f"https://www.googleapis.com/drive/v3/files/{file_id}",
            headers=headers,
            params={"alt": "media"},
            timeout=60
        )
    else:
        r = requests.get(
            f"https://www.googleapis.com/drive/v3/files/{file_id}/export",
            headers=headers,
            params={"mimeType": "text/plain"},
            timeout=60
        )

    if r.status_code != 200:
        return None

    return r.content.decode("utf-8", errors="replace")

def upload_livraison_photo(uploaded_file, produit: str, horodatage):
    """
    Téléverse une photo de réception dans le dossier Drive dédié.
    Retourne un lien partageable.
    """
    if uploaded_file is None:
        return ""
    if not LIVRAISON_PHOTO_FOLDER_ID:
        st.warning("Dossier Drive pour les photos de livraison non configuré (LIVRAISON_PHOTO_FOLDER_ID).")
        return ""
    try:
        token = _get_sa_token(scopes=["https://www.googleapis.com/auth/drive"])
        headers = {"Authorization": f"Bearer {token}"}

        if isinstance(horodatage, datetime):
            ts = horodatage.strftime("%Y%m%d-%H%M%S")
        else:
            ts = datetime.now().strftime("%Y%m%d-%H%M%S")

        base_name = f"{produit}-{ts}".strip().replace(" ", "_")
        base_name = re.sub(r"[^A-Za-z0-9._-]", "_", base_name)

        mime_type = getattr(uploaded_file, "type", None) or "image/jpeg"
        metadata = {
            "name": base_name,
            "parents": [LIVRAISON_PHOTO_FOLDER_ID],
        }
        files = {
            "metadata": ("metadata", json.dumps(metadata), "application/json; charset=UTF-8"),
            "file": (base_name, uploaded_file.getvalue(), mime_type),
        }

        resp = requests.post(
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
            headers=headers,
            files=files,
            timeout=60,
        )
        if resp.status_code not in (200, 201):
            st.warning(f"Échec de l’upload de la photo pour {produit} ({resp.status_code}).")
            return ""

        file_id = resp.json().get("id")
        if not file_id:
            return ""
        return f"https://drive.google.com/file/d/{file_id}/view?usp=drivesdk"
    except Exception as e:
        st.warning(f"Impossible de téléverser la photo pour {produit} : {e}")
        return ""

# ———————————————————————————————
# IDS Google Sheets & CHARGEMENT
# ———————————————————————————————
SHEET_COMMANDES_ID = "1cBP7iEeWK5whbHzoZAWUhq_HQ5OcAEjTBkUro2cmkoc"
SHEET_HYGIENE_ID   = "1phiQjSYqvHdVEqv7uAt8pitRE0NfKv4b1f4UUzUqbXQ"
SHEET_TEMP_ID      = "1e4hS6iawCa1IizhzY3xhskLy8Gj3todP3zzk38s7aq0"
SHEET_PLANNING_ID  = "1OBYGNHtHdDB2jufKKjoAwq6RiiS_pnz4ta63sAM-t_0"
SHEET_PRODUITS_ID  = "1FbRV4KgXyCwqwLqJkyq8cHZbo_BfB7kyyPP3pO53Snk"
SHEET_RESP_ID      = "1nWEel6nizI0LKC84uaBDyqTNg1hzwPSVdZw41YJaBV8"

LIVRAISON_PHOTO_FOLDER_ID = st.secrets.get(
    "LIVRAISON_PHOTO_FOLDER_ID",
    "1EF9JPKr8XV4XDlHm_rFhpbYofDkBvv5V"
).strip()

ss_cmd        = open_sheet_retry(gc, SHEET_COMMANDES_ID)
sheet_haccp   = ss_cmd.worksheet("Suivi HACCP")
sheet_vitrine = ss_cmd.worksheet("Vitrine")

ss_hygiene  = open_sheet_retry(gc, SHEET_HYGIENE_ID)
ss_temp     = open_sheet_retry(gc, SHEET_TEMP_ID)
ss_planning = open_sheet_retry(gc, SHEET_PLANNING_ID)
ss_produits = open_sheet_retry(gc, SHEET_PRODUITS_ID)
sheet_prod  = ss_produits.worksheet("Produits")
ss_resp     = open_sheet_retry(gc, SHEET_RESP_ID)

# ———————————————————————————————
# UTILITAIRES STOCKAGE FRIGO
# ———————————————————————————————
def load_df(sh, ws_name):
    return pd.DataFrame(sh.worksheet(ws_name).get_all_records())

def save_df(sh, ws_name, df: pd.DataFrame):
    df = df[["frigo", "article", "quantite", "dlc"]].copy()
    df["dlc"] = pd.to_datetime(df["dlc"], errors="coerce") \
                  .dt.strftime("%Y-%m-%d") \
                  .fillna("")
    df = df.fillna("").astype(str)
    ws = sh.worksheet(ws_name)
    ws.clear()
    ws.update([df.columns.tolist()] + df.values.tolist())

# === Objectifs CA ===
@st.cache_data(ttl=600)
def load_objectifs_df():
    try:
        try:
            ws = ss_cmd.worksheet("objectifs")
        except WorksheetNotFound:
            ws = ss_cmd.worksheet("Objectifs")
    except WorksheetNotFound:
        return pd.DataFrame()

    values = ws.get_all_values()
    if not values or len(values) < 2:
        return pd.DataFrame()

    header = values[0]
    rows   = values[1:]
    df = pd.DataFrame(rows, columns=header)
    return df

# ———————————————————————————————
# PRODUITS + DÉNOMINATION GEP
# ———————————————————————————————
def _norm_gep_key(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii")
    return s.strip().lower()

try:
    produits_records = sheet_prod.get_all_records()
    df_produits = pd.DataFrame(produits_records)
except Exception:
    df_produits = pd.DataFrame()

if not df_produits.empty:
    cols_norm = {normalize_col(c): c for c in df_produits.columns}

    col_nom = None
    for key in ("produit", "nom_produit", "produit_yorgios"):
        if key in cols_norm:
            col_nom = cols_norm[key]
            break

    col_gep = None
    for key in ("denomination_gep", "denomination_gep_", "gep", "categorie_gep"):
        if key in cols_norm:
            col_gep = cols_norm[key]
            break

    if col_nom:
        df_produits["__nom__"] = df_produits[col_nom].astype(str).str.strip()
    else:
        df_produits["__nom__"] = ""

    if col_gep:
        df_produits["__gep__"] = df_produits[col_gep].astype(str).str.strip()
    else:
        df_produits["__gep__"] = ""
else:
    df_produits = pd.DataFrame(columns=["__nom__", "__gep__"])

PROD_GEP_MAPPING = {
    row["__nom__"]: row["__gep__"]
    for _, row in df_produits.iterrows()
    if str(row.get("__nom__", "")).strip() and str(row.get("__gep__", "")).strip()
}

produits_gep_list = sorted(PROD_GEP_MAPPING.keys())

try:
    produits_list = sorted(set(p.strip() for p in sheet_prod.col_values(1) if p.strip()))
except Exception:
    produits_list = sorted(PROD_GEP_MAPPING.keys())

livraison_produits_list = produits_gep_list if produits_gep_list else produits_list

GEP_RULES = {
    "viande hachee":       {"min": 0.0, "max": 2.0, "max_tol": 3.0},
    "viande":              {"min": 0.0, "max": 3.0, "max_tol": 5.0},
    "lait":                {"min": 0.0, "max": 4.0, "max_tol": 6.0},
    "plat cuisine":        {"min": 0.0, "max": 3.0, "max_tol": 5.0},
    "plat cuisine frais":  {"min": 0.0, "max": 3.0, "max_tol": 5.0},
    "patisserie":          {"min": 0.0, "max": 3.0, "max_tol": 5.0},
    "patisserie fraiche":  {"min": 0.0, "max": 3.0, "max_tol": 5.0},
    "legume":              {"min": 0.0, "max": 8.0, "max_tol": 10.0},
    "legumes":             {"min": 0.0, "max": 8.0, "max_tol": 10.0},
    "poisson":             {"min": 0.0, "max": 2.0, "max_tol": 3.0},
}

def get_gep_rule(denom_gep: str):
    key = _norm_gep_key(denom_gep)
    return GEP_RULES.get(key)

def parse_temp_to_float(temp_str: str):
    if not isinstance(temp_str, str):
        temp_str = str(temp_str or "")
    temp_str = temp_str.replace(" ", "").replace(",", ".")
    try:
        return float(temp_str)
    except ValueError:
        return None

def compute_reception_result(temp_recep_txt: str, denomination_gep: str) -> str:
    t = parse_temp_to_float(temp_recep_txt)
    if t is None:
        return ""
    rule = get_gep_rule(denomination_gep)
    if not rule:
        return ""
    return "✅ Accepté" if t <= rule["max_tol"] else "❌ Refusé"

# ———————————————————————————————
# TEMPÉRATURES DE LIVRAISON (sheet)
# ———————————————————————————————
def get_livraison_temp_ws():
    headers_target = [
        "Produit",
        "Température départ (°C)",
        "Horodatage départ",
        "Température réception (°C)",
        "Dénomination GEP",
        "Résultat réception",
        "Lien photo",
    ]
    try:
        ws = ss_cmd.worksheet("Livraison Température")
    except WorksheetNotFound:
        ws = ss_cmd.add_worksheet("Livraison Température", rows=1000, cols=len(headers_target))
        ws.update("A1", [headers_target])
        return ws

    try:
        existing = ws.get_all_values()
        if not existing:
            ws.update("A1", [headers_target])
            return ws

        current_header = existing[0]
        if current_header != headers_target:
            new_header = headers_target
            new_values = [new_header]
            for row in existing[1:]:
                row = row + [""] * (len(new_header) - len(row))
                new_values.append(row[: len(new_header)])
            ws.clear()
            ws.update("A1", new_values)
    except Exception:
        pass

    return ws

@st.cache_data(ttl=300, show_spinner=False)
def load_livraison_temp_df():
    ws = get_livraison_temp_ws()
    values = ws.get_all_values()

    if not values:
        header = ws.row_values(1)
        if not header:
            header = [
                "Produit",
                "Température départ (°C)",
                "Horodatage départ",
                "Température réception (°C)",
                "Dénomination GEP",
                "Résultat réception",
                "Lien photo",
            ]
        return pd.DataFrame(columns=header)

    if len(values) == 1:
        header = values[0]
        return pd.DataFrame(columns=header)

    header = values[0]
    rows   = values[1:]
    df = pd.DataFrame(rows, columns=header)
    return df

# ———————————————————————————————
# VITRINE – OUTILS COMMUNS
# ———————————————————————————————
def vitrine_df_norm_active(raw=None):
    if raw is None:
        raw = sheet_vitrine.get_all_values()
    if not raw:
        return pd.DataFrame(), []
    header_raw = raw[0]
    cols = [normalize_col(c) for c in header_raw]
    df_raw = pd.DataFrame(raw[1:], columns=cols)
    if "date_retrait" not in df_raw.columns:
        df_raw["date_retrait"] = ""
    actifs = df_raw[df_raw["date_retrait"] == ""].copy()
    return actifs, cols

def df_dlc_alerts(raw=None):
    actifs, cols = vitrine_df_norm_active(raw)
    if actifs.empty:
        return pd.DataFrame(), pd.DataFrame()
    today_dt = pd.Timestamp(date.today())
    if "dlc" not in actifs.columns:
        return pd.DataFrame(), pd.DataFrame()
    dlc = pd.to_datetime(actifs["dlc"], errors="coerce")
    depassee = actifs[dlc < today_dt].copy()
    dujour   = actifs[dlc == today_dt].copy()
    drop_cols = [c for c in ["date_retrait"] if c in actifs.columns]
    base_cols = [c for c in actifs.columns if c not in drop_cols]
    return depassee[base_cols], dujour[base_cols]

def style_dlc_alert(df: pd.DataFrame):
    def styler(_):
        return ["background-color: #b71c1c; color: black;"] * len(df.columns)
    return df.style.apply(styler, axis=1)

# ———————————————————————————————
# DASHBOARD
# ———————————————————————————————
JOURS_FR = {
    "Monday":"Lundi","Tuesday":"Mardi","Wednesday":"Mercredi",
    "Thursday":"Jeudi","Friday":"Vendredi","Saturday":"Samedi","Sunday":"Dimanche"
}

def _compose_responsable_from_row(row, candidates=("responsable","nom","nom_1","nom1","nom_2","nom2")) -> str | None:
    names = []
    for c in candidates:
        if c in row.index:
            v = str(row[c]).strip()
            if v and v.lower() not in ("nan", "none"):
                names.append(v)
    if not names:
        return None
    unique = []
    for n in names:
        if n not in unique:
            unique.append(n)
    return " & ".join(unique)

def render_dashboard():
    st.header("🏠 Dashboard")
    today = date.today()
    iso_year, semaine_iso, _ = today.isocalendar()

    # Responsable de la semaine
    st.subheader("👤 Responsable de la semaine")
    resp_nom = "—"
    try:
        titles = ws_titles(SHEET_RESP_ID)
        raw = ws_values(SHEET_RESP_ID, titles[0]) if titles else []

        if len(raw) >= 2:
            cols_norm = [normalize_col(c) for c in raw[0]]
            df = pd.DataFrame(raw[1:], columns=cols_norm)

            if "date_debut" not in df.columns and "debut" in df.columns:
                df["date_debut"] = df["debut"]
            if "date_fin" not in df.columns and "fin" in df.columns:
                df["date_fin"] = df["fin"]

            if "semaine" in df.columns and resp_nom == "—":
                def _parse_week(v):
                    m = re.search(r"\d+", str(v))
                    return int(m.group()) if m else None
                df["semaine_num"] = df["semaine"].apply(_parse_week)
                row = df.loc[df["semaine_num"] == semaine_iso].head(1)
                if not row.empty:
                    who = _compose_responsable_from_row(
                        row.iloc[0],
                        candidates=("responsable","nom","nom_1","nom1","nom_2","nom2")
                    )
                    if who:
                        resp_nom = who

            if resp_nom == "—" and ("date_debut" in df.columns and "date_fin" in df.columns):
                ddeb = pd.to_datetime(df["date_debut"], errors="coerce", dayfirst=True)
                dfin = pd.to_datetime(df["date_fin"],   errors="coerce", dayfirst=True)
                if ddeb.isna().mean() > 0.5 or dfin.isna().mean() > 0.5:
                    ddeb = pd.to_datetime(df["date_debut"], errors="coerce")
                    dfin = pd.to_datetime(df["date_fin"],   errors="coerce")
                df = df.assign(date_debut=ddeb, date_fin=dfin)
                ts = pd.to_datetime(today)
                row = df[(df["date_debut"] <= ts) & (ts < df["date_fin"])].head(1)
                if row.empty:
                    row = df[(df["date_debut"] <= ts) & (ts <= df["date_fin"])].head(1)
                if not row.empty:
                    who = _compose_responsable_from_row(
                        row.iloc[0],
                        candidates=("nom","nom_1","nom1","nom_2","nom2","responsable")
                    )
                    if who:
                        resp_nom = who
    except Exception:
        pass

    if resp_nom == "—":
        try:
            titres = [w.title for w in ss_planning.worksheets() if w.title.lower().startswith("semaine")]
            titres.sort(key=lambda x: int(re.search(r"\d+", x).group()))
            target = f"Semaine {semaine_iso}"
            if target not in titres and titres:
                target = titres[-1]
            if titres:
                ws = ss_planning.worksheet(target)
                raw = ws.get_all_values()
                if len(raw) >= 2:
                    df_pl = pd.DataFrame(raw[1:], columns=raw[0]).replace("", None)
                    cols_lower = [c.lower() for c in df_pl.columns]
                    if "responsable" in cols_lower and not df_pl["Responsable"].dropna().empty:
                        resp_nom = str(df_pl["Responsable"].dropna().iloc[0])
                    elif "manager" in cols_lower and not df_pl["Manager"].dropna().empty:
                        resp_nom = str(df_pl["Manager"].dropna().iloc[0])
        except Exception:
            pass

    st.info(f"**Responsable semaine {semaine_iso} :** {resp_nom}")

    st.markdown("---")

    # Températures & Hygiène
    col_temp, col_hyg = st.columns(2)

    with col_temp:
        st.subheader("🌡️ Températures – Aujourd’hui")
        candidates = [f"Semaine {semaine_iso} {iso_year}", f"Semaine {semaine_iso}"]
        ws_title = None
        titres_all = ws_titles(SHEET_TEMP_ID)
        for cand in candidates:
            if cand in titres_all:
                ws_title = cand
                break
        if ws_title is None:
            semaines = [t for t in titres_all if t.lower().startswith("semaine")]
            if semaines:
                semaines.sort(key=lambda x: int(re.search(r"\d+", x).group()))
                ws_title = semaines[-1]

        if ws_title is None:
            st.warning("Feuille températures introuvable.")
        else:
            raw = ws_values(SHEET_TEMP_ID, ws_title)
            if len(raw) < 2:
                st.warning("Feuille vide.")
            else:
                header = [h.strip() for h in raw[0]]
                df = pd.DataFrame(raw[1:], columns=header)
                jour_fr = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"][today.weekday()]
                target_cols = [h for h in header if re.match(rf"^{jour_fr}\s+(Matin|Soir)$", h, flags=re.I)]
                if not target_cols:
                    st.warning("Colonnes du jour absentes dans cette feuille.")
                else:
                    missing_cols = []
                    for col in target_cols:
                        series = df[col].astype(str)
                        if (series.str.strip()=="").any():
                            missing_cols.append(col)
                    if not missing_cols:
                        st.success("OK – toutes les valeurs du jour sont saisies.")
                    else:
                        st.error("À faire – colonnes incomplètes : " + ", ".join(missing_cols))

    with col_hyg:
        st.subheader("🧼 Hygiène – Quotidien (Aujourd’hui)")
        try:
            raw = ws_values(SHEET_HYGIENE_ID, "Quotidien")
            if len(raw) < 2:
                st.warning("Feuille Quotidien vide.")
            else:
                dfh = pd.DataFrame(raw[1:], columns=raw[0])
                today_str = today.strftime("%Y-%m-%d")
                if "Date" not in dfh.columns:
                    st.warning("Colonne Date manquante.")
                else:
                    if today_str not in dfh["Date"].values:
                        st.error("À faire – aucune ligne pour aujourd’hui.")
                    else:
                        idx = int(dfh.index[dfh["Date"] == today_str][0])
                        cols = [c for c in dfh.columns if c != "Date"]
                        not_ok = [c for c in cols if str(dfh.at[idx, c]).strip() != "✅"]
                        if not not_ok:
                            st.success("OK – toutes les cases sont cochées.")
                        else:
                            st.error(f"À faire – {len(not_ok)} case(s) restante(s).")
                            with st.expander("Voir les cases manquantes"):
                                st.write(", ".join(not_ok))
        except Exception as e:
            st.warning(f"Impossible de lire l’onglet Hygiène Quotidien : {e}")

    st.markdown("---")

    st.subheader("⚠️ Alertes DLC – Vitrine")
    raw_vitrine = ws_values(SHEET_COMMANDES_ID, "Vitrine")
    depassee, dujour = df_dlc_alerts(raw_vitrine)
    cA, cB = st.columns(2)
    with cA:
        st.caption("DLC dépassées")
        if depassee.empty:
            st.success("RAS")
        else:
            st.dataframe(style_dlc_alert(depassee), use_container_width=True)
    with cB:
        st.caption("DLC du jour")
        if dujour.empty:
            st.success("RAS")
        else:
            st.dataframe(style_dlc_alert(dujour), use_container_width=True)

# ———————————————————————————————
# NAVIGATION
# ———————————————————————————————
onglets = [
    "🏠 Dashboard",
    "🌡️ Relevé des températures",
    "🚚 Température livraison",
    "🧼 Hygiène",
    "🧊 Stockage Frigo",
    "📋 Protocoles",
    "📊 Objectifs Chiffres d'affaires",
    "📅 Planning",
    "🖥️ Vitrine",
    "🛎️ Ruptures & Commandes",
    "🧾 Contrôle Hygiène",
    "🔗 Liens Google Sheets",
]
choix = st.sidebar.radio("Navigation", onglets)

# ———————————————————————————————
# ONGLET : Dashboard
# ———————————————————————————————
if choix == "🏠 Dashboard":
    render_dashboard()

# ———————————————————————————————
# ONGLET : Relevé des températures
# ———————————————————————————————
elif choix == "🌡️ Relevé des températures":
    st.header("🌡️ Relevé des températures")

    jour = st.date_input(
        "🗓️ Sélectionner la date",
        value=date.today(),
        key="rt_jour"
    )

    iso_year, iso_week, _ = jour.isocalendar()
    nom_ws = f"Semaine {iso_week} {iso_year}"
    try:
        ws = ss_temp.worksheet(nom_ws)
    except WorksheetNotFound:
        st.warning(f"⚠️ Feuille « {nom_ws} » introuvable.")
        if st.button("➕ Créer la semaine", key="rt_create"):
            model = ss_temp.worksheet("Semaine 38")
            ss_temp.duplicate_sheet(source_sheet_id=model.id, new_sheet_name=nom_ws)
        st.stop()

    raw       = ws.get_all_values()
    header    = [h.strip() for h in raw[0]]
    df_temp   = pd.DataFrame(raw[1:], columns=header)
    frigos    = df_temp.iloc[:, 0].tolist()

    moment = st.selectbox(
        "🕒 Moment du relevé",
        ["Matin", "Soir"],
        key="rt_moment"
    )

    with st.form("rt_form"):
        saisies = {
            f: st.text_input(f"Température {f}", key=f"rt_temp_{f}")
            for f in frigos
        }
        if st.form_submit_button("✅ Valider les relevés"):
            jours_fr = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"]
            cible    = f"{jours_fr[jour.weekday()]} {moment}".strip()

            header_lower = [h.lower() for h in header]
            if cible.lower() not in header_lower:
                st.error(
                    f"Colonne « {cible} » introuvable.\n"
                    f"Colonnes disponibles : {', '.join(header)}"
                )
            else:
                col_reelle = header[header_lower.index(cible.lower())]
                for i, f in enumerate(frigos):
                    df_temp.at[i, col_reelle] = saisies[f]
                ws.update("A1", [header] + df_temp.values.tolist())
                st.success("✅ Relevés sauvegardés.")

    disp = df_temp.replace("", "⛔️")
    st.subheader("📊 Aperçu complet")
    st.dataframe(
        disp.style.applymap(
            lambda v: "color:red;" if v == "⛔️" else "color:green;"
        ),
        use_container_width=True
    )

# ———————————————————————————————
# ONGLET : Température livraison cuisine → corner
# ———————————————————————————————
elif choix == "🚚 Température livraison":
    st.header("🚚 Température de livraison (cuisine → corner)")
    st.caption("Saisir les températures au départ (cuisine) ou à réception (corner), selon le poste.")

    mode_liv = st.radio(
        "Lieu d’utilisation",
        ["Cuisine – départ", "Corner – réception"],
        horizontal=True,
        key="liv_mode"
    )

    # ——————————— MODE CUISINE : UNIQUEMENT FORMULAIRE DE DÉPART, SANS GOOGLE SHEETS ———————————
    if mode_liv == "Cuisine – départ":
        st.subheader("Produits à contrôler au départ (cuisine)")
        st.caption(
            "Choisissez un produit dans la liste, saisissez la température de départ, "
            "cliquez sur « ➕ Ajouter ». Une fois tous les produits saisis, "
            "cliquez sur « ✅ Enregistrer les relevés de départ » pour envoyer vers Google Sheets."
        )

        if not livraison_produits_list:
            st.error("Impossible de charger la liste des produits Yorgios avec Dénomination GEP.")
        else:
            # Buffer local tant que rien n’est envoyé
            if "liv_depart_buffer" not in st.session_state:
                st.session_state["liv_depart_buffer"] = []

            col1, col2, col3 = st.columns([2, 1, 1])
            with col1:
                prod = st.selectbox(
                    "Produit",
                    options=[""] + livraison_produits_list,
                    key="liv_depart_prod"
                )
            with col2:
                # pas de key → pas d’erreur session_state, champ vidé à chaque rerun
                temp_dep = st.text_input(
                    "Température départ (°C)",
                    value="",
                    placeholder="ex : 3,8"
                )
            with col3:
                add_clicked = st.button("➕ Ajouter", key="liv_depart_add")

            if add_clicked:
                prod_clean = str(prod or "").strip()
                temp_str_raw = str(temp_dep or "").strip().replace(" ", "")
                dep_txt = temp_str_raw.replace(".", ",")

                if not prod_clean:
                    st.error("Choisissez un produit avant d’ajouter.")
                elif not temp_str_raw:
                    st.error("Saisissez la température de départ.")
                elif not re.match(r"^-?\d+(,\d+)?$", dep_txt):
                    st.error("Température de départ invalide. Exemple attendu : 3,8")
                else:
                    st.session_state["liv_depart_buffer"].append(
                        {
                            "Produit": prod_clean,
                            "Température départ (°C)": dep_txt,
                        }
                    )
                    st.success(f"Ligne ajoutée : {prod_clean} ({dep_txt}°C)")

            buffer = st.session_state["liv_depart_buffer"]

            if buffer:
                st.markdown("#### Lignes en attente d’enregistrement")
                df_buffer = pd.DataFrame(buffer)
                st.table(df_buffer)

                # Rappels GEP pour les produits déjà saisis
                produits_buf = sorted({entry["Produit"] for entry in buffer})
                with st.expander("ℹ️ Rappels GEP et seuils de températures pour les produits saisis"):
                    for p in produits_buf:
                        denom = PROD_GEP_MAPPING.get(p, "")
                        rule = get_gep_rule(denom) if denom else None
                        if denom and rule:
                            st.write(
                                f"- **{p}** → {denom} : "
                                f"{rule['min']}°C à {rule['max']}°C "
                                f"(max tolérée {rule['max_tol']}°C)"
                            )
                        elif denom:
                            st.write(f"- **{p}** → {denom}")
                        else:
                            st.write(f"- **{p}** : catégorie GEP non trouvée dans la liste produits.")

                if st.button("✅ Enregistrer les relevés de départ", key="liv_depart_save"):
                    try:
                        ws_lt = get_livraison_temp_ws()
                        headers = ws_lt.row_values(1)
                        horodatage = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

                        lignes = []
                        recap_rows = []
                        for entry in buffer:
                            prod_clean = entry["Produit"]
                            dep_txt = entry["Température départ (°C)"]

                            denom = PROD_GEP_MAPPING.get(prod_clean, "")
                            row_dict = {
                                "Produit": prod_clean,
                                "Température départ (°C)": dep_txt,
                                "Horodatage départ": horodatage,
                                "Dénomination GEP": denom,
                                "Température réception (°C)": "",
                                "Résultat réception": "",
                                "Lien photo": "",
                            }
                            lignes.append([str(row_dict.get(h, "")) for h in headers])

                            rule = get_gep_rule(denom) if denom else None
                            recap_rows.append(
                                {
                                    "Produit": prod_clean,
                                    "Dénomination GEP": denom or "(non trouvée)",
                                    "Température départ (°C)": dep_txt,
                                    "Plage cible (°C)": (
                                        f"{rule['min']} à {rule['max']} (tol. {rule['max_tol']})"
                                        if rule else "-"
                                    ),
                                }
                            )

                        if not lignes:
                            st.error("Aucune ligne à enregistrer. Ajoutez au moins un produit.")
                        else:
                            ws_lt.append_rows(lignes, value_input_option="USER_ENTERED")
                            load_livraison_temp_df.clear()
                            st.success(f"{len(lignes)} relevé(s) de départ enregistrés dans Google Sheets.")

                            if recap_rows:
                                st.markdown("#### Récapitulatif des catégories GEP et seuils")
                                st.dataframe(
                                    pd.DataFrame(recap_rows),
                                    use_container_width=True
                                )

                            # on vide le buffer une fois que tout est envoyé
                            st.session_state["liv_depart_buffer"] = []
                    except Exception as e:
                        st.error(f"Erreur lors de l’enregistrement dans Google Sheets : {e}")
            else:
                st.info("Aucune ligne en attente. Ajoutez un produit et une température pour commencer.")

    # ——————————— MODE CORNER : RÉCEPTION + TABLEAU JOUR + HISTORIQUE ———————————
    else:  # Corner – réception
        st.subheader("À compléter au corner – livraisons du jour sans température de réception")

        df_liv = load_livraison_temp_df()
        if df_liv.empty:
            st.info("Aucune livraison à compléter pour l’instant.")
        else:
            if "Horodatage départ" not in df_liv.columns:
                st.warning("Colonne 'Horodatage départ' manquante dans le sheet Livraison Température.")
                df_edit_corner = pd.DataFrame()
            else:
                df_liv["Horodatage départ"] = pd.to_datetime(
                    df_liv["Horodatage départ"], errors="coerce"
                )
                df_liv["__row__"] = range(2, 2 + len(df_liv))

                today_dt = date.today()
                mask_today = df_liv["Horodatage départ"].dt.date == today_dt

                col_recep = "Température réception (°C)"
                if col_recep not in df_liv.columns:
                    st.warning(f"Colonne « {col_recep} » introuvable dans le sheet Livraison Température.")
                    df_edit_corner = pd.DataFrame()
                else:
                    mask_no_recep = df_liv[col_recep].astype(str).str.strip().isin(["", "nan", "None"])
                    df_edit_corner = df_liv[mask_today & mask_no_recep].copy()

            if df_edit_corner.empty:
                st.success("Toutes les températures de réception du jour sont saisies ✅.")
            else:
                df_edit_corner = df_edit_corner.sort_values("Horodatage départ", ascending=False)

                with st.form("form_livraison_recep"):
                    updates = []
                    st.caption("Pour chaque ligne, renseigne la température à réception et, si besoin, ajoute une photo preuve.")

                    for _, row in df_edit_corner.iterrows():
                        produit = str(row.get("Produit", ""))
                        t_dep = row.get("Température départ (°C)", "")
                        h_dep = row.get("Horodatage départ", pd.NaT)
                        h_txt = h_dep.strftime("%H:%M") if pd.notna(h_dep) else ""
                        denom = row.get("Dénomination GEP", "") or PROD_GEP_MAPPING.get(produit, "")
                        rule = GEP_RULES.get(_norm_gep_key(denom)) if denom else None

                        key_suffix = int(row["__row__"])

                        with st.expander(f"{produit} — départ {t_dep}°C à {h_txt}", expanded=True):
                            if denom:
                                if rule:
                                    st.caption(
                                        f"Catégorie GEP : {denom} — "
                                        f"{rule['min']}°C à {rule['max']}°C "
                                        f"(max tolérée {rule['max_tol']}°C)"
                                    )
                                else:
                                    st.caption(f"Catégorie GEP : {denom}")

                            temp_input = st.text_input(
                                "Température réception (°C)",
                                key=f"liv_recep_{key_suffix}",
                                placeholder="ex : 3,8",
                            )
                            photo_file = st.file_uploader(
                                "📷 Photo (optionnelle)",
                                type=["jpg", "jpeg", "png"],
                                key=f"liv_photo_{key_suffix}",
                                help="Sur mobile, le bouton permet souvent 'Prendre une photo' ou 'Photothèque'.",
                            )

                            updates.append(
                                {
                                    "row_idx": key_suffix,
                                    "produit": produit,
                                    "denom": denom,
                                    "horodatage": h_dep,
                                    "temp_recep_txt": temp_input,
                                    "photo_file": photo_file,
                                }
                            )

                    submitted_recep = st.form_submit_button("✅ Enregistrer les températures de réception")

                if submitted_recep:
                    try:
                        ws_lt = get_livraison_temp_ws()
                        headers = ws_lt.row_values(1)

                        def _col_idx(name, default_idx):
                            try:
                                return headers.index(name) + 1
                            except ValueError:
                                return default_idx

                        col_idx_recep = _col_idx("Température réception (°C)", 4)
                        col_idx_gep = _col_idx("Dénomination GEP", 5)
                        col_idx_result = _col_idx("Résultat réception", 6)
                        col_idx_photo = _col_idx("Lien photo", 7)

                        n_ok = 0
                        for upd in updates:
                            val_str = (upd["temp_recep_txt"] or "").strip().replace(" ", "")
                            if not val_str:
                                continue

                            rec_txt = val_str.replace(".", ",")
                            if not re.match(r"^-?\d+(,\d+)?$", rec_txt):
                                st.error(
                                    f"Valeur de réception invalide pour « {upd['produit']} » : {val_str}. "
                                    f"Utilise par ex. 3,8"
                                )
                                st.stop()

                            ws_lt.update_cell(upd["row_idx"], col_idx_recep, rec_txt)

                            denom = upd["denom"] or PROD_GEP_MAPPING.get(upd["produit"], "")
                            if denom:
                                ws_lt.update_cell(upd["row_idx"], col_idx_gep, denom)
                                res_txt = compute_reception_result(rec_txt, denom)
                                if res_txt:
                                    ws_lt.update_cell(upd["row_idx"], col_idx_result, res_txt)

                            if upd["photo_file"] is not None:
                                lien = upload_livraison_photo(
                                    upd["photo_file"],
                                    upd["produit"],
                                    upd["horodatage"],
                                )
                                if lien:
                                    ws_lt.update_cell(upd["row_idx"], col_idx_photo, lien)

                            n_ok += 1

                        if n_ok > 0:
                            load_livraison_temp_df.clear()
                            st.success(f"{n_ok} température(s) de réception enregistrée(s).")
                        else:
                            st.info("Aucune valeur de réception renseignée, rien à enregistrer.")
                    except Exception as e:
                        st.error(f"Erreur lors de la mise à jour des températures de réception : {e}")

        # 3) TABLEAU DU JOUR – DÉPART & RÉCEPTION
        st.markdown("---")
        st.subheader("Tableau du jour – départ & réception")

        df_liv_today = load_livraison_temp_df()
        if df_liv_today.empty:
            st.info("Aucun relevé de livraison pour l’instant.")
        else:
            if "Horodatage départ" in df_liv_today.columns:
                df_liv_today["Horodatage départ"] = pd.to_datetime(
                    df_liv_today["Horodatage départ"], errors="coerce"
                )
                today_dt2 = date.today()
                mask_today2 = df_liv_today["Horodatage départ"].dt.date == today_dt2
                df_today = df_liv_today[mask_today2].copy()
            else:
                df_today = df_liv_today.copy()

            if df_today.empty:
                st.info("Aucune livraison enregistrée aujourd’hui.")
            else:
                if (
                    "Température réception (°C)" in df_today.columns
                    and "Dénomination GEP" in df_today.columns
                ):
                    def _compute_res(row):
                        existing = str(row.get("Résultat réception", "")).strip()
                        if existing:
                            return existing
                        return compute_reception_result(
                            row["Température réception (°C)"],
                            row["Dénomination GEP"],
                        )
                    df_today["Résultat réception"] = df_today.apply(_compute_res, axis=1)

                cols_to_show = [
                    c
                    for c in [
                        "Produit",
                        "Dénomination GEP",
                        "Température départ (°C)",
                        "Température réception (°C)",
                        "Résultat réception",
                    ]
                    if c in df_today.columns
                ]
                st.dataframe(
                    df_today[cols_to_show],
                    use_container_width=True,
                )

        # 4) HISTORIQUE COMPLET
        st.markdown("---")
        afficher_hist = st.checkbox("Afficher l’historique complet des relevés de livraison", value=False)
        if afficher_hist:
            df_liv_full = load_livraison_temp_df()
            st.subheader("Historique des relevés de livraison")
            if df_liv_full.empty:
                st.info("Aucun relevé de température de livraison pour l’instant.")
            else:
                if "Horodatage départ" in df_liv_full.columns:
                    df_liv_full["Horodatage départ"] = pd.to_datetime(
                        df_liv_full["Horodatage départ"], errors="coerce"
                    )
                    df_liv_full = df_liv_full.sort_values(
                        "Horodatage départ", ascending=False
                    ).reset_index(drop=True)
                st.dataframe(df_liv_full, use_container_width=True)

# —————————————— ONGLET “🧼 Hygiène” ——————————————
elif choix == "🧼 Hygiène":
    st.header("🧼 Relevé Hygiène – Aujourd’hui")
    typ = st.selectbox("📋 Type de tâches", ["Quotidien", "Hebdomadaire", "Mensuel"], key="hyg_type")

    df_key  = f"df_hyg_{typ}"
    idx_key = f"df_hyg_idx_{typ}"

    if df_key not in st.session_state:
        try:
            ws = ss_hygiene.worksheet(typ)
        except Exception as e:
            st.error(f"❌ Impossible d’ouvrir l’onglet '{typ}' : {e}")
            st.stop()

        raw = ws.get_all_values()
        if len(raw) < 2:
            st.warning("⚠️ La feuille est vide ou mal formatée (pas assez de lignes).")
            st.stop()

        df_hyg = pd.DataFrame(raw[1:], columns=raw[0])

        today_str = date.today().strftime("%Y-%m-%d")
        if today_str in df_hyg["Date"].values:
            idx = int(df_hyg.index[df_hyg["Date"] == today_str][0])
        else:
            idx = len(df_hyg)
            new_row = {col: "" for col in df_hyg.columns}
            new_row["Date"] = today_str
            df_hyg = pd.concat([df_hyg, pd.DataFrame([new_row])], ignore_index=True)

        st.session_state[df_key]  = df_hyg
        st.session_state[idx_key] = idx

    df_hyg = st.session_state[df_key]
    idx    = st.session_state[idx_key]
    today_str = date.today().strftime("%Y-%m-%d")

    st.subheader(f"✅ Cochez les tâches effectuées pour le {today_str}")

    checks = {}
    for col in df_hyg.columns[1:]:
        chk_key = f"hyg_chk_{typ}_{col}"
        if chk_key not in st.session_state:
            st.session_state[chk_key] = (str(df_hyg.at[idx, col]) == "✅")
        checks[col] = st.checkbox(col, value=st.session_state[chk_key], key=chk_key)

    if st.button("📅 Valider la journée"):
        for col, val in checks.items():
            df_hyg.at[idx, col] = "✅" if val else ""

        nouvelle_feuille = [df_hyg.columns.tolist()] + df_hyg.values.tolist()

        try:
            ws = ss_hygiene.worksheet(typ)
            ws.update("A1", nouvelle_feuille)
            st.success("✅ Hygiène mise à jour dans Google Sheets.")
            del st.session_state[df_key]
            del st.session_state[idx_key]
            for col in df_hyg.columns[1:]:
                chk_key = f"hyg_chk_{typ}_{col}"
                if chk_key in st.session_state:
                    del st.session_state[chk_key]
        except Exception as e:
            st.error(f"❌ Erreur lors de la mise à jour du Google Sheet : {e}")

# ——— ONGLET PROTOCOLES ———
elif choix == "📋 Protocoles":
    st.header("📋 Protocoles opérationnels")

    fichiers = {
        "Arrivée":                 "protocoles_arrivee.txt",
        "Fermeture":               "protocoles_fermeture.txt",
        "Temps calme":             "protocoles_tempscalmes.txt",
        "Stockage":                "protocole_stockage.txt",
        "Hygiène du personnel":    "protocoles_hygiene du personnel.txt",
        "Service du midi":         "protocoles_midi.txt",
        "Règles en stand":         "protocoles_regles en stand.txt",
        "Hygiène générale":        "protocole_hygiene.txt",
        "TooGoodToGo":             "TooGoodToGo.txt"
    }

    choix_proto = st.selectbox(
        "🧾 Choisir un protocole à consulter", 
        list(fichiers.keys()),
        key="select_proto"
    )

    try:
        contenu = read_txt_from_drive(
            file_name=fichiers[choix_proto],
            folder_id="14Pa-svM3uF9JQtjKysP0-awxK0BDi35E"
        )
        if contenu is None:
            st.error(f"⚠️ Le fichier « {fichiers[choix_proto]} » n’a pas été trouvé dans le dossier Drive.")
        else:
            texte = contenu.replace("•", "\n\n•")
            st.markdown(
                f"### 🗂️ {choix_proto}\n\n" +
                textwrap.indent(texte, prefix=""),
                unsafe_allow_html=True
            )
    except Exception as e:
        st.error(f"❌ Impossible de charger « {choix_proto} » depuis Drive : {e}")

# ——— ONGLET OBJECTIFS CHIFFRES D’AFFAIRES ———
elif choix == "📊 Objectifs Chiffres d'affaires":
    st.header("📊 Objectifs Chiffres d'affaires")

    df_obj = load_objectifs_df()
    if df_obj.empty:
        st.info("La feuille 'objectifs' est vide ou introuvable dans le fichier europoseidon_liaison.")
    else:
        cols = list(df_obj.columns)

        col_mois = cols[0] if cols else None
        col_ht = "HT" if "HT" in cols else (cols[1] if len(cols) > 1 else None)
        col_res = None
        for c in cols:
            if "result" in c.lower():
                col_res = c
                break
        if col_res is None and len(cols) > 2:
            col_res = cols[2]

        if not (col_mois and col_ht and col_res):
            st.error("Impossible d’identifier les colonnes Mois / HT / Résultat dans la feuille 'objectifs'.")
        else:
            def _to_float(x):
                s = str(x or "").strip()
                if not s:
                    return None
                s = s.replace(" ", "")
                s = s.replace(",", ".")
                s = re.sub(r"[^0-9.\-]", "", s)
                try:
                    return float(s)
                except ValueError:
                    return None

            df_obj["_ht_val"] = df_obj[col_ht].apply(_to_float)
            df_obj["_res_val"] = df_obj[col_res].apply(_to_float)

            def _prime(row):
                ht = row["_ht_val"]
                res = row["_res_val"]
                if ht is None or res is None:
                    return ""
                return "✅" if res >= ht else "❌"

            df_obj["Prime"] = df_obj.apply(_prime, axis=1)

            df_aff = pd.DataFrame({
                "Mois": df_obj[col_mois],
                "Objectif HT": df_obj[col_ht],
                "Résultat": df_obj[col_res],
                "Prime": df_obj["Prime"],
            })

            st.caption("✅ = objectif atteint ou dépassé • ❌ = objectif non atteint (Résultat < Objectif HT)")
            st.dataframe(df_aff, use_container_width=True)

# ——— ONGLET PLANNING (placeholder) ———
elif choix == "📅 Planning":
    st.header("📅 Planning – en construction")
    st.info("Cette page est temporairement mise de côté. Nous l’intégrerons une fois la ‘Planning app’ finalisée.")
    st.caption("Le Dashboard continue de récupérer le « Responsable de la semaine » via le Google Sheet dédié / Planning existant.")

# ——— ONGLET STOCKAGE FRIGO ———
elif choix == "🧊 Stockage Frigo":
    st.header("🧊 Stockage Frigo")

    df_all = load_df(ss_cmd, "Stockage Frigo")
    df_all.columns = [c.strip().lower().replace(" ", "_") for c in df_all.columns]
    df_all["dlc"] = pd.to_datetime(df_all["dlc"], dayfirst=True, errors="coerce").dt.date
    df_all["jours_restants"] = (
        pd.to_datetime(df_all["dlc"]) - pd.Timestamp.today().normalize()
    ).dt.days

    st.subheader("📦 Tous les frigos")
    def bordure_color(d):
        if pd.isna(d):
            return ""
        if d > 1:
            return "border-left:4px solid #a8d5ba"
        if d == 1:
            return "border-left:4px solid #ffe5a1"
        return "border-left:4px solid #f7b2b7"

    display_df = df_all[["frigo", "article", "quantite", "dlc"]]
    styled = display_df.style.apply(
        lambda row: [bordure_color(df_all.loc[row.name, "jours_restants"])] * len(row),
        axis=1
    ).set_properties(**{"font-size": "0.9em"})
    st.dataframe(styled, use_container_width=True)

    st.markdown("---")

    frigos = ["Frigo 1", "Frigo 2", "Frigo 3", "Grand Frigo", "Chambre Froide"]
    choix_frigo = st.selectbox("🔍 Afficher un seul frigo :", frigos, key="sel_frigo")
    df = df_all[df_all["frigo"] == choix_frigo].reset_index()

    st.subheader(f"📋 Contenu de « {choix_frigo} »")
    if df.empty:
        st.info("Aucun article dans ce frigo.")
    else:
        for _, row in df.iterrows():
            jr = row["jours_restants"]
            style = bordure_color(jr)
            c1, c2, c3 = st.columns([4, 1, 1])
            with c1:
                st.markdown(
                    f"<div style='{style}; padding:8px 12px; border-radius:4px;'>"
                    f"<strong>{row['article']}</strong>  •  Qté : {row['quantite']}  •  DLC : {row['dlc']}"
                    f"</div>",
                    unsafe_allow_html=True
                )
            with c2:
                if st.button("❌", key=f"del_{choix_frigo}_{row['index']}", help="Supprimer"):
                    new_df = df_all.drop(row["index"])
                    save_df(ss_cmd, "Stockage Frigo", new_df)
                    st.success("Article supprimé.")
            with c3:
                if st.button("🔁", key=f"tf_{choix_frigo}_{row['index']}", help="Transférer"):
                    st.session_state["to_transfer"] = row["index"]
                    st.session_state["transfer_src"] = choix_frigo

    if "to_transfer" in st.session_state:
        st.markdown("---")
        src = st.session_state["transfer_src"]
        article = df_all.at[st.session_state["to_transfer"], "article"]
        st.warning(f"🔁 Transfert de « {article} » depuis **{src}**")
        dest = st.selectbox(
            "Choisissez le frigo de destination",
            [f for f in frigos if f != src],
            key="dest_frigo"
        )
        if st.button("✅ Confirmer le transfert"):
            df2 = load_df(ss_cmd, "Stockage Frigo")
            df2.columns = [c.strip().lower().replace(" ", "_") for c in df2.columns]
            df2.at[st.session_state["to_transfer"], "frigo"] = dest
            save_df(ss_cmd, "Stockage Frigo", df2)
            st.success("🔁 Transfert effectué !")
            del st.session_state["to_transfer"]
            del st.session_state["transfer_src"]

    st.markdown("---")
    if st.button(f"🗑️ Vider complètement « {choix_frigo} »"):
        df2 = df_all[df_all["frigo"] != choix_frigo]
        save_df(ss_cmd, "Stockage Frigo", df2)
        st.success(f"Contenu de « {choix_frigo} » vidé.")

    st.markdown("---")
    st.subheader("➕ Ajouter un article")
    c1, c2, c3, c4 = st.columns([3, 1, 2, 1])
    art = c1.text_input("Article", key="add_art")
    qte = c2.number_input("Qté", min_value=1, value=1, key="add_qte")
    dlc_in = c3.date_input("DLC", value=date.today() + timedelta(days=3), key="add_dlc")
    if c4.button("✅ Ajouter"):
        if not art.strip():
            st.error("Le nom de l’article est vide.")
        else:
            nouveau = {
                "frigo":    choix_frigo,
                "article":  art.strip(),
                "quantite": qte,
                "dlc":       dlc_in.strftime("%Y-%m-%d")
            }
            df2 = pd.concat([df_all, pd.DataFrame([nouveau])], ignore_index=True)
            save_df(ss_cmd, "Stockage Frigo", df2)
            st.success(f"« {art.strip()} » ajouté.")

# ——— ONGLET VITRINE ———
elif choix == "🖥️ Vitrine":
    st.header("🖥️ Vitrine")

    raw = ws_values_safe(SHEET_COMMANDES_ID, "Vitrine")
    if not raw:
        st.warning("Feuille Vitrine vide.")
        st.stop()

    header_raw = raw[0]
    cols_norm = [normalize_col(c) for c in header_raw]
    rows = raw[1:]
    df_all = pd.DataFrame(rows, columns=cols_norm)

    df_all["__row__"] = range(2, 2 + len(df_all))

    for missing in ["produit", "date_fabrication", "dlc", "date_ajout", "date_retrait"]:
        if missing not in df_all.columns:
            df_all[missing] = ""

    st.subheader("➕ Ajouter un produit en vitrine")

    try:
        options_produits = produits_list
    except Exception:
        options_produits = sorted(
            [p for p in df_all["produit"].dropna().unique().tolist() if str(p).strip()]
        )

    col1, col2, col3 = st.columns([2, 1, 1])

    with col1:
        choix_prod = st.selectbox("Produit (ou choisissez 'Autre')",
                                  options=(["(Autre)"] + options_produits) if options_produits else ["(Autre)"])
        if choix_prod == "(Autre)":
            produit = st.text_input("Nom du produit")
        else:
            produit = choix_prod

    with col2:
        fab = st.date_input("Date de fabrication", value=date.today())

    dlc_calc = fab + timedelta(days=3)
    with col3:
        st.text_input("DLC (auto J+3, non éditable)", value=dlc_calc.strftime("%Y-%m-%d"), disabled=True)

    date_ajout = st.date_input("Date d’ajout (pour le lot si besoin)", value=date.today())

    ok = st.button("Enregistrer en vitrine", type="primary", use_container_width=True)

    if ok:
        if not produit or not str(produit).strip():
            st.error("Veuillez renseigner un nom de produit.")
            st.stop()
        try:
            sh = _open_by_key_cached(SHEET_COMMANDES_ID)
            ws = sh.worksheet("Vitrine")

            header_norm_map = {normalize_col(h): i for i, h in enumerate(header_raw)}
            new_vals = [""] * len(header_raw)

            def set_if_exists(key_norm, value):
                idx = header_norm_map.get(key_norm)
                if idx is not None:
                    new_vals[idx] = value

            set_if_exists("produit", str(produit).strip())
            set_if_exists("date_fabrication", fab.isoformat())
            set_if_exists("dlc", dlc_calc.isoformat())
            set_if_exists("date_ajout", date_ajout.isoformat())

            ws.append_row(new_vals, value_input_option="RAW")
            st.success("Produit ajouté en vitrine.")
            st.cache_data.clear()
            st.rerun()
        except Exception as e:
            st.error(f"Échec de l’enregistrement : {e}")

    st.markdown("---")

    st.subheader("⚠️ Alertes DLC")
    actifs = df_all[df_all["date_retrait"].astype(str).str.strip() == ""].copy()

    if not actifs.empty and "dlc" in actifs.columns:
        dlc_series = pd.to_datetime(actifs["dlc"], errors="coerce")
        today_dt3 = pd.Timestamp(date.today())
        depassee = actifs[dlc_series < today_dt3].copy()
        dujour   = actifs[dlc_series.dt.date == date.today()].copy()
    else:
        depassee = pd.DataFrame()
        dujour   = pd.DataFrame()

    cA, cB = st.columns(2)
    with cA:
        st.caption("DLC dépassées")
        if depassee.empty:
            st.success("RAS")
        else:
            try:
                st.dataframe(style_dlc_alert(depassee), use_container_width=True)
            except Exception:
                st.dataframe(depassee, use_container_width=True)
    with cB:
        st.caption("DLC du jour")
        if dujour.empty:
            st.success("RAS")
        else:
            try:
                st.dataframe(style_dlc_alert(dujour), use_container_width=True)
            except Exception:
                st.dataframe(dujour, use_container_width=True)

    st.markdown("---")

    st.subheader("Articles actifs")
    if actifs.empty:
        st.info("Aucun article actif en vitrine.")
        st.stop()

    try:
        col_idx_retrait = [normalize_col(h) for h in header_raw].index("date_retrait") + 1
    except ValueError:
        st.error("Colonne 'date_retrait' introuvable dans la feuille Vitrine.")
        st.stop()

    def _norm_txt(x):
        s = str(x or "").strip().lower()
        try:
            s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
        except Exception:
            pass
        return s

    actifs["_prod_sort"] = actifs["produit"].map(_norm_txt) if "produit" in actifs.columns else ""
    actifs["_dlc_dt"] = pd.to_datetime(actifs["dlc"], errors="coerce") if "dlc" in actifs.columns else pd.NaT
    actifs = actifs.sort_values(by=["_prod_sort", "_dlc_dt"], na_position="last").drop(columns=["_prod_sort"], errors="ignore")

    for _, r in actifs.iterrows():
        produit_txt = str(r.get("produit", "")).strip()
        lot_txt     = str(r.get("lot", "")).strip() if "lot" in actifs.columns else ""
        fab_txt     = str(r.get("date_fabrication", "")).strip()
        dlc_txt     = str(r.get("dlc", "")).strip()

        line = f"**{produit_txt}**"
        meta = []
        if lot_txt:
            meta.append(f"Lot {lot_txt}")
        if fab_txt:
            meta.append(f"Fab {fab_txt}")
        if dlc_txt:
            meta.append(f"DLC {dlc_txt}")
        if meta:
            line += " — " + " • ".join(meta)

        c1, c2 = st.columns([8, 2])
        with c1:
            st.markdown(line)
        with c2:
            gs_row = int(r["__row__"])
            if st.button("🗑️ Retirer", key=f"retirer-{gs_row}", use_container_width=True):
                try:
                    sh = _open_by_key_cached(SHEET_COMMANDES_ID)
                    ws = sh.worksheet("Vitrine")
                    ws.update_cell(gs_row, col_idx_retrait, date.today().isoformat())
                    st.cache_data.clear()
                    st.rerun()
                except Exception as e:
                    st.error(f"Impossible de retirer l’article (ligne {gs_row}) : {e}")

# ——— ONGLET RUPTURES & COMMANDES ———
elif choix == "🛎️ Ruptures & Commandes":
    st.header("🛎️ Ruptures & Commandes")
    st.write("Sélectionnez les produits par niveau de priorité puis générez le message SMS / WhatsApp.")

    try:
        options_produits = produits_list
    except Exception:
        try:
            raw_vit = ws_values_safe(SHEET_COMMANDES_ID, "Vitrine")
            if raw_vit and len(raw_vit) > 1:
                cols = [normalize_col(c) for c in raw_vit[0]]
                df_v = pd.DataFrame(raw_vit[1:], columns=cols)
                options_produits = sorted(
                    [p for p in df_v["produit"].dropna().unique().tolist() if str(p).strip()]
                ) if "produit" in df_v.columns else []
            else:
                options_produits = []
        except Exception:
            options_produits = []

    col_u, col_j2, col_surplus = st.columns(3)
    with col_u:
        urgence = st.multiselect("🔥 URGENCE", options=options_produits, key="rupt_urgence",
                                 help="Produits à commander immédiatement.")
    with col_j2:
        j2 = st.multiselect("⏳ Demande à J+2", options=options_produits, key="rupt_j2",
                            help="Produits à commander sous 48h.")
    with col_surplus:
        surplus = st.multiselect("🟩 Produit en trop – ne pas envoyer", options=options_produits, key="rupt_surplus",
                                 help="Trop de stock : merci de NE PAS ENVOYER.")

    commentaire = st.text_area("📝 Commentaire / Quantités (optionnel)")

    header = st.secrets.get("RUPTURES_HEADER", "Commandes Corner")

    def _build_message(urgence_list, j2_list, surplus_list, note, header_text):
        lines = [str(header_text).strip()]
        if urgence_list:
            lines.append("URGENCE : " + ", ".join(urgence_list))
        if j2_list:
            lines.append("Demande à J+2 : " + ", ".join(j2_list))
        if surplus_list:
            lines.append("Produit en trop — ne pas envoyer : " + ", ".join(surplus_list))
        if note and note.strip():
            lines.append("Commentaire : " + note.strip())
        if len(lines) == 1:
            lines.append("Aucune sélection.")
        return "\n".join(lines)

    msg = _build_message(urgence, j2, surplus, commentaire, header)

    st.markdown("#### 📨 Aperçu du message")
    st.code(msg, language="text")

    sms_num = str(st.secrets.get("CONTACT_SMS", "")).strip()
    wa_num  = str(st.secrets.get("CONTACT_WHATSAPP", "")).strip()

    wa_flag_str = str(st.secrets.get("SHOW_WHATSAPP", "")).strip().lower()
    wa_flag = wa_flag_str in ("true", "1", "yes", "on")
    show_whatsapp = wa_flag and bool(wa_num)

    cols2 = st.columns(2) if show_whatsapp else st.columns(1)

    with cols2[0]:
        if st.button("📲 Générer SMS"):
            if not sms_num:
                st.error("🚨 Configurez CONTACT_SMS dans vos secrets.")
            else:
                url = f"sms:{sms_num}?&body={urllib.parse.quote(msg)}"
                st.markdown(f"[➡️ Ouvrir SMS]({url})")

    if show_whatsapp:
        with cols2[1]:
            if st.button("💬 Générer WhatsApp"):
                url = f"https://wa.me/{wa_num}?text={urllib.parse.quote(msg)}"
                st.markdown(f"[➡️ Ouvrir WhatsApp]({url})")

# ——— ONGLET CONTROLE HYGIENE ———
elif choix == "🧾 Contrôle Hygiène":
    st.header("🧾 Contrôle Hygiène – Visualisation & Export PDF")

    date_debut = st.date_input(
        "📅 Date de début",
        value=date(2025, 5, 1),
        key="ch_debut"
    )
    date_fin = st.date_input(
        "📅 Date de fin",
        value=date(2025, 6, 1),
        key="ch_fin"
    )

    cle_temp = "ch_df_temp"
    cle_hyg  = "ch_df_hyg"
    cle_vit  = "ch_df_vit"
    cle_liv  = "ch_df_liv"

    if st.button("🔄 Charger & Afficher les relevés"):
        list_temp = []
        for ws in ss_temp.worksheets():
            titre = ws.title.strip()
            if titre.lower().startswith("semaine"):
                vals = ws.get_all_values()
                if len(vals) < 2:
                    continue
                dfw = pd.DataFrame(vals[1:], columns=vals[0])
                dfw["Semaine"] = titre
                list_temp.append(dfw)
        df_all_temp = pd.concat(list_temp, ignore_index=True) if list_temp else pd.DataFrame()
        if "Date" in df_all_temp.columns:
            df_all_temp["Date"] = pd.to_datetime(df_all_temp["Date"], errors="coerce")
            mask_temp = (
                (df_all_temp["Date"] >= pd.to_datetime(date_debut)) &
                (df_all_temp["Date"] <= pd.to_datetime(date_fin))
            )
            df_all_temp = df_all_temp.loc[mask_temp].reset_index(drop=True)

        list_hyg = []
        for nom in ["Quotidien", "Hebdomadaire", "Mensuel"]:
            try:
                wh = ss_hygiene.worksheet(nom)
                vals = wh.get_all_values()
                if len(vals) < 2:
                    continue
                dfh = pd.DataFrame(vals[1:], columns=vals[0])
                dfh["Type"] = nom
                list_hyg.append(dfh)
            except WorksheetNotFound:
                pass
        if list_hyg:
            df_filtre = pd.concat(list_hyg, ignore_index=True)
            if "Date" in df_filtre.columns:
                df_filtre["Date"] = pd.to_datetime(df_filtre["Date"], errors="coerce")
                mask_hyg = (
                    (df_filtre["Date"] >= pd.to_datetime(date_debut)) &
                    (df_filtre["Date"] <= pd.to_datetime(date_fin))
                )
                df_filtre = df_filtre.loc[mask_hyg].reset_index(drop=True)
            else:
                df_filtre = pd.DataFrame()
        else:
            df_filtre = pd.DataFrame()

        raw_vitrine = sheet_vitrine.get_all_records()
        if raw_vitrine:
            df_vit_full = pd.DataFrame(raw_vitrine)
            if "date_ajout" in df_vit_full.columns:
                df_vit_full["DateAjout"] = pd.to_datetime(
                    df_vit_full["date_ajout"], format="%Y%m%d", errors="coerce"
                )
                mask_vit = (
                    (df_vit_full["DateAjout"] >= pd.to_datetime(date_debut)) &
                    (df_vit_full["DateAjout"] <= pd.to_datetime(date_fin))
                )
                vitrine_df = df_vit_full.loc[mask_vit].reset_index(drop=True)
            else:
                vitrine_df = pd.DataFrame()
        else:
            vitrine_df = pd.DataFrame()

        try:
            df_liv = load_livraison_temp_df()
            if not df_liv.empty and "Horodatage départ" in df_liv.columns:
                df_liv["Horodatage départ"] = pd.to_datetime(
                    df_liv["Horodatage départ"], errors="coerce"
                )
                start_ts = pd.to_datetime(date_debut)
                end_ts = pd.to_datetime(date_fin) + pd.Timedelta(days=1)
                mask_liv = (
                    (df_liv["Horodatage départ"] >= start_ts) &
                    (df_liv["Horodatage départ"] < end_ts)
                )
                df_liv = df_liv.loc[mask_liv].reset_index(drop=True)
            else:
                df_liv = pd.DataFrame()
        except Exception:
            df_liv = pd.DataFrame()

        st.session_state[cle_temp] = df_all_temp
        st.session_state[cle_hyg]  = df_filtre
        st.session_state[cle_vit]  = vitrine_df
        st.session_state[cle_liv]  = df_liv

        if "pdf_hygiene_bytes" in st.session_state:
            del st.session_state["pdf_hygiene_bytes"]

    if (
        cle_temp in st.session_state and
        cle_hyg in st.session_state and
        cle_vit in st.session_state and
        cle_liv in st.session_state
    ):
        df_all_temp = st.session_state[cle_temp]
        df_filtre   = st.session_state[cle_hyg]
        vitrine_df  = st.session_state[cle_vit]
        df_liv      = st.session_state[cle_liv]

        st.markdown("### 🌡️ Relevés Températures (Vue complète)")
        if df_all_temp.empty:
            st.warning("Aucun relevé de températures sur la période sélectionnée.")
        else:
            st.dataframe(df_all_temp, use_container_width=True)

        st.markdown("### 🧼 Relevés Hygiène (Vue complète)")
        if df_filtre.empty:
            st.warning("Aucun relevé d’hygiène sur la période sélectionnée.")
        else:
            st.dataframe(df_filtre, use_container_width=True)

        st.markdown("### 🖥️ Articles en Vitrine (Vue complète)")
        if vitrine_df.empty:
            st.warning("Aucun article en vitrine pour la période sélectionnée.")
        else:
            st.dataframe(vitrine_df, use_container_width=True)

        st.markdown("### 🚚 Températures de livraison (Vue complète)")
        if df_liv.empty:
            st.warning("Aucun relevé de température de livraison sur la période sélectionnée.")
        else:
            st.dataframe(df_liv, use_container_width=True)

        st.markdown("---")

        if st.button("📤 Générer PDF Contrôle Hygiène"):
            try:
                pdf_path = generate_controle_hygiene_pdf(
                    df_all_temp, df_filtre, vitrine_df, date_debut, date_fin
                )
                with open(pdf_path, "rb") as f:
                    st.session_state["pdf_hygiene_bytes"] = f.read()
                st.success("✅ PDF généré, vous pouvez maintenant le télécharger.")
            except Exception as e:
                st.error(f"❌ Erreur lors de la génération du PDF : {e}")

        if "pdf_hygiene_bytes" in st.session_state:
            st.download_button(
                "📄 Télécharger le PDF Contrôle Hygiène",
                st.session_state["pdf_hygiene_bytes"],
                file_name="controle_hygiene.pdf",
                mime="application/pdf"
            )

    else:
        st.info("Cliquez sur « 🔄 Charger & Afficher les relevés » pour voir les données puis générer le PDF.")

# ——— ONGLET LIENS GOOGLE SHEETS ———
elif choix == "🔗 Liens Google Sheets":
    st.header("🔗 Liens vers les Google Sheets utilisés")

    sheets = {
        "📦 Commandes + HACCP + Vitrine" : "https://docs.google.com/spreadsheets/d/1cBP7iEeWK5whbHzoZAWUhq_HQ5OcAEjTBkUro2cmkoc",
        "🧼 Hygiène"                     : "https://docs.google.com/spreadsheets/d/1XMYhh2CSIv1zyTtXKM4_ACEhW-6kXxoFi4ACzNhbuDE",
        "🌡️ Températures"               : "https://docs.google.com/spreadsheets/d/1e4hS6iawCa1IizhzY3xhskLy8Gj3todP3zzk38s7aq0",
        "📅 Planning"                   : "https://docs.google.com/spreadsheets/d/1OBYGNHtHdDB2jufKKjoAwq6RiiS_pnz4ta63sAM-t_0",
        "🛒 Liste Produits"             : "https://docs.google.com/spreadsheets/d/1FbRV4KgXyCwqwLqJkyq8cHZbo_BfB7kyyPP3pO53Snk",
        "👤 Responsables semaine"       : "https://docs.google.com/spreadsheets/d/1nWEel6nizI0LKC84uaBDyqTNg1hzwPSVdZw41YJaBV8"
    }

    for label, url in sheets.items():
        col1, col2 = st.columns([1, 4])
        with col1:
            st.markdown(f"**{label}**")
        with col2:
            st.link_button("🔗 Ouvrir", url)

# ———————————————————————————————
# PIED DE PAGE
# ———————————————————————————————
st.markdown(
    """
    <hr style="margin-top:40px; margin-bottom:10px">
    <p style="text-align:center; font-size:12px;">
        Application Yorgios • Développée avec ❤️ par Demis
    </p>
    """,
    unsafe_allow_html=True
)
