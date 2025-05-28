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

# ——— ONGLET STOCKAGE FRIGO ———
elif choix == "🧊 Stockage Frigo":
    st.header("🧊 Gestion du Stock par Frigo")

    # 1) Chargement et nettoyage
    df_stock = load_df(ss_cmd, "Stockage Frigo")
    df_stock.columns = [c.strip().lower().replace(" ", "_") for c in df_stock.columns]

    required = {"frigo", "article", "quantite", "dlc"}
    if not required.issubset(df_stock.columns):
        st.error(f"❌ Colonnes attendues manquantes : {required - set(df_stock.columns)}")
        st.stop()

    df_stock["frigo"] = (
        df_stock["frigo"]
        .astype(str)
        .str.strip()
        .str.replace("\xa0", " ", regex=False)
    )

    # 2) Choix du frigo
    frigos_dispo = sorted(df_stock["frigo"].dropna().unique())
    frigo_select = st.selectbox(
        "🧊 Choisir un frigo",
        frigos_dispo,
        key="sf_choose"
    )

    # 3) Affichage du contenu actuel
    df_frigo = df_stock[df_stock["frigo"] == frigo_select].reset_index(drop=True)
    st.subheader(f"📋 Contenu actuel de **{frigo_select}**")
    if df_frigo.empty:
        st.info("Aucun article dans ce frigo.")
    else:
        st.dataframe(
            df_frigo[["article", "quantite", "dlc"]],
            use_container_width=True
        )

    st.markdown("---")

    # 4) Formulaire d’ajout / mise à jour
    st.subheader("➕ Ajouter ou mettre à jour un article")
    with st.form("sf_form"):
        col1, col2, col3 = st.columns(3)
        with col1:
            art = st.text_input("Article", key="sf_art")
        with col2:
            qty = st.number_input(
                "Quantité",
                min_value=1,
                value=1,
                step=1,
                key="sf_qty"
            )
        with col3:
            dlc_new = st.date_input(
                "DLC",
                value=date.today() + timedelta(days=3),
                key="sf_new_dlc"
            )

        if st.form_submit_button("✅ Sauvegarder"):
            # Prépare la nouvelle ligne
            new_row = {
                "frigo": frigo_select,
                "article": art.strip(),
                "quantite": int(qty),
                "dlc": dlc_new.strftime("%Y-%m-%d")
            }
            # On retire l’ancienne version de cet article dans ce frigo
            autres = df_stock[
                ~(
                    (df_stock["frigo"] == frigo_select)
                    & (df_stock["article"].str.strip().str.lower() == art.strip().lower())
                )
            ]
            df_to_save = pd.concat(
                [autres, pd.DataFrame([new_row])],
                ignore_index=True
            )
            save_df(ss_cmd, "Stockage Frigo", df_to_save)
            st.success("✅ Stock mis à jour avec succès.")
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
    today = date.today()

    # 1) Formulaire d’ajout en haut
    with st.form("vt_form", clear_on_submit=True):
        da  = st.date_input("Date d’ajout", value=today, key="vt_da")
        pr  = st.selectbox("Produit", produits_list, key="vt_pr")
        dfb = st.date_input("Date fabrication", value=today, key="vt_df")
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

    # 2) Rechargement & normalisation du header
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
    df   = pd.DataFrame(raw[1:], columns=cols)

    # 3) Filtrage des actifs (date_retrait vide)
    actifs = df[df.get("date_retrait", "") == ""].reset_index(drop=True)

    # 4) Calcul des jours restants
    today_ts         = pd.Timestamp(today)
    actifs["jr_rest"] = (
        pd.to_datetime(actifs["dlc"], errors="coerce") - today_ts
    ).dt.days

    # 5) Affichage coloré
    def colorer(row):
        jr = actifs.at[row.name, "jr_rest"]
        if jr <= 0:
            color = "#f44336"  # rouge
        elif jr == 1:
            color = "#ff9800"  # orange
        else:
            color = "#8bc34a"  # vert
        return [f"background-color: {color}"] * len(row)

    st.subheader("📋 Articles en vitrine")
    # on affiche toutes les colonnes sauf date_retrait et jr_rest
    disp_cols = [c for c in cols if c not in ("date_retrait", "jr_rest")]
    st.dataframe(
        actifs[disp_cols]
              .style
              .apply(colorer, axis=1),
        use_container_width=True
    )

    # 6) Retrait d’un article
    st.subheader("❌ Retirer un article")
    for i, row in actifs.iterrows():
        c1, c2 = st.columns([0.8, 0.2])
        with c1:
            st.write(f"• {row['produit']} – Lot `{row['numero_de_lot']}` – DLC {row['dlc']}")
        with c2:
            if st.button("🗑️", key=f"vt_rem_{i}"):
                cell_row    = i + 2  # +2 pour passer l’en-tête
                col_retrait = cols.index("date_retrait") + 1
                sheet_vitrine.update_cell(
                    cell_row,
                    col_retrait,
                    today.strftime("%Y-%m-%d")
                )
                st.success("✅ Article retiré")

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
