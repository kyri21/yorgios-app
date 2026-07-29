"use strict";
/** Logique pure des périodes d'hygiène — aucun import firebase, pour
 *  rester testable. Duplique volontairement src/modules/corner/utils/hygiene.ts :
 *  ce projet n'a pas d'import cross-package entre le client et les fonctions.
 *  Les tests des deux côtés vérifient les mêmes identifiants. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_HYGIENE_SETTINGS = exports.ITEMS_ORIGINE_IDS = void 0;
exports.estComplete = estComplete;
exports.mergeHygieneSettings = mergeHygieneSettings;
exports.getPeriodId = getPeriodId;
exports.resolveJalon = resolveJalon;
exports.parisNow = parisNow;
/** Identifiants des items d'ORIGINE, GELÉS.
 *
 *  Ne jamais les modifier : les items évoluent désormais dans
 *  `settings/hygiene_items`. Ils servent uniquement de repli pour les
 *  documents `hygiene_corner` antérieurs, qui ne portent pas `itemsAttendus`.
 *  Les juger sur la liste courante rendrait tout l'historique incomplet au
 *  premier ajout d'item. */
exports.ITEMS_ORIGINE_IDS = {
    quotidien: [
        'plats_service', 'int_vitrines', 'ustensiles', 'meuble_vente',
        'comptoir_balance', 'micro_ondes', 'evier_papier', 'etiquettes',
        'plan_travail', 'ext_placards', 'ext_frigo', 'poubelle', 'vitres',
    ],
    hebdo: [
        'int_frigos', 'etageres_materiels', 'support_papier',
        'placard_hygiene', 'machine_glacon',
    ],
    mensuel: ['placard_rangement'],
};
/** Une période est faite quand tous les items QUI LUI ÉTAIENT DEMANDÉS sont
 *  cochés. Le document porte lui-même sa référence (`itemsAttendus`), donc
 *  aucune lecture supplémentaire n'est nécessaire ici. */
function estComplete(docData, kind) {
    var _a;
    if (!docData)
        return false;
    const attendus = Array.isArray(docData.itemsAttendus)
        ? docData.itemsAttendus
        : exports.ITEMS_ORIGINE_IDS[kind];
    const items = (_a = docData.items) !== null && _a !== void 0 ? _a : {};
    return attendus.every(id => items[id] === true);
}
/** Ces valeurs reproduisent exactement le comportement figé de la révision 1.
 *  Elles sont dupliquées dans src/utils/hygieneSettings.ts — les tests des
 *  deux côtés assertent les mêmes littéraux pour verrouiller cet accord. */
exports.DEFAULT_HYGIENE_SETTINGS = {
    rappelsEnabled: true,
    escaladeDestinataires: [],
    hebdo: {
        rappel1: { actif: true, jour: 4, heure: 10 }, // jeudi
        rappel2: { actif: true, jour: 6, heure: 10 }, // samedi
        escalade: { actif: true, jour: 0, heure: 18 }, // dimanche
    },
    mensuel: {
        rappel1: { actif: true, joursAvantFin: 7, heure: 10 },
        rappel2: { actif: true, joursAvantFin: 2, heure: 10 },
        escalade: { actif: true, joursAvantFin: 0, heure: 18 },
    },
    canaux: {
        designation: { email: true, push: true },
        rappel: { email: true, push: true },
        escalade: { email: true, push: false },
    },
};
const JALONS = ['rappel1', 'rappel2', 'escalade'];
/** Convertit et borne une valeur numérique lue depuis Firestore.
 *
 *  Le document `settings/hygiene_responsables` peut être édité à la main dans
 *  la console Firebase, ou écrit par un script qui sérialise tout en chaînes.
 *  `heure: "10"` comparé en `===` à un nombre dans `resolveJalon` ne
 *  correspondrait JAMAIS : le rappel ne partirait plus jamais, sans erreur,
 *  sans log, l'interface continuant d'afficher « jeu 10h ». Un simple
 *  étalement d'objets laissait passer cette valeur telle quelle.
 *
 *  ⚠️ Copie rigoureusement identique à src/utils/hygieneSettings.ts. */
function nombreBorne(brut, min, max, defaut) {
    const n = typeof brut === 'string' ? Number(brut.trim()) : brut;
    if (typeof n !== 'number' || !Number.isFinite(n))
        return defaut;
    return Math.min(max, Math.max(min, Math.round(n)));
}
/** Booléen strict. `actif: "false"` sous forme de chaîne est une valeur vraie
 *  en JavaScript : un jalon affiché comme désactivé continuerait d'envoyer.
 *  Convention conservée de `rappelsEnabled` : absent (ou illisible) = actif,
 *  on n'éteint jamais un rappel par omission. */
function booleenStrict(brut, defaut) {
    if (typeof brut === 'boolean')
        return brut;
    if (brut === 'true')
        return true;
    if (brut === 'false')
        return false;
    return defaut;
}
/** Bornes de validation. `joursAvantFin` va jusqu'à 30 : c'est le maximum de
 *  jours restants réellement atteignable dans un mois de 31 jours. La saisie
 *  de la section Paramètres est volontairement plus stricte (0-27, la seule
 *  plage qui se déclenche aussi en février) — son domaine est un sous-ensemble
 *  de celui-ci, jamais l'inverse. */
const BORNES = {
    jour: { min: 0, max: 6 },
    heure: { min: 0, max: 23 },
    joursAvantFin: { min: 0, max: 30 },
};
/** Fusion champ par champ avec les défauts, valeurs converties et bornées.
 *  Un document absent, partiel, ou écrit par la révision 1 doit produire le
 *  comportement d'origine — c'est ce qui garantit que rendre ces réglages
 *  configurables ne casse rien pour qui n'y touche jamais. */
function mergeHygieneSettings(data) {
    var _a, _b, _c, _d, _e, _f, _g;
    const d = data !== null && data !== void 0 ? data : {};
    const hebdo = {};
    const mensuel = {};
    for (const cle of JALONS) {
        const defH = exports.DEFAULT_HYGIENE_SETTINGS.hebdo[cle];
        const brutH = (_b = (_a = d.hebdo) === null || _a === void 0 ? void 0 : _a[cle]) !== null && _b !== void 0 ? _b : {};
        hebdo[cle] = {
            actif: booleenStrict(brutH.actif, defH.actif),
            jour: nombreBorne(brutH.jour, BORNES.jour.min, BORNES.jour.max, defH.jour),
            heure: nombreBorne(brutH.heure, BORNES.heure.min, BORNES.heure.max, defH.heure),
        };
        const defM = exports.DEFAULT_HYGIENE_SETTINGS.mensuel[cle];
        const brutM = (_d = (_c = d.mensuel) === null || _c === void 0 ? void 0 : _c[cle]) !== null && _d !== void 0 ? _d : {};
        mensuel[cle] = {
            actif: booleenStrict(brutM.actif, defM.actif),
            joursAvantFin: nombreBorne(brutM.joursAvantFin, BORNES.joursAvantFin.min, BORNES.joursAvantFin.max, defM.joursAvantFin),
            heure: nombreBorne(brutM.heure, BORNES.heure.min, BORNES.heure.max, defM.heure),
        };
    }
    const canal = (brut, defaut) => ({
        email: booleenStrict(brut === null || brut === void 0 ? void 0 : brut.email, defaut.email),
        push: booleenStrict(brut === null || brut === void 0 ? void 0 : brut.push, defaut.push),
    });
    return {
        // Absent = actif : ne jamais éteindre des rappels par omission.
        rappelsEnabled: booleenStrict(d.rappelsEnabled, true),
        escaladeDestinataires: Array.isArray(d.escaladeDestinataires) ? d.escaladeDestinataires : [],
        hebdo,
        mensuel,
        canaux: {
            designation: canal((_e = d.canaux) === null || _e === void 0 ? void 0 : _e.designation, exports.DEFAULT_HYGIENE_SETTINGS.canaux.designation),
            rappel: canal((_f = d.canaux) === null || _f === void 0 ? void 0 : _f.rappel, exports.DEFAULT_HYGIENE_SETTINGS.canaux.rappel),
            escalade: canal((_g = d.canaux) === null || _g === void 0 ? void 0 : _g.escalade, exports.DEFAULT_HYGIENE_SETTINGS.canaux.escalade),
        },
    };
}
const pad = (n) => String(n).padStart(2, '0');
function thursdayOfISOWeek(d) {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
    return date;
}
function isoWeek(d) {
    const thursday = thursdayOfISOWeek(d);
    const week1 = new Date(thursday.getFullYear(), 0, 4);
    return 1 + Math.round(((thursday.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}
function getPeriodId(kind, ref) {
    if (kind === 'hebdo') {
        return `${thursdayOfISOWeek(ref).getFullYear()}-W${pad(isoWeek(ref))}_hebdo`;
    }
    return `${ref.getFullYear()}-${pad(ref.getMonth() + 1)}_mensuel`;
}
/** Dernier jour du mois de `d`. Jour 0 du mois suivant = dernier jour du mois courant. */
function lastDayOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
/**
 * Quel jalon correspond à cet instant, selon la configuration.
 * `now` doit être une date exprimée en heure murale de Paris.
 *
 * Collision : si deux jalons partagent le même créneau, le plus grave
 * l'emporte et un seul message part. L'interface avertit au réglage.
 */
function resolveJalon(kind, now, config) {
    const heure = now.getHours();
    // Ordre DÉCROISSANT de gravité : le premier qui correspond gagne, donc en
    // cas de collision sur un même créneau c'est le plus grave qui part.
    // ⚠️ `JALONS` dans src/utils/hygieneSettings.ts porte l'ordre inverse, et
    // l'avertissement de collision de l'interface en dépend pour désigner le
    // bon gagnant. Répercuter toute modification de priorité des deux côtés.
    const parGravite = ['escalade', 'rappel2', 'rappel1'];
    if (kind === 'hebdo') {
        const jour = now.getDay(); // 0 = dimanche
        for (const cle of parGravite) {
            const j = config.hebdo[cle];
            if (j.actif && j.jour === jour && j.heure === heure)
                return cle;
        }
        return null;
    }
    const restants = lastDayOfMonth(now) - now.getDate();
    for (const cle of parGravite) {
        const j = config.mensuel[cle];
        if (j.actif && j.joursAvantFin === restants && j.heure === heure)
            return cle;
    }
    return null;
}
/** Heure murale de Paris, quel que soit le fuseau du conteneur.
 *  Même approche que les fonctions planifiées déjà en place. */
function parisNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
}
//# sourceMappingURL=periods.js.map