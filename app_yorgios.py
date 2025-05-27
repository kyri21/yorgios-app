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
from ics import Calendar, Event
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from io import BytesIO
from google.oauth2.service_account import Credentials
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import landscape, A4
from reportlab.lib.units import cm
import urllib.parse


# ———————————————————————————————
# CONFIGURATION STREAMLIT
# ———————————————————————————————
st.set_page_config(page_title="Yorgios V1", layout="wide")
try:
    locale.setlocale(locale.LC_TIME, 'fr_FR.UTF-8')
except locale.Error:
    pass

# ———————————————————————————————
# FONCTION D’EXPORT PDF Contrôle Hygiène
# ———————————————————————————————
def generate_controle_hygiene_pdf(temp_df, hygiene_df, haccp_df, date_debut, date_fin):
    pdf_path = "/tmp/controle_hygiene.pdf"
    c = canvas.Canvas(pdf_path, pagesize=landscape(A4))
    width, height = landscape(A4)
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(width/2, height - 1.5*cm,
                        "Export Contrôle Hygiène Yorgios")
    c.setFont("Helvetica", 10)
    c.drawCentredString(width/2, height - 2.2*cm,
                        f"Période : {date_debut.strftime('%d/%m/%Y')} au {date_fin.strftime('%d/%m/%Y')}")
    y = height - 3.5*cm

    def draw_table(title, df, y_pos):
        c.setFont("Helvetica-Bold", 11)
        c.drawString(2*cm, y_pos, title)
        y_pos -= 0.5*cm
        c.setFont("Helvetica", 8)
        # colonnes jusqu’à 6
        for i, col in enumerate(df.columns[:6]):
            c.drawString((i+1)*3*cm, y_pos, str(col)[:15])
        y_pos -= 0.4*cm
        for row in df.values[:15]:
            for i, val in enumerate(row[:6]):
                c.drawString((i+1)*3*cm, y_pos, str(val)[:15])
            y_pos -= 0.35*cm
        return y_pos - 0.7*cm

    if not temp_df.empty:
        y = draw_table("🌡️ Températures relevées", temp_df, y)
    if not hygiene_df.empty:
        y = draw_table("🧼 Relevés Hygiène", hygiene_df, y)
    if not haccp_df.empty:
        y = draw_table("📦 Produits retirés (HACCP)", haccp_df, y)

    c.showPage()
    c.save()
    return pdf_path

# ———————————————————————————————
# LECTURE de fichiers PROTOCOLES depuis Google Drive
# ———————————————————————————————
def read_txt_from_drive(file_name, folder_id="14Pa-svM3uF9JQtjKysP0-awxK0BDi35E"):
    scopes = ["https://www.googleapis.com/auth/drive.readonly"]
    creds = Credentials.from_service_account_info(
        json.loads(st.secrets["GOOGLE_SERVICE_ACCOUNT_JSON"]), scopes=scopes
    )
    service = build("drive", "v3", credentials=creds)
    # cherche le fichier dans le dossier
    res = service.files().list(
        q=f"name='{file_name}' and '{folder_id}' in parents",
        fields="files(id,name)", pageSize=1
    ).execute()
    files = res.get("files", [])
    if not files:
        return None
    file_id = files[0]["id"]
    request = service.files().get_media(fileId=file_id)
    fh = BytesIO()
    dl = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        _, done = dl.next_chunk()
    return fh.getvalue().decode("utf-8")

# ———————————————————————————————
# AUTHENTIFICATION GOOGLE SHEETS
# ———————————————————————————————
def gsheets_client():
    sa_info = json.loads(st.secrets["GOOGLE_SERVICE_ACCOUNT_JSON"])
    sa_info["private_key"] = sa_info["private_key"].replace("\\n", "\n")
    scopes = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ]
    creds = ServiceAccountCredentials.from_json_keyfile_dict(sa_info, scopes)
    return gspread.authorize(creds)

gc = gsheets_client()

# ———————————————————————————————
# FALLBACK open_by_key → openall
# ———————————————————————————————
def open_sheet(key: str) -> gspread.Spreadsheet:
    try:
        return gc.open_by_key(key)
    except SpreadsheetNotFound:
        for sh in gc.openall():
            if sh.id == key:
                return sh
        raise

# ———————————————————————————————
# IDS DES SPREADSHEETS
# ———————————————————————————————
SHEET_COMMANDES_ID = "1cBP7iEeWK5whbHzoZAWUhq_HQ5OcAEjTBkUro2cmkoc"
SHEET_HYGIENE_ID   = "1XMYhh2CSIv1zyTtXKM4_ACEhW-6kXxoFi4ACzNhbuDE"
SHEET_TEMP_ID      = "1e4hS6iawCa1IizhzY3xhskLy8Gj3todP3zzk38s7aq0"
SHEET_PLANNING_ID  = "1OBYGNHtHdDB2jufKKjoAwq6RiiS_pnz4ta63sAM-t_0"
SHEET_PRODUITS_ID  = "1FbRV4KgXyCwqwLqJkyq8cHZbo_BfB7kyyPP3pO53Snk"

# ———————————————————————————————
# CHARGEMENT DES FEUILLES
# ———————————————————————————————
ss_cmd        = open_sheet(SHEET_COMMANDES_ID)
sheet_haccp   = ss_cmd.worksheet("Suivi HACCP")
sheet_vitrine = ss_cmd.worksheet("Vitrine")

ss_hygiene   = open_sheet(SHEET_HYGIENE_ID)
ss_temp      = open_sheet(SHEET_TEMP_ID)
ss_planning  = open_sheet(SHEET_PLANNING_ID)
ss_produits  = open_sheet(SHEET_PRODUITS_ID)
sheet_prod   = ss_produits.worksheet("Produits")

# ———————————————————————————————
# UTILITAIRES DE CHARGEMENT / SAUVEGARDE
# ———————————————————————————————
@st.cache_data(ttl=300)
def load_df(_sh, ws_name):
    ws = _sh.worksheet(ws_name)
    return pd.DataFrame(ws.get_all_records())

def save_df(sh, ws_name, df: pd.DataFrame):
    # colonnes dans l’ordre attendu
    df = df[["frigo", "article", "quantite", "dlc"]]
    df = df.fillna("").astype(str)
    ws = sh.worksheet(ws_name)
    ws.clear()
    ws.update([df.columns.tolist()] + df.values.tolist())

# ———————————————————————————————
# LISTES & CONSTANTES
# ———————————————————————————————
produits_list = sorted(
    set(p.strip().capitalize() for p in sheet_prod.col_values(1) if p.strip())
)

JOURS_FR = {
    "Monday": "Lundi", "Tuesday": "Mardi", "Wednesday": "Mercredi",
    "Thursday": "Jeudi", "Friday": "Vendredi",
    "Saturday": "Samedi", "Sunday": "Dimanche"
}

onglets = [
    "🌡️ Relevé des températures",
    "🧼 Hygiène",
    "🧊 Stockage Frigo",
    "📋 Protocoles",
    "📅 Planning",
    "🖥️ Vitrine",
    "🛎️ Ruptures & Commandes",
    "🧾 Contrôle Hygiène",
    "🔗 Liens Google Sheets"
]
choix = st.sidebar.radio("Navigation", onglets, key="onglet_actif")

# ———————————————————————————————
# ONGLET : Relevé des températures
# ———————————————————————————————
if choix == "🌡️ Relevé des températures":
    st.header("🌡️ Relevé des températures")
    jour = st.date_input("🗓️ Sélectionner la date", value=date.today())
    nom_ws = f"Semaine {jour.isocalendar().week} {jour.year}"
    try:
        ws = ss_temp.worksheet(nom_ws)
    except WorksheetNotFound:
        st.warning(f"⚠️ La feuille « {nom_ws} » est introuvable.")
        if st.button(f"➕ Créer « {nom_ws} » depuis Semaine 38"):
            model = ss_temp.worksheet("Semaine 38")
            ss_temp.duplicate_sheet(source_sheet_id=model.id, new_sheet_name=nom_ws)
            st.experimental_rerun()
        st.stop()
    raw = ws.get_all_values()
    if len(raw) < 2:
        st.warning("⚠️ La feuille est vide ou mal formatée."); st.stop()
    df_temp = pd.DataFrame(raw[1:], columns=raw[0])
    frigos = df_temp.iloc[:,0].tolist()
    moment = st.selectbox("🕒 Moment du relevé", ["Matin","Soir"])
    with st.form("form_temp"):
        saisies = {f: st.text_input(f, value="", key=f"t_{f}") for f in frigos}
        if st.form_submit_button("✅ Valider"):
            col = f"{JOURS_FR[jour.strftime('%A')]} {moment}"
            if col not in df_temp.columns:
                st.error(f"Colonne '{col}' introuvable.")
            else:
                for i,f in enumerate(frigos):
                    df_temp.at[i,col] = saisies[f]
                ws.update("A1",[df_temp.columns.tolist()]+df_temp.values.tolist())
                st.success("✅ Relevés sauvegardés.")
    disp = df_temp.replace("","⛔️")
    st.subheader("📊 Aperçu complet")
    st.dataframe(disp.style.applymap(lambda v: "color:red;" if v=="⛔️" else "color:green;"),
                 use_container_width=True)

# … (continue avec les autres onglets : Hygiène, Stockage Frigo, Protocoles, Planning, Vitrine, Contrôle Hygiène, Liens) …

# ———————————————————————————————
# PIED DE PAGE
# ———————————————————————————————
st.markdown("""
<hr style="margin-top:40px; margin-bottom:10px">
<p style="text-align:center; font-size:12px;">
    Application Yorgios • Développée avec ❤️ & Demis
</p>
""", unsafe_allow_html=True)
# ——— ONGLET TEMPÉRATURES ———
if choix == "🌡️ Relevé des températures":
    st.header("🌡️ Relevé des températures")
    jour = st.date_input("🗓️ Sélectionner la date", value=date.today())
    nom_ws = f"Semaine {jour.isocalendar().week} {jour.year}"

    try:
        ws = ss_temp.worksheet(nom_ws)
        st.markdown(f"🗓️ Données depuis **{nom_ws}**")
    except WorksheetNotFound:
        st.warning(f"⚠️ La feuille « {nom_ws} » est introuvable.")
        if st.button(f"➕ Créer « {nom_ws} » depuis Semaine 38"):
            model = ss_temp.worksheet("Semaine 38")
            ss_temp.duplicate_sheet(source_sheet_id=model.id, new_sheet_name=nom_ws)
            st.rerun()
        st.stop()

    raw = ws.get_all_values()
    if len(raw) < 2:
        st.warning("⚠️ La feuille est vide ou mal formatée.")
        st.stop()

    df_temp = pd.DataFrame(raw[1:], columns=raw[0])
    frigos = df_temp.iloc[:, 0].tolist()
    moment = st.selectbox("🕒 Moment du relevé", ["Matin", "Soir"])

    with st.form("form_temp"):
        saisies = {f: st.text_input(f, value="", key=f"temp_{f}") for f in frigos}
        if st.form_submit_button("✅ Valider les relevés"):
            col = f"{JOURS_FR[jour.strftime('%A')]} {moment}"
            if col not in df_temp.columns:
                st.error(f"❌ Colonne '{col}' introuvable.")
            else:
                for i, f in enumerate(frigos):
                    df_temp.at[i, col] = saisies[f]
                ws.update("A1", [df_temp.columns.tolist()] + df_temp.values.tolist())
                st.success("✅ Relevés sauvegardés.")

    st.subheader("📊 Aperçu complet")
    disp = df_temp.replace("", "⛔️")
    st.dataframe(
        disp.style.applymap(lambda v: "color:red;" if v == "⛔️" else "color:green;"),
        use_container_width=True
    )

# ——— ONGLET HYGIÈNE ———
elif choix == "🧼 Hygiène":
    st.header("🧼 Relevé Hygiène – Aujourd’hui")
    typ = st.selectbox("📋 Type de tâches", ["Quotidien", "Hebdomadaire", "Mensuel"])
    try:
        ws = ss_hygiene.worksheet(typ)
    except Exception as e:
        st.error(f"❌ Impossible d’ouvrir '{typ}': {e}")
        st.stop()
    raw = ws.get_all_values()
    if len(raw) < 2:
        st.warning("⚠️ Feuille vide ou mal formatée.")
        st.stop()
    df_hyg = pd.DataFrame(raw[1:], columns=raw[0])
    today_str = date.today().strftime("%Y-%m-%d")
    if today_str in df_hyg["Date"].values:
        idx = df_hyg.index[df_hyg["Date"] == today_str][0]
    else:
        idx = len(df_hyg)
        new_row = {c: "" for c in df_hyg.columns}
        new_row["Date"] = today_str
        df_hyg = pd.concat([df_hyg, pd.DataFrame([new_row])], ignore_index=True)
    with st.form("form_hyg"):
        checks = {
            c: st.checkbox(c, value=(df_hyg.at[idx, c] == "✅"), key=f"chk_{c}")
            for c in df_hyg.columns[1:]
        }
        if st.form_submit_button("✅ Valider la journée"):
            for c, done in checks.items():
                df_hyg.at[idx, c] = "✅" if done else ""
            ws.update("A1", [df_hyg.columns.tolist()] + df_hyg.values.tolist())
            st.success("✅ Hygiène sauvegardée.")

# ——— ONGLET PLANNING ———
elif choix == "📅 Planning":
    st.header("📅 Planning Google")
    try:
        titres = sorted(
            [w.title for w in ss_planning.worksheets() if w.title.lower().startswith("semaine")],
            key=lambda x: int("".join(filter(str.isdigit, x)))
        )
        dt = st.date_input("📅 Choisir une date", value=date.today())
        nom_ws = f"Semaine {dt.isocalendar().week}"
        if nom_ws not in titres:
            st.warning(f"⚠️ Feuille « {nom_ws} » introuvable, affichage de « {titres[-1]} ».")
            nom_ws = titres[-1]
        ws = ss_planning.worksheet(nom_ws)
        raw = ws.get_all_values()
        st.markdown(f"🗓️ **{nom_ws}**")
        df_pl = pd.DataFrame(raw[1:], columns=raw[0]).replace("", None)
        prenoms = df_pl["Prenoms"].dropna().unique().tolist()
        filt = st.selectbox("👤 Filtrer par prénom", ["Tous"] + prenoms)
        if filt == "Tous":
            st.dataframe(df_pl, use_container_width=True)
        else:
            jours_col = raw[0][1:8]
            jours_fr = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]
            ligne = df_pl[df_pl["Prenoms"] == filt]
            horaires = ligne.values.tolist()[0][1:8] if not ligne.empty else [""] * 7
            horaires = [h or "–" for h in horaires]
            df_aff = pd.DataFrame({"Jour": jours_fr, "Horaires": horaires})
            st.dataframe(df_aff, use_container_width=True)
            if st.button("📥 Télécharger .ics"):
                cal = Calendar()
                tz = pytz.timezone("Europe/Paris")
                for i, cell in enumerate(horaires):
                    if cell == "–":
                        continue
                    date_str = re.search(r"\d{2}/\d{2}/\d{4}", jours_col[i]).group()
                    date_obj = datetime.strptime(date_str, "%d/%m/%Y")
                    h_deb, h_fin = cell.split(" à ")
                    dt_start = tz.localize(datetime.combine(date_obj, datetime.strptime(h_deb, "%H:%M").time()))
                    dt_end = tz.localize(datetime.combine(date_obj, datetime.strptime(h_fin, "%H:%M").time()))
                    ev = Event()
                    ev.name = f"{filt} – {h_deb} à {h_fin}"
                    ev.begin = dt_start
                    ev.end = dt_end
                    cal.events.add(ev)
                path = "/tmp/planning.ics"
                with open(path, "w") as f:
                    f.writelines(cal)
                with open(path, "rb") as f:
                    st.download_button("📅 Télécharger le fichier .ics", f, file_name=f"planning_{filt}.ics")
                st.success("✅ Export terminé.")
    except Exception as e:
        st.error(f"❌ Erreur planning : {e}")

# ——— ONGLET STOCKAGE FRIGO ———
elif choix == "🧊 Stockage Frigo":
    st.header("🧊 Gestion du Stock par Frigo")

    # 1️⃣ Chargement + nettoyage
    df_stock = load_df(ss_cmd, "Stockage Frigo")
    df_stock.columns = [c.strip().lower().replace(" ", "_") for c in df_stock.columns]

    required = {"frigo", "article", "quantite", "dlc"}
    if not required.issubset(df_stock.columns):
        st.error(f"❌ Colonnes attendues manquantes : {required - set(df_stock.columns)}")
        st.stop()

    # Uniformiser les formats
    df_stock["frigo"] = df_stock["frigo"].astype(str).str.strip()
    # On convertit dlc en datetime pour le tri et l'alerte
    df_stock["dlc"] = pd.to_datetime(df_stock["dlc"], errors="coerce")
    frigos_dispo = sorted(df_stock["frigo"].dropna().unique())

    # 2️⃣ Sélection du frigo
    frigo_select = st.selectbox("🧊 Choisir un frigo", frigos_dispo)
    df_frigo = df_stock[df_stock["frigo"] == frigo_select].copy()

    # 3️⃣ Alerte DLC
    today = pd.Timestamp.today().normalize()
    df_frigo["jours_restants"] = (df_frigo["dlc"] - today).dt.days
    alertes = df_frigo[df_frigo["jours_restants"] <= 1]
    if not alertes.empty:
        st.warning("⚠️ Produits avec DLC proche ou dépassée :")
        st.dataframe(alertes[["article", "quantite", "dlc"]], use_container_width=True)

    # 4️⃣ Vidage complet
    if st.button(f"🗑️ Vider complètement {frigo_select}"):
        if st.confirm(f"⚠️ Confirmer suppression de tous les articles de {frigo_select} ?"):
            autres = df_stock[df_stock["frigo"] != frigo_select]
            # Sauvegarde directe : on convertit tout en str
            df_autres = autres[["frigo","article","quantite","dlc"]].copy()
            df_autres["dlc"] = df_autres["dlc"].dt.strftime("%Y-%m-%d").fillna("")
            df_autres["quantite"] = df_autres["quantite"].fillna(0).astype(int).astype(str)
            save_df(ss_cmd, "Stockage Frigo", df_autres.fillna("").astype(str))
            st.success(f"✅ {frigo_select} vidé avec succès.")
            st.rerun()

    # 5️⃣ Édition en place
    st.subheader(f"📋 Contenu de {frigo_select}")
    df_frigo["supprimer"] = False
    edited = st.data_editor(
        df_frigo[["article", "quantite", "dlc", "supprimer"]],
        num_rows="dynamic",
        use_container_width=True,
        key="editor_stock_frigo"
    )

    # 6️⃣ Formulaire d’ajout
    st.markdown("---")
    st.subheader("➕ Ajouter un article")
    col1, col2, col3 = st.columns(3)
    with col1:
        new_article = st.text_input("Article")
    with col2:
        new_qty = st.number_input("Quantité", min_value=0, step=1, value=0)
    with col3:
        new_dlc = st.date_input("DLC", value=date.today() + timedelta(days=3))

    # 7️⃣ Bouton Sauvegarder : on reconstruit tout le df et on convertit en str
    if st.button("✅ Sauvegarder"):
        rows = []
        # on garde les lignes non cochées
        for _, row in edited.iterrows():
            if row["supprimer"]:
                continue
            art = str(row["article"]).strip()
            dlc = row["dlc"]
            qty = int(row["quantite"]) if pd.notna(row["quantite"]) else 0
            if art and pd.notna(dlc):
                rows.append({
                    "frigo": frigo_select,
                    "article": art,
                    "quantite": qty,
                    "dlc": dlc.strftime("%Y-%m-%d")
                })

        # on ajoute la nouvelle si renseignée
        if new_article.strip() and new_qty > 0:
            rows.append({
                "frigo": frigo_select,
                "article": new_article.strip(),
                "quantite": new_qty,
                "dlc": new_dlc.strftime("%Y-%m-%d")
            })

        # on récupère les autres frigos
        autres = df_stock[df_stock["frigo"] != frigo_select][["frigo","article","quantite","dlc"]].copy()
        autres["dlc"] = autres["dlc"].dt.strftime("%Y-%m-%d").fillna("")
        autres["quantite"] = autres["quantite"].fillna(0).astype(int).astype(str)

        # fusion + conversion finale
        df_save = pd.concat([autres, pd.DataFrame(rows)], ignore_index=True)
        df_save = df_save[["frigo","article","quantite","dlc"]].fillna("").astype(str)

        # on sauvegarde
        save_df(ss_cmd, "Stockage Frigo", df_save)

        st.success("✅ Stock mis à jour avec succès.")
        st.rerun()
# ——— ONGLET PROTOCOLES ———
elif choix == "📋 Protocoles":
    st.header("📋 Protocoles opérationnels")
    fichiers = {
        "Arrivée": "protocoles_arrivee.txt",
        "Fermeture": "protocoles_fermeture.txt",
        "Temps calme": "protocoles_tempscalmes.txt",
        "Stockage": "protocole_stockage.txt",
        "Hygiène du personnel": "protocoles_hygiene du personnel.txt",
        "Service du midi": "protocoles_midi.txt",
        "Règles en stand": "protocoles_regles en stand.txt",
        "Hygiène générale": "protocole_hygiene.txt"
    }
    choix_proto = st.selectbox("🧾 Choisir un protocole à consulter", list(fichiers))
    txt = read_txt_from_drive(fichiers[choix_proto])
    if txt:
        st.markdown(f"### 🗂️ {choix_proto}")
        txt_clean = txt.replace("\n", "").replace("•", "\n\n•").strip()
        st.markdown(txt_clean, unsafe_allow_html=True)
    else:
        st.error("⚠️ Fichier introuvable dans le dossier Google Drive.")

# ——— ONGLET VITRINE ———
elif choix == "🖥️ Vitrine":
    st.header("🖥️ Vitrine – Traçabilité HACCP")
    raw = sheet_vitrine.get_all_values()
    cols, data = raw[0], raw[1:]
    ids = list(range(2, 2 + len(data)))
    df = pd.DataFrame(data, columns=cols)
    df["_row"] = ids
    df.columns = [c.strip().lower().replace(" ", "_").replace("é", "e") for c in df.columns]
    actifs = df[df["date_retrait"] == ""].copy()
    archives = df[df["date_retrait"] != ""].copy()
    today = date.today()
    today_str = today.strftime("%Y-%m-%d")

    def style_dlc(v):
        try:
            d = datetime.strptime(v, "%Y-%m-%d").date()
        except:
            return ""
        diff = (d - today).days
        if diff <= 0:
            return "background-color:#f8d7da"
        elif diff == 1:
            return "background-color:#fff3cd"
        else:
            return "background-color:#d4edda"

    st.subheader("📝 Articles en vitrine (actifs)")
    if actifs.empty:
        st.write("Aucun article en vitrine actuellement.")
    else:
        disp = actifs.drop(columns=["_row"])
        st.dataframe(disp.style.applymap(style_dlc, subset=["dlc"]), use_container_width=True)
        st.write("#### Retirer un article")
        for _, row in actifs.iterrows():
            label = f"❌ Retirer – {row['produit']} ({row['numero_de_lot']})"
            if st.button(label, key=f"ret_{row['_row']}"):
                col_idx = df.columns.get_loc("date_retrait") + 1
                sheet_vitrine.update_cell(row["_row"], col_idx, today_str)
                st.success(f"✅ {row['produit']} retiré le {today_str}")
                st.rerun()

    with st.expander("📚 Historique des retraits"):
        if archives.empty:
            st.write("Pas encore d’articles retirés.")
        else:
            st.dataframe(archives.drop(columns=["_row"]), use_container_width=True)

    st.markdown("---")
    st.subheader("➕ Ajouter un nouvel article")
    with st.form("form_add_vitrine"):
        date_ajout = st.date_input("Date d’ajout", value=today)
        prod = st.selectbox("Produit", produits_list)
        dfab = st.date_input("Date de fabrication", value=today)
        dlc = st.date_input("DLC", value=today + timedelta(days=3))
        if st.form_submit_button("✅ Ajouter en vitrine"):
            nouveau_lot = f"{dfab.strftime('%Y%m%d')}-MAN-{len(actifs)+1}"
            row = [
                date_ajout.strftime("%Y-%m-%d"),
                prod,
                nouveau_lot,
                dfab.strftime("%Y-%m-%d"),
                dlc.strftime("%Y-%m-%d"),
                ""
            ]
            sheet_vitrine.append_row(row)
            st.success(f"✅ {prod} ajouté en vitrine.")
            st.rerun()

# ——— ONGLET RUPTURES ET COMMANDES ———
elif choix == "🛎️ Ruptures & Commandes":
    st.header("🛎️ Ruptures & Commandes")
    st.write("Sélectionnez les produits en rupture et envoyez facilement la demande.")

    # Multi-sélect des produits
    ruptures = st.multiselect(
        "Produits en rupture",
        options=produits_list,
        help="Cochez un ou plusieurs produits à commander"
    )

    commentaire = st.text_area(
        "Commentaire / Quantités",
        help="Optionnel : précisez les quantités ou infos complémentaires"
    )

    # Numéros à configurer dans st.secrets
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
                # wa_num sans '+' : "33123456789"
                url = f"https://wa.me/{wa_num}?text={urllib.parse.quote(msg)}"
                st.markdown(f"[➡️ Ouvrir WhatsApp]({url})")


# ——— ONGLET CONTROLE HYGIENE ———
elif choix == "🧾 Contrôle Hygiène":
    st.header("🧾 Export Contrôle Hygiène / Température / HACCP")

    date_debut = st.date_input("📆 Début de la période", value=date.today() - timedelta(days=7))
    date_fin   = st.date_input("📆 Fin de la période", value=date.today())

    if st.button("📥 Exporter les relevés PDF"):
        st.info("⏳ Génération en cours...")

        # Températures
        temp_frames = []
        for ws in ss_temp.worksheets():
            if "Semaine" not in ws.title:
                continue
            raw = ws.get_all_values()
            if len(raw) < 2: continue
            df = pd.DataFrame(raw[1:], columns=raw[0])
            for col in df.columns[1:]:
                try:
                    jour_str, moment = col.split()
                    jour = datetime.strptime(jour_str, "%A").date()
                    if date_debut <= jour <= date_fin:
                        df_sub = df[[df.columns[0], col]].copy()
                        df_sub.columns = ["Frigo", f"{col}"]
                        temp_frames.append(df_sub)
                except:
                    continue

        if temp_frames:
            df_all_temp = pd.concat(temp_frames, axis=1)
            st.subheader("🌡️ Températures")
            st.dataframe(df_all_temp, use_container_width=True)

        # Hygiène
        st.subheader("🧼 Hygiène (quotidien)")
        ws_hyg = ss_hygiene.worksheet("Quotidien")
        raw = ws_hyg.get_all_values()
        df_hyg = pd.DataFrame(raw[1:], columns=raw[0])
        df_hyg["Date"] = pd.to_datetime(df_hyg["Date"], errors="coerce")
        df_filtre = df_hyg[(df_hyg["Date"] >= pd.to_datetime(date_debut)) & (df_hyg["Date"] <= pd.to_datetime(date_fin))]
        st.dataframe(df_filtre.fillna(""), use_container_width=True)

        # HACCP
        st.subheader("📦 Produits retirés (HACCP)")
        raw = sheet_vitrine.get_all_values()
        df = pd.DataFrame(raw[1:], columns=raw[0])
        df["date_retrait"] = pd.to_datetime(df["date_retrait"], errors="coerce")
        archives = df[(df["date_retrait"] >= pd.to_datetime(date_debut)) & (df["date_retrait"] <= pd.to_datetime(date_fin))]
        if not archives.empty:
            st.dataframe(archives, use_container_width=True)
        else:
            st.info("Aucun produit retiré sur la période.")

        st.success("✅ Données prêtes pour impression ou export.")
        
        pdf_path = generate_contrôle_hygiene_pdf(df_all_temp, df_filtre, archives, date_debut, date_fin)
        with open(pdf_path, "rb") as f:
            st.download_button("📄 Télécharger le PDF", f, file_name="controle_hygiene.pdf")

# ——— ONGLET LIENS GOOGLE SHEETS ———
elif choix == "🔗 Liens Google Sheets":
    st.header("🔗 Liens vers les Google Sheets utilisés")

    sheets = {
        "📦 Commandes + HACCP + Vitrine" : "https://docs.google.com/spreadsheets/d/1cBP7iEeWK5whbHzoZAWUhq_HQ5OcAEjTBkUro2cmkoc",
        "🧼 Hygiène"                     : "https://docs.google.com/spreadsheets/d/1XMYhh2CSIv1zyTtXKM4_ACEhW-6kXxoFi4ACzNhbuDE",
        "🌡️ Températures"               : "https://docs.google.com/spreadsheets/d/1e4hS6iawCa1IizhzY3xhskLy8Gj3todP3zzk38s7aq0",
        "📅 Planning"                   : "https://docs.google.com/spreadsheets/d/1OBYGNHtHdDB2jufKKjoAwq6RiiS_pnz4ta63sAM-t_0",
        "🛒 Liste Produits"             : "https://docs.google.com/spreadsheets/d/1FbRV4KgXyCwqwLqJkyq8cHZbo_BfB7kyyPP3pO53Snk"
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
        Application Yorgios • Développée avec ❤️ & Demis
    </p>
    """,
    unsafe_allow_html=True
)
