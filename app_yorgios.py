import streamlit as st
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import pandas as pd
from datetime import datetime
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
import os

# CONFIGURATION
GOOGLE_SHEET_NAME = "europoseidon_liaison"
CREDENTIALS_FILE = "credentials.json"
LOGO_PATH = "logo_yorgios.jpg"

# Connexion Google Sheets
scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
creds = ServiceAccountCredentials.from_json_keyfile_name(CREDENTIALS_FILE, scope)
client = gspread.authorize(creds)

sheet_demandes = client.open(GOOGLE_SHEET_NAME).worksheet("Demandes Corner")

# Chargement des données
data = sheet_demandes.get_all_records()
df = pd.DataFrame(data)
if "Statut" not in df.columns:
    df["Statut"] = "En attente"
if "Lot N°" not in df.columns:
    df["Lot N°"] = ""

# UI Streamlit
st.set_page_config(page_title="Interface Cuisine", layout="wide")
st.title("🍽️ Interface Cuisine – Gestion des livraisons")

# --- AJOUT MANUEL ---
with st.expander("➕ Ajouter un article libre à la livraison"):
    with st.form("ajout_libre"):
        col1, col2 = st.columns([1, 2])
        with col1:
            date_ajout = st.date_input("📅 Date de livraison", datetime.today())
            date_str = date_ajout.strftime("%d/%m/%Y")
        with col2:
            produit_libre = st.text_input("Produit")
        quant = st.number_input("Quantité", min_value=1, step=1)
        comment = st.text_area("Commentaire", height=60)
        lot = st.text_input("Lot N° (facultatif)", value=f"{date_str.replace('/', '')}-{produit_libre[:3].upper()}")
        ajouter = st.form_submit_button("✅ Ajouter")

        if ajouter:
            new_row = [date_str, produit_libre.strip(), quant, comment.strip(), "Prêt", lot]
            sheet_demandes.append_row(new_row)
            st.success("Ajouté à la livraison.")

# --- GESTION DES DEMANDES ---
date_selection = st.date_input("📅 Voir les commandes pour la date :", datetime.today())
date_str = date_selection.strftime("%d/%m/%Y")

df_selection = df[df["Date"] == date_str]
st.subheader(f"🗂️ Demandes du {date_str}")

if df_selection.empty:
    st.info("Aucune demande pour cette date.")
else:
    # Marquage automatique "Prêt" si sélectionné
    df_selection = df_selection.copy()
    df_selection["Sélectionner"] = False
    df_selection["Lot N°"] = df_selection["Lot N°"].astype(str)

    edited = st.data_editor(
        df_selection,
        column_config={
            "Statut": st.column_config.SelectboxColumn("Statut", options=["En attente", "En fabrication", "Prêt", "En livraison"]),
            "Sélectionner": st.column_config.CheckboxColumn("À inclure"),
            "Lot N°": st.column_config.TextColumn("Lot N°"),
        },
        use_container_width=True
    )

    if st.button("💾 Enregistrer les statuts modifiés"):
        for i, row in edited.iterrows():
            idx = df.index[(df["Date"] == row["Date"]) & (df["Produit"] == row["Produit"]) & (df["Quantité"] == row["Quantité"])].tolist()
            if idx:
                if row["Sélectionner"]:
                    row["Statut"] = "Prêt"
                sheet_demandes.update_cell(idx[0]+2, 5, row["Statut"])  # Statut
                sheet_demandes.update_cell(idx[0]+2, 6, row["Lot N°"])  # Lot
        st.success("Mise à jour réussie.")

    if st.button("📦 Générer le bon de livraison"):
        to_livrer = edited[edited["Sélectionner"] & (edited["Statut"] == "Prêt")]
        if to_livrer.empty:
            st.warning("Aucun produit sélectionné.")
        else:
            file_path = f"bon_livraison_{date_selection.strftime('%Y%m%d')}.pdf"
            c = canvas.Canvas(file_path, pagesize=A4)
            width, height = A4

            if os.path.exists(LOGO_PATH):
                c.drawInlineImage(LOGO_PATH, width - 70 * mm, height - 40 * mm, 60 * mm, 20 * mm)

            c.setFont("Helvetica-Bold", 14)
            c.drawString(30, height - 50, "Bon de livraison")
            c.setFont("Helvetica", 10)
            c.drawString(30, height - 80, "YORGIOS LABO – 31 rue d’Hauteville – 75009 PARIS")
            c.drawString(30, height - 110, f"Bon de livraison N° : BL-{date_selection.strftime('%Y%m%d')}-001")
            c.drawString(30, height - 125, f"Date : {date_str}")
            c.drawString(30, height - 140, "Lieu : La Grande Épicerie – 38 rue de Sèvres – 75007 PARIS")

            y = height - 170
            c.setFont("Helvetica-Bold", 10)
            c.drawString(30, y, "Produit")
            c.drawString(200, y, "Qté")
            c.drawString(250, y, "Lot N°")
            c.drawString(360, y, "Commentaire")
            c.setFont("Helvetica", 10)
            y -= 20

            for _, row in to_livrer.iterrows():
                c.drawString(30, y, row["Produit"])
                c.drawString(200, y, str(row["Quantité"]))
                c.drawString(250, y, row.get("Lot N°", ""))
                c.drawString(360, y, row.get("Commentaire", ""))
                y -= 20

            y -= 30
            c.drawString(30, y, "Livré le : " + date_str)
            y -= 20
            c.drawString(30, y, "Reçu le : _______________________")
            y -= 20
            c.drawString(30, y, "Signature : ______________________")
            y -= 50
            c.drawString(30, y, "Tampon de réception :")
            c.rect(180, y - 20, 120, 40)
            c.save()

            # Met à jour les statuts
            for _, row in to_livrer.iterrows():
                idx = df.index[(df["Date"] == row["Date"]) & (df["Produit"] == row["Produit"]) & (df["Quantité"] == row["Quantité"])].tolist()
                if idx:
                    sheet_demandes.update_cell(idx[0]+2, 5, "En livraison")

            with open(file_path, "rb") as f:
                st.download_button("📥 Télécharger le bon de livraison", f, file_name=file_path)

# --- HISTORIQUE ---
with st.expander("📚 Historique des livraisons"):
    df_livr = df[df["Statut"] == "En livraison"]
    df_livr["Date"] = pd.to_datetime(df_livr["Date"], format="%d/%m/%Y")
    df_livr = df_livr.sort_values(by="Date", ascending=False)
    st.dataframe(df_livr[["Date", "Produit", "Quantité", "Lot N°", "Commentaire"]], use_container_width=True)
