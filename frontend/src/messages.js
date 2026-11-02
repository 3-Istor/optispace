// French copy for API codes, notification types and domain values.
import { fmtTime } from './time.js'

const ERRORS = {
  RESERVATION_CONFLICT: 'Ce créneau vient d’être réservé. Choisissez un autre espace ou un autre horaire.',
  INVALID_SLOT: 'Ce créneau n’est pas valide : début à venir, horaires sur 5 min et durée autorisée pour cet espace.',
  NOT_OWNER: 'Seule la personne qui a réservé peut modifier ou annuler cette réservation.',
  RESERVATION_ENDED: 'Cette réservation est terminée ou libérée : elle ne peut plus être modifiée.',
  FORBIDDEN: 'Vous n’avez pas accès à cette page.',
  REAUTH_REQUIRED: 'Confirmez votre mot de passe pour continuer.',
  DEVICE_UNASSIGNED: 'Affectez d’abord ce boîtier à un espace.',
  INVALID_SETTINGS: 'Chaque durée minimale doit être inférieure ou égale à la durée maximale.',
  NETWORK: 'Pas de connexion. Réessayez dans quelques instants.',
}

// Text for an ApiError (or anything thrown); unknown codes get a generic message.
export const errorText = (error) => ERRORS[error?.code] ?? 'Une erreur est survenue. Réessayez dans quelques instants.'

// Notification `params`: space_name, plus `at` (ABSENCE_WARNING release time, RELEASED time,
// DEVICE_OFFLINE since) or space_type, start_at, end_at (SPACE_AVAILABLE); times are UTC ISO.
export const NOTIFICATIONS = {
  ABSENCE_WARNING: {
    title: 'Absence détectée', color: '#D9771F',
    text: (p) => `Personne n’est détecté dans ${p.space_name}. Sans présence, la réservation sera libérée à ${fmtTime(p.at)}.`,
  },
  RELEASED: {
    title: 'Réservation libérée', color: '#8A94A3',
    text: (p) => `Votre réservation de ${p.space_name} a été libérée à ${fmtTime(p.at)}.`,
  },
  SPACE_AVAILABLE: {
    title: 'Espace disponible', color: '#1A8F4E',
    text: (p) => `${p.space_name} est disponible de ${fmtTime(p.start_at)} à ${fmtTime(p.end_at)}.`,
  },
  DEVICE_OFFLINE: {
    title: 'Boîtier hors ligne', color: '#D63F45',
    text: (p) => `Le boîtier de ${p.space_name} est hors ligne depuis ${fmtTime(p.at)}.`,
  },
  DEVICE_SEALED: {
    title: 'Boîtier rescellé', color: '#2F6FE0',
    text: (p) => `Le boîtier de ${p.space_name} a été rescellé.`,
  },
}

// space_state (spec §5) -> [label, dot color]
export const SPACE_STATES = {
  free: ['Libre', '#1A8F4E'],
  awaiting_presence: ['Réservée, en attente de présence', '#D9771F'],
  occupied_reserved: ['Occupée', '#D63F45'],
  occupied_unreserved: ['Occupée sans réservation', '#A8323A'],
  unknown: ['Occupation inconnue', '#2F6FE0'],
  sealed: ['Détection désactivée', '#8A94A3'],
}

export const SPACE_TYPES = { meeting_room: 'Salle de réunion', individual_booth: 'Bulle individuelle' }

export const floorLabel = (n) => (n === 0 ? 'RDC' : n === 1 ? '1er étage' : n < 0 ? `Sous-sol ${-n}` : `${n}e étage`)
