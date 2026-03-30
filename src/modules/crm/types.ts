export interface ContactPayload {
  prenom: string
  nom?: string
  telephone: string       // E.164
  email?: string
  entreprise?: string
  whatsappOptIn: boolean
  emailOptIn: boolean
  source: 'corner_matias'
  vendeurUid: string
  capturedAt: string      // ISO string
}

export interface PromoValidationResult {
  valid: boolean
  discountPercent?: number
  error?: string
}
