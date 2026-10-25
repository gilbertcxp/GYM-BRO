import { describe, expect, it } from 'vitest'
import { estimateCalories, metFor } from './cardio'
import { haversineMeters, judgeFix, kmSplits, routeDistanceMeters, routeSegments, type Fix, type RoutePoint } from './geo'

// 0.001° de latitud ≈ 111.2 m
const line = (n: number, stepDeg: number, stepSec: number, seg = 0, startLat = 18.45, t0 = 0): RoutePoint[] =>
  Array.from({ length: n }, (_, i) => [startLat + i * stepDeg, -69.93, t0 + i * stepSec, seg] as RoutePoint)

describe('haversine', () => {
  it('mide distancias conocidas', () => {
    expect(haversineMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -1)
    // Santo Domingo -> Santiago de los Caballeros ≈ 134 km en línea recta
    expect(haversineMeters({ lat: 18.4861, lng: -69.9312 }, { lat: 19.4517, lng: -70.697 }) / 1000).toBeCloseTo(134, 0)
    expect(haversineMeters({ lat: 10, lng: 10 }, { lat: 10, lng: 10 })).toBe(0)
  })
})

describe('filtro de lecturas GPS', () => {
  const fix = (lat: number, time: number, accuracy = 8): Fix => ({ lat, lng: -69.93, accuracy, time })
  it('acepta la primera lectura precisa y descarta las imprecisas', () => {
    expect(judgeFix(null, fix(18.45, 0), 'running')).toEqual({ accept: true, meters: 0 })
    expect(judgeFix(null, fix(18.45, 0, 80), 'running')).toEqual({ accept: false, reason: 'low_accuracy' })
  })
  it('ignora el ruido estando quieto y lecturas repetidas', () => {
    expect(judgeFix(fix(18.45, 0), fix(18.45001, 5000), 'running')).toEqual({ accept: false, reason: 'jitter' }) // ~1 m
    expect(judgeFix(fix(18.45, 5000), fix(18.451, 5000), 'running')).toEqual({ accept: false, reason: 'stale' })
  })
  it('descarta saltos imposibles según la actividad', () => {
    // 111 m en 5 s = 22 m/s: imposible corriendo, posible en bicicleta
    expect(judgeFix(fix(18.45, 0), fix(18.451, 5000), 'running')).toEqual({ accept: false, reason: 'jump' })
    const bike = judgeFix(fix(18.45, 0), fix(18.451, 5000), 'cycling')
    expect(bike.accept && Math.round(bike.meters)).toBe(111)
  })
})

describe('ruta', () => {
  it('no suma distancia entre pausas (segmentos)', () => {
    const a = line(11, 0.001, 30, 0)                 // ~1.112 km
    const b = line(11, 0.001, 30, 1, 18.5, 400)      // otro tramo lejos, ~1.112 km
    expect(routeDistanceMeters([...a, ...b]) / 1000).toBeCloseTo(2.224, 2)
    expect(routeSegments([...a, ...b])).toHaveLength(2)
  })
  it('calcula parciales por km interpolando el tiempo', () => {
    // 0.0001° ≈ 11.12 m cada 3 s → ~3.7 m/s → ~270 s por km
    const pts = line(300, 0.0001, 3)
    const splits = kmSplits(pts)
    expect(splits.slice(0, 3).map((s) => s.km)).toEqual([1, 2, 3])
    expect(splits[0].seconds).toBeCloseTo(269.8, 0)
    expect(splits.at(-1)?.partialMeters).toBeGreaterThan(50)
  })
})

describe('calorías estimadas', () => {
  it('usan MET por velocidad y requieren peso', () => {
    expect(metFor('running', 10)).toBe(10)
    expect(metFor('running', 5)).toBe(3.8) // ritmo de caminata
    expect(estimateCalories({ activity: 'running', duration_seconds: 1800, distance_km: 5 }, 80)).toBe(400) // 10 MET × 80 kg × 0.5 h
    expect(estimateCalories({ activity: 'running', duration_seconds: 1800, distance_km: 5 }, null)).toBeNull()
  })
})
