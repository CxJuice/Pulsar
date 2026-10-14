const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');

function createMcpOperationContext({ begin, cancel, finish, generation }) {
  const storage = new AsyncLocalStorage(), active = new Set();
  return {
    current: () => storage.getStore(),
    detached: action => storage.run(undefined, action),
    cancelAll: () => { for (const operation of active) operation.controller.abort(); },
    count: () => active.size,
    drain: () => Promise.all([...active].map(operation => operation.done)),
    async run(request, invoke) {
      const controller = new AbortController();
      const signal = AbortSignal.any([request.signal, controller.signal]);
      const operation = { id: randomUUID(), generation: generation(), signal, controller };
      operation.done = new Promise(resolve => { operation.finish = resolve; });
      active.add(operation);
      let registered = false;
      const stop = () => { if (registered) void cancel(operation).catch(() => {}); };
      signal.addEventListener('abort', stop, { once: true });
      try {
        signal.throwIfAborted();
        await begin(operation); registered = true;
        signal.throwIfAborted();
        return await storage.run(operation, invoke);
      } finally {
        if (registered && signal.aborted) await cancel(operation).catch(() => {});
        signal.removeEventListener('abort', stop);
        if (registered) await finish(operation).catch(() => {});
        active.delete(operation);
        operation.finish();
      }
    },
  };
}

// A canceled consumer must not abort a shared account/project cache fill.
function waitForMcpRead(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const stop = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener('abort', stop);
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

module.exports = { createMcpOperationContext, waitForMcpRead };
