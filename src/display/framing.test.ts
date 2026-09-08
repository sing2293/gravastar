import { describe, expect, it } from 'vitest'
import { DEFAULT_FRAMING, framingRect, panAfterDrag } from './prepare'

describe('display framing', () => {
  const W = 428
  const H = 142
  it('fill crops a 16:9 picture to the panel, centred', () => {
    const r = framingRect(DEFAULT_FRAMING, 1920, 1080, W, H)
    expect(r.dw).toBe(W)
    expect(r.dh).toBe(Math.round(1080 * (W / 1920))) // 241
    expect(r.dx).toBe(0)
    expect(r.dy).toBe(Math.round((H - r.dh) / 2)) // negative: cropped top and bottom
    expect(r.dy).toBeLessThan(0)
  })
  it('fit letter-boxes and stretch fills regardless of aspect', () => {
    const fit = framingRect({ ...DEFAULT_FRAMING, mode: 'fit' }, 1920, 1080, W, H)
    expect(fit.dh).toBe(H)
    expect(fit.dw).toBe(Math.round(1920 * (H / 1080)))
    expect(fit.dx).toBeGreaterThan(0)
    expect(framingRect({ ...DEFAULT_FRAMING, mode: 'stretch' }, 100, 100, W, H)).toEqual({ dx: 0, dy: 0, dw: W, dh: H })
  })
  it('zoom enlarges around the pan point and pan is clamped to keep the panel covered', () => {
    const z = framingRect({ mode: 'fill', zoom: 2, pan: { x: 0, y: 1 } }, 1920, 1080, W, H)
    expect(z.dw).toBe(W * 2)
    expect(z.dx).toBe(0) // pan.x 0 → left edge aligned
    expect(z.dy).toBe(H - z.dh) // pan.y 1 → bottom edge aligned
    const dragged = panAfterDrag({ mode: 'fill', zoom: 2, pan: { x: 0.5, y: 0.5 } }, 1920, 1080, W, H, -1000, 0)
    expect(dragged.x).toBe(1) // dragged far left → shows the right edge
    expect(dragged.y).toBe(0.5)
    const square = panAfterDrag(DEFAULT_FRAMING, 428, 142, W, H, 50, 50)
    expect(square).toEqual({ x: 0.5, y: 0.5 }) // exact fit: nothing to pan
  })
})
