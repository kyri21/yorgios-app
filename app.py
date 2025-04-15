import streamlit as st
import gspread
from oauth2client.service_account import ServiceAccountCredentials
import json
from io import StringIO
from datetime import datetime
import smtplib
from email.mime.text import MIMEText

# --- ACCÈS GOOGLE SHEET ---
scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
service_account_info = json.load(StringIO(st.secrets["GOOGLE_SERVICE_ACCOUNT_JSON"]))
creds = ServiceAccountCredentials.from_json_keyfile_dict(service_account_info, scope)
client = gspread.authorize(creds)

SHEET_NAME = "Yorgios App"  # nom du Google Sheet partagé
sheet_demandes = client.open(SHEET_NAME).worksheet("Demandes Corner")
sheet_fournitures = client.open(SHEET_NAME).worksheet("Commandes Fournitures")

# --- FORMULAIRE ---
st.title("📦 Demande de Produits & Fournitures")

col1, col2 = st.columns(2)

with col1:
    produit = st.text_input("Nom du produit ou fourniture")
    quantite = st.number_input("Quantité", min_value=1, step=1)
    type_demande = st.radio("Type de demande :", ["Produit alimentaire", "Fourniture (non alimentaire)"])
with col2:
    commentaire = st.text_area("Commentaire éventuel")
    date_souhaitee = st.date_input("Date souhaitée", value=datetime.now().date())

if st.button("Envoyer la demande"):
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    ligne = [now, str(date_souhaitee), produit, quantite, commentaire, type_demande]

    if type_demande == "Produit alimentaire":
        sheet_demandes.append_row(ligne, value_input_option="USER_ENTERED")
        st.success("✅ Demande envoyée à la cuisine.")
    else:
        sheet_fournitures.append_row(ligne, value_input_option="USER_ENTERED")
        st.success("✅ Demande de fourniture envoyée au responsable.")
        
        # ENVOI MAIL POUR FOURNITURE
        msg = MIMEText(f"Nouvelle demande de fourniture :\n\n{produit} x {quantite}\nCommentaire : {commentaire}")
        msg["Subject"] = f"Demande de fourniture Yorgios - {now}"
        msg["From"] = "yorgios.system@gmail.com"
        msg["To"] = "a.cozzika@gmail.com"

        try:
            server = smtplib.SMTP("smtp.gmail.com", 587)
            server.starttls()
            server.login("yorgios.system@gmail.com", st.secrets["MAIL_PASSWORD"])
            server.send_message(msg)
            server.quit()
        except Exception as e:
            st.warning(f"❌ Erreur lors de l’envoi de l’email : {e}")
