import streamlit as st
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import pandas as pd
from datetime import datetime

# CONFIGURATION
GOOGLE_SHEET_NAME = "europoseidon_liaison"
CREDENTIALS_FILE = "credentials.json"

# Connexion Google Sheets
scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
creds = ServiceAccountCredentials.from_json_keyfile_name(CREDENTIALS_FILE, scope)
client = gspread.authorize(creds)

sheet_demandes = client.open(GOOGLE_SHEET_NAME).worksheet("Demandes Corner")

# UI Streamlit
st.set_page_config(page_title="Demande de Produits – Corner", layout="wide")
st.title("📋 Interface Corner – Demande de produits à la cuisine")

# --- FORMULAIRE DE DEMANDE ---
with st.form("form_demande"):
    col1, col2 = st.columns([1, 2])
    with col1:
        date_livraison = st.date_input("📅 Date souhaitée de livraison", datetime.today())
        date_str = date_livraison.strftime("%d/%m/%Y")
    with col2:
        produit = st.text_input("🍽️ Produit demandé (ex : Tiropita, Moussaka)")

    quantite = st.number_input("🔢 Quantité demandée", min_value=1, step=1)
    commentaire = st.text_area("💬 Commentaire (facultatif)", height=80)

    submitted = st.form_submit_button("✅ Ajouter la demande")

    if submitted:
        nouvelle_ligne = [date_str, produit.strip(), quantite, commentaire.strip(), "En attente"]
        sheet_demandes.append_row(nouvelle_ligne)
        st.success(f"Demande ajoutée pour le {date_str} : {produit} x{quantite}")

# --- HISTORIQUE + MODIFICATION/SUPPRESSION ---
st.markdown("### 🧾 Suivi des demandes (modifiable)")

data = sheet_demandes.get_all_records()
df = pd.DataFrame(data)

if "Statut" not in df.columns:
    df["Statut"] = "En attente"

df["Date"] = pd.to_datetime(df["Date"], format="%d/%m/%Y")
df = df.sort_values(by="Date", ascending=False)
df_display = df.reset_index(drop=True)

# Affichage des lignes avec possibilité de modifier ou supprimer
for i, row in df_display.iterrows():
    with st.expander(f"📝 {row['Date'].strftime('%d/%m/%Y')} – {row['Produit']} x{row['Quantité']}"):
        new_quant = st.number_input(f"Quantité pour {row['Produit']}", min_value=1, value=int(row["Quantité"]), key=f"quant_{i}")
        new_comment = st.text_area("Commentaire", value=row.get("Commentaire", ""), key=f"comm_{i}")
        col_modif, col_supp = st.columns([1, 1])

        if col_modif.button("💾 Modifier", key=f"modif_{i}"):
            sheet_demandes.update_cell(i + 2, 3, new_quant)       # Quantité (col C)
            sheet_demandes.update_cell(i + 2, 4, new_comment)     # Commentaire (col D)
            st.success("Demande mise à jour avec succès.")

        if col_supp.button("🗑️ Supprimer", key=f"del_{i}"):
            sheet_demandes.delete_rows(i + 2)
            st.warning("Demande supprimée.")
            st.experimental_rerun()
