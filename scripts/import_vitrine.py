#!/usr/bin/env python3
"""
Import des données historiques de la vitrine depuis l'onglet 'Vitrine'
du fichier Excel europoseidon_liaison.xlsx.
→ Collection `corner_stock` (DB `test`, projet cuisine-yorgios).

Toutes les lignes ont une date_retrait → active=False (données archivées).
Utile pour le rapport Contrôle Hygiène (onglet Vitrine).

Usage :
  python3 scripts/import_vitrine.py --dry-run   # test sans écriture
  python3 scripts/import_vitrine.py              # import réel (3916 docs)
"""

import argparse
from datetime import datetime
import openpyxl
import firebase_admin
from firebase_admin import credentials, firestore

EXCEL_PATH = "reference/data/europoseidon_liaison.xlsx"
SHEET_NAME = "Vitrine"
SA_KEY     = "cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json"
DB_ID      = "test"

def parse_date(val) -> datetime | None:
    """Accepte str 'YYYY-MM-DD' ou datetime."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.replace(hour=12, minute=0, second=0, microsecond=0)
    if isinstance(val, str):
        try:
            return datetime.strptime(val.strip(), "%Y-%m-%d").replace(hour=12)
        except ValueError:
            return None
    return None

def to_ts(val):
    dt = parse_date(val)
    return dt  # Firestore Admin SDK convertit automatiquement les datetime

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    cred = credentials.Certificate(SA_KEY)
    firebase_admin.initialize_app(cred)
    db = firestore.client(database_id=DB_ID)

    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    ws = wb[SHEET_NAME]

    rows = list(ws.iter_rows(min_row=2, values_only=True))
    print(f"📄 {len(rows)} lignes dans '{SHEET_NAME}'")

    ok = skipped = errors = 0
    BATCH_SIZE = 400

    batch = db.batch() if not args.dry_run else None
    batch_count = 0

    for i, row in enumerate(rows, start=2):
        date_ajout, produit, lot, date_fab, dlc, date_retrait = (list(row) + [None]*6)[:6]

        if not produit:
            skipped += 1
            continue

        try:
            ajout_dt   = to_ts(date_ajout)
            fab_dt     = to_ts(date_fab)
            dlc_dt     = to_ts(dlc)
            retrait_dt = to_ts(date_retrait)

            lot_code = str(lot).strip() if lot and str(lot).strip() not in ('—', '', 'None') else None

            doc = {
                "productName":  str(produit).strip(),
                "lotCode":      lot_code,
                "dateAjout":    ajout_dt,
                "fabricationAt":fab_dt,
                "dlcAt":        dlc_dt,
                "retireAt":     retrait_dt,
                "active":       False,
                "importedFrom": "excel",
            }

            if args.dry_run:
                if i <= 10 or i % 500 == 0:
                    print(f"  [DRY] L{i}: {produit} | fab={date_fab} | dlc={dlc} | retrait={date_retrait}")
            else:
                ref = db.collection("corner_stock").document()
                batch.set(ref, doc)
                batch_count += 1

                if batch_count >= BATCH_SIZE:
                    batch.commit()
                    print(f"  ✅ Batch commité ({ok + batch_count} docs)")
                    batch = db.batch()
                    batch_count = 0

            ok += 1

        except Exception as e:
            print(f"  ❌ L{i}: {e} | {row[:6]}")
            errors += 1

    # Commit dernier batch
    if not args.dry_run and batch_count > 0:
        batch.commit()
        print(f"  ✅ Dernier batch commité ({batch_count} docs)")

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Résumé : {ok} importés, {skipped} ignorés, {errors} erreurs")

if __name__ == "__main__":
    main()
