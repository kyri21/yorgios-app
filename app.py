import streamlit as st
import json
import os
from oauth2client.service_account import ServiceAccountCredentials
import gspread

st.title("🚀 Yorgios App")

# Récupérer les secrets depuis Render
mail_password = os.getenv("MAIL_PASSWORD")
json_str = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
service_account_info = json.loads(json_str)

scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
creds = ServiceAccountCredentials.from_json_keyfile_dict(service_account_info, scope)
client = gspread.authorize(creds)

st.success("Connexion réussie à Google Sheets ✅")
