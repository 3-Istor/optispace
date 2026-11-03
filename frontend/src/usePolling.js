import { useEffect, useState } from 'react'

// Runs fn() now, then every ms while the tab is visible; resumes at once when it shows again.
// A new fn identity restarts the loop, so wrap fn in useCallback with its inputs.
// Returns {data, error, refresh}; data keeps the last success when a later call fails.
export function usePolling(fn, ms = 5000) {
  const [state, setState] = useState({})
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    let busy = false
    let timer
    const run = async () => {
      clearTimeout(timer)
      if (document.hidden) return
      busy = true
      try {
        const data = await fn()
        if (alive) setState({ data })
      } catch (error) {
        if (alive) setState((s) => ({ ...s, error }))
      }
      busy = false
      if (alive && !document.hidden) timer = setTimeout(run, ms)
    }
    const onVisible = () => !document.hidden && !busy && run()
    document.addEventListener('visibilitychange', onVisible)
    run()
    return () => {
      alive = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fn, ms, tick])

  return { ...state, refresh: () => setTick((t) => t + 1) }
}
