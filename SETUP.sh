#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#  SETUP.sh — Initialisation du projet Yorgios Master App
#  Exécuter UNE SEULE FOIS depuis /home/demis/Documents/
#
#  Usage :
#    cd /home/demis/Documents/
#    bash yorgios-app/SETUP.sh
# ═══════════════════════════════════════════════════════════
set -e
cd "$(dirname "$0")"
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Yorgios App — Installation initiale   ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Dépendances app principale ───────────────────────────
echo "📦 Installation des dépendances app (React + Firebase)…"
npm install
echo "✅ App installée"
echo ""

# ── 2. Dépendances scripts migration ────────────────────────
echo "📦 Installation des dépendances scripts de migration…"
cd scripts && npm install && cd ..
echo "✅ Scripts installés"
echo ""

# ── 3. Créer .env.local si inexistant ───────────────────────
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  echo "📝 .env.local créé à partir de .env.example"
  echo "   ⚠️  IMPORTANT : Ouvrir .env.local dans VS Code et remplir les valeurs Firebase !"
else
  echo "✅ .env.local existe déjà"
fi
echo ""

# ── 4. Vérifier Firebase CLI ────────────────────────────────
if ! command -v firebase &>/dev/null; then
  echo "🔧 Installation Firebase CLI…"
  npm install -g firebase-tools
fi
echo "✅ Firebase CLI : $(firebase --version)"
echo ""

# ── 5. Sélectionner le projet Firebase ──────────────────────
echo "🔗 Liaison avec le projet Firebase planning-yorgios-3bdb2…"
firebase use planning-yorgios-3bdb2 || true
echo ""

# ── 6. Résumé final ─────────────────────────────────────────
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Installation terminée. Prochaines étapes :         ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║                                                      ║"
echo "║  1. Ouvrir .env.local → remplir les clés Firebase   ║"
echo "║     (Firebase Console → Paramètres → SDK config)    ║"
echo "║                                                      ║"
echo "║  2. Copier la clé admin :                           ║"
echo "║     cp ../pms-cuisine/secrets/firebase-admin.json   ║"
echo "║        secrets/firebase-admin.json                  ║"
echo "║                                                      ║"
echo "║  3. Copier la V1 Streamlit :                        ║"
echo "║     cp chemin/app_yorgios.py reference/app_yorgios_v1.py ║"
echo "║                                                      ║"
echo "║  4. Placer les Excel dans reference/data/           ║"
echo "║     (voir reference/README.md)                      ║"
echo "║                                                      ║"
echo "║  5. Démarrer le serveur de dev :                    ║"
echo "║     npm run dev                                      ║"
echo "║                                                      ║"
echo "║  6. Lancer les migrations (après étape 2+4) :       ║"
echo "║     cd scripts && node migrate_all.mjs              ║"
echo "║                                                      ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
