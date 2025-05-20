import streamlit as st
import json
import locale
import re
import textwrap
from datetime import date, datetime, timedelta
import pandas as pd
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import pytz
from ics import Calendar, Event

# ← Doit être en tout premier
st.set_page_config(page_title="Yorgios V1", layout="wide")

# Locale FR
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
    ]
    creds = ServiceAccountCredentials.from_json_keyfile_dict(sa_info, scopes)
    return gspread.authorize(creds)

gc = gsheets_client()

# ———————————————————————————————
# IDS DES SPREADSHEETS
# ———————————————————————————————
SHEET_COMMANDES_ID = "1cBP7iEeWK5whbHzoZAWUhq_HQ5OcAEjTBkUro2cmkoc"
SHEET_HYGIENE_ID   = "1phiQjSYqvHdVEq7uAt8pitRE0NfKv4b1f4UUzUqbXQ"
SHEET_TEMP_ID      = "1e4hS6iawCa1IizhzY3xhskLy8Gj3todP3zzk38s7aq0"
SHEET_PLANNING_ID  = "1OBYGNHtHdDB2jufKKjoAwq6RiiS_pnz4ta63sAM-t_0"
SHEET_PRODUITS_ID  = "1FbRV4KgXyCwqwLqJkyq8cHZbo_BfB7kyyPP3pO53Snk"

# ———————————————————————————————
# OUVERTURE DES SPREADSHEETS / WORKSHEETS
# ———————————————————————————————
ss_cmd        = gc.open_by_key(SHEET_COMMANDES_ID)
sheet_haccp   = ss_cmd.worksheet("Suivi HACCP")
sheet_vitrine = ss_cmd.worksheet("Vitrine")

ss_hygiene   = gc.open_by_key(SHEET_HYGIENE_ID)
ss_temp      = gc.open_by_key(SHEET_TEMP_ID)
ss_planning  = gc.open_by_key(SHEET_PLANNING_ID)
ss_produits  = gc.open_by_key(SHEET_PRODUITS_ID)
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

# ———————————————————————————————
# NAVIGATION
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

# === Relevé Températures ===
if choix == "🌡️ Relevé des températures":
    st.header("🌡️ Relevé des températures")
    jour = st.date_input("🗓️ Sélectionner la date", date.today())
    nom_ws = f"Semaine {jour.isocalendar().week} {jour.year}"
    try:
        ws = ss_temp.worksheet(nom_ws)
    except gspread.exceptions.WorksheetNotFound:
        st.warning(f"⚠️ Feuille « {nom_ws} » introuvable.")
        if st.button(f"➕ Créer « {nom_ws} » depuis Semaine 38"):
            model = ss_temp.worksheet("Semaine 38")
            ss_temp.duplicate_sheet(model.id, nom_ws)
            st.experimental_rerun()
        st.stop()
    raw = ws.get_all_values()
    if len(raw) < 2:
        st.warning("⚠️ Feuille vide ou mal formatée."); st.stop()
    df_temp = pd.DataFrame(raw[1:], columns=raw[0])
    moment = st.selectbox("🕒 Moment", ["Matin","Soir"])
    with st.form("form_temp"):
        saisies = {f: st.text_input(f, "", key=f"t_{f}") for f in df_temp.iloc[:,0]}
        if st.form_submit_button("✅ Valider"):
            col = f"{JOURS_FR[jour.strftime('%A')]} {moment}"
            if col not in df_temp.columns:
                st.error(f"Col '{col}' introuvable.")
            else:
                for i,f in enumerate(df_temp.iloc[:,0]):
                    df_temp.at[i,col] = saisies[f]
                ws.update("A1",[df_temp.columns.tolist()]+df_temp.values.tolist())
                st.success("✅ OK")
    st.dataframe(df_temp.replace("","⛔️").style.applymap(
        lambda v:"color:red;" if v=="⛔️" else "color:green;"
    ), use_container_width=True)

# === Stockage Frigo ===
elif choix == "🧊 Stockage Frigo":
    st.header("🧊 Stockage Frigo")
    df_flat = load_df(ss_cmd,"Stockage Frigo")
    pivot = df_flat.pivot_table(
        index="article",columns="frigo",values="quantite",
        aggfunc="sum",fill_value=0
    ).reset_index()
    frigos = [c for c in pivot.columns if c!="article"]
    edited = st.data_editor(
        pivot,hide_index=True,num_rows="dynamic",
        column_config={"article":st.column_config.SelectboxColumn(
            "Article",options=sorted(pivot["article"].unique()),free_text=True
        ), **{f:st.column_config.NumberColumn(f,min_value=0) for f in frigos}},
        key="ed_stock"
    )
    if st.button("✅ Enregistrer"):
        rows=[]
        for _,r in edited.iterrows():
            a=r["article"].strip()
            if not a: continue
            for f in frigos:
                rows.append({"frigo":f,"article":a,"quantite":int(r[f])})
        save_df(ss_cmd,"Stockage Frigo",pd.DataFrame(rows))
        st.success("🔄 OK"); st.experimental_rerun()

# === Hygiène ===
elif choix == "🧼 Hygiène":
    st.header("🧼 Relevé Hygiène")
    typ=st.selectbox("Type",["Quotidien","Hebdomadaire","Mensuel"])
    ws=ss_hygiene.worksheet(typ)
    raw=ws.get_all_values()
    df_hyg=pd.DataFrame(raw[1:],columns=raw[0])
    today=date.today().strftime("%Y-%m-%d")
    if today in df_hyg["Date"].values:
        idx=df_hyg.index[df_hyg["Date"]==today][0]
    else:
        idx=len(df_hyg); nr={c:"" for c in df_hyg.columns}; nr["Date"]=today
        df_hyg=pd.concat([df_hyg,pd.DataFrame([nr])],ignore_index=True)
    with st.form("f"):
        checks={c:st.checkbox(c,df_hyg.at[idx,c]=="✅",key=c) for c in df_hyg.columns[1:]}
        if st.form_submit_button("✅ Valider"):
            for c,v in checks.items(): df_hyg.at[idx,c]="✅" if v else ""
            ws.update("A1",[df_hyg.columns.tolist()]+df_hyg.values.tolist())
            st.success("✅ OK")

# === Protocoles ===
elif choix == "📋 Protocoles":
    st.header("📋 Protocoles")
    files={
        "Arrivée":"protocoles_arrivee.txt","Fermeture":"protocoles_fermeture.txt",
        "Temps calme":"protocoles_tempscalmes.txt","Stockage":"protocole_stockage.txt",
        "Hygiène du personnel":"protocoles_hygiene du personnel.txt",
        "Service du midi":"protocoles_midi.txt","Règles en stand":"protocoles_regles en stand.txt",
        "Hygiène générale":"protocole_hygiene.txt"
    }
    sel=st.selectbox("Choix",list(files))
    try:
        t=open(files[sel],encoding="utf-8").read().replace("•","\n\n•")
        st.markdown(f"### {sel}\n\n{textwrap.indent(t,'')}",unsafe_allow_html=True)
    except:
        st.error("Fichier manquant.")

# === Planning ===
elif choix == "📅 Planning":
    st.header("📅 Planning")
    titres=sorted(
        [w.title for w in ss_planning.worksheets() if w.title.lower().startswith("semaine")],
        key=lambda x:int(re.search(r"\d+",x).group())
    )
    dt=st.date_input("Date",date.today())
    nom=f"Semaine {dt.isocalendar().week}"
    if nom not in titres:
        nom=titres[-1]; st.warning(f"Affichage {nom}.")
    ws=ss_planning.worksheet(nom)
    raw=ws.get_all_values()
    dfp=pd.DataFrame(raw[1:],columns=raw[0])
    prs=list(dfp["Prenoms"].dropna().unique())
    filt=st.selectbox("Prénom",["Tous"]+prs)
    if filt=="Tous":
        st.dataframe(dfp,use_container_width=True)
    else:
        cols=raw[0][1:8]; jours=["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"]
        row=dfp[dfp["Prenoms"]==filt]
        hor=(row.values.tolist()[0][1:8] if not row.empty else [""]*7)
        hor=[h or "–" for h in hor]
        st.dataframe(pd.DataFrame({"Jour":jours,"Horaires":hor}),use_container_width=True)
        if st.button("📥 ICS"):
            cal=Calendar(); tz=pytz.timezone("Europe/Paris")
            for i,c in enumerate(hor):
                if c=="–": continue
                d=re.search(r"\d{2}/\d{2}/\d{4}",cols[i]).group()
                day=datetime.strptime(d,"%d/%m/%Y")
                start,end=c.split(" à ")
                ev=Event(); ev.name=f"{filt} – {start} à {end}"
                ev.begin=tz.localize(datetime.combine(day,datetime.strptime(start,"%H:%M").time()))
                ev.end=tz.localize(datetime.combine(day,datetime.strptime(end,"%H:%M").time()))
                cal.events.add(ev)
            p="/tmp/planning.ics"
            with open(p,"w") as f: f.writelines(cal)
            with open(p,"rb") as f:
                st.download_button("Télécharger ICS",f,file_name=f"planning_{filt}.ics")
            st.success("✅ OK")

# === Vitrine ===
elif choix == "🖥️ Vitrine":
    st.header("🖥️ Vitrine")
    raw=sheet_vitrine.get_all_values(); cols,dat=raw[0],raw[1:]
    ids=list(range(2,2+len(dat)))
    dfv=pd.DataFrame(dat,columns=cols); dfv["_row"]=ids
    dfv.columns=[c.strip().lower().replace(" ","_").replace("é","e") for c in dfv.columns]
    act=dfv[dfv["date_retrait"]==""].copy(); arc=dfv[dfv["date_retrait"]!=""].copy()
    today=date.today(); ts=today.strftime("%Y-%m-%d")
    def sd(v):
        try:d=datetime.strptime(v,"%Y-%m-%d").date()
        except:return""
        diff=(d-today).days
        return "background-color:#f8d7da" if diff<=0 else "background-color:#fff3cd" if diff==1 else "background-color:#d4edda"
    st.subheader("Actifs")
    if act.empty: st.write("Rien.")
    else:
        st.dataframe(act.drop(columns="_row").style.applymap(sd,subset=["dlc"]),use_container_width=True)
        st.write("Retirer :")
        for _,r in act.iterrows():
            lbl=f"❌ {r['produit']} ({r['numero_de_lot']})"
            if st.button(lbl,key=r["_row"]):
                cidx=dfv.columns.get_loc("date_retrait")+1
                sheet_vitrine.update_cell(r["_row"],cidx,ts)
                st.success("✅"); st.experimental_rerun()
    with st.expander("Archives"):
        if arc.empty: st.write("Aucune.")
        else: st.dataframe(arc.drop(columns="_row"),use_container_width=True)
    st.markdown("---")
    st.subheader("Ajouter")
    with st.form("fv"):
        da=st.date_input("Ajout",today); p=st.selectbox("Produit",produits_list)
        dfb=st.date_input("Fab",today); dl=st.date_input("DLC",today+timedelta(days=3))
        if st.form_submit_button("✅ Ajouter"):
            nl=f"{dfb.strftime('%Y%m%d')}-MAN-{len(act)+1}"
            sheet_vitrine.append_row([
                da.strftime("%Y-%m-%d"),p,nl,dfb.strftime("%Y-%m-%d"),dl.strftime("%Y-%m-%d"),""
            ])
            st.success("✅"); st.experimental_rerun()

# ———————————————————————————————
# Pied de page
# ———————————————————————————————
st.markdown("""
<hr style="margin-top:40px; margin-bottom:10px">
<p style="text-align:center; font-size:12px;">
    Application Yorgios • Développée avec ❤️ & Demis
</p>
""", unsafe_allow_html=True)
