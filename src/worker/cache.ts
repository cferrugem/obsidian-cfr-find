/**
 * Raw IndexedDB persistence (no Dexie). Runs inside the worker so cache
 * (de)serialization never touches the UI thread.
 *
 * Keys in the single 'cache' object store:
 *   index    — serialized MiniSearch JSON string
 *   manifest — IndexedEntry[] (path + mtime of everything in the index)
 *   meta     — { schemaVersion, optionsHash }
 * index + manifest + meta are always written in ONE transaction so the
 * cache stays self-consistent even if the process dies mid-write.
 */

import { IndexedEntry } from '../shared/protocol'

export interface CacheMeta {
  schemaVersion: number
  optionsHash: string
}

const STORE = 'cache'

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

export class Cache {
  private db: IDBDatabase | null = null

  async open(name: string): Promise<void> {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(name, 1)
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(STORE)) {
          open.result.createObjectStore(STORE)
        }
      }
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
  }

  async read(): Promise<{
    index?: string
    manifest?: IndexedEntry[]
    meta?: CacheMeta
  }> {
    if (!this.db) return {}
    const store = this.db.transaction(STORE, 'readonly').objectStore(STORE)
    const [index, manifest, meta] = await Promise.all([
      req(store.get('index')),
      req(store.get('manifest')),
      req(store.get('meta')),
    ])
    return {
      index: index as string | undefined,
      manifest: manifest as IndexedEntry[] | undefined,
      meta: meta as CacheMeta | undefined,
    }
  }

  async write(
    index: string,
    manifest: IndexedEntry[],
    meta: CacheMeta
  ): Promise<void> {
    if (!this.db) return
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      store.put(index, 'index')
      store.put(manifest, 'manifest')
      store.put(meta, 'meta')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  }

  async clear(): Promise<void> {
    if (!this.db) return
    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}
