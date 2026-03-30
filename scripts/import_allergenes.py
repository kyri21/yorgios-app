"""
Import des allergènes depuis l'Excel Yorgios vers Firestore (collection 'produits').

Pour chaque produit Excel :
  - Cherche un produit Firestore avec le même nom (normalisé)
  - S'il existe : met à jour le champ `allergenes` et `inMenu=True`
  - S'il n'existe pas : crée le produit avec inMenu=True, inVitrine=True

Usage :
  python3 scripts/import_allergenes.py --dry-run   # aperçu sans écriture
  python3 scripts/import_allergenes.py             # import réel
"""
import sys, unicodedata, re
import openpyxl
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1 import SERVER_TIMESTAMP

DRY_RUN = '--dry-run' in sys.argv

# ── Mapping termes Excel → allergènes INCO 2014 officiels ──────────────────
# Sentinel pour distinguer "terme non trouvé" de "terme ignoré volontairement"
_SKIP = object()

ALLERGEN_MAP: dict[str, object] = {
    'GLUTEN':              'Gluten',
    'LACTOSE':             'Lait',
    'LAIT':                'Lait',
    'SESAME':              'Graines de sésame',
    'SÉSAME':              'Graines de sésame',
    'POISSON':             'Poisson',
    'CRUSTACES':           'Crustacés',
    'CRUSTACÉS':           'Crustacés',
    'MOUTARDE':            'Moutarde',
    'NOIX':                'Fruits à coque',
    'FRUIT A COQUE':       'Fruits à coque',
    'FRUITS A COQUE':      'Fruits à coque',
    'FRUIT À COQUE':       'Fruits à coque',
    'FRUITS À COQUE':      'Fruits à coque',
    'PISTACHE':            'Fruits à coque',
    'AMANDE':              'Fruits à coque',
    'NOISETTE':            'Fruits à coque',
    'CELERI':              'Céleri',
    'CÉLERI':              'Céleri',
    'OEU':                 'Œufs',
    'OEUF':                'Œufs',
    'ŒUF':                 'Œufs',
    'ŒUFS':                'Œufs',
    'ARACHIDES':           'Arachides',
    'ARACHIDE':            'Arachides',
    'SOJA':                'Soja',
    'LUPIN':               'Lupin',
    'MOLLUSQUES':          'Mollusques',
    'MOLLUSQUE':           'Mollusques',
    'ANHYDRIDE SULFUREUX': 'Anhydride sulfureux',
    'SO2':                 'Anhydride sulfureux',
    'SO₂':                 'Anhydride sulfureux',
    # Termes non réglementés INCO mais importants pour les clients
    'AIL':                 'Ail',
    'OIGNON':              _SKIP,
}

ALLERGENES_OFFICIELS = [
    'Gluten', 'Crustacés', 'Œufs', 'Poisson', 'Arachides', 'Soja', 'Lait',
    'Fruits à coque', 'Céleri', 'Moutarde', 'Graines de sésame',
    'Anhydride sulfureux', 'Lupin', 'Mollusques', 'Ail',
]


def normalize(s: str) -> str:
    """Normalise un nom pour la comparaison : minuscules, sans accents, sans espaces superflus."""
    s = s.strip().upper()
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = re.sub(r'\s+', ' ', s)
    return s


def parse_allergenes(raw: str) -> list[str]:
    """Convertit la chaîne brute Excel en liste d'allergènes officiels."""
    if not raw:
        return []
    result = set()
    text = raw.upper().strip()
    # Développer les parenthèses : "FRUIT A COQUE (PISTACHE)" → "FRUIT A COQUE, PISTACHE"
    text_clean = re.sub(r'\(([^)]+)\)', r', \1', text)
    parts = re.split(r'[,;/]', text_clean)
    # Trier les clés par longueur décroissante pour matcher les termes longs en premier
    sorted_keys = sorted(ALLERGEN_MAP.keys(), key=len, reverse=True)
    for part in parts:
        part = part.strip().rstrip(',').strip()
        if not part:
            continue
        # Essai exact
        if part in ALLERGEN_MAP:
            val = ALLERGEN_MAP[part]
            if val is not None:
                result.add(val)
            # sinon : terme ignoré volontairement (AIL, OIGNON…)
            continue
        # Essai partiel (clés longues en premier)
        found = False
        for key in sorted_keys:
            if key in part:
                val = ALLERGEN_MAP[key]
                if val is not None:
                    result.add(val)
                found = True
                break
        if not found:
            print(f"    ⚠️  Terme non reconnu : '{part}' — ignoré")
    # Maintenir l'ordre officiel
    return [a for a in ALLERGENES_OFFICIELS if a in result]


def auto_abrv(name: str) -> str:
    n = unicodedata.normalize('NFD', name.strip().upper())
    n = ''.join(c for c in n if unicodedata.category(c) != 'Mn')
    n = re.sub(r'[^A-Z]', '', n)
    return n[:4] or 'PROD'


# ── Firebase ───────────────────────────────────────────────────────────────
cred = credentials.Certificate('cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json')
firebase_admin.initialize_app(cred)
db = firestore.client(database_id='test')

# ── Charger Excel ──────────────────────────────────────────────────────────
EXCEL_PATH = 'reference/data/YORGIOS liste produits et allergenes.xlsx'
wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
ws = wb['Feuil1']

excel_produits = []
for row in ws.iter_rows(min_row=2, values_only=True):
    name_raw = row[0]
    ingredients = row[1] or ''
    allergenes_raw = row[2] or ''
    if not name_raw or not str(name_raw).strip():
        continue
    name = str(name_raw).strip()
    allergenes = parse_allergenes(str(allergenes_raw))
    excel_produits.append({'name': name, 'ingredients': ingredients, 'allergenes': allergenes})

print(f"\n📋 {len(excel_produits)} produits lus depuis l'Excel")

# ── Charger Firestore ──────────────────────────────────────────────────────
firestore_docs = list(db.collection('produits').stream())
# Index par nom normalisé
firestore_index = {}
for d in firestore_docs:
    data = d.to_dict()
    n = data.get('name', '')
    if n:
        firestore_index[normalize(n)] = (d.id, d.reference, data)

print(f"📦 {len(firestore_docs)} produits trouvés dans Firestore\n")

# ── Traitement ─────────────────────────────────────────────────────────────
updated = created = skipped = 0

for p in excel_produits:
    key = normalize(p['name'])
    allergenes = p['allergenes']

    if key in firestore_index:
        doc_id, ref, existing = firestore_index[key]
        existing_al = existing.get('allergenes', [])

        if set(existing_al) == set(allergenes):
            print(f"  ✅ {p['name']} — déjà à jour ({', '.join(allergenes) or 'aucun'})")
            skipped += 1
        else:
            print(f"  ✏️  {p['name']}")
            print(f"      avant : {existing_al}")
            print(f"      après : {allergenes}")
            if not DRY_RUN:
                ref.update({'allergenes': allergenes, 'inMenu': True})
            updated += 1
    else:
        print(f"  ➕ NOUVEAU : {p['name']} ({', '.join(allergenes) or 'aucun allergène'})")
        if not DRY_RUN:
            db.collection('produits').add({
                'name': p['name'],
                'abrv': auto_abrv(p['name']),
                'defaultCategory': 'PLAT_CUISINE',
                'dlcDays': 3,
                'allergenes': allergenes,
                'active': True,
                'inMenu': True,
                'inVitrine': True,
                'inReception': False,
            })
        created += 1

print(f"\n{'=' * 50}")
print(f"✅ Terminé — mis à jour: {updated}  créés: {created}  déjà OK: {skipped}")
if DRY_RUN:
    print("⚠️  DRY RUN — aucune écriture effectuée")
