export type Role = 'patron' | 'administrateur' | 'manager' | 'corner' | 'cuisine';

export interface UserProfile {
  uid:          string;
  email:        string;
  role:         Role;
  displayName?: string;
}

// Produit Matias
export interface Produit {
  id:             string;
  nom:            string;
  abreviation:    string;
  categorie:      string;
  denomination_gep: string;
  dlc_jours:      number;
  temp_max:       number;
  temp_max_tol:   number;
}

// Relevé température frigo
export interface ReleverTemp {
  id:       string;
  frigo:    string;
  semaine:  number;
  annee:    number;
  releves:  Record<string, number | null>; // "Lundi Matin" → 2.8
}

// Livraison cuisine → corner
export interface Livraison {
  id:                   string;
  produit:              string;
  denomination_gep:     string;
  temp_depart:          number | null;
  horodatage_depart:    Date | null;
  temp_reception:       number | null;
  horodatage_reception: Date | null;
  resultat:             '✅ Accepté' | '❌ Refusé' | '';
  photo_url:            string;
  lot_id?:              string;
}

// Check-list hygiène (corner ou cuisine)
export interface HygieneRecord {
  id:     string;
  type:   'Quotidien' | 'Hebdomadaire' | 'Mensuel';
  date:   string; // YYYY-MM-DD
  taches: Record<string, boolean>;
}

// Article vitrine
export interface ArticleVitrine {
  id:            string;
  produit:       string;
  date_ajout:    string;
  date_fab:      string;
  dlc:           string;
  date_retrait:  string;
  numero_de_lot: string;
}

// Objectif CA
export interface ObjectifCA {
  id:          string; // mois ex: "Janvier"
  mois:        string;
  objectif_ht: number;
  resultat:    number | null;
}
