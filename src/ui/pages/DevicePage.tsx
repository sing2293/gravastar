import { getDriver, useDevices } from '@/store/devices'
import { Button, Notice } from '@/ui/components/kit'
import { KeyboardPage } from '@/ui/keyboard/KeyboardPage'
import { MousePage } from '@/ui/mouse/MousePage'
import { navigate } from '@/ui/router'

export function DevicePage({ id, tab }: { id: string; tab?: string }) {
  const summary = useDevices((s) => s.devices[id])
  const connect = useDevices((s) => s.connect)
  const disconnect = useDevices((s) => s.disconnect)
  const driver = getDriver(id)
  if (!summary) {
    return (
      <div>
        <Notice kind="error">Unknown device.</Notice>
        <Button onClick={() => navigate()}>Back to devices</Button>
      </div>
    )
  }
  const header = (
    <div className="page-head">
      <div>
        <h1>{summary.product.displayName}</h1>
        <div className="muted row wrap" style={{ gap: 8 }}>
          <span>{summary.link === 'dongle' ? '2.4 GHz receiver' : 'USB'}</span>
          {summary.info?.firmwareVersion && <span>· Firmware {summary.info.firmwareVersion}</span>}
          {summary.info?.dongleFirmwareVersion && <span>· Receiver {summary.info.dongleFirmwareVersion}</span>}
          {summary.battery && <span>· Battery {summary.battery.level}%{summary.battery.charging ? ' (charging)' : ''}</span>}
          {summary.info?.uniqueId && <span className="mono dim">· {summary.info.uniqueId}</span>}
        </div>
      </div>
      <div className="row">
        {summary.state === 'connected' ? (
          <Button onClick={() => void disconnect(id)}>Disconnect</Button>
        ) : (
          <Button variant="primary" disabled={summary.state === 'connecting'} onClick={() => void connect(id)}>
            {summary.state === 'connecting' ? 'Connecting…' : 'Connect'}
          </Button>
        )}
      </div>
    </div>
  )
  if (summary.state !== 'connected' || !driver) {
    return (
      <div>
        {header}
        {summary.error ? <Notice kind="error">{summary.error}</Notice> : <Notice kind="info">{summary.state === 'connecting' ? 'Talking to the device…' : 'Connect the device to configure it.'}</Notice>}
      </div>
    )
  }
  return (
    <div>
      {header}
      {driver.kind === 'keyboard' ? <KeyboardPage id={id} driver={driver} summary={summary} tab={tab} /> : <MousePage id={id} driver={driver} summary={summary} tab={tab} />}
    </div>
  )
}
