import streamlit as st
import json
from io import StringIO
from oauth2client.service_account import ServiceAccountCredentials
import gspread

st.set_page_config(page_title="🚀 Yorgios App", layout="wide")
st.title("🚀 Yorgios App")

# Chargement du JSON depuis les secrets
json_str = st.secrets["GOOGLE_SERVICE_ACCOUNT_JSON"]
service_account_info = json.loads(json_str)

# Correction : retransformer le private_key avec des vrais \n
service_account_info["private_key"] = service_account_info["private_key"].replace("\\n", "\n")

# Authentification Google Sheets
scope = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]
creds = ServiceAccountCredentials.from_json_keyfile_dict(service_account_info, scope)
client = gspread.authorize(creds)

# Affichage test
st.success("Connexion à Google Sheets réussie ✅")
