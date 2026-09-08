import { useDevices } from '@/store/devices'
import type { DeviceSummary } from '@/model/device'
import { Badge, Button, Notice } from '@/ui/components/kit'
import { navigate } from '@/ui/router'

function DeviceCard({ d }: { d: DeviceSummary }) {
  const connect = useDevices((s) => s.connect)
  const open = () => (d.state === 'connected' ? navigate('device', d.id) : connect(d.id))
  return (
    <div className="device-card" onClick={open} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && open()}>
      <div className="art">{d.kind === 'keyboard' ? '⌨️' : '🖱️'}</div>
      <div className="title">{d.product.displayName}</div>
      <div className="row wrap" style={{ gap: 6 }}>
        <Badge tone={d.state === 'connected' ? 'accent' : undefined}>{stateLabel(d)}</Badge>
        <Badge>{d.link === 'dongle' ? '2.4G' : 'Wired'}</Badge>
        {d.battery && (
          <Badge>
            🔋 {d.battery.level}%{d.battery.charging ? ' ⚡' : ''}
          </Badge>
        )}
        {d.info?.firmwareVersion && <Badge>{d.info.firmwareVersion}</Badge>}
      </div>
      {d.error && <div className="dim" style={{ fontSize: 12 }}>{d.error}</div>}
      {d.id.startsWith('sim-') && <Badge tone="warn">Simulated</Badge>}
    </div>
  )
}

function stateLabel(d: DeviceSummary): string {
  switch (d.state) {
    case 'connected':
      return 'Connected'
    case 'connecting':
      return 'Connecting…'
    case 'authorized':
      return 'Click to connect'
    case 'disconnected':
      return 'Disconnected'
    case 'error':
      return 'Connection error'
  }
}

export function DevicesPage() {
  const { devices, order, error, hidSupported, requestDevice, addSimulated } = useDevices()
  const list = order.map((id) => devices[id]!).filter(Boolean)
  const online = list.filter((d) => d.state === 'connected').length
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Your Devices</h1>
          <div className="muted">{list.length ? `${online} of ${list.length} device${list.length === 1 ? '' : 's'} online.` : 'Connect a GravaStar keyboard or mouse to get started.'}</div>
        </div>
        <div className="row">
          <Button onClick={() => void addSimulated('keyboard')}>Add simulated K98 Pro</Button>
          <Button onClick={() => void addSimulated('mouse', 'dongle')}>Add simulated mouse</Button>
          <Button variant="primary" disabled={!hidSupported} onClick={() => void requestDevice()}>
            + Add New Device
          </Button>
        </div>
      </div>
      {!hidSupported && (
        <Notice kind="error">This browser has no WebHID. Use Google Chrome, Microsoft Edge or Arc — Safari and Firefox cannot talk to the devices.</Notice>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      <div className="grid cols-3" style={{ marginTop: 16 }}>
        {list.map((d) => (
          <DeviceCard key={d.id} d={d} />
        ))}
        <div className="device-card add" onClick={() => void requestDevice()} role="button" tabIndex={0}>
          <div style={{ fontSize: 28 }}>+</div>
          <div>Add New Device</div>
          <div className="dim" style={{ fontSize: 12 }}>K98 Pro (USB or 2.4G) · Mercury mice</div>
        </div>
      </div>
    </div>
  )
}
