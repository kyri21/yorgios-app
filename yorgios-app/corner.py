import streamlit as st
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import pandas as pd
from datetime import datetime
import json
from io import StringIO
import smtplib
from email.mime.text import MIMEText

# --- AUTHENTIFICATION GOOGLE
scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
service_account_info = json.load(StringIO(st.secrets["GOOGLE_SERVICE_ACCOUNT_JSON"]))
creds = ServiceAccountCredentials.from_json_keyfile_dict(service_account_info, scope)
client = gspread.authorize(creds)

# --- FEUILLES GOOGLE
GOOGLE_SHEET_NAME = "europoseidon_liaison"
sheet_produits = client.open(GOOGLE_SHEET_NAME).worksheet("Demandes Corner")
sheet_fournitures = client.open(GOOGLE_SHEET_NAME).worksheet("Commandes Fournitures")

# --- CHARGER PRODUITS
@st.cache_data
def charger_produits():
    df = pd.read_excel("liste_produits_clean.xlsx")
    return df["Produit"].dropna().unique().tolist()

produits = charger_produits()

# --- ENVOI DE MAIL AUTOMATIQUE (FOURNITURES)
def envoyer_mail_fourniture(date, item, quantite, commentaire):
    expediteur = "yorgios.system@gmail.com"
    destinataire = "a.cozzika@gmail.com"
    mot_de_passe = st.secrets["MAIL_PASSWORD"]

    contenu = f"""📦 Nouvelle commande de fourniture :

📅 Date : {date}
🧰 Fourniture : {item}
📦 Quantité : {quantite}
💬 Commentaire : {commentaire or "—"}

Merci de traiter cette demande.
    """

    msg = MIMEText(contenu)
    msg["Subject"] = f"📦 Commande fourniture – {item}"
    msg["From"] = expediteur
    msg["To"] = destinataire

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(expediteur, mot_de_passe)
            server.sendmail(expediteur, destinataire, msg.as_string())
    except Exception as e:
        st.error(f"Erreur d'envoi e-mail : {e}")

# --- UI PRINCIPALE
st.set_page_config(page_title="Interface Corner Yorgios", layout="wide")
st.title("🧾 Interface Corner – Produits & Fournitures")

onglet = st.sidebar.radio("📋 Choisir :", ["🍽️ Demande produits cuisine", "📦 Commande de fournitures"])

# ---------------------------------------------------------------------------------
# 🍽️ ONGLET 1 : PRODUITS CUISINE
# ---------------------------------------------------------------------------------
if onglet == "🍽️ Demande produits cuisine":
    st.header("🍽️ Produits à la cuisine")

    with st.form("form_produit"):
        col1, col2 = st.columns([1, 2])
        with col1:
            date_livraison = st.date_input("📅 Date livraison", datetime.today())
            date_str = date_livraison.strftime("%d/%m/%Y")
        with col2:
            produit = st.selectbox("🍽️ Produit", options=produits, index=None, placeholder="Commencez à taper...")

        quantite = st.number_input("🔢 Quantité", min_value=1, step=1)
        commentaire = st.text_area("💬 Commentaire", height=80)
        submitted = st.form_submit_button("✅ Ajouter")

        if submitted and produit:
            ligne = [date_str, produit.strip(), quantite, commentaire.strip(), "En attente", ""]
            sheet_produits.append_row(ligne)
            st.success(f"Ajouté : {produit} x{quantite} pour le {date_str}")

    st.markdown("### 📋 Suivi des demandes")
    data = sheet_produits.get_all_records()
    df = pd.DataFrame(data)

    if "Statut" not in df.columns:
        df["Statut"] = "En attente"
    if "Lot N°" not in df.columns:
        df["Lot N°"] = ""

    df["Date"] = pd.to_datetime(df["Date"], format="%d/%m/%Y")
    df = df.sort_values(by="Date", ascending=False).reset_index(drop=True)

    for i, row in df.iterrows():
        with st.expander(f"{row['Date'].strftime('%d/%m/%Y')} – {row['Produit']} x{row['Quantité']}"):
            new_quant = st.number_input("Quantité", min_value=1, value=int(row["Quantité"]), key=f"quant_{i}")
            new_comment = st.text_area("Commentaire", value=row.get("Commentaire", ""), key=f"comm_{i}")
            col_modif, col_supp = st.columns([1, 1])

            if col_modif.button("💾 Modifier", key=f"modif_{i}"):
                sheet_produits.update_cell(i + 2, 3, new_quant)
                sheet_produits.update_cell(i + 2, 4, new_comment)
                st.success("Mise à jour faite.")

            if col_supp.button("🗑️ Supprimer", key=f"del_{i}"):
                sheet_produits.delete_rows(i + 2)
                st.warning("Ligne supprimée.")
                st.experimental_rerun()

# ---------------------------------------------------------------------------------
# 📦 ONGLET 2 : FOURNITURES
# ---------------------------------------------------------------------------------
if onglet == "📦 Commande de fournitures":
    st.header("📦 Fournitures (non alimentaires)")

    with st.form("form_fourniture"):
        date_com = st.date_input("📅 Date de commande", datetime.today())
        date_str = date_com.strftime("%d/%m/%Y")
        item = st.text_input("🧰 Fourniture demandée")
        quant = st.text_input("📦 Quantité ou format")
        commentaire = st.text_area("💬 Commentaire", height=60)
        sub = st.form_submit_button("✅ Envoyer")

        if sub and item:
            ligne = [date_str, item.strip(), quant.strip(), commentaire.strip(), "En attente"]
            sheet_fournitures.append_row(ligne)
            envoyer_mail_fourniture(date_str, item, quant, commentaire)
            st.success(f"Demande envoyée + e-mail transmis à a.cozzika@gmail.com")

    st.markdown("### 📋 Historique des commandes")
    data_f = sheet_fournitures.get_all_records()
    df_f = pd.DataFrame(data_f)

    if not df_f.empty:
        df_f["Date"] = pd.to_datetime(df_f["Date"], format="%d/%m/%Y")
        df_f = df_f.sort_values(by="Date", ascending=False)
        st.dataframe(df_f[["Date", "Fourniture", "Quantité", "Statut"]], use_container_width=True)
