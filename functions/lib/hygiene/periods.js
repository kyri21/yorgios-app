"use strict";
/** Logique pure des périodes d'hygiène — aucun import firebase, pour
 *  rester testable. Duplique volontairement src/modules/corner/utils/hygiene.ts :
 *  ce projet n'a pas d'import cross-package entre le client et les fonctions.
 *  Les tests des deux côtés vérifient les mêmes identifiants. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MENSUEL_IDS = exports.HEBDO_IDS = void 0;
exports.itemIdsFor = itemIdsFor;
exports.getPeriodId = getPeriodId;
exports.resolveJalon = resolveJalon;
exports.isHygieneDone = isHygieneDone;
exports.parisNow = parisNow;
exports.HEBDO_IDS = [
    'int_frigos', 'etageres_materiels', 'support_papier',
    'placard_hygiene', 'machine_glacon',
];
exports.MENSUEL_IDS = ['placard_rangement'];
function itemIdsFor(kind) {
    return kind === 'hebdo' ? exports.HEBDO_IDS : exports.MENSUEL_IDS;
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
 * Quel jalon de rappel correspond à cet instant, s'il y en a un.
 * `now` doit être une date exprimée en heure murale de Paris.
 *
 * Hebdo   : jeudi 10h · samedi 10h · dimanche 18h
 * Mensuel : J-7 10h · J-2 10h · dernier jour 18h — J étant la fin du
 *           mois, calculée par soustraction et jamais sur un numéro fixe.
 */
function resolveJalon(kind, now) {
    const heure = now.getHours();
    if (kind === 'hebdo') {
        const jour = now.getDay(); // 0 = dimanche
        if (jour === 4 && heure === 10)
            return 'j-3';
        if (jour === 6 && heure === 10)
            return 'j-1';
        if (jour === 0 && heure === 18)
            return 'escalade';
        return null;
    }
    const restants = lastDayOfMonth(now) - now.getDate();
    if (restants === 7 && heure === 10)
        return 'j-3';
    if (restants === 2 && heure === 10)
        return 'j-1';
    if (restants === 0 && heure === 18)
        return 'escalade';
    return null;
}
function isHygieneDone(items, ids) {
    if (!items)
        return false;
    return ids.every(id => items[id] === true);
}
/** Heure murale de Paris, quel que soit le fuseau du conteneur.
 *  Même approche que les fonctions planifiées déjà en place. */
function parisNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
}
//# sourceMappingURL=periods.js.map