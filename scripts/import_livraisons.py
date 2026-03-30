#!/usr/bin/env python3
"""
Import des livraisons depuis l'onglet 'Livraison Température' du fichier Excel.
Importe dans la collection `livraisons` de la DB Firestore `test` (projet cuisine-yorgios).

Usage :
  python3 scripts/import_livraisons.py --dry-run   # test sans écriture
  python3 scripts/import_livraisons.py              # import réel
"""

import sys
import argparse
import openpyxl
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime, timezone

# ─── Configuration ────────────────────────────────────────────────
EXCEL_PATH  = "reference/data/europoseidon_liaison.xlsx"
SHEET_NAME  = "Livraison Température"
SA_KEY      = "cuisine-yorgios-firebase-adminsdk-fbsvc-1c759ed390.json"
DB_ID       = "test"

# ─── GEP → ruleMaxTol (température max tolérée en °C) ─────────────
GEP_MAX_TOL: dict[str, float] = {
    "Viande hachée": 3.0,
    "Viande":        5.0,
    "Poisson":       3.0,
    "Lait":          6.0,
    "Plat cuisiné":  5.0,
    "Pâtisserie":    5.0,
    "Légumes":      10.0,
}

def result_from_str(s: str | None) -> str:
    if not s:
        return "A_VERIFIER"
    s = s.strip()
    if "Accepté" in s or "✅" in s:
        return "ACCEPTE"
    if "Refusé" in s or "❌" in s:
        return "REFUSE"
    return "A_VERIFIER"

def dt_to_ts(dt: datetime | None):
    """Convertit un datetime Excel (naïf, UTC+1 en pratique) en Firestore Timestamp."""
    if not isinstance(dt, datetime):
        return None
    # Le datetime Excel est naïf → on le traite comme heure locale France (pas critique pour import historique)
    return dt

def lot_code(product: str, dt: datetime) -> str:
    """Génère un code lot à partir du produit et de la date de départ."""
    d = dt.strftime("%Y%m%d")
    slug = "".join(c for c in product.upper().replace(" ", "")[:8] if c.isalnum())
    return f"{d}-IMP-{slug}"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Affiche les docs sans écrire")
    args = parser.parse_args()

    # ─── Init Firebase ────────────────────────────────────────────
    cred = credentials.Certificate(SA_KEY)
    firebase_admin.initialize_app(cred)
    db = firestore.client(database_id=DB_ID)

    # ─── Lire Excel ───────────────────────────────────────────────
    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    ws = wb[SHEET_NAME]

    rows = list(ws.iter_rows(min_row=2, values_only=True))
    print(f"📄 {len(rows)} lignes dans '{SHEET_NAME}'")

    ok = skipped = errors = 0

    for i, row in enumerate(rows, start=2):
        product, dep_temp, dep_dt, rec_temp, gep, result_raw, photo_url = (list(row) + [None]*7)[:7]

        if not product or dep_temp is None or dep_dt is None:
            print(f"  L{i}: ignoré (données manquantes) → {row}")
            skipped += 1
            continue

        try:
            dep_temp  = float(dep_temp)
            rec_temp  = float(rec_temp) if rec_temp is not None and not isinstance(rec_temp, datetime) else None
            result    = result_from_str(result_raw)
            gep_clean = str(gep).strip() if gep else ""
            rule_max  = GEP_MAX_TOL.get(gep_clean, None)
            lc        = lot_code(str(product), dep_dt)

            doc = {
                "productName":    str(product).strip(),
                "lotCode":        lc,
                "category":       gep_clean,
                "departTempC":    dep_temp,
                "departAt":       dep_dt,           # Firestore SDK convertit automatiquement les datetime
                "receptionTempC": rec_temp,
                "receptionAt":    dep_dt if rec_temp is not None else None,
                "result":         result,
                "ruleMaxTol":     rule_max,
                "isManual":       False,
                "importedFrom":   "excel",
            }

            if args.dry_run:
                print(f"  [DRY] L{i}: {product} | {dep_temp}°C → {rec_temp}°C | {gep_clean} | {result} | lot={lc}")
            else:
                db.collection("livraisons").add(doc)
                print(f"  ✅ L{i}: {product} ({result})")

            ok += 1

        except Exception as e:
            print(f"  ❌ L{i}: ERREUR → {e} | row={row}")
            errors += 1

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Résumé : {ok} importés, {skipped} ignorés, {errors} erreurs")

if __name__ == "__main__":
    main()
