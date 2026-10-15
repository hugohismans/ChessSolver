// Enchaînement « photo -> position » : vignettes (worker de vision),
// probabilités (worker d'apprentissage), orientation, puis grille.

import { capture } from '../state/capture.svelte'
import { recognition, START_LABELS, type RecognitionMode } from '../state/recognition.svelte'
import { settings } from '../state/settings.svelte'
import { profiles } from '../state/profiles.svelte'
import { getVision } from '../vision/client'
import { getMl } from './client'
import { guessRotation, rotationForStart } from './orient'

/**
 * Reconnaît la photo en cours (coins déjà validés). `start` : la photo
 * montre la position de départ (calibration), ce qui fixe l'orientation.
 */
export async function recognizeCapture(mode: RecognitionMode, start = false): Promise<void> {
  if (!capture.quad) throw new Error('Coins du plateau absents')
  const tiles = await getVision().tiles(capture.quad)
  const profileId = settings.activeProfile
  const probs = await getMl().predict(tiles, profileId)
  const rotation = start ? rotationForStart(probs, START_LABELS) : guessRotation(probs, tiles)
  recognition.tiles = tiles
  recognition.probs = probs
  recognition.rotation = rotation
  recognition.profileId = profileId
  recognition.profileName = profiles.activeName
  recognition.photoId = `ph${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  recognition.mode = mode
  recognition.active = true
  capture.rotation = rotation
}
