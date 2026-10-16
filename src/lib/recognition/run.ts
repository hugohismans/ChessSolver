// Enchaînement « photo -> position » : vignettes (worker de vision),
// probabilités (worker d'apprentissage), orientation, puis grille.

import { capture } from '../state/capture.svelte'
import { recognition, START_LABELS, type RecognitionMode, type View } from '../state/recognition.svelte'
import { settings } from '../state/settings.svelte'
import { profiles } from '../state/profiles.svelte'
import { getVision } from '../vision/client'
import { getMl } from './client'
import { guessRotation, rotationForStart, rotationToMatch } from './orient'

/** Reconnaît la photo en cours (coins déjà validés). */
async function recognizeView(): Promise<Omit<View, 'rotation'>> {
  if (!capture.quad) throw new Error('Coins du plateau absents')
  const tiles = await getVision().tiles(capture.quad)
  const probs = await getMl().predict(tiles, settings.activeProfile)
  return { tiles, probs, photoId: `ph${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}` }
}

/**
 * Nouvelle reconnaissance à partir de la photo en cours. `start` : la photo
 * montre la position de départ (calibration), ce qui fixe l'orientation.
 */
export async function recognizeCapture(mode: RecognitionMode, start = false): Promise<void> {
  const v = await recognizeView()
  const rotation = start ? rotationForStart(v.probs, START_LABELS) : guessRotation(v.probs, v.tiles)
  recognition.views = [{ ...v, rotation }]
  recognition.profileId = settings.activeProfile
  recognition.profileName = profiles.activeName
  recognition.mode = mode
  recognition.active = true
  capture.rotation = rotation
}

/**
 * Photo supplémentaire de la même position : orientée pour coller aux
 * photos précédentes, puis fusionnée avec elles.
 */
export async function addCaptureView(): Promise<void> {
  const v = await recognizeView()
  const rotation = rotationToMatch(v.probs, recognition.fused)
  recognition.views = [...recognition.views, { ...v, rotation }]
  capture.rotation = rotation
}
