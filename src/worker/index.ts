/** Worker entry point: bundled separately and inlined into main.js. */

import { createCore } from './core'
import { WorkerRequest } from '../shared/protocol'

// `self` is the worker's global scope (this file only runs inside a Worker;
// the main-thread fallback imports createCore directly).
const ctx = self as unknown as {
  postMessage: (msg: unknown) => void
  addEventListener: (
    type: 'message',
    listener: (e: { data: WorkerRequest }) => void
  ) => void
}

const core = createCore(msg => ctx.postMessage(msg))
ctx.addEventListener('message', e => core.handle(e.data))
