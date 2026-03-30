# planning_v2/data.py
from __future__ import annotations
import os, json
from dataclasses import dataclass, asdict
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Any

from .config import PLANNING_STORAGE_ROOT, DATA_BACKEND, DEFAULT_SLOTS, DEFAULT_CAPACITY, DEFAULT_EMPLOYEE_PRESETS

# ————————————————————————
# Types de données
# ————————————————————————
DAYS_FR = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]

@dataclass
class Employee:
    name: str
    initials: str
    color: str

@dataclass
class SlotCell:
    capacity: int
    employees: List[str]  # liste des noms

WeekData = Dict[str, Dict[str, SlotCell]]  # day -> "HH:MM-HH:MM" -> SlotCell

@dataclass
class PlanningState:
    employees: List[Employee]
    week: WeekData

# ————————————————————————
# Utilitaires
# ————————————————————————
def _monday_of_week(d: date) -> date:
    return d - timedelta(days=(d.weekday()))  # lundi = 0

def _week_key(monday: date) -> str:
    return monday.strftime("%Y-%m-%d")  # clé de fichier

def _ensure_dir(path: str) -> None:
    if not os.path.isdir(path):
        os.makedirs(path, exist_ok=True)

def _json_path_for_week(monday: date) -> str:
    storage = PLANNING_STORAGE_ROOT
    _ensure_dir(storage)
    return os.path.join(storage, f"week_{_week_key(monday)}.json")

def _json_path_employees() -> str:
    storage = PLANNING_STORAGE_ROOT
    _ensure_dir(storage)
    return os.path.join(storage, "employees.json")

def _default_week() -> WeekData:
    week: WeekData = {}
    for i, day in enumerate(DAYS_FR):
        week[day] = {}
        for start, end in DEFAULT_SLOTS:
            k = f"{start}-{end}"
            week[day][k] = SlotCell(capacity=DEFAULT_CAPACITY, employees=[])
    return week

def _default_employees() -> List[Employee]:
    return [Employee(**e) for e in DEFAULT_EMPLOYEE_PRESETS]

# ————————————————————————
# Backend JSON
# ————————————————————————
def _json_load_week(monday: date) -> PlanningState:
    p = _json_path_for_week(monday)
    if not os.path.isfile(p):
        state = PlanningState(employees=_json_load_employees(), week=_default_week())
        _json_save_week(monday, state)
        return state
    with open(p, "r", encoding="utf-8") as f:
        raw = json.load(f)
    employees = [Employee(**e) for e in raw.get("employees", [])]
    week: WeekData = {}
    for day, slots in raw.get("week", {}).items():
        week[day] = {}
        for rng, cell in slots.items():
            week[day][rng] = SlotCell(**cell)
    return PlanningState(employees=employees, week=week)

def _json_save_week(monday: date, state: PlanningState) -> None:
    p = _json_path_for_week(monday)
    payload = {
        "employees": [asdict(e) for e in state.employees],
        "week": {d: {k: asdict(v) for k, v in slots.items()} for d, slots in state.week.items()},
    }
    with open(p, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

def _json_load_employees() -> List[Employee]:
    p = _json_path_employees()
    if not os.path.isfile(p):
        emps = _default_employees()
        _json_save_employees(emps)
        return emps
    with open(p, "r", encoding="utf-8") as f:
        raw = json.load(f)
    return [Employee(**e) for e in raw]

def _json_save_employees(emps: List[Employee]) -> None:
    p = _json_path_employees()
    with open(p, "w", encoding="utf-8") as f:
        json.dump([asdict(e) for e in emps], f, ensure_ascii=False, indent=2)

# ————————————————————————
# Backend Firestore (préparé, activable plus tard)
# ————————————————————————
def _firestore_client():
    # Activable plus tard : firebase_admin / credentials / initialize_app
    # Ici, on garde l’interface prête pour switcher rapidement.
    from firebase_admin import firestore  # type: ignore
    return firestore.client()

def _fs_col():
    return "planning_weeks"

def _fs_employees_col():
    return "planning_employees"

def _fs_doc_key(monday: date) -> str:
    return _week_key(monday)

def _fs_load_week(monday: date) -> PlanningState:
    db = _firestore_client()
    doc = db.collection(_fs_col()).document(_fs_doc_key(monday)).get()
    if not doc.exists:
        state = PlanningState(employees=_fs_load_employees(), week=_default_week())
        _fs_save_week(monday, state)
        return state
    raw = doc.to_dict() or {}
    employees = [Employee(**e) for e in raw.get("employees", [])]
    week: WeekData = {}
    for day, slots in raw.get("week", {}).items():
        week[day] = {}
        for rng, cell in slots.items():
            week[day][rng] = SlotCell(**cell)
    return PlanningState(employees=employees, week=week)

def _fs_save_week(monday: date, state: PlanningState) -> None:
    db = _firestore_client()
    payload = {
        "employees": [asdict(e) for e in state.employees],
        "week": {d: {k: asdict(v) for k, v in slots.items()} for d, slots in state.week.items()},
        "monday": _week_key(monday),
        "updated_at": datetime.utcnow().isoformat()
    }
    db.collection(_fs_col()).document(_fs_doc_key(monday)).set(payload)

def _fs_load_employees() -> List[Employee]:
    db = _firestore_client()
    docs = db.collection(_fs_employees_col()).get()
    if not docs:
        emps = _default_employees()
        _fs_save_employees(emps)
        return emps
    out: List[Employee] = []
    for d in docs:
        out.append(Employee(**(d.to_dict() or {})))
    return out

def _fs_save_employees(emps: List[Employee]) -> None:
    db = _firestore_client()
    batch = db.batch()
    col = db.collection(_fs_employees_col())
    # purge simple (option)
    for d in col.get():
        batch.delete(d.reference)
    batch.commit()
    # insert
    batch = db.batch()
    for e in emps:
        ref = col.document(e.name)
        batch.set(ref, asdict(e))
    batch.commit()

# ————————————————————————
# API publique (le reste de l’app utilise seulement ces fonctions)
# ————————————————————————
def load_week(monday: Optional[date] = None) -> PlanningState:
    monday = _monday_of_week(monday or date.today())
    if DATA_BACKEND == "firestore":
        return _fs_load_week(monday)
    return _json_load_week(monday)

def save_week(state: PlanningState, monday: Optional[date] = None) -> None:
    monday = _monday_of_week(monday or date.today())
    if DATA_BACKEND == "firestore":
        _fs_save_week(monday, state)
    else:
        _json_save_week(monday, state)

def load_employees() -> List[Employee]:
    if DATA_BACKEND == "firestore":
        return _fs_load_employees()
    return _json_load_employees()

def save_employees(emps: List[Employee]) -> None:
    if DATA_BACKEND == "firestore":
        _fs_save_employees(emps)
    else:
        _json_save_employees(emps)

def monday_for(date_like: Optional[date] = None) -> date:
    return _monday_of_week(date_like or date.today())

def days_labels() -> List[str]:
    return DAYS_FR
