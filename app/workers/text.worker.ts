import { prepareSuggestions } from '../utils/suggestionMatch'
import { sourceDiff } from '../utils/sourceDiff'

self.onmessage = (event: MessageEvent) => {
  const { id, operation, payload } = event.data
  try {
    const result = operation === 'suggestions'
      ? prepareSuggestions(payload.candidates, payload.current)
      : sourceDiff(payload.original, payload.current)
    self.postMessage({ id, result })
  } catch (error) { self.postMessage({ id, error: (error as Error).message }) }
}
