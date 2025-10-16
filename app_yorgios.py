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
# (googleapiclient supprimé)
from io import BytesIO
# (google.oauth2 supprimé)
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import landscape, A4
from reportlab.lib.units import cm
import urllib.parse
import unicodedata
import requests  # ➕ utilisé pour l’API Drive directe

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

# 🔐 ———————————————————————————————————————————
# Auth simple par mot de passe (stocké dans st.secrets["APP_PASSWORD"])
# ——————————————————————————————————————————————
def require_auth():
    expected_pwd = st.secrets.get("APP_PASSWORD", "christelle").strip()

    # Si le mot de passe n'est pas configuré dans les secrets, on bloque proprement
    if not expected_pwd:
        st.title("🔐 Accès restreint")
        st.error(
            "Mot de passe non configuré.\n"
            "Ajoutez APP_PASSWORD dans vos secrets (Streamlit Cloud > Settings > Secrets)."
        )
        st.stop()

    # Déjà authentifié pour cette session ?
    if st.session_state.get("auth_ok", False):
        # Bouton de déconnexion dans la sidebar
        with st.sidebar:
            st.caption("🔒 Accès privé")
            if st.button("Se déconnecter"):
                # On nettoie l'état et on relance
                for k in list(st.session_state.keys()):
                    del st.session_state[k]
                st.rerun()
        return  # Laisse l’app continuer normalement

    # Formulaire de connexion
    st.title("🔐 Accès réservé")
    pwd = st.text_input("Mot de passe", type="password", placeholder="Entrez le mot de passe")

    colA, colB = st.columns([1, 5])
    with colA:
        login = st.button("Se connecter", type="primary")

    # Valider si clic ou entrée dans le champ
    if login or (pwd and "last_try_pwd" not in st.session_state):
        st.session_state["last_try_pwd"] = pwd
        if pwd == expected_pwd:
            st.session_state["auth_ok"] = True
            st.rerun()
        elif login:
            st.error("Mot de passe incorrect.")

    # Bloque l’app tant qu’on n’est pas connecté
    st.stop()

# ———————————————————————————————
# CONFIGURATION STREAMLIT
# ———————————————————————————————
st.set_page_config(page_title="Yorgios V1", layout="wide")
try:
    locale.setlocale(locale.LC_TIME, 'fr_FR.UTF-8')
except locale.Error:
    pass

# 🔐 Bloque l’app tant que l’utilisateur n’est pas authentifié
require_auth()   # ← ← ← AJOUTE CETTE LIGNE ICI

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
# CACHES LECTURE SHEETS (accélère fortement le Dashboard)
# ———————————————————————————————
@st.cache_resource
def _open_by_key_cached(key: str):
    # garde un handle Spreadsheet en mémoire
    return open_sheet_retry(gc, key)

@st.cache_data(ttl=60)  # 60s : équilibre entre fraîcheur et vitesse
def ws_values(key: str, title: str):
    sh = _open_by_key_cached(key)
    return sh.worksheet(title).get_all_values()

@st.cache_data(ttl=300)
def ws_titles(key: str):
    sh = _open_by_key_cached(key)
    return [w.title for w in sh.worksheets()]

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
# TOKEN & LECTURE PROTOCOLES DRIVE (sans googleapiclient)
# ———————————————————————————————
def _get_sa_token(scopes=None):
    if scopes is None:
        scopes = ["https://www.googleapis.com/auth/drive.readonly"]
    sa_info = json.loads(st.secrets["GOOGLE_SERVICE_ACCOUNT_JSON"])
    creds = ServiceAccountCredentials.from_json_keyfile_dict(sa_info, scopes)
    # oauth2client: get_access_token() rafraîchit si besoin
    return creds.get_access_token().access_token
def _drive_q_escape(value: str) -> str:
    # Échapper \ puis ' pour la syntaxe de requête Drive (v3)
    return value.replace("\\", "\\\\").replace("'", "\\'")

def read_txt_from_drive(file_name, folder_id="14Pa-svM3uF9JQtjKysP0-awxK0BDi35E"):
    """
    Récupère le contenu d’un fichier texte (.txt) ou d’un Google Docs
    dans le dossier Drive donné et renvoie du texte brut, via requêtes HTTP directes.
    """
    token = _get_sa_token()
    headers = {"Authorization": f"Bearer {token}"}

    # 1) Trouver le fichier par nom dans le dossier (sans f-string à l'intérieur)
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

    # 2) Télécharger en texte
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

# ———————————————————————————————
# IDS Google Sheets & CHARGEMENT via retry
# ———————————————————————————————
SHEET_COMMANDES_ID = "1cBP7iEeWK5whbHzoZAWUhq_HQ5OcAEjTBkUro2cmkoc"
SHEET_HYGIENE_ID   = "1phiQjSYqvHdVEqv7uAt8pitRE0NfKv4b1f4UUzUqbXQ"
SHEET_TEMP_ID      = "1e4hS6iawCa1IizhzY3xhskLy8Gj3todP3zzk38s7aq0"
SHEET_PLANNING_ID  = "1OBYGNHtHdDB2jufKKjoAwq6RiiS_pnz4ta63sAM-t_0"
SHEET_PRODUITS_ID  = "1FbRV4KgXyCwqwLqJkyq8cHZbo_BfB7kyyPP3pO53Snk"
# ➕ Responsables semaine (ajouté)
SHEET_RESP_ID      = "1nWEel6nizI0LKC84uaBDyqTNg1hzwPSVdZw41YJaBV8"

ss_cmd        = open_sheet_retry(gc, SHEET_COMMANDES_ID)
sheet_haccp   = ss_cmd.worksheet("Suivi HACCP")
sheet_vitrine = ss_cmd.worksheet("Vitrine")

ss_hygiene  = open_sheet_retry(gc, SHEET_HYGIENE_ID)
ss_temp     = open_sheet_retry(gc, SHEET_TEMP_ID)
ss_planning = open_sheet_retry(gc, SHEET_PLANNING_ID)
ss_produits = open_sheet_retry(gc, SHEET_PRODUITS_ID)
sheet_prod  = ss_produits.worksheet("Produits")
# ➕ ouverture du sheet Responsables semaine
ss_resp = open_sheet_retry(gc, SHEET_RESP_ID)

# ———————————————————————————————
# UTILITAIRES LECTURE / SAUVEGARDE
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

# ———————————————————————————————
# LISTE PRODUITS & JOURS_FR & NAV
# ———————————————————————————————
produits_list = sorted(set(p.strip().capitalize() for p in sheet_prod.col_values(1) if p.strip()))
JOURS_FR = {"Monday":"Lundi","Tuesday":"Mardi","Wednesday":"Mercredi","Thursday":"Jeudi","Friday":"Vendredi","Saturday":"Samedi","Sunday":"Dimanche"}

# ➕ insérer Dashboard en premier
onglets = ["🏠 Dashboard","🌡️ Relevé des températures","🧼 Hygiène","🧊 Stockage Frigo","📋 Protocoles","📅 Planning","🖥️ Vitrine","🛎️ Ruptures & Commandes","🧾 Contrôle Hygiène","🔗 Liens Google Sheets"]
choix = st.sidebar.radio("Navigation", onglets)

# ———————————————————————————————
# OUTILS COMMUNS VITRINE (alertes & normalisation)
# ———————————————————————————————
def normalize_col(c: str) -> str:
    nfkd = unicodedata.normalize("NFKD", c)
    return (nfkd.encode("ascii", "ignore").decode().strip().lower().replace(" ", "_"))

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
    # fond rouge #b71c1c, texte noir
    def styler(_):
        return ["background-color: #b71c1c; color: black;"] * len(df.columns)
    return df.style.apply(styler, axis=1)

# ———————————————————————————————
# DASHBOARD
# ———————————————————————————————
def _compose_responsable_from_row(row, candidates=("responsable","nom","nom_1","nom1","nom_2","nom2")) -> str | None:
    """Construit 'Nom' ou 'Nom & Nom 2' selon les colonnes présentes et non vides (après normalisation)."""
    names = []
    for c in candidates:
        if c in row.index:
            v = str(row[c]).strip()
            if v and v.lower() not in ("nan", "none"):
                names.append(v)
    if not names:
        return None
    # déduplication en conservant l’ordre
    unique = []
    for n in names:
        if n not in unique:
            unique.append(n)
    return " & ".join(unique)

def render_dashboard():
    st.header("🏠 Dashboard")
    today = date.today()
    semaine_iso = today.isocalendar().week

    # ——— Responsable de la semaine (plein écran en haut)
    st.subheader("👤 Responsable de la semaine")
    resp_nom = "—"
    try:
        # 1) Lecture du Google Sheet "Responsables semaine" (1ère feuille)
        titles = ws_titles(SHEET_RESP_ID)
        raw = ws_values(SHEET_RESP_ID, titles[0]) if titles else []

        if len(raw) >= 2:
            # Normalisation des en-têtes
            cols_norm = [normalize_col(c) for c in raw[0]]
            df = pd.DataFrame(raw[1:], columns=cols_norm)

            # Harmonisation éventuelle des noms de colonnes de dates
            if "date_debut" not in df.columns and "debut" in df.columns:
                df["date_debut"] = df["debut"]
            if "date_fin" not in df.columns and "fin" in df.columns:
                df["date_fin"] = df["fin"]

            # ✦ Cas A : par n° de semaine
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

            # ✦ Cas B : par plage de dates (date_debut / date_fin + Nom / Nom 2)
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

    # Fallback Planning si rien trouvé
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

    # ——— Rappels Températures & Hygiène (côte à côte)
    col_temp, col_hyg = st.columns(2)

    # Températures – Aujourd’hui
    with col_temp:
        st.subheader("🌡️ Températures – Aujourd’hui")
        candidates = [f"Semaine {semaine_iso} {today.year}", f"Semaine {semaine_iso}"]
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

    # Hygiène – Quotidien
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

    # ——— Alertes DLC (en dessous)
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
# ONGLET : Dashboard
# ———————————————————————————————
if choix == "🏠 Dashboard":
    render_dashboard()

# ———————————————————————————————
# ONGLET : Relevé des températures
# ———————————————————————————————
elif choix == "🌡️ Relevé des températures":
    st.header("🌡️ Relevé des températures")

    # 1) Choix de la date
    jour = st.date_input(
        "🗓️ Sélectionner la date",
        value=date.today(),
        key="rt_jour"
    )

    # 2) Ouvrir (ou créer) la feuille correspondante
    nom_ws = f"Semaine {jour.isocalendar().week} {jour.year}"
    try:
        ws = ss_temp.worksheet(nom_ws)
    except WorksheetNotFound:
        st.warning(f"⚠️ Feuille « {nom_ws} » introuvable.")
        if st.button("➕ Créer la semaine", key="rt_create"):
            model = ss_temp.worksheet("Semaine 38")
            ss_temp.duplicate_sheet(source_sheet_id=model.id, new_sheet_name=nom_ws)
        st.stop()

    # 3) Charger les données brutes + en-tête
    raw       = ws.get_all_values()
    header    = [h.strip() for h in raw[0]]
    df_temp   = pd.DataFrame(raw[1:], columns=header)
    frigos    = df_temp.iloc[:, 0].tolist()

    # 4) Choix Matin/Soir
    moment = st.selectbox(
        "🕒 Moment du relevé",
        ["Matin", "Soir"],
        key="rt_moment"
    )

    # 5) Formulaire de saisie
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

# —————————————— ONGLET “🧼 Hygiène” (inchangé) ——————————————
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

# ——— ONGLET PROTOCOLES (inchangé, mais lecture par API HTTP) ———
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

# ——— ONGLET PLANNING (désactivé / en construction) ———
elif choix == "📅 Planning":
    st.header("📅 Planning – en construction")
    st.info("Cette page est temporairement mise de côté. Nous l’intégrerons une fois la ‘Planning app’ finalisée.")
    st.caption("Le Dashboard continue de récupérer le « Responsable de la semaine » via le Google Sheet dédié / Planning existant.")

# ——— ONGLET STOCKAGE FRIGO (inchangé) ———
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

# ——— ONGLET VITRINE (corrigé) ———
elif choix == "🖥️ Vitrine":
    st.header("🖥️ Vitrine – Traçabilité HACCP")
    today = date.today()

    # ─── 1) Formulaire d’ajout (ordre + DLC auto J+3 non-éditable) ───
    with st.form("vt_form", clear_on_submit=True):
        pr  = st.selectbox("Produit", produits_list, key="vt_pr")
        dfb = st.date_input("Date de fabrication", value=today, key="vt_df")
        # DLC dynamique J+3, non éditable
        dlc_auto = dfb + timedelta(days=3)
        st.text_input("DLC (auto J+3)", value=dlc_auto.strftime("%Y-%m-%d"), disabled=True, key="vt_dlc_ro")
        da  = st.date_input("Date d’ajout", value=today, key="vt_da")

        if st.form_submit_button("✅ Ajouter"):
            # Rechargement pour cohérence/doublons actifs
            raw        = sheet_vitrine.get_all_values()
            header_raw = raw[0] if raw else []
            cols = [normalize_col(c) for c in header_raw] if header_raw else []
            df_raw = pd.DataFrame(raw[1:], columns=cols) if raw else pd.DataFrame(columns=["produit","date_fab","date_retrait","dlc","date_ajout","numero_de_lot"])
            if "date_retrait" not in df_raw.columns:
                df_raw["date_retrait"] = ""
            df_raw["row_num"] = list(range(2, 2 + len(df_raw)))
            actifs = df_raw[df_raw["date_retrait"] == ""].reset_index(drop=True)

            date_fab_str = dfb.strftime("%Y-%m-%d")
            if ((actifs.get("produit","")==pr) & (actifs.get("date_fab","")==date_fab_str)).any():
                st.error(f"⛔ « {pr} » fabriqué le {dfb.strftime('%d/%m/%Y')} est déjà en vitrine.")
            else:
                ds  = da.strftime("%Y%m%d")
                ab  = pr[:3].upper()
                seq = len(actifs) + 1
                lot = f"{ds} {ab} {seq:02d}"
                # écriture : date_ajout, produit, numero_de_lot, date_fab, dlc, date_retrait
                sheet_vitrine.append_row([
                    ds,
                    pr,
                    lot,
                    date_fab_str,
                    dlc_auto.strftime("%Y-%m-%d"),
                    ""  # retrait vide
                ])
                st.success(f"✅ « {pr} » ajouté (lot : {lot})")

    # ─── 2) Alertes DLC (mêmes tableaux que Dashboard) ───
    st.subheader("⚠️ Alertes DLC")
    depassee, dujour = df_dlc_alerts()
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

    # ─── 3) Liste des articles actifs + suppression 1 clic ───
    st.subheader("📋 Articles actifs")
    actifs, cols = vitrine_df_norm_active()
    if actifs.empty:
        st.info("Aucun article actif en vitrine.")
    else:
        for _, row in actifs.reset_index(drop=True).iterrows():
            c1, c2 = st.columns([0.85, 0.15])
            with c1:
                parts = []
                if "produit" in row: parts.append(f"**{row['produit']}**")
                if "numero_de_lot" in row: parts.append(f"Lot `{row['numero_de_lot']}`")
                if "date_fab" in row: parts.append(f"Fab {row['date_fab']}")
                if "dlc" in row: parts.append(f"DLC {row['dlc']}")
                st.markdown(" • ".join(parts))
            with c2:
                if st.button("🗑️ Retirer", key=f"vt_rem_{row.name}"):
                    header = sheet_vitrine.row_values(1)
                    cols_now = [normalize_col(c) for c in header]
                    col_retrait_idx = cols_now.index("date_retrait") + 1 if "date_retrait" in cols_now else len(cols_now)+1
                    raw_all = sheet_vitrine.get_all_values()
                    if raw_all:
                        df_all = pd.DataFrame(raw_all[1:], columns=[normalize_col(c) for c in raw_all[0]])
                        mask = pd.Series([True]*len(df_all))
                        if "numero_de_lot" in df_all.columns and "numero_de_lot" in row:
                            mask &= (df_all["numero_de_lot"]==row.get("numero_de_lot",""))
                        if "produit" in df_all.columns and "produit" in row:
                            mask &= (df_all["produit"]==row.get("produit",""))
                        idxs = df_all[mask].index.tolist()
                        if idxs:
                            cell_row = idxs[0] + 2  # + header
                            sheet_vitrine.update_cell(cell_row, col_retrait_idx, date.today().strftime("%Y-%m-%d"))
                            st.success("✅ Article retiré")
                            st.rerun()

# ——— ONGLET RUPTURES ET COMMANDES (inchangé) ———
elif choix == "🛎️ Ruptures & Commandes":
    st.header("🛎️ Ruptures & Commandes")
    st.write("Sélectionnez les produits en rupture et envoyez facilement la demande.")

    ruptures = st.multiselect(
        "Produits en rupture",
        options=produits_list,
        help="Cochez un ou plusieurs produits à commander"
    )

    commentaire = st.text_area(
        "Commentaire / Quantités",
        help="Optionnel : précisez les quantités ou infos complémentaires"
    )

    sms_num      = st.secrets.get("CONTACT_SMS", "")
    wa_num       = st.secrets.get("CONTACT_WHATSAPP", "")

    col1, col2 = st.columns(2)
    with col1:
        if st.button("📲 Générer SMS"):
            if not sms_num:
                st.error("🚨 Configurez CONTACT_SMS dans vos secrets.")
            else:
                msg = "Rupture : " + ", ".join(ruptures)
                if commentaire:
                    msg += f" ({commentaire})"
                url = f"sms:{sms_num}?&body={urllib.parse.quote(msg)}"
                st.markdown(f"[➡️ Ouvrir SMS]({url})")

    with col2:
        if st.button("💬 Générer WhatsApp"):
            if not wa_num:
                st.error("🚨 Configurez CONTACT_WHATSAPP dans vos secrets.")
            else:
                msg = "Rupture : " + ", ".join(ruptures)
                if commentaire:
                    msg += f" ({commentaire})"
                url = f"https://wa.me/{wa_num}?text={urllib.parse.quote(msg)}"
                st.markdown(f"[➡️ Ouvrir WhatsApp]({url})")

# ——— ONGLET CONTROLE HYGIENE (inchangé) ———
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

        st.session_state[cle_temp] = df_all_temp
        st.session_state[cle_hyg]  = df_filtre
        st.session_state[cle_vit]  = vitrine_df

        if "pdf_hygiene_bytes" in st.session_state:
            del st.session_state["pdf_hygiene_bytes"]

    if cle_temp in st.session_state and cle_hyg in st.session_state and cle_vit in st.session_state:
        df_all_temp = st.session_state[cle_temp]
        df_filtre   = st.session_state[cle_hyg]
        vitrine_df  = st.session_state[cle_vit]

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

# ——— ONGLET LIENS GOOGLE SHEETS (inchangé) ———
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
# PIED DE PAGE (inchangé)
# ———————————————————————————————
st.markdown(
    """
    <hr style="margin-top:40px; margin-bottom:10px">
    <p style="text-align:center; font-size:12px;">
        Application Yorgios • Développée avec ❤️ & Demis
    </p>
    """,
    unsafe_allow_html=True
)
