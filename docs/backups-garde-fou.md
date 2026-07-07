# Garde-fou données — Corbeille employés + Sauvegardes natives

Mis en place le 2026-07-07. Deux briques complémentaires contre la perte de données.

## Brique A — Corbeille employés (in-app) ✅ déployé

Répare en 1 clic l'erreur la plus courante : un employé désactivé par erreur.

- **Cause du trou** : la liste `EmployeeManager` charge `where('active','==',true)`. Le bouton 🗑
  (« Supprimer ») fait `deactivateEmployee` → `active:false` → l'employé **disparaît totalement**
  de l'écran (contrairement à ⏸ Suspendre qui laisse `active:true` et reste visible).
- **Fix** :
  - `employees.ts` → `subscribeTrashedEmployees()` (`where('active','==',false)`) + `reactivateEmployee(id)`
    (`{ active:true, suspended:false }`).
  - `EmployeeManager.tsx` → section repliable « 🗑 Corbeille (N) » avec bouton « ♻️ Réactiver ».
  - L'`id` du doc ne change jamais → réactiver **restaure tout l'historique de planning** (les shifts
    référencent `empId`).
- **Aucune règle Firestore modifiée** : `employees` déjà read `isAnyRole` / write `isPatronOrManager`.

> Rien n'est jamais supprimé « en dur » côté app (aucun `deleteDoc` sur `employees`). Toute
> « suppression » est réversible via la Corbeille.

## Brique B — Sauvegardes natives Firestore (filet global)

Managées par Google, zéro code. Couvrent TOUTE la base `test` (planning, catalogue, pointages…).
À créer **une seule fois** avec un compte propriétaire du projet (la clé service account admin SDK
n'a pas les droits IAM `datastore.backupSchedules.*`).

```bash
# 1. S'authentifier avec le compte propriétaire de cuisine-yorgios
gcloud auth login
gcloud config set project cuisine-yorgios

# 2. Sauvegarde QUOTIDIENNE, rétention 7 jours
gcloud firestore backups schedules create \
  --database=test --recurrence=daily --retention=7d

# 3. Sauvegarde HEBDOMADAIRE, rétention 14 semaines (--day-of-week obligatoire)
gcloud firestore backups schedules create \
  --database=test --recurrence=weekly --retention=14w --day-of-week=SUN

# 4. PITR — rembobinage à n'importe quelle seconde des 7 derniers jours
gcloud firestore databases update --database=test --enable-pitr
```

Vérifier ensuite :

```bash
gcloud firestore backups schedules list --database=test
gcloud firestore backups list --database=test        # sauvegardes réelles (après 1er run)
```

### Restauration (le jour où)

La restauration native crée **une nouvelle base** (jamais un écrasement de la prod vivante) :

```bash
# Lister les sauvegardes disponibles
gcloud firestore backups list --database=test
# Restaurer une sauvegarde dans une base neuve, puis basculer l'app dessus
gcloud firestore databases restore \
  --source-backup=projects/cuisine-yorgios/locations/LOCATION/backups/BACKUP_ID \
  --destination-database=test-restore
```

Coût : quelques centimes/mois de stockage pour une base de cette taille.
