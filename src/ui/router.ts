import { useEffect, useState } from 'react'

/** Hash routes: `#/`, `#/device/<id>/<tab>`. Kept tiny on purpose — no history library needed for a device tool. */
export interface Route {
  segments: string[]
}

function parse(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  return { segments: hash ? hash.split('/').map(decodeURIComponent) : [] }
}

export function navigate(...segments: string[]): void {
  window.location.hash = '/' + segments.map(encodeURIComponent).join('/')
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse)
  useEffect(() => {
    const onChange = () => setRoute(parse())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
