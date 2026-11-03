import { useSyncExternalStore } from 'react'

// Tiny history router: App.jsx maps useRoute().path to a page.
const listeners = new Set()
const notify = () => listeners.forEach((l) => l())
window.addEventListener('popstate', notify)

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function navigate(to, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState'](null, '', to)
  notify()
  window.scrollTo(0, 0)
}

// Returns {path, query: URLSearchParams, url}; re-renders on navigation.
export function useRoute() {
  const url = useSyncExternalStore(subscribe, () => location.pathname + location.search)
  return { path: location.pathname, query: new URLSearchParams(location.search), url }
}

// <a> that navigates in-app; modified clicks (new tab) keep the browser behaviour.
export function Link({ to, onClick, ...props }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        navigate(to)
      }}
      {...props}
    />
  )
}
