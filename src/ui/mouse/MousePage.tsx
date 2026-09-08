import { useEffect, useState } from 'react'
import type { DeviceSummary } from '@/model/device'
import type { MouseCapabilities, MouseDriver } from '@/model/mouse'
import { Notice, Tabs } from '@/ui/components/kit'
import { navigate } from '@/ui/router'
import { DpiPanel } from './panels/DpiPanel'
import { MouseKeysPanel } from './panels/MouseKeysPanel'
import { MouseLightingPanel } from './panels/MouseLightingPanel'
import { MouseOverviewPanel } from './panels/MouseOverviewPanel'
import { MouseSettingsPanel } from './panels/MouseSettingsPanel'
import { SensorPanel } from './panels/SensorPanel'

export type MouseTab = 'overview' | 'dpi' | 'keys' | 'sensor' | 'lighting' | 'settings'

const TABS: { id: MouseTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'dpi', label: 'DPI' },
  { id: 'keys', label: 'Buttons' },
  { id: 'sensor', label: 'Sensor' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'settings', label: 'Settings' },
]

export interface MousePanelProps {
  id: string
  driver: MouseDriver
  caps: MouseCapabilities
  summary: DeviceSummary
}

export function MousePage({ id, driver, summary, tab }: { id: string; driver: MouseDriver; summary: DeviceSummary; tab?: string }) {
  const [caps, setCaps] = useState<MouseCapabilities>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let alive = true
    setCaps(undefined)
    driver
      .capabilities()
      .then((c) => alive && setCaps(c))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [driver])
  const active = (TABS.some((t) => t.id === tab) ? tab : 'overview') as MouseTab
  if (error) return <Notice kind="error">{error}</Notice>
  if (!caps) return <div className="muted">Reading mouse settings…</div>
  const props: MousePanelProps = { id, driver, caps, summary }
  return (
    <div>
      <Tabs value={active} tabs={TABS.filter((t) => t.id !== 'lighting' || caps.hasLighting)} onChange={(t) => navigate('device', id, t)} />
      {active === 'overview' && <MouseOverviewPanel {...props} />}
      {active === 'dpi' && <DpiPanel {...props} />}
      {active === 'keys' && <MouseKeysPanel {...props} />}
      {active === 'sensor' && <SensorPanel {...props} />}
      {active === 'lighting' && <MouseLightingPanel {...props} />}
      {active === 'settings' && <MouseSettingsPanel {...props} />}
    </div>
  )
}
