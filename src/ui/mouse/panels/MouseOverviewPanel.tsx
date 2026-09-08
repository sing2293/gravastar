import { useEffect, useState } from 'react'
import type { DpiSettings, ReportRate } from '@/model/mouse'
import { Card } from '@/ui/components/kit'
import type { MousePanelProps } from '../MousePage'

export function MouseOverviewPanel({ driver, caps, summary }: MousePanelProps) {
  const [dpi, setDpi] = useState<DpiSettings>()
  const [rate, setRate] = useState<ReportRate>()
  useEffect(() => {
    let alive = true
    void Promise.all([driver.dpi.get(), driver.reportRate.get()]).then(([d, r]) => {
      if (!alive) return
      setDpi(d)
      setRate(r)
    })
    const off1 = driver.on('dpi-change', () => void driver.dpi.get().then((d) => alive && setDpi(d)))
    const off2 = driver.on('report-rate-change', (r) => alive && setRate(r))
    return () => {
      alive = false
      off1()
      off2()
    }
  }, [driver])
  const current = dpi?.stages[dpi.current]
  return (
    <div className="grid cols-2">
      <Card title="Mouse">
        <dl className="kv">
          <dt>Model</dt>
          <dd>{summary.product.displayName}</dd>
          <dt>Sensor</dt>
          <dd>PixArt {caps.model.sensor}</dd>
          <dt>Link</dt>
          <dd>{summary.link === 'dongle' ? `2.4 GHz receiver (up to ${caps.model.maxReportRate} Hz)` : `USB (up to ${caps.model.maxReportRate} Hz)`}</dd>
          <dt>Firmware</dt>
          <dd>{summary.info?.firmwareVersion ?? '—'}{summary.info?.dongleFirmwareVersion ? ` · receiver ${summary.info.dongleFirmwareVersion}` : ''}</dd>
          <dt>Battery</dt>
          <dd>{summary.battery ? `${summary.battery.level}%${summary.battery.charging ? ', charging' : ''}${summary.battery.voltageMv ? ` (${(summary.battery.voltageMv / 1000).toFixed(2)} V)` : ''}` : '—'}</dd>
          <dt>Buttons</dt>
          <dd>{caps.keys.map((k) => k.label).join(', ')}</dd>
        </dl>
      </Card>
      <Card title="Right now">
        <dl className="kv">
          <dt>DPI</dt>
          <dd>
            {current ? (
              <span className="row" style={{ gap: 8 }}>
                <span className="swatch" style={{ background: `rgb(${current.color.r},${current.color.g},${current.color.b})` }} />
                {current.dpiX}
                {current.dpiY !== current.dpiX ? ` × ${current.dpiY}` : ''} (stage {dpi.current + 1} of {dpi.stageCount})
              </span>
            ) : (
              '…'
            )}
          </dd>
          <dt>Report rate</dt>
          <dd>{rate ? `${rate} Hz` : '…'}</dd>
        </dl>
      </Card>
    </div>
  )
}
