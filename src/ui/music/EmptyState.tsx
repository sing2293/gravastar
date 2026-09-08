import { useDevices } from '@/store/devices'
import { Button, Card } from '@/ui/components/kit'
import { navigate } from '@/ui/router'

/** Shown on the Music Sync page while no device is connected. */
export function EmptyState() {
  const addSimulated = useDevices((s) => s.addSimulated)
  return (
    <Card>
      <div className="music-empty">
        <div className="icon" aria-hidden>
          🎵
        </div>
        <h2>No device connected</h2>
        <p className="muted">
          Connect a K98 Pro or a Mercury mouse and it appears here automatically — one session lights every device at
          once.
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Button variant="primary" onClick={() => navigate()}>
            Go to Devices
          </Button>
          <Button onClick={() => void addSimulated('keyboard')}>Try with a simulated keyboard</Button>
        </div>
      </div>
    </Card>
  )
}
