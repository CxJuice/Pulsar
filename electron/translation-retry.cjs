function isTranslationTimeout(error) {
  const status = Number(error?.status);
  if (status === 408 || status === 504) return true;
  if (Number.isFinite(status) && status > 0 && status < 500) return false;
  return error?.name === 'TimeoutError' ||
    /TIMEOUT|TIMEDOUT/i.test(error?.code || '') ||
    /超时|\btimeout\b|\btimed\s*out\b/i.test(error?.message || '');
}

function waitForRetry(delay, signal) {
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => finish(reject, new Error('翻译已取消'));
    const timer = setTimeout(() => finish(resolve), delay);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function withTranslationTimeoutRetries(send, signal, { retries = 2, delayMs = 1000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new Error('翻译已取消');
    try { return await send(); }
    catch (error) {
      if (signal?.aborted) throw new Error('翻译已取消');
      if (!isTranslationTimeout(error) || attempt >= retries) throw error;
      await waitForRetry(delayMs * 2 ** attempt, signal);
    }
  }
}

module.exports = { isTranslationTimeout, withTranslationTimeoutRetries };
