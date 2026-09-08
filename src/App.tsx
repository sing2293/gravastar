import { useEffect } from 'react'
import { useDevices } from '@/store/devices'
import { navigate, useRoute } from '@/ui/router'
import { DevicesPage } from '@/ui/pages/DevicesPage'
import { DevicePage } from '@/ui/pages/DevicePage'

export function App() {
  const route = useRoute()
  const { devices, order, init, addSimulated } = useDevices()
  useEffect(() => {
    void init()
    if (new URLSearchParams(window.location.search).get('sim') === '1') {
      void addSimulated('keyboard').then(() => addSimulated('mouse', 'dongle'))
    }
  }, [init, addSimulated])
  const activeId = route.segments[0] === 'device' ? route.segments[1] : undefined
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand" onClick={() => navigate()} role="link" tabIndex={0} style={{ cursor: 'pointer' }}>
          <span className="logo" /> GravaStar Hub
        </div>
        <nav>
          <button className={['navitem', !activeId ? 'active' : ''].join(' ')} onClick={() => navigate()}>
            <span className="dot" /> Devices
          </button>
          {order.map((id) => {
            const d = devices[id]!
            return (
              <button key={id} className={['navitem', activeId === id ? 'active' : ''].join(' ')} onClick={() => navigate('device', id)}>
                <span className={['dot', d.state === 'connected' ? 'connected' : d.state === 'error' ? 'error' : ''].join(' ')} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.product.displayName}</span>
                <span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>{d.link === 'dongle' ? '2.4G' : 'USB'}</span>
              </button>
            )
          })}
        </nav>
        <div className="footer">Open source configurator for GravaStar K98 Pro and Mercury mice. Works in Chrome, Edge and Arc.</div>
      </aside>
      <main className="main">{activeId ? <DevicePage id={activeId} tab={route.segments[2]} /> : <DevicesPage />}</main>
    </div>
  )
}
