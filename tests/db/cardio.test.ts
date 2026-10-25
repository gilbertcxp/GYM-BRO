import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, type Db } from './harness'

let db: Db
let ana: string
let beto: string
let carla: string

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows

beforeAll(async () => {
  db = await createDb()
  await q(`insert into allowed_emails (email) values ('ana@test.com'), ('beto@test.com'), ('carla@test.com')`)
  ana = await createUser(db, 'ana@test.com')
  beto = await createUser(db, 'beto@test.com')
  carla = await createUser(db, 'carla@test.com')
  await asUser(db, ana, () => q(`select send_partner_request('beto@test.com')`))
  const [req] = await asUser(db, beto, () => q<{ id: string }>(`select id from partnerships`))
  await asUser(db, beto, () => q(`select respond_partner_request($1, true)`, [req.id]))
}, 60000)

describe('cardio', () => {
  it('registra sesiones propias con validaciones', async () => {
    await asUser(db, ana, () => q(`insert into cardio_sessions (activity, duration_seconds, distance_km, avg_heart_rate, max_heart_rate)
                                   values ('running', 1800, 5, 150, 172)`))
    await expect(asUser(db, ana, () => q(`insert into cardio_sessions (activity, duration_seconds) values ('running', 10)`)))
      .rejects.toThrow(/check constraint/)
    await expect(asUser(db, ana, () => q(`insert into cardio_sessions (activity, duration_seconds, avg_heart_rate, max_heart_rate) values ('rowing', 600, 170, 150)`)))
      .rejects.toThrow(/check constraint/)
  })

  it('el compañero la ve si se comparten entrenamientos, pero no la modifica', async () => {
    expect(await asUser(db, beto, () => q(`select id from cardio_sessions where user_id = $1`, [ana]))).toHaveLength(1)
    const upd = await asUser(db, beto, () => db.query(`update cardio_sessions set duration_seconds = 60`))
    expect(upd.affectedRows).toBe(0)
    await expect(asUser(db, beto, () => q(`insert into cardio_sessions (user_id, activity, duration_seconds) values ($1, 'walking', 600)`, [ana])))
      .rejects.toThrow(/row-level security/)
  })

  it('deja de verla si el dueño deja de compartir, y un tercero nunca la ve', async () => {
    await asUser(db, ana, () => q(`update user_preferences set share_workouts = false where user_id = $1`, [ana]))
    expect(await asUser(db, beto, () => q(`select id from cardio_sessions`))).toHaveLength(0)
    expect(await asUser(db, carla, () => q(`select id from cardio_sessions`))).toHaveLength(0)
  })
})
