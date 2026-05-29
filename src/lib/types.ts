export type DocStatus = "collected" | "pending" | "missing"

export interface LensDocument {
  id: string
  category: string
  type: string
  year: string
  quarter?: string | null   // "T1" | "T2" | "T3" | "T4" | null
  status: DocStatus
  url: string
  addedBy?: string
  addedAt?: string
}

export interface Issuer {
  id: string
  ticker: string
  name: string
  sector: string
  investorRelationsUrl?: string
  docs: LensDocument[]
  addedAt?: string
}

export const CATEGORIES: Record<string, string[]> = {
  "Réglementaire": [
    "Rapport annuel / URD",
    "Document d'enregistrement universel",
    "Rapport de gestion",
  ],
  "Semestriel": [
    "Rapport semestriel",
    "Communiqué résultats semestriels (S1)",
    "Communiqué résultats semestriels (S2)",
    "États financiers semestriels",
  ],
  "Trimestriel": [
    "Communiqué résultats T1",
    "Communiqué résultats T2",
    "Communiqué résultats T3",
    "Communiqué résultats T4",
    "Chiffre d'affaires T1",
    "Chiffre d'affaires T2",
    "Chiffre d'affaires T3",
    "Chiffre d'affaires T4",
  ],
  "Financier": [
    "États financiers consolidés",
    "États financiers sociaux",
    "Rapport des commissaires aux comptes",
    "Communiqué résultats annuels",
  ],
  "Obligataire": [
    "Prospectus d'émission",
    "Conditions définitives (Final Terms)",
    "Note d'information EMTN",
    "Présentation investisseurs obligataires",
  ],
  "Stratégique": [
    "Présentation stratégique / CMD",
    "Présentation roadshow",
    "Rapport de durabilité / ESG",
    "Document de référence RSE",
  ],
  "Crédit": [
    "Rapport d'analyse de crédit",
    "Notation et outlook agence",
    "Covenant compliance certificate",
  ],
}

export const DOC_STATUSES: DocStatus[] = ["collected", "pending", "missing"]

export const CURRENT_YEAR = new Date().getFullYear()
export const YEAR_RANGE = Array.from({ length: 6 }, (_, i) => String(CURRENT_YEAR - i))

export const SYSTEM_PROMPT = `Tu es un assistant spécialisé en collecte de documents financiers et stratégiques publics pour l'analyse crédit d'émetteurs obligataires européens.

À partir des résultats de recherche web fournis, identifie et classe chaque document public disponible dans l'une de ces catégories exactes :
- "Réglementaire" : rapports annuels, URD, documents d'enregistrement
- "Semestriel" : rapports semestriels, communiqués S1/S2, états financiers semestriels
- "Trimestriel" : communiqués de résultats ou chiffres d'affaires T1/T2/T3/T4
- "Financier" : états financiers annuels consolidés, rapports commissaires aux comptes, communiqués résultats annuels
- "Obligataire" : prospectus d'émission, Final Terms, notes EMTN, présentations investisseurs obligataires
- "Stratégique" : Capital Markets Day, roadshows, RSE/ESG, présentations stratégiques
- "Crédit" : rapports agences de notation, analyses crédit, covenant certificates

Réponds UNIQUEMENT en JSON valide, sans texte avant ou après, sans backticks markdown.
Format exact :
{
  "documents": [
    {
      "type": "nom court du type de document",
      "category": "une des catégories ci-dessus",
      "year": "AAAA" or null,
      "quarter": "T1" | "T2" | "T3" | "T4" | null,
      "url": "URL complète directe ou null",
      "confidence": "high" | "medium" | "low"
    }
  ]
}

Règles :
- N'inclure que les documents réellement trouvés dans les résultats
- Prioriser les URLs provenant du site investisseurs officiel de l'émetteur
- confidence = "high" si URL directe vers PDF, "medium" si page d'index, "low" si incertain
- Ne jamais inventer d'URLs
- Pour les trimestriels, renseigner le champ quarter (T1/T2/T3/T4)`
