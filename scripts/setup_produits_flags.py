"""
Met à jour les flags inVitrine / inReception sur les produits existants
et crée les produits de réception manquants.
Usage : python3 scripts/setup_produits_flags.py [--dry-run]
"""
import sys, firebase_admin
from firebase_admin import credentials, firestore

DRY_RUN = '--dry-run' in sys.argv

cred = credentials.Certificate('cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json')
firebase_admin.initialize_app(cred)
db = firestore.client(database_id='test')

# ── Catégories vitrine (plats fabriqués par la cuisine → vendus en corner) ──
VITRINE_CATS = {'PLAT_CUISINE', 'PATISSERIE', 'LAIT', 'LAITIER', 'POISSON', 'VIANDE', 'VIANDE_HACHEE', 'LEGUMES'}

# ── Produits réception HACCP (matières premières reçues) ──
# Format : (name, abrv, defaultCategory, dlcDays)
RECEPTION_PRODUITS = [
    ('Poulet',           'POU',  'VIANDE',       3),
    ('Viande de bœuf',   'BOE',  'VIANDE',       3),
    ('Agneau',           'AGN',  'VIANDE',       3),
    ('Viande hachée',    'VHA',  'VIANDE_HACHEE',2),
    ('Poisson',          'POI',  'POISSON',      2),
    ('Lait',             'LAI',  'LAITIER',      7),
    ('Crème',            'CRE',  'LAITIER',      7),
    ('Œufs',             'OEU',  'AUTRE',        28),
    ('Fruits et légumes','FLE',  'LEGUMES',      5),
]

docs = list(db.collection('produits').stream())
print(f"Total produits trouvés : {len(docs)}")

deleted = updated_vitrine = updated_none = created = 0

for d in docs:
    data = d.to_dict()
    name = data.get('name')
    cat  = data.get('defaultCategory')

    # Supprimer les docs vides (name=None)
    if not name:
        print(f"  🗑  Suppression doc vide : {d.id}")
        if not DRY_RUN:
            d.reference.delete()
        deleted += 1
        continue

    # Définir inVitrine selon la catégorie
    in_vitrine = cat in VITRINE_CATS if cat else False
    updates = {}
    if data.get('inVitrine') != in_vitrine:
        updates['inVitrine'] = in_vitrine
    if data.get('inReception') is None:
        updates['inReception'] = False

    if updates:
        print(f"  ✏️  {name} → {updates}")
        if not DRY_RUN:
            d.reference.update(updates)
        updated_vitrine += 1

# Créer les produits de réception manquants
existing_names = {
    d.to_dict().get('name', '').lower()
    for d in db.collection('produits').stream()
    if d.to_dict().get('name')
}

for name, abrv, cat, dlc in RECEPTION_PRODUITS:
    if name.lower() in existing_names:
        # Juste activer inReception
        snap = db.collection('produits').where('name', '==', name).limit(1).get()
        if snap:
            doc_ref = snap[0].reference
            print(f"  📋 inReception=True sur '{name}'")
            if not DRY_RUN:
                doc_ref.update({'inReception': True})
    else:
        print(f"  ➕ Création '{name}' (inReception=True)")
        if not DRY_RUN:
            db.collection('produits').add({
                'name': name, 'abrv': abrv,
                'defaultCategory': cat, 'dlcDays': dlc,
                'active': True, 'inReception': True, 'inVitrine': False,
            })
        created += 1

print(f"\n✅ Terminé — supprimés:{deleted} mis_à_jour:{updated_vitrine} créés:{created}")
if DRY_RUN:
    print("(DRY RUN — aucune écriture)")
