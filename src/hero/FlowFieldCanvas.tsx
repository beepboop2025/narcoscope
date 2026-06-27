import { useEffect, useRef } from 'react'
import { HERO_NODES, HERO_ARCS, COLOR_HOT, COLOR_COOL } from './heroData'

/**
 * 2D fallback for mobile / no-WebGL. Same nodes and corridors as the globe,
 * flattened with an equirectangular projection, with pulses drifting along each
 * arc — a lightweight canvas trick (a plain <canvas>, no 3D dependency).
 */
export default function FlowFieldCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let w = 0
    let h = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const resize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect()
      w = rect.width
      h = rect.height
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    // equirectangular projection into a padded box
    const padX = w * 0.08
    const project = (lat: number, lng: number) => ({
      x: padX + ((lng + 180) / 360) * (w - padX * 2),
      y: h * 0.12 + ((90 - lat) / 180) * (h * 0.76),
    })

    const draw = (time: number) => {
      const t = time / 1000
      ctx.clearRect(0, 0, w, h)

      // corridor arcs (straight, faint) + a travelling pulse on each
      HERO_ARCS.forEach((arc, i) => {
        const a = project(arc.from[0], arc.from[1])
        const b = project(arc.to[0], arc.to[1])
        const color = arc.fromSource ? COLOR_HOT : COLOR_COOL
        ctx.strokeStyle = color
        ctx.globalAlpha = 0.18
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()

        const p = (t * 0.18 + i / HERO_ARCS.length) % 1
        const px = a.x + (b.x - a.x) * p
        const py = a.y + (b.y - a.y) * p
        ctx.globalAlpha = 0.9
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(px, py, 2, 0, Math.PI * 2)
        ctx.fill()
      })

      // nodes with a soft glow
      HERO_NODES.forEach((n) => {
        const { x, y } = project(n.lat, n.lng)
        const color = n.isSource ? COLOR_HOT : COLOR_COOL
        const pulse = 1 + Math.sin(t * 1.5 + x) * 0.15
        const g = ctx.createRadialGradient(x, y, 0, x, y, 14 * pulse)
        g.addColorStop(0, color)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.globalAlpha = 0.5
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(x, y, 14 * pulse, 0, Math.PI * 2)
        ctx.fill()

        ctx.globalAlpha = 1
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(x, y, n.isSource ? 3 : 2.2, 0, Math.PI * 2)
        ctx.fill()
      })

      ctx.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />
}
