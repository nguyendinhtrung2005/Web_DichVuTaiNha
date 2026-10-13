"use client"

import { executeStoreCommand, getStoreSnapshot, persistenceOf, storedStateData, storedStateRaw, subscribeStore } from "./store"
import type { AppState } from "./types"

/** Frontend boundary. An API implementation must enforce permissions on server. */
export interface DataAccess {
  snapshot(): AppState | null
  subscribe(listener: () => void): () => void
  command<T>(command: () => T): Promise<T | { ok: false; error: string }>
  persistence(matches: (saved: AppState) => boolean): "local" | "session"
}

export const browserDataAccess: DataAccess = {
  snapshot: getStoreSnapshot,
  subscribe: subscribeStore,
  command: executeStoreCommand,
  persistence: persistenceOf,
}

export { executeStoreCommand, getStoreSnapshot, persistenceOf, storedStateData, storedStateRaw }
