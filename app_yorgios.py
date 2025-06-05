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
# FONCTION DE GÉNÉRATION DU PDF Contrôle Hygiène (avec pagination automatique)
# ———————————————————————————————
def generate_controle_hygiene_pdf(temp_df, hygiene_df, vitrine_df, date_debut, date_fin):
    """
    Crée un PDF paginé (format A4, paysage) contenant :
      • tous les relevés de températures (temp_df) filtrés,
      • tous les relevés d’hygiène filtrés (hygiene_df),
      • tous les articles de Vitrine filtrés (vitrine_df),
    sur la période [date_debut, date_fin].

    Renvoie le chemin local du PDF généré.
    """
    pdf_path = "/tmp/controle_hygiene.pdf"
    c = canvas.Canvas(pdf_path, pagesize=landscape(A4))
    width, height = landscape(A4)

    # Dessine le titre en en-tête sur chaque page
    def draw_title():
        c.setFont("Helvetica-Bold", 14)
        c.drawCentredString(
            width / 2,
            height - 1.5 * cm,
            "Export Contrôle Hygiène Yorgios"
        )
        c.setFont("Helvetica", 10)
        c.drawCentredString(
            width / 2,
            height - 2.2 * cm,
            f"Période : {date_debut.strftime('%d/%m/%Y')} au {date_fin.strftime('%d/%m/%Y')}"
        )

    # Fonction générique pour dessiner un sous-tableau (max 20 lignes/page, 6 colonnes)
    def draw_chunked_table(title, df):
        if df.empty:
            return
        chunk_size = 20
        for start in range(0, len(df), chunk_size):
            chunk = df.iloc[start : start + chunk_size]
            y = height - 3.5 * cm
            draw_title()
            c.setFont("Helvetica-Bold", 11)
            c.drawString(2 * cm, y, title + ("" if start == 0 else f" (suite)"))
            y -= 0.5 * cm
            c.setFont("Helvetica", 8)
            # En-têtes (jusqu’à 6 colonnes)
            for i, col in enumerate(chunk.columns[:6]):
                c.drawString((i + 1) * 3 * cm, y, str(col)[:15])
            y -= 0.4 * cm
            # Données chunk
            for row in chunk.values:
                for i, val in enumerate(row[:6]):
                    c.drawString((i + 1) * 3 * cm, y, str(val)[:15])
                y -= 0.35 * cm
            c.showPage()

    # 1) Températures
    draw_chunked_table("🌡️ Températures relevées", temp_df)

    # 2) Hygiène
    draw_chunked_table("🧼 Relevés Hygiène", hygiene_df)

    # 3) Vitrine
    draw_chunked_table("🖥️ Articles en Vitrine", vitrine_df)

    c.save()
    return pdf_path

# ———————————————————————————————
# CONFIGURATION STREAMLIT
# ———————————————————————————————
st.set_page_config(page_title="Yorgios V1", layout="wide")
try:
    locale.setlocale(locale.LC_TIME, 'fr_FR.UTF-8')
except locale.Error:
    pass

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

def read_txt_from_drive(file_name, folder_id="14Pa-svM3uF9JQtjKysP0-awxK0BDi35E"):
    scopes = ["https://www.googleapis.com/auth/drive.readonly"]
    creds = Credentials.from_service_account_info(
        json.loads(st.secrets["GOOGLE_SERVICE_ACCOUNT_JSON"]),
        scopes=scopes
    )
    service = build("drive", "v3", credentials=creds)

    results = service.files().list(
        q=f"name='{file_name}' and '{folder_id}' in parents",
        fields="files(id, name)", pageSize=1
    ).execute()
    files = results.get("files", [])
    if not files:
        return None

    file_id = files[0]["id"]
    request = service.files().get_media(fileId=file_id)
    fh = BytesIO()
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return fh.getvalue().decode("utf-8")

# ———————————————————————————————
# ID des fichiers Google Sheets
# ———————————————————————————————
SHEET_COMMANDES_ID = "1cBP7iEeWK5whbHzoZAWUhq_HQ5OcAEjTBkUro2cmkoc"
SHEET_HYGIENE_ID   = "1phiQjSYqvHdVEqv7uAt8pitRE0NfKv4b1f4UUzUqbXQ"
SHEET_TEMP_ID      = "1e4hS6iawCa1IizhzY3xhskLy8Gj3todP3zzk38s7aq0"
SHEET_PLANNING_ID  = "1OBYGNHtHdDB2jufKKjoAwq6RiiS_pnz4ta63sAM-t_0"
SHEET_PRODUITS_ID  = "1FbRV4KgXyCwqwLqJkyq8cHZbo_BfB7kyyPP3pO53Snk"

# ———————————————————————————————
# Chargement des feuilles principales
# ———————————————————————————————
ss_cmd        = gc.open_by_key(SHEET_COMMANDES_ID)
sheet_haccp   = ss_cmd.worksheet("Suivi HACCP")
sheet_vitrine = ss_cmd.worksheet("Vitrine")

ss_hygiene    = gc.open_by_key(SHEET_HYGIENE_ID)
ss_temp       = gc.open_by_key(SHEET_TEMP_ID)
ss_planning   = gc.open_by_key(SHEET_PLANNING_ID)
ss_produits   = gc.open_by_key(SHEET_PRODUITS_ID)
sheet_prod    = ss_produits.worksheet("Produits")

# ———————————————————————————————
# UTILITAIRES DE CHARGEMENT / SAUVEGARDE
# ———————————————————————————————
def load_df(sh, ws_name):
    ws = sh.worksheet(ws_name)
    return pd.DataFrame(ws.get_all_records())

def save_df(sh, ws_name, df: pd.DataFrame):
    # On s'assure d’avoir les colonnes dans l’ordre attendu
    df = df[["frigo", "article", "quantite", "dlc"]]
    df = df.fillna("").astype(str)
    ws = sh.worksheet(ws_name)
    ws.clear()
    ws.update([df.columns.tolist()] + df.values.tolist())

# ———————————————————————————————
# Liste des produits
# ———————————————————————————————
produits_list = sorted(
    set(p.strip().capitalize() for p in sheet_prod.col_values(1) if p.strip())
)

# ———————————————————————————————
# Jours en français
# ———————————————————————————————
JOURS_FR = {
    "Monday":    "Lundi",
    "Tuesday":   "Mardi",
    "Wednesday": "Mercredi",
    "Thursday":  "Jeudi",
    "Friday":    "Vendredi",
    "Saturday":  "Samedi",
    "Sunday":    "Dimanche"
}

# ———————————————————————————————
# Navigation (onglets)
# ———————————————————————————————
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
choix = st.sidebar.radio("Navigation", onglets)
# ———————————————————————————————
# ONGLET : Relevé des températures
# ———————————————————————————————
if choix == "🌡️ Relevé des températures":
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
            st.experimental_rerun()
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
            # construction du libellé recherché
            jours_fr = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"]
            cible    = f"{jours_fr[jour.weekday()]} {moment}".strip()

            # comparaison insensible à la casse
            header_lower = [h.lower() for h in header]
            if cible.lower() not in header_lower:
                st.error(
                    f"Colonne « {cible} » introuvable.\n"
                    f"Colonnes disponibles : {', '.join(header)}"
                )
            else:
                # on récupère le vrai nom de colonne
                col_reelle = header[header_lower.index(cible.lower())]
                # on met à jour la df
                for i, f in enumerate(frigos):
                    df_temp.at[i, col_reelle] = saisies[f]
                # on ré-écrit tout (en gardant l'en-tête d'origine)
                ws.update("A1", [header] + df_temp.values.tolist())
                st.success("✅ Relevés sauvegardés.")

    # 6) Affichage complet coloré
    disp = df_temp.replace("", "⛔️")
    st.subheader("📊 Aperçu complet")
    st.dataframe(
        disp.style.applymap(
            lambda v: "color:red;" if v == "⛔️" else "color:green;"
        ),
        use_container_width=True
    )
# —————————————— ONGLET “🧼 Hygiène” ——————————————
elif choix == "🧼 Hygiène":
    st.header("🧼 Relevé Hygiène – Aujourd’hui")
    typ = st.selectbox("📋 Type de tâches", ["Quotidien", "Hebdomadaire", "Mensuel"], key="hyg_type")

    # Clé unique pour stocker le DataFrame et l’index de la date du jour
    df_key  = f"df_hyg_{typ}"
    idx_key = f"df_hyg_idx_{typ}"

    # 1) Si on n’a pas encore en session le DataFrame ou si on vient de changer de type
    if df_key not in st.session_state:
        # 1.a) Charger la feuille depuis Google Sheets
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

        # 1.b) Trouver ou créer la ligne du jour
        today_str = date.today().strftime("%Y-%m-%d")
        if today_str in df_hyg["Date"].values:
            idx = int(df_hyg.index[df_hyg["Date"] == today_str][0])
        else:
            idx = len(df_hyg)
            new_row = {col: "" for col in df_hyg.columns}
            new_row["Date"] = today_str
            df_hyg = pd.concat([df_hyg, pd.DataFrame([new_row])], ignore_index=True)

        # Stocker dans session_state
        st.session_state[df_key]  = df_hyg
        st.session_state[idx_key] = idx

    # Récupérer de la session
    df_hyg = st.session_state[df_key]
    idx    = st.session_state[idx_key]
    today_str = date.today().strftime("%Y-%m-%d")

    st.subheader(f"✅ Cochez les tâches effectuées pour le {today_str}")

    # 2) Afficher les checkboxes (mais ne PAS modifier Google Sheets à chaque clic)
    #    On lit/écrit uniquement dans st.session_state["hyg_chk_{typ}_{col}"]
    checks = {}
    for col in df_hyg.columns[1:]:
        chk_key = f"hyg_chk_{typ}_{col}"
        # Valeur initiale pour la checkbox
        if chk_key not in st.session_state:
            st.session_state[chk_key] = (str(df_hyg.at[idx, col]) == "✅")
        checks[col] = st.checkbox(col, value=st.session_state[chk_key], key=chk_key)

    # 3) Bouton pour mettre à jour TOUT d’un coup
    if st.button("📅 Valider la journée"):
        # 3.a) Mettre à jour le DataFrame en mémoire
        for col, val in checks.items():
            df_hyg.at[idx, col] = "✅" if val else ""

        # 3.b) Reconstruire le tableau complet à envoyer
        nouvelle_feuille = [df_hyg.columns.tolist()] + df_hyg.values.tolist()

        try:
            # On récupère encore la worksheet pour être sûr qu’elle n’a pas changé
            ws = ss_hygiene.worksheet(typ)
            ws.update("A1", nouvelle_feuille)
            st.success("✅ Hygiène mise à jour dans Google Sheets.")
            # 3.c) Supprimer de session_state pour recharger au prochain passage
            del st.session_state[df_key]
            del st.session_state[idx_key]
            # Optionnel : effacer aussi les keys des checkboxes (pour repartir à zéro)
            for col in df_hyg.columns[1:]:
                chk_key = f"hyg_chk_{typ}_{col}"
                if chk_key in st.session_state:
                    del st.session_state[chk_key]
        except Exception as e:
            st.error(f"❌ Erreur lors de la mise à jour du Google Sheet : {e}")
# ——— ONGLET PLANNING ———
elif choix == "📅 Planning":
    st.header("📅 Planning Google")

    date_sel = st.date_input(
        "📅 Choisir une date",
        value=date.today(),
        key="pl_date"
    )

    titres = [w.title for w in ss_planning.worksheets() if w.title.lower().startswith("semaine")]
    titres.sort(key=lambda x: int(re.search(r"\d+", x).group()))

    semaine_iso = date_sel.isocalendar().week
    nom_ws = f"Semaine {semaine_iso}"
    if nom_ws not in titres:
        st.warning(f"⚠️ Feuille « {nom_ws} » introuvable. Dernière utilisée.")
        nom_ws = titres[-1]

    ws = ss_planning.worksheet(nom_ws)
    raw = ws.get_all_values()
    df_pl = pd.DataFrame(raw[1:], columns=raw[0]).replace("", None)

    filt = st.selectbox(
        "👤 Filtrer par prénom",
        ["Tous"] + df_pl["Prenoms"].dropna().unique().tolist(),
        key="pl_filter"
    )

    if filt == "Tous":
        st.dataframe(df_pl, use_container_width=True)
    else:
        jours_col = raw[0][1:8]
        jours_fr  = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"]
        ligne     = df_pl[df_pl["Prenoms"]==filt]
        horaires  = (ligne.values.tolist()[0][1:8] if not ligne.empty else [""]*7)
        horaires  = [h or "–" for h in horaires]
        df_aff    = pd.DataFrame({"Jour":jours_fr,"Horaires":horaires})
        st.dataframe(df_aff, use_container_width=True)

        if st.button("📥 Télécharger .ics", key="pl_ics"):
            cal = Calendar(); tz = pytz.timezone("Europe/Paris")
            for i, cell in enumerate(horaires):
                if cell == "–": continue
                date_str = re.search(r"\d{2}/\d{2}/\d{4}", jours_col[i]).group()
                dt = datetime.strptime(date_str,"%d/%m/%Y")
                h0, h1 = cell.split(" à ")
                start = tz.localize(datetime.combine(dt, datetime.strptime(h0, "%H:%M").time()))
                end   = tz.localize(datetime.combine(dt, datetime.strptime(h1, "%H:%M").time()))
                e = Event(); e.name = f"{filt} {h0}–{h1}"; e.begin=start; e.end=end
                cal.events.add(e)
            tmp = "/tmp/planning.ics"
            with open(tmp,"w") as f: f.writelines(cal)
            with open(tmp,"rb") as f:
                st.download_button("Télécharger ICS", f, file_name=f"planning_{filt}.ics", key="pl_dl")
            st.success("✅ Exporté.")

elif choix == "🧊 Stockage Frigo":
    st.header("🧊 Gestion du Stock par Frigo")

    #
    # 1) CHARGEMENT + NETTOYAGE
    #
    df_stock = load_df(ss_cmd, "Stockage Frigo")
    df_stock.columns = [c.strip().lower().replace(" ", "_") for c in df_stock.columns]

    # Si une de ces colonnes manque, on arrête tout
    required = {"frigo", "article", "quantite", "dlc"}
    if not required.issubset(df_stock.columns):
        st.error(f"❌ Colonnes attendues manquantes : {required - set(df_stock.columns)}")
        st.stop()

    # Conversion en datetime (pour le calcul d’alerte DLC)
    df_stock["dlc"] = pd.to_datetime(df_stock["dlc"], errors="coerce")

    #
    # 2) SÉLECTEUR “Liste fixe” DES FRIGOS
    #
    liste_frigos = ["Frigo 1", "Frigo 2", "Frigo 3", "Grand Frigo", "Chambre Froide"]
    frigo_select = st.selectbox("🧊 Choisir un frigo", liste_frigos, key="select_frigo")

    #
    # 3) FILTRER LES LIGNES POUR LE FRIGO SÉLECTIONNÉ
    #
    df_frigo = df_stock.loc[df_stock["frigo"] == frigo_select].copy()

    #
    # 4) 🔔 Alerte DLC si < 1 jour restant
    #
    today = pd.Timestamp.today().normalize()
    if not df_frigo.empty:
        df_frigo["jours_restants"] = (df_frigo["dlc"] - today).dt.days
        alertes = df_frigo[df_frigo["jours_restants"] <= 1]
        if not alertes.empty:
            st.warning("⚠️ Produits avec DLC proche ou dépassée :")
            st.dataframe(
                alertes[["article", "quantite", "dlc", "jours_restants"]],
                use_container_width=True
            )

    #
    # 5) 🗑️ VIDAGE COMPLET EN DEUX ÉTAPES via UN FORMULAIRE
    #
    st.markdown("---")
    st.subheader(f"🗑️ Vider complètement « {frigo_select} »")
    with st.form(key=f"form_clear_{frigo_select.replace(' ', '_')}"):
        st.write(f"❗ Cela supprimera **tous** les articles de « {frigo_select} ».")
        valider_clear = st.form_submit_button(label="🔴 Confirmer la suppression complète")
        annuler_clear = st.form_submit_button(label="⚪ Annuler")
        if valider_clear:
            # On reconstruit un DataFrame sans aucune ligne pour ce frigo
            autres = df_stock[df_stock["frigo"] != frigo_select]
            save_df(ss_cmd, "Stockage Frigo", autres)
            # Vider le cache de load_df pour forcer la relecture immédiate
            st.cache_data.clear()
            st.success(f"✅ Contenu de « {frigo_select} » vidé avec succès.")
            # --- Le rerun se fait automatiquement à la soumission du form ---
        if annuler_clear:
            st.info("❌ Suppression annulée.")

    #
    # 6) 📋 AFFICHAGE + ÉDITION PAR LIGNE (DATA_EDITOR + FORMULAIRE)
    #
    st.markdown("---")
    st.subheader(f"📋 Contenu de « {frigo_select} »")
    if df_frigo.empty:
        st.info("Aucun article pour ce frigo.")
    else:
        df_display = df_frigo.reset_index(drop=True).copy()
        df_display["supprimer"] = False

        edited = st.data_editor(
            df_display[["article", "quantite", "dlc", "supprimer"]],
            num_rows="dynamic",
            use_container_width=True,
            key=f"editor_stock_{frigo_select}"
        )

        # Construire la liste des lignes à garder
        to_keep = []
        for _, row in edited.iterrows():
            if not row["supprimer"]:
                to_keep.append({
                    "frigo": frigo_select,
                    "article": str(row["article"]).strip(),
                    "quantite": int(row["quantite"]) if pd.notna(row["quantite"]) else 0,
                    "dlc": row["dlc"].strftime("%Y-%m-%d") if not pd.isna(row["dlc"]) else ""
                })

        autres = df_stock[df_stock["frigo"] != frigo_select]
        df_a_sauver = pd.concat(
            [autres, pd.DataFrame(to_keep, columns=["frigo", "article", "quantite", "dlc"])],
            ignore_index=True
        )

        with st.form(key=f"form_save_{frigo_select.replace(' ', '_')}"):
            enregistrer_modifs = st.form_submit_button(label="✅ Enregistrer les modifications")
            if enregistrer_modifs:
                save_df(ss_cmd, "Stockage Frigo", df_a_sauver)
                st.cache_data.clear()
                st.success("✅ Modifications enregistrées dans Google Sheet.")
                # --- Le rerun se fait automatiquement à la soumission du form ---

    #
    # 7) ➕ FORMULAIRE D’AJOUT D’UN NOUVEL ARTICLE
    #
    st.markdown("---")
    st.subheader("➕ Ajouter un article dans ce frigo")
    with st.form(key=f"form_add_{frigo_select.replace(' ', '_')}"):
        col1, col2, col3 = st.columns(3)
        with col1:
            new_article = st.text_input("Article", key=f"new_art_{frigo_select}")
        with col2:
            new_qty = st.number_input("Quantité", min_value=1, step=1, value=1, key=f"new_qty_{frigo_select}")
        with col3:
            new_dlc = st.date_input("DLC", value=date.today() + timedelta(days=3), key=f"new_dlc_{frigo_select}")

        ajouter_ok = st.form_submit_button(label="✅ Ajouter l’article")
        if ajouter_ok:
            if new_article.strip() == "":
                st.error("❌ Le nom de l’article ne peut pas être vide.")
            else:
                # Anciens contenus de ce frigo
                anciens = df_frigo[["article", "quantite", "dlc"]].copy()
                anciens = anciens.assign(
                    frigo=frigo_select,
                    dlc=anciens["dlc"].dt.strftime("%Y-%m-%d") if "dlc" in anciens else ""
                )

                # Nouvelle ligne
                ligne = {
                    "frigo": frigo_select,
                    "article": new_article.strip(),
                    "quantite": new_qty,
                    "dlc": new_dlc.strftime("%Y-%m-%d")
                }
                ajout = pd.DataFrame([ligne], columns=["frigo", "article", "quantite", "dlc"])
                autres = df_stock[df_stock["frigo"] != frigo_select]
                df_a_sauver = pd.concat(
                    [autres, anciens, ajout],
                    ignore_index=True
                )

                save_df(ss_cmd, "Stockage Frigo", df_a_sauver)
                st.cache_data.clear()
                st.success(f"✅ « {new_article.strip()} » ajouté dans {frigo_select}.")
                # --- Le rerun se fait automatiquement à la soumission du form ---

# ——— ONGLET VITRINE ———
elif choix == "🖥️ Vitrine":
    st.header("🖥️ Vitrine – Traçabilité HACCP")
    today = date.today()

    # ─── 1) Formulaire d’ajout ──────────────────────────────────────────
    with st.form("vt_form", clear_on_submit=True):
        da  = st.date_input("Date d’ajout", value=today, key="vt_da")
        pr  = st.selectbox("Produit", produits_list, key="vt_pr")
        dfb = st.date_input("Date de fabrication", value=today, key="vt_df")
        dl  = st.date_input("DLC", value=today + timedelta(days=3), key="vt_dl")
        if st.form_submit_button("✅ Ajouter"):
            ds  = da.strftime("%Y%m%d")
            ab  = pr[:3].upper()
            seq = len(actifs) + 1 if "actifs" in locals() else 1
            lot = f"{ds} {ab} {seq:02d}"
            sheet_vitrine.append_row([
                ds, pr, lot,
                dfb.strftime("%Y-%m-%d"),
                dl.strftime("%Y-%m-%d"),
                ""  # date_retrait vide
            ])
            st.success(f"✅ {pr} ajouté (lot : {lot})")

    # ─── 2) Chargement + normalisation du header ────────────────────────
    import unicodedata
    raw        = sheet_vitrine.get_all_values()
    header_raw = raw[0]
    def normalize(c):
        nfkd = unicodedata.normalize("NFKD", c)
        return (nfkd.encode("ascii", "ignore")
                    .decode()
                    .strip()
                    .lower()
                    .replace(" ", "_"))
    cols = [normalize(c) for c in header_raw]

    # DataFrame avec row_num pour pointer la bonne ligne dans la sheet
    df_raw = pd.DataFrame(raw[1:], columns=cols)
    df_raw["row_num"] = list(range(2, 2 + len(df_raw)))

    # Filtrage des actifs (date_retrait vide)
    actifs = df_raw[df_raw["date_retrait"] == ""].reset_index(drop=True)

    # ─── 3) Suppression au premier clic ────────────────────────────────
    st.subheader("❌ Retirer un article")
    deleted = False
    for _, row in actifs.iterrows():
        c1, c2 = st.columns([0.8, 0.2])
        with c1:
            st.write(f"• {row['produit']} – Lot `{row['numero_de_lot']}` – DLC {row['dlc']}")
        with c2:
            if st.button("🗑️", key=f"vt_rem_{row['row_num']}"):
                cell_row    = int(row["row_num"])
                col_retrait = cols.index("date_retrait") + 1
                sheet_vitrine.update_cell(
                    cell_row,
                    col_retrait,
                    today.strftime("%Y-%m-%d")
                )
                st.success("✅ Article retiré")
                deleted = True
                break

    # ─── 4) Si on a supprimé, on recharge les données ──────────────────
    if deleted:
        raw        = sheet_vitrine.get_all_values()
        header_raw = raw[0]
        cols = [normalize(c) for c in header_raw]
        df_raw = pd.DataFrame(raw[1:], columns=cols)
        df_raw["row_num"] = list(range(2, 2 + len(df_raw)))
        actifs = df_raw[df_raw["date_retrait"] == ""].reset_index(drop=True)

    # ─── 5) Calcul des jours restants & affichage coloré ───────────────
    today_ts          = pd.Timestamp(today)
    actifs["jr_rest"] = (
        pd.to_datetime(actifs["dlc"], errors="coerce") - today_ts
    ).dt.days

    def colorer(r):
        jr = actifs.loc[r.name, "jr_rest"]
        if jr <= 0:
            col = "#f44336"
        elif jr == 1:
            col = "#ff9800"
        else:
            col = "#8bc34a"
        return [f"background-color: {col}"] * len(r)

    st.subheader("📋 Articles en vitrine")
    disp_cols = [c for c in cols if c not in ("date_retrait","row_num","jr_rest")]
    st.dataframe(
        actifs[disp_cols]
              .style
              .apply(colorer, axis=1),
        use_container_width=True
    )

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
    st.header("🧾 Contrôle Hygiène – Visualisation & Export PDF")

    # ───────────────────────────────────────────────────────────────────
    # 1) Sélection de la période (toujours visible)
    # ───────────────────────────────────────────────────────────────────
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

    # Clés pour stocker les DataFrames dans session_state
    cle_temp = "ch_df_temp"
    cle_hyg  = "ch_df_hyg"
    cle_vit  = "ch_df_vit"

    # ───────────────────────────────────────────────────────────────────
    # 2) Bouton pour charger et stocker en session_state
    # ───────────────────────────────────────────────────────────────────
    if st.button("🔄 Charger & Afficher les relevés"):
        # ----- a) TEMPÉRATURES (toutes les feuilles 'Semaine X')
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
        # Filtrer sur la colonne "Date" (si elle existe)
        if "Date" in df_all_temp.columns:
            df_all_temp["Date"] = pd.to_datetime(df_all_temp["Date"], errors="coerce")
            mask_temp = (
                (df_all_temp["Date"] >= pd.to_datetime(date_debut)) &
                (df_all_temp["Date"] <= pd.to_datetime(date_fin))
            )
            df_all_temp = df_all_temp.loc[mask_temp].reset_index(drop=True)

        # ----- b) HYGIÈNE (quotidien, hebdo, mensuel)
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

        # ----- c) VITRINE (filtrer sur "date_ajout")
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

        # Stocker dans session_state
        st.session_state[cle_temp] = df_all_temp
        st.session_state[cle_hyg]  = df_filtre
        st.session_state[cle_vit]  = vitrine_df

        # Effacer ancien PDF si existant
        if "pdf_hygiene_bytes" in st.session_state:
            del st.session_state["pdf_hygiene_bytes"]

    # ───────────────────────────────────────────────────────────────────
    # 3) Une fois chargé (ou si déjà en session), afficher les DataFrames
    # ───────────────────────────────────────────────────────────────────
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

        # ───────────────────────────────────────────────────────────────────
        # 4) Boutons pour générer et/ou télécharger le PDF (paginé)
        # ───────────────────────────────────────────────────────────────────
        st.markdown("---")

        # 4.a) Si on clique pour générer maintenant, on produit les octets du PDF
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

        # 4.b) Si un PDF a déjà été généré, afficher le bouton de téléchargement
        if "pdf_hygiene_bytes" in st.session_state:
            st.download_button(
                "📄 Télécharger le PDF Contrôle Hygiène",
                st.session_state["pdf_hygiene_bytes"],
                file_name="controle_hygiene.pdf",
                mime="application/pdf"
            )

    else:
        # Info utilisateur : il faut d'abord cliquer sur "Charger & Afficher"
        st.info("Cliquez sur « 🔄 Charger & Afficher les relevés » pour voir les données puis générer le PDF.")

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
