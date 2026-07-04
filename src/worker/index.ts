/** Worker entry point: bundled separately and inlined into main.js. */

import { createCore } from './core'
import { WorkerRequest } from '../shared/protocol'

const ctx = globalThis as unknown as {
  postMessage: (msg: unknown) => void
  addEventListener: (
    type: 'message',
    listener: (e: { data: WorkerRequest }) => void
  ) => void
}

const core = createCore(msg => ctx.postMessage(msg))
ctx.addEventListener('message', e => core.handle(e.data))
