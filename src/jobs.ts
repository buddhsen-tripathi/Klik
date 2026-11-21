// Background scan queue: upload, then poll until done, while the user keeps scanning.
// A tiny external store (useSyncExternalStore) so any screen can show the tray.
import { useSyncExternalStore } from 'react'
import { createScan, getScanSummaries, type Shot } from './api'
import type { ScanStage } from './shared/types'

export type JobStage = 'uploading' | 'upload-failed' | ScanStage

export interface Job {
  localId: string
  scanId: string | null
  name: string
  thumb: string | null
  stage: JobStage
  error: string | null
  createdAt: number
}

export interface Notice {
  text: string
  scanId: string
}

interface State {
  jobs: Job[]
  notice: Notice | null
}

const STORAGE_KEY = 'aotg.jobs.v1'
const POLL_MS = 3000
const FINISHED: JobStage[] = ['done', 'failed', 'upload-failed']

let state: State = { jobs: load(), notice: null }
const listeners = new Set<() => void>()
const pendingShots = new Map<string, { shots: Shot[]; hint: string }>()
let pollTimer: ReturnType<typeof setTimeout> | null = null

function load(): Job[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Job[]
    // Uploads can't resume after a reload; drop them.
    return raw.filter((j) => j.scanId)
  } catch {
    return []
  }
}

function save() {
  try {
    const keep = state.jobs.filter((j) => j.scanId).slice(0, 30)
    // Object-URL thumbnails don't survive a reload.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keep.map((j) => ({ ...j, thumb: j.thumb?.startsWith('blob:') ? null : j.thumb }))))
  } catch {}
}

function set(next: Partial<State>) {
  state = { ...state, ...next }
  save()
  listeners.forEach((l) => l())
}

function update(localId: string, patch: Partial<Job>) {
  set({ jobs: state.jobs.map((j) => (j.localId === localId ? { ...j, ...patch } : j)) })
}

export function useJobs(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** Queue a scan; returns immediately. */
export function enqueueScan(shots: Shot[], hint: string) {
  const localId = crypto.randomUUID()
  const job: Job = {
    localId,
    scanId: null,
    name: hint || 'New scan',
    thumb: shots[0] ? URL.createObjectURL(shots[0].blob) : null,
    stage: 'uploading',
    error: null,
    createdAt: Date.now(),
  }
  set({ jobs: [job, ...state.jobs] })
  pendingShots.set(localId, { shots, hint })
  void upload(localId)
}

async function upload(localId: string) {
  const pending = pendingShots.get(localId)
  if (!pending) return
  update(localId, { stage: 'uploading', error: null })
  try {
    const scanId = await createScan(pending.shots, pending.hint)
    pendingShots.delete(localId)
    update(localId, { scanId, stage: 'queued' })
    schedulePoll(0)
  } catch (err) {
    update(localId, { stage: 'upload-failed', error: (err as Error).message })
  }
}

export const retryUpload = (localId: string) => void upload(localId)

export function dismissJob(localId: string) {
  const job = state.jobs.find((j) => j.localId === localId)
  if (job?.thumb?.startsWith('blob:')) URL.revokeObjectURL(job.thumb)
  pendingShots.delete(localId)
  set({ jobs: state.jobs.filter((j) => j.localId !== localId) })
}

export const clearNotice = () => set({ notice: null })

function schedulePoll(delay = POLL_MS) {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = setTimeout(poll, delay)
}

async function poll() {
  pollTimer = null
  const active = state.jobs.filter((j) => j.scanId && !FINISHED.includes(j.stage))
  if (active.length === 0) return
  // Background tab: check again later instead of polling.
  if (document.hidden) return schedulePoll()
  try {
    const summaries = await getScanSummaries(active.map((j) => j.scanId!))
    let notice: Notice | null = state.notice
    const jobs = state.jobs.map((j) => {
      const s = summaries.find((x) => x.id === j.scanId)
      if (!s) return j
      const name = s.objectName ?? j.name
      if (s.stage === 'done' && j.stage !== 'done') {
        notice = { text: `${name} is ready`, scanId: s.id }
        navigator.vibrate?.([40, 60, 40])
      }
      return { ...j, stage: s.stage, name, thumb: j.thumb ?? s.photoUrl }
    })
    set({ jobs, notice })
  } catch {
    // Network hiccup: try again next tick.
  }
  schedulePoll()
}

// Resume polling for unfinished scans from a previous visit, and when the tab comes back.
schedulePoll(0)
document.addEventListener('visibilitychange', () => !document.hidden && schedulePoll(0))
