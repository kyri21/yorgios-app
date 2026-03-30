# planning_v2/app.py
from __future__ import annotations
import streamlit as st
from datetime import date, timedelta
from typing import Tuple

from .data import load_week, save_week, load_employees, save_employees, monday_for, days_labels, PlanningState, SlotCell
from .config import DEFAULT_SLOTS, DEFAULT_CAPACITY

# ——————————————————————————————————————————
# Rendu minimal compact (compatible avec ton style)
# NB : Tu peux remplacer les cellules par tes "chips" compactes de components.py
# en important/rendering ici si tu souhaites 100% le même rendu.
# ——————————————————————————————————————————

def _week_selector() -> date:
    # Semaine courante par défaut (lundi)
    monday = monday_for(date.today())
    # Composant : navigation semaine -1 / +1 + label
    c1, c2, c3 = st.columns([1,2,1])
    with c1:
        if st.button("← Semaine -1", use_container_width=True):
            st.session_state["_week_offset"] = st.session_state.get("_week_offset", 0) - 1
    with c3:
        if st.button("Semaine +1 →", use_container_width=True):
            st.session_state["_week_offset"] = st.session_state.get("_week_offset", 0) + 1
    offset = st.session_state.get("_week_offset", 0)
    monday = monday + timedelta(days=7*offset)
    with c2:
        st.markdown(f"### 🗓️ Semaine du **{monday.strftime('%d/%m/%Y')}**")
    return monday

def _render_employee_chips(state: PlanningState, read_only: bool) -> None:
    st.subheader("👥 Équipe")
    cols = st.columns(4)
    for i, e in enumerate(state.employees):
        with cols[i % 4]:
            st.markdown(
                f"<div style='border:1px solid #eee;border-radius:10px;padding:8px;margin:4px;display:flex;align-items:center;gap:8px'>"
                f"<div style='width:20px;height:20px;background:{e.color};border-radius:50%'></div>"
                f"<div><b>{e.name}</b><br/><span style='opacity:.7'>{e.initials}</span></div>"
                f"</div>",
                unsafe_allow_html=True
            )
    if not read_only:
        with st.expander("Ajouter / modifier un employé"):
            name = st.text_input("Nom")
            initials = st.text_input("Initiales", max_chars=3)
            color = st.color_picker("Couleur", "#2563eb")
            if st.button("Enregistrer l’employé"):
                if name.strip():
                    # replace si existe
                    remaining = [x for x in state.employees if x.name != name]
                    state.employees = remaining + [{"name": name.strip(), "initials": initials.strip() or name[:2].upper(), "color": color}]
                    # cast dict->dataclass
                    from .data import Employee
                    state.employees = [Employee(**e.__dict__) if hasattr(e, "__dict__") else Employee(**e) for e in state.employees]
                    save_employees(state.employees)
                    st.success("Employé enregistré.")
                    st.experimental_rerun()

def _render_grid(state: PlanningState, read_only: bool) -> None:
    st.subheader("📋 Grille hebdomadaire")
    days = days_labels()
    # En-têtes
    header = st.columns([1] + [1]*len(DEFAULT_SLOTS))
    header[0].write("**Jour**")
    for i, (start, end) in enumerate(DEFAULT_SLOTS):
        header[i+1].write(f"**{start}–{end}**")

    # Lignes jour par jour
    for d in days:
        row = st.columns([1] + [1]*len(DEFAULT_SLOTS))
        row[0].write(f"**{d.capitalize()}**")
        for i, (start, end) in enumerate(DEFAULT_SLOTS):
            key = f"{start}-{end}"
            cell: SlotCell = state.week[d][key]
            if read_only:
                # rendu compact lecture seule
                txt = f"{len(cell.employees)}/{cell.capacity}"
                row[i+1].button(txt, key=f"ro_{d}_{key}", disabled=True, use_container_width=True)
            else:
                # édition rapide : count/capacity + multiselect
                with row[i+1]:
                    cap = st.number_input("Cap.", min_value=1, max_value=99, value=cell.capacity, key=f"cap_{d}_{key}", label_visibility="collapsed")
                    names = [e.name for e in state.employees]
                    selected = st.multiselect(
                        f"{d}-{key}",
                        options=names,
                        default=cell.employees,
                        key=f"ms_{d}_{key}",
                        label_visibility="collapsed"
                    )
                    # Mise à jour en mémoire (sauvegarde au clic global)
                    cell.capacity = int(cap)
                    cell.employees = list(selected)

def _save_changes(state: PlanningState, monday: date) -> None:
    save_week(state, monday)
    st.success("✅ Semaine enregistrée.")

def render_planning_ui(*, read_only: bool, manager_mode: bool) -> None:
    """
    - read_only : force l’UI lecture seule (Corner/Cuisine)
    - manager_mode : si True, autorise l’édition et boutons d’actions
    """
    monday = _week_selector()
    state = load_week(monday)

    # Bandeau mode
    t = "Lecture seule" if read_only and not manager_mode else "Gestion (édition)"
    st.info(f"Mode : **{t}** – Semaine du **{monday.strftime('%d/%m/%Y')}**")

    # Équipe
    _render_employee_chips(state, read_only=not manager_mode)

    # Grille
    _render_grid(state, read_only=not manager_mode)

    # Actions Manager
    if manager_mode:
        save_col, _, dup_col, clear_day_col, clear_week_col = st.columns([1, .2, 1, 1, 1])
        with save_col:
            if st.button("💾 Enregistrer la semaine", use_container_width=True):
                _save_changes(state, monday)
        with dup_col:
            with st.popover("🗂️ Dupliquer vers…"):
                target = st.date_input("Lundi cible", value=monday + timedelta(days=7))
                if st.button("Dupliquer"):
                    from copy import deepcopy
                    save_week(deepcopy(state), monday_for(target))
                    st.success("Semaine dupliquée.")
        with clear_day_col:
            with st.popover("🧹 Vider un jour"):
                from .data import days_labels
                day = st.selectbox("Jour", days_labels())
                if st.button("Vider ce jour"):
                    for rng in state.week[day]:
                        state.week[day][rng].employees = []
                    st.success(f"{day.capitalize()} vidé.")
        with clear_week_col:
            with st.popover("🧽 Vider la semaine"):
                if st.button("Confirmer vider"):
                    for d in state.week:
                        for rng in state.week[d]:
                            state.week[d][rng].employees = []
                    st.success("Semaine vidée.")
