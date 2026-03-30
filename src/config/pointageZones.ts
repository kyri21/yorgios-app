export interface PointageZone {
  id: string
  label: string
  address: string
  lat: number
  lng: number
  radiusMeters: number
}

export const POINTAGE_ZONES: PointageZone[] = [
  {
    id: 'cuisine',
    label: 'Cuisine',
    address: "31 rue d'Hauteville, 75010 Paris",
    lat: 48.8739,
    lng: 2.3498,
    radiusMeters: 80,
  },
  {
    id: 'corner',
    label: 'Corner',
    address: '38 rue de Sèvres, 75007 Paris',
    lat: 48.85034,
    lng: 2.32394,
    radiusMeters: 100,
  },
]

export const GPS_ACCURACY_LIMIT = 50 // mètres — au-delà, le pointage est bloqué
