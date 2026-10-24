import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, type Db } from './harness'

let db: Db
let ana: string
let beto: string

beforeAll(async () => {
  db = await createDb()
  await db.query(`insert into allowed_emails (email) values ('ana@test.com'), ('beto@test.com')`)
  ana = await createUser(db, 'ana@test.com')
  beto = await createUser(db, 'beto@test.com')
}, 60000)

const consume = (user: string, limit: number) =>
  asUser(db, user, async () => (await db.query<{ left: number }>(`select consume_ai_quota($1) as left`, [limit])).rows[0].left)

describe('cuota diaria del asistente', () => {
  it('descuenta consultas y bloquea al llegar al límite', async () => {
    expect(await consume(ana, 2)).toBe(1)
    expect(await consume(ana, 2)).toBe(0)
    expect(await consume(ana, 2)).toBe(-1)
    // Un rechazo no suma uso
    const rows = await asUser(db, ana, async () => (await db.query<{ requests: number }>(`select requests from ai_usage`)).rows)
    expect(rows).toEqual([{ requests: 2 }])
  })

  it('cada usuario tiene su propia cuota y no ve la ajena', async () => {
    expect(await consume(beto, 2)).toBe(1)
    const seen = await asUser(db, beto, async () => (await db.query(`select * from ai_usage`)).rows)
    expect(seen).toHaveLength(1)
  })

  it('el cliente no puede reiniciar su cuota', async () => {
    const r = await asUser(db, ana, () => db.query(`update ai_usage set requests = 0`).catch((e: Error) => e))
    expect(String(r)).toMatch(/permission denied/)
  })
})
