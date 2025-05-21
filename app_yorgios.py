import streamlit as st
import json
import locale
import re
import textwrap
from datetime import date, datetime, timedelta
import pandas as pd
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from gspread.exceptions import SpreadsheetNotFound
import pytz
from ics import Calendar, Event

# ———————————————————————————————
# CONFIGURATION STREAMLIT
# ———————————————————————————————
st.set_page_config(page_title="Yorgios V1 – Épuré", layout="wide")

try:
    locale.setlocale(locale.LC_TIME, 'fr_FR.UTF-8')
except locale.Error:
    pass

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
        "https://www.googleapis.com/auth/drive.readonly"
    ]
    creds = ServiceAccountCredentials.from_json_keyfile_dict(sa_info, scopes)
    return gspread.authorize(creds)

gc = gsheets_client()
# ———————————————————————————————
# FALLBACK POUR OPEN_BY_KEY
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
# IDENTIFIANTS SPREADSHEETS
# ———————————————————————————————
SHEET_COMMANDES_ID = "1cBP7iEeWK5whbHzoZAWUhq_HQ5OcAEjTBkUro2cmkoc"
SHEET_HYGIENE_ID = "1XMYhh2CSIv1zyTtXKM4_ACEhW-6kXxoFi4ACzNhbuDE"
SHEET_TEMP_ID      = "1e4hS6iawCa1IizhzY3xhskLy8Gj3todP3zzk38s7aq0"
SHEET_PLANNING_ID  = "1OBYGNHtHdDB2jufKKjoAwq6RiiS_pnz4ta63sAM-t_0"
SHEET_PRODUITS_ID  = "1FbRV4KgXyCwqwLqJkyq8cHZbo_BfB7kyyPP3pO53Snk"

# ———————————————————————————————
# OUVERTURE DES SPREADSHEETS / WORKSHEETS
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
    ws = sh.worksheet(ws_name)
    ws.clear()
    ws.update([df.columns.tolist()] + df.values.tolist())

# ———————————————————————————————
# LISTES UTILES
# ———————————————————————————————
produits_list = sorted(
    set(p.strip().capitalize() for p in sheet_prod.col_values(1) if p.strip())
)

JOURS_FR = {
    "Monday": "Lundi", "Tuesday": "Mardi", "Wednesday": "Mercredi",
    "Thursday": "Jeudi", "Friday": "Vendredi",
    "Saturday": "Samedi", "Sunday": "Dimanche"
}

# ———————————————————————————————
# NAVIGATION PAR ONGLETS
# ———————————————————————————————
onglets = [
    "🌡️ Relevé des températures",
    "🧊 Stockage Frigo",
    "🧼 Hygiène",
    "📋 Protocoles",
    "📅 Planning",
    "🖥️ Vitrine"
]
choix = st.sidebar.radio("Navigation", onglets, key="onglet_actif")

# === ONGLET : Relevé des températures ===
if choix == "🌡️ Relevé des températures":
    st.header("🌡️ Relevé des températures")
    jour = st.date_input("🗓️ Sélectionner la date", value=date.today())
    nom_ws = f"Semaine {jour.isocalendar().week} {jour.year}"
    try:
        ws = ss_temp.worksheet(nom_ws)
        st.markdown(f"🗓️ Données depuis **{nom_ws}**")
    except gspread.exceptions.WorksheetNotFound:
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

# === ONGLET : Stockage Frigo (vue matricielle) ===
elif choix == "🧊 Stockage Frigo":
    st.header("🧊 Stockage Frigo – Vue matricielle")
    df_flat = load_df(ss_cmd, "Stockage Frigo")
    pivot = (
        df_flat
        .pivot_table(index="article", columns="frigo", values="quantite", aggfunc="sum", fill_value=0)
        .reset_index()
    )
    frigos = [c for c in pivot.columns if c != "article"]
    edited = st.data_editor(
        pivot,
        num_rows="dynamic",
        hide_index=True,
        column_config={
            "article": st.column_config.SelectboxColumn(
                "Article",
                options=sorted(pivot["article"].unique()),
                free_text=True
            ),
            **{f: st.column_config.NumberColumn(f, min_value=0, step=1) for f in frigos}
        },
        key="stock_editor"
    )
    if st.button("✅ Enregistrer les modifications"):
        rows = []
        for _, row in edited.iterrows():
            art = row["article"].strip()
            if not art:
                continue
            for f in frigos:
                q = int(row[f]) if pd.notna(row[f]) else 0
                rows.append({"frigo": f, "article": art, "quantite": q})
        save_df(ss_cmd, "Stockage Frigo", pd.DataFrame(rows))
        st.success("🔄 Stock mis à jour !")
        st.rerun()

# === ONGLET : Hygiène ===
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

# === ONGLET : Protocoles ===
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
    try:
        txt = open(fichiers[choix_proto], encoding="utf-8").read().replace("•", "\n\n•")
        st.markdown(f"### 🗂️ {choix_proto}\n\n{textwrap.indent(txt, prefix='')}", unsafe_allow_html=True)
    except FileNotFoundError:
        st.error("⚠️ Fichier manquant. Vérifiez qu'il existe dans le dossier de l’application.")

# === ONGLET : Planning ===
elif choix == "📅 Planning":
    st.header("📅 Planning Google")
    try:
        titres = sorted(
            [w.title for w in ss_planning.worksheets() if w.title.lower().startswith("semaine")],
            key=lambda x: int(re.search(r"\d+", x).group())
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

# === ONGLET : Vitrine ===
elif choix == "🖥️ Vitrine":
    st.header("🖥️ Vitrine – Traçabilité HACCP")
    raw = sheet_vitrine.get_all_values()
    cols, data = raw[0], raw[1:]
    ids = list(range(2, 2 + len(data)))
    df = pd.DataFrame(data, columns=cols)
    df["_row"] = ids
    df.columns = [
        c.strip().lower().replace(" ", "_").replace("é", "e").replace("è", "e").replace("ê", "e")
        for c in df.columns
    ]
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
        if diff < 0:
            return "background-color:#f8d7da"
        if diff == 0:
            return "background-color:#f8d7da"
        if diff == 1:
            return "background-color:#fff3cd"
        if diff >= 2:
            return "background-color:#d4edda"
        return ""

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
            st.success(f"✅ {prod} ajouté en vitrine (ajouté le {date_ajout}).")
            st.rerun()

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
