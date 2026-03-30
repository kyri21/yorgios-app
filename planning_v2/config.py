# planning_v2/config.py
from __future__ import annotations
import os
from datetime import time

# ——— Emplacement du stockage local partagé (JSON)
# Priorité : variable d'env, sinon dossier "storage" local, sinon dossier du projet planning.
PLANNING_STORAGE_ROOT = os.getenv(
    "PLANNING_STORAGE_ROOT",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "storage"))
)

# ——— Backends de données disponibles : "json" (par défaut) ou "firestore"
DATA_BACKEND = os.getenv("PLANNING_DATA_BACKEND", "json").lower()

# ——— Plage horaire par défaut (affichage grille)
DEFAULT_SLOTS = [
    ("08:00", "10:00"),
    ("10:00", "12:00"),
    ("12:00", "14:00"),
    ("14:00", "16:00"),
    ("16:00", "18:00"),
    ("18:00", "20:00"),
    ("20:00", "22:00"),
    ("22:00", "23:59"),
]

# ——— Capacité par créneau (par défaut, modifiable dans l’UI manager)
DEFAULT_CAPACITY = 3

# ——— Initiales/couleurs par défaut (optionnel, peut être surchargé par data)
DEFAULT_EMPLOYEE_PRESETS = [
    {"name": "Arthur", "initials": "AK", "color": "#2563eb"},
    {"name": "Alexandre", "initials": "AX", "color": "#16a34a"},
    {"name": "Nicolas", "initials": "NC", "color": "#ef4444"},
    {"name": "Justine", "initials": "J", "color": "#a855f7"},
]
