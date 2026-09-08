import { useEffect, useState } from 'react'
import type { DeviceSummary } from '@/model/device'
import type { KeyboardCapabilities, KeyboardDriver } from '@/model/keyboard'
import { Notice, Tabs } from '@/ui/components/kit'
import { navigate } from '@/ui/router'
import { AdvancedKeysPanel } from './panels/AdvancedKeysPanel'
import { DisplayPanel } from './panels/DisplayPanel'
import { KeysPanel } from './panels/KeysPanel'
import { MacrosPanel } from './panels/MacrosPanel'
import { PerformancePanel } from './panels/PerformancePanel'
import { LightingPanel } from './panels/LightingPanel'
import { MusicPanel } from './panels/MusicPanel'
import { OverviewPanel } from './panels/OverviewPanel'
import { SettingsPanel } from './panels/SettingsPanel'

export type KeyboardTab = 'overview' | 'keys' | 'lighting' | 'music' | 'performance' | 'advanced' | 'macros' | 'display' | 'settings'

const TABS: { id: KeyboardTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'keys', label: 'Keys' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'music', label: 'Music Sync' },
  { id: 'performance', label: 'Performance' },
  { id: 'advanced', label: 'Advanced Keys' },
  { id: 'macros', label: 'Macros' },
  { id: 'display', label: 'Display' },
  { id: 'settings', label: 'Settings' },
]

export interface KeyboardPanelProps {
  id: string
  driver: KeyboardDriver
  caps: KeyboardCapabilities
  summary: DeviceSummary
}

export function KeyboardPage({ id, driver, summary, tab }: { id: string; driver: KeyboardDriver; summary: DeviceSummary; tab?: string }) {
  const [caps, setCaps] = useState<KeyboardCapabilities>()
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
  const active = (TABS.some((t) => t.id === tab) ? tab : 'overview') as KeyboardTab
  if (error) return <Notice kind="error">{error}</Notice>
  if (!caps) return <div className="muted">Reading keyboard capabilities…</div>
  const props: KeyboardPanelProps = { id, driver, caps, summary }
  return (
    <div>
      <Tabs value={active} tabs={TABS} onChange={(t) => navigate('device', id, t)} />
      {active === 'overview' && <OverviewPanel {...props} />}
      {active === 'keys' && <KeysPanel {...props} />}
      {active === 'lighting' && <LightingPanel {...props} />}
      {active === 'music' && <MusicPanel {...props} />}
      {active === 'performance' && <PerformancePanel {...props} />}
      {active === 'advanced' && <AdvancedKeysPanel {...props} />}
      {active === 'macros' && <MacrosPanel {...props} />}
      {active === 'display' && <DisplayPanel {...props} />}
      {active === 'settings' && <SettingsPanel {...props} />}
    </div>
  )
}
