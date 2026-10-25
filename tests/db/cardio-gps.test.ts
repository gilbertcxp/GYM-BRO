import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, type Db } from './harness'

let db: Db
let ana: string
let beto: string
let carla: string
let sessionId: string

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const points = JSON.stringify([[18.47, -69.93, 0, 0], [18.471, -69.931, 30, 0], [18.472, -69.932, 60, 0]])

beforeAll(async () => {
  db = await createDb()
  await q(`insert into allowed_emails (email) values ('ana@test.com'), ('beto@test.com'), ('carla@test.com')`)
  ana = await createUser(db, 'ana@test.com')
  beto = await createUser(db, 'beto@test.com')
  carla = await createUser(db, 'carla@test.com')
  await asUser(db, ana, () => q(`select send_partner_request('beto@test.com')`))
  const [req] = await asUser(db, beto, () => q<{ id: string }>(`select id from partnerships`))
  await asUser(db, beto, () => q(`select respond_partner_request($1, true)`, [req.id]))
  ;[{ id: sessionId }] = await asUser(db, ana, () => q<{ id: string }>(
    `insert into cardio_sessions (activity, duration_seconds, distance_km, tracking_mode, started_at, ended_at)
     values ('running', 1800, 5.012, 'gps', now() - interval '31 minutes', now()) returning id`))
}, 60000)

describe('cardio con GPS', () => {
  it('guarda la ruta de una sesión propia', async () => {
    await asUser(db, ana, () => q(`insert into cardio_routes (session_id, points) values ($1, $2::jsonb)`, [sessionId, points]))
    expect(await asUser(db, ana, () => q(`select session_id from cardio_routes`))).toHaveLength(1)
  })

  it('no permite colgar una ruta en la sesión de otro', async () => {
    const [{ id }] = await asUser(db, beto, () => q<{ id: string }>(`insert into cardio_sessions (activity, duration_seconds) values ('walking', 600) returning id`))
    await expect(asUser(db, ana, () => q(`insert into cardio_routes (session_id, points) values ($1, $2::jsonb)`, [id, points])))
      .rejects.toThrow(/row-level security/)
  })

  it('el compañero ve la sesión pero no el mapa hasta que se autorice', async () => {
    expect(await asUser(db, beto, () => q(`select id, tracking_mode from cardio_sessions where user_id = $1`, [ana]))).toEqual([{ id: sessionId, tracking_mode: 'gps' }])
    expect(await asUser(db, beto, () => q(`select session_id from cardio_routes`))).toHaveLength(0)
    await asUser(db, ana, () => q(`update user_preferences set share_routes = true where user_id = $1`, [ana]))
    expect(await asUser(db, beto, () => q(`select session_id from cardio_routes`))).toHaveLength(1)
    // Sin compartir entrenamientos tampoco se comparten rutas.
    await asUser(db, ana, () => q(`update user_preferences set share_workouts = false where user_id = $1`, [ana]))
    expect(await asUser(db, beto, () => q(`select session_id from cardio_routes`))).toHaveLength(0)
    await asUser(db, ana, () => q(`update user_preferences set share_workouts = true where user_id = $1`, [ana]))
  })

  it('un tercero nunca ve rutas y nadie edita las ajenas', async () => {
    expect(await asUser(db, carla, () => q(`select session_id from cardio_routes`))).toHaveLength(0)
    const r = await asUser(db, beto, () => db.query(`update cardio_routes set points = '[]'::jsonb`))
    expect(r.affectedRows).toBe(0)
  })

  it('al borrar la sesión se borra la ruta', async () => {
    await asUser(db, ana, () => q(`delete from cardio_sessions where id = $1`, [sessionId]))
    expect(await asUser(db, ana, () => q(`select session_id from cardio_routes`))).toHaveLength(0)
  })

  it('valida la meta semanal y el modo', async () => {
    await asUser(db, ana, () => q(`update profiles set cardio_weekly_goal_km = 20 where id = $1`, [ana]))
    const [p] = await asUser(db, beto, () => q<{ cardio_weekly_goal_km: string }>(`select cardio_weekly_goal_km from profiles where id = $1`, [ana]))
    expect(Number(p.cardio_weekly_goal_km)).toBe(20)
    await expect(asUser(db, ana, () => q(`insert into cardio_sessions (activity, duration_seconds, tracking_mode) values ('running', 600, 'satellite')`)))
      .rejects.toThrow(/check constraint/)
  })
})
