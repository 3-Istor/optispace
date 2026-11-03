// French copy for API codes, notification types and domain values.
import { fmtTime } from './time.js'

const ERRORS = {
  RESERVATION_CONFLICT: 'Ce créneau vient d’être réservé. Choisissez un autre espace ou un autre horaire.',
  INVALID_SLOT: 'Ce créneau n’est pas valide : début à venir, horaires sur 5 min et durée autorisée pour cet espace.',
  NOT_OWNER: 'Seule la personne qui a réservé peut modifier ou annuler cette réservation.',
  RESERVATION_ENDED: 'Cette réservation est terminée ou libérée : elle ne peut plus être modifiée.',
  FORBIDDEN: 'Vous n’avez pas accès à cette page.',
  CONFIRMATION_REQUIRED: 'Confirmez le descellement pour continuer.',
  DEVICE_UNASSIGNED: 'Affectez d’abord ce boîtier à un espace.',
  DEVICE_NOT_FOUND: 'Ce boîtier n’existe plus. Actualisez la page.',
  SPACE_NOT_FOUND: 'Cet espace n’existe plus. Actualisez la page.',
  SPACE_HAS_DEVICE: 'Cet espace a déjà un boîtier.',
  INVALID_SETTINGS: 'Chaque durée minimale doit être inférieure ou égale à la durée maximale.',
  INVALID_SPACE: 'La durée minimale de l’espace doit être inférieure ou égale à sa durée maximale.',
  INVALID_PERIOD: 'Cette période doit couvrir au moins une minute écoulée.',
  RESERVATION_NOT_FOUND: 'Cette réservation n’existe plus. Actualisez la page.',
  ALERT_NOT_FOUND: 'Cette alerte n’existe plus. Actualisez la page.',
  NOTIFICATION_NOT_FOUND: 'Cette notification n’existe plus. Actualisez la page.',
  INVALID_PUSH_ENDPOINT: 'Le service de notification de ce navigateur n’est pas pris en charge.',
  // api.js gives this code to a 422 whose detail is FastAPI's list of field errors.
  HTTP_422: 'Données invalides.',
  NETWORK: 'Pas de connexion. Réessayez dans quelques instants.',
}

// Text for an ApiError (or anything thrown); unknown codes get a generic message.
export const errorText = (error) => ERRORS[error?.code] ?? 'Une erreur est survenue. Réessayez dans quelques instants.'

// GET /spaces/{id}/insights `warnings` codes; Dashboard.jsx shows unknown ones as is.
export const WARNINGS = {
  MISSING_SENSOR_DATA: 'Données de présence manquantes sur une partie de la période.',
  RESERVATIONS_UNAVAILABLE: 'Réservations indisponibles.',
  SIMULATED_DATA: 'Données simulées.',
  PARTIAL_COVERAGE: 'Couverture partielle des mesures.',
}

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
  unknown: ['Présence à vérifier', '#2F6FE0'],
  sealed: ['Détection désactivée', '#8A94A3'],
}

// GET /devices item -> key of DEVICE_STATES; offline wins so a dead box is never shown as fine.
export const deviceState = (d) => (!d.online ? 'offline' : d.seal === 'unsealed' ? 'active' : d.space ? 'sealed' : 'new')
export const DEVICE_STATES = {
  new: ['Scellé, non affecté', '#2F6FE0'],
  sealed: ['Scellé', '#2F6FE0'],
  active: ['Actif', '#1A8F4E'],
  offline: ['Hors ligne', '#D63F45'],
}

export const SPACE_TYPES = { meeting_room: 'Salle de réunion', individual_booth: 'Bulle individuelle' }

export const floorLabel = (n) => (n === 0 ? 'RDC' : n === 1 ? '1er étage' : n < 0 ? `Sous-sol ${-n}` : `${n}e étage`)
