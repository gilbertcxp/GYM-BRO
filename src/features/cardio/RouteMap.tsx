import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { kmSplits, routeSegments, type RoutePoint } from '@/lib/geo'
import { cn } from '@/lib/utils'

/**
 * Mapa del recorrido con Leaflet + OpenStreetMap (gratis, con atribución).
 * - Modo histórico: ajusta la vista a la ruta completa.
 * - Modo en vivo: sigue la última posición mientras el usuario no mueva el mapa.
 * Usa marcadores circulares (sin imágenes) para inicio, fin, posición actual y cada km.
 */
export function RouteMap({ points, live = false, unitLabel = 'km', className }: {
  points: RoutePoint[]; live?: boolean; unitLabel?: string; className?: string
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const follow = useRef(true)
  const fitted = useRef(false)

  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { zoomControl: true, attributionControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(m)
    m.setView([18.4861, -69.9312], 13)
    m.on('dragstart', () => { follow.current = false })
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    // El contenedor puede cambiar de tamaño al abrir un modal.
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => { ro.disconnect(); m.remove(); map.current = null }
  }, [])

  useEffect(() => {
    const m = map.current
    const g = layer.current
    if (!m || !g) return
    g.clearLayers()
    if (!points.length) return
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#a3ff12'
    for (const seg of routeSegments(points)) {
      L.polyline(seg, { color: '#0a0a0a', weight: 8, opacity: 0.35 }).addTo(g)
      L.polyline(seg, { color: accent, weight: 5, opacity: 0.95 }).addTo(g)
    }
    for (const s of kmSplits(points)) {
      if (s.partialMeters) continue
      L.circleMarker([s.lat, s.lng], { radius: 9, color: '#0a0a0a', weight: 2, fillColor: '#fafafa', fillOpacity: 1 })
        .bindTooltip(`${s.km} ${unitLabel}`, { permanent: true, direction: 'center', className: 'km-marker' }).addTo(g)
    }
    const first = points[0]
    const last = points[points.length - 1]
    L.circleMarker([first[0], first[1]], { radius: 7, color: '#fff', weight: 2, fillColor: '#22c55e', fillOpacity: 1 }).bindTooltip('Inicio').addTo(g)
    L.circleMarker([last[0], last[1]], { radius: live ? 9 : 7, color: '#fff', weight: 2, fillColor: live ? '#3b82f6' : '#ef4444', fillOpacity: 1 })
      .bindTooltip(live ? 'Estás aquí' : 'Fin').addTo(g)

    if (live) {
      if (follow.current) m.setView([last[0], last[1]], Math.max(m.getZoom(), 16), { animate: true })
    } else if (!fitted.current) {
      m.fitBounds(L.latLngBounds(points.map((p) => [p[0], p[1]] as [number, number])), { padding: [24, 24], maxZoom: 17 })
      fitted.current = true
    }
  }, [points, live, unitLabel])

  return (
    <div className={cn('relative isolate overflow-hidden rounded-2xl border border-border', className)}>
      <div ref={el} className="h-full w-full" role="region" aria-label="Mapa del recorrido" />
      {live && (
        <button type="button" onClick={() => { follow.current = true; const last = points.at(-1); if (last) map.current?.setView([last[0], last[1]], 16) }}
          className="absolute bottom-3 right-3 z-[500] rounded-xl bg-surface/90 px-3 py-2 text-xs font-semibold shadow">Centrar</button>
      )}
    </div>
  )
}
