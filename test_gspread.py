import gspread
import json
from oauth2client.service_account import ServiceAccountCredentials

with open("service_account.json", "r") as f:
    service_json = json.load(f)

# Assure une bonne gestion des retours à la ligne dans la clé privée
service_json["private_key"] = service_json["private_key"].replace("\\n", "\n")

scope = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/drive.readonly"
]

creds = ServiceAccountCredentials.from_json_keyfile_dict(service_json, scope)
gc = gspread.authorize(creds)

sheet = gc.open_by_key("1XMYhh2CSIv1zyTtXKM4_ACEhW-6kXxoFi4ACzNhbuDE")
print("✅ Feuille trouvée :", sheet.title)
