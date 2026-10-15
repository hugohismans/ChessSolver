<!--
  Écran « Calibrer mon jeu » : profils de jeux d'échecs, collecte
  d'exemples (photos de la position de départ, puis positions quelconques
  corrigées), entraînement du modèle dans un worker, export / import.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import Sheet from './Sheet.svelte'
  import PieceIcon from './PieceIcon.svelte'
  import { profiles } from '../state/profiles.svelte'
  import { settings } from '../state/settings.svelte'
  import { BASE_PROFILE, createProfile, deleteProfile, exportProfile, importProfile, saveProfile } from '../recognition/storage'
  import { CLASSES } from '../recognition/classes'
  import { getMl } from '../recognition/client'
  import type { TrainProgress, TrainResult } from '../recognition/ml.worker'
  import type { PieceChar } from '../chess/position'
  import { persistStorage } from '../state/pwa.svelte'
  import { keepAwake, haptic } from '../wakelock'

  interface Props {
    onstartphoto: () => void
    onpositionphoto: () => void
  }
  let { onstartphoto, onpositionphoto }: Props = $props()

  onMount(() => {
    profiles.refresh()
  })

  const active = $derived(profiles.active)
  const stats = $derived(profiles.stats)
  const GOAL_MIN = 5
  const GOAL_MAX = 10

  // ---- Profils ----
  let nameSheet = $state<'new' | 'rename' | null>(null)
  let nameInput = $state('')
  let message = $state('')
  let importInput = $state<HTMLInputElement>()

  function openName(kind: 'new' | 'rename') {
    nameInput = kind === 'rename' ? (active?.name ?? '') : ''
    nameSheet = kind
  }

  async function confirmName() {
    const name = nameInput.trim()
    if (!name) return
    if (nameSheet === 'new') {
      const p = await createProfile(name)
      settings.activeProfile = p.id
      // Les profils représentent du travail : on demande à les conserver
      persistStorage()
    } else if (active) {
      await saveProfile({ ...active, name })
    }
    nameSheet = null
    await profiles.refresh()
  }

  async function remove() {
    if (!active) return
    if (!confirm(`Supprimer le profil « ${active.name} » et tous ses exemples ?`)) return
    await deleteProfile(active.id)
    settings.activeProfile = BASE_PROFILE
    await profiles.refresh()
  }

  async function select(id: string) {
    settings.activeProfile = id
    result = null
    await profiles.refresh()
  }

  async function doExport() {
    if (!active) return
    message = 'Préparation du fichier...'
    try {
      const blob = await exportProfile(active.id)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${active.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'profil'}.chesscam`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      message = `Fichier exporté (${(blob.size / 1e6).toFixed(1)} Mo).`
    } catch (e) {
      message = e instanceof Error ? e.message : 'Export impossible'
    }
  }

  async function doImport(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (!f) return
    message = 'Import en cours...'
    try {
      const p = await importProfile(f)
      settings.activeProfile = p.id
      await profiles.refresh()
      message = `Profil « ${p.name} » importé.`
    } catch (err) {
      message = err instanceof Error ? err.message : 'Import impossible'
    }
    ;(e.target as HTMLInputElement).value = ''
  }

  // ---- Entraînement ----
  let training = $state(false)
  let progress = $state<TrainProgress | null>(null)
  let result = $state<TrainResult | null>(null)
  let trainError = $state('')

  async function train() {
    if (!active) return
    training = true
    trainError = ''
    result = null
    progress = { phase: 'features', progress: 0 }
    // Écran allumé pendant l'entraînement (le navigateur ralentit les onglets en veille)
    const release = keepAwake()
    try {
      result = await getMl().train(active.id, (p) => (progress = p))
      await profiles.refresh()
      haptic(30)
    } catch (e) {
      trainError = e instanceof Error ? e.message : 'Entraînement impossible'
    } finally {
      release()
      training = false
    }
  }

  const phaseText = $derived.by(() => {
    if (!progress) return ''
    if (progress.phase === 'features') return 'Analyse des exemples (avec variantes : rotation, lumière, contraste, miroir)...'
    if (progress.phase === 'train')
      return `Apprentissage, époque ${progress.epoch}/${progress.epochs}${progress.valAccuracy != null ? `, validation ${pct(progress.valAccuracy)}` : ''}`
    return 'Enregistrement...'
  })
  // Barre globale : 60 % pour l'analyse des exemples, 40 % pour l'apprentissage
  const overall = $derived(progress ? (progress.phase === 'features' ? progress.progress * 0.6 : progress.phase === 'train' ? 0.6 + progress.progress * 0.4 : 1) : 0)

  function pct(v: number) {
    return `${(v * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`
  }

  const metrics = $derived(active?.metrics ?? null)
</script>

<div class="flex flex-col gap-4">
  <!-- Profil actif -->
  <section class="rounded-2xl bg-stone-900 p-4 ring-1 ring-white/5" aria-labelledby="profil">
    <h2 id="profil" class="section-title">Jeu utilisé pour la reconnaissance</h2>
    <select
      class="h-12 w-full rounded-xl bg-stone-800 px-3 text-base text-stone-100 outline-none focus:ring-2 focus:ring-teal-400"
      value={settings.activeProfile}
      onchange={(e) => select((e.target as HTMLSelectElement).value)}
      aria-label="Profil actif"
    >
      <option value={BASE_PROFILE}>Modèle de base (générique)</option>
      {#each profiles.list as p (p.id)}
        <option value={p.id}>{p.name}</option>
      {/each}
    </select>
    <div class="mt-2 grid grid-cols-3 gap-2">
      <button class="btn-secondary" onclick={() => openName('new')}>Nouveau</button>
      <button class="btn-secondary" disabled={!active} onclick={() => openName('rename')}>Renommer</button>
      <button class="btn-secondary text-red-300!" disabled={!active} onclick={remove}>Supprimer</button>
      <button class="btn-secondary" disabled={!active} onclick={doExport}>Exporter</button>
      <button class="btn-secondary col-span-2" onclick={() => importInput?.click()}>Importer un profil</button>
    </div>
    <input bind:this={importInput} type="file" accept=".chesscam,application/gzip,application/octet-stream" class="hidden" onchange={doImport} />
    {#if message}<p class="mt-2 text-sm text-stone-300" role="status">{message}</p>{/if}
  </section>

  {#if !active}
    <section class="rounded-2xl bg-teal-950/50 p-4 ring-1 ring-teal-800">
      <p class="text-sm text-teal-100">
        Le modèle de base reconnaît un jeu Staunton classique. Pour votre propre jeu (bois, voyage, pièces originales), créez un
        profil puis photographiez-le : la reconnaissance s'adaptera à vos pièces, votre plateau et votre éclairage.
      </p>
      <button class="btn-primary mt-3 w-full" onclick={() => openName('new')}>Créer un profil</button>
    </section>
  {:else}
    <!-- Étape 1 -->
    <section class="rounded-2xl bg-stone-900 p-4 ring-1 ring-white/5" aria-labelledby="etape1">
      <h2 id="etape1" class="font-semibold">1. Position de départ</h2>
      <p class="mt-1 text-sm text-stone-400">
        Installez les pièces en position de départ et prenez {GOAL_MIN} à {GOAL_MAX} photos sous des angles et des éclairages variés.
        Chaque photo donne 64 cases étiquetées automatiquement.
      </p>
      <div class="mt-3 flex items-center gap-1.5" aria-label={`${stats?.startPhotos ?? 0} photos sur ${GOAL_MAX}`}>
        {#each Array(GOAL_MAX) as _, i (i)}
          <span
            class="h-3 flex-1 rounded-full {i < (stats?.startPhotos ?? 0) ? 'bg-teal-400' : i < GOAL_MIN ? 'bg-stone-600' : 'bg-stone-800'}"
          ></span>
        {/each}
      </div>
      <p class="mt-1 text-sm text-stone-300">
        {stats?.startPhotos ?? 0} photo{(stats?.startPhotos ?? 0) > 1 ? 's' : ''}
        {#if (stats?.startPhotos ?? 0) < GOAL_MIN}, encore {GOAL_MIN - (stats?.startPhotos ?? 0)} conseillée{GOAL_MIN - (stats?.startPhotos ?? 0) > 1 ? 's' : ''}{/if}
      </p>
      <button class="btn-primary mt-3 w-full" onclick={onstartphoto}>Photographier la position de départ</button>
    </section>

    <!-- Étape 2 -->
    <section class="rounded-2xl bg-stone-900 p-4 ring-1 ring-white/5" aria-labelledby="etape2">
      <h2 id="etape2" class="font-semibold">2. Positions quelconques <span class="text-sm font-normal text-stone-400">(facultatif)</span></h2>
      <p class="mt-1 text-sm text-stone-400">
        Photographiez des positions variées : l'app propose sa reconnaissance, vous corrigez, et les 64 cases rejoignent les
        exemples. Utile pour les pièces souvent confondues.
      </p>
      <button class="btn-secondary mt-3 w-full" onclick={onpositionphoto}>Photographier une position</button>
    </section>

    <!-- Exemples -->
    {#if stats}
      <section class="rounded-2xl bg-stone-900 p-4 ring-1 ring-white/5" aria-labelledby="exemples">
        <h2 id="exemples" class="section-title">Exemples : {stats.total} cases, {stats.photos} photo{stats.photos > 1 ? 's' : ''}</h2>
        <div class="grid grid-cols-7 gap-1 text-center text-xs text-stone-300">
          <div class="flex flex-col items-center rounded-lg bg-stone-800 py-1">
            <span class="flex h-7 items-center text-[10px] text-stone-400">vide</span>{stats.perClass[0]}
          </div>
          {#each CLASSES.slice(1) as c, i (c)}
            <div class="flex flex-col items-center rounded-lg bg-stone-800 py-1" class:text-amber-300={stats.perClass[i + 1] < 4}>
              <PieceIcon piece={c as PieceChar} class="h-7 w-7" />{stats.perClass[i + 1]}
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Entraînement -->
    <section class="rounded-2xl bg-stone-900 p-4 ring-1 ring-white/5" aria-labelledby="entrainement">
      <h2 id="entrainement" class="font-semibold">3. Entraîner</h2>
      <p class="mt-1 text-sm text-stone-400">
        L'apprentissage se fait sur votre téléphone, en arrière-plan. Une photo sur cinq est mise de côté pour mesurer la
        précision.
      </p>

      {#if training && progress}
        <div class="mt-3" aria-live="polite">
          <div class="h-3 overflow-hidden rounded-full bg-stone-800" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(overall * 100)}>
            <div class="h-full bg-teal-400 transition-[width]" style:width={`${overall * 100}%`}></div>
          </div>
          <p class="mt-1 text-sm text-stone-300">{phaseText}</p>
        </div>
        <button class="btn-danger mt-3 w-full" onclick={() => getMl().stop()}>Arrêter</button>
      {:else}
        <button class="btn-primary mt-3 w-full" disabled={!stats || stats.startPhotos < 1} onclick={train}>Entraîner</button>
        {#if stats && stats.startPhotos < 1}
          <p class="mt-1 text-xs text-stone-500">Il faut au moins une photo de la position de départ.</p>
        {/if}
      {/if}

      {#if trainError}<p class="mt-2 text-sm text-red-300">{trainError}</p>{/if}
      {#if result?.stopped}<p class="mt-2 text-sm text-amber-300">Entraînement arrêté, le modèle précédent est conservé.</p>{/if}

      {#if metrics}
        <div class="mt-3 rounded-xl bg-stone-800 p-3 text-sm">
          <p>
            Précision sur les cases mises de côté :
            <strong class="text-teal-300">{pct(metrics.valAccuracy)}</strong>
          </p>
          <p class="text-stone-400">Modèle de base sur les mêmes cases : {pct(metrics.baseValAccuracy)}</p>
          <p class="mt-1 text-xs text-stone-500">
            {metrics.trainExamples} cases d'entraînement, {metrics.valExamples} de validation, le
            {new Date(metrics.trainedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}.
          </p>
        </div>
      {:else if active && !training}
        <p class="mt-2 text-xs text-stone-500">Pas encore entraîné : la reconnaissance utilise le modèle de base.</p>
      {/if}
    </section>
  {/if}
</div>

<Sheet open={nameSheet !== null} title={nameSheet === 'new' ? 'Nouveau profil' : 'Renommer le profil'} onclose={() => (nameSheet = null)}>
  <form
    onsubmit={(e) => {
      e.preventDefault()
      confirmName()
    }}
  >
    <label class="block text-sm text-stone-400" for="nom">Nom du jeu</label>
    <input
      id="nom"
      class="mt-1 h-12 w-full rounded-xl bg-stone-800 px-3 text-base outline-none focus:ring-2 focus:ring-teal-400"
      placeholder="Jeu en bois, jeu de voyage..."
      maxlength="40"
      bind:value={nameInput}
    />
    <button class="btn-primary mt-3 w-full" type="submit" disabled={!nameInput.trim()}>
      {nameSheet === 'new' ? 'Créer' : 'Renommer'}
    </button>
  </form>
</Sheet>
