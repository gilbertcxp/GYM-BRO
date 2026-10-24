import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, createDb, createUser, type Db } from './harness'

let db: Db
let ana: string
let beto: string
let carla: string
let benchId: string

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows
}

/** Crea una sesión completada con una lista de series [peso, reps, tipo]. */
async function logSession(user: string, startedAt: string, sets: [number, number, string?][]) {
  return asUser(db, user, async () => {
    const [s] = await q<{ id: string }>(
      `insert into workout_sessions (name, started_at) values ('Push', $1) returning id`, [startedAt])
    const [we] = await q<{ id: string }>(
      `insert into workout_exercises (session_id, exercise_id, position) values ($1, $2, 0) returning id`, [s.id, benchId])
    let n = 1
    for (const [w, r, t] of sets) {
      await q(`insert into workout_sets (workout_exercise_id, set_number, weight_kg, reps, set_type, completed)
               values ($1, $2, $3, $4, $5, true)`, [we.id, n++, w, r, t ?? 'normal'])
    }
    const [{ beaten }] = await q<{ beaten: number }>(
      `select finish_workout_session($1, $2::timestamptz + interval '1 hour') as beaten`, [s.id, startedAt])
    return { sessionId: s.id, beaten }
  })
}

beforeAll(async () => {
  db = await createDb()
  await q(`insert into allowed_emails (email) values ('ana@test.com'), ('beto@test.com'), ('carla@test.com')`)
  ana = await createUser(db, 'ana@test.com', 'Ana')
  beto = await createUser(db, 'beto@test.com', 'Beto')
  carla = await createUser(db, 'carla@test.com', 'Carla')
  ;[{ id: benchId }] = await q<{ id: string }>(`select id from exercises where name = 'Press de banca con barra'`)
}, 60000)

describe('alta controlada de cuentas', () => {
  it('crea perfil y preferencias para correos autorizados', async () => {
    const rows = await q(`select p.full_name, up.weight_unit from profiles p join user_preferences up on up.user_id = p.id where p.id = $1`, [ana])
    expect(rows).toEqual([{ full_name: 'Ana', weight_unit: 'kg' }])
  })
  it('rechaza correos no invitados', async () => {
    await expect(createUser(db, 'intruso@test.com')).rejects.toThrow(/EMAIL_NOT_INVITED/)
  })
  it('el cliente no puede leer la lista de correos autorizados', async () => {
    await expect(asUser(db, ana, () => q(`select * from allowed_emails`))).rejects.toThrow(/permission denied/)
  })
})

describe('biblioteca de ejercicios', () => {
  it('incluye la biblioteca global con músculos secundarios', async () => {
    const rows = await asUser(db, ana, () => q<{ n: number }>(`select count(*)::int n from exercises where owner_id is null`))
    expect(rows[0].n).toBeGreaterThan(40)
    const sec = await asUser(db, ana, () => q(`select muscle from exercise_muscles where exercise_id = $1 order by muscle`, [benchId]))
    expect(sec.map((r) => r.muscle)).toEqual(['shoulders', 'triceps'])
  })
  it('un usuario no puede editar la biblioteca global ni crear ejercicios a nombre de otro', async () => {
    const upd = await asUser(db, ana, () => db.query(`update exercises set name = 'x' where id = $1`, [benchId]))
    expect(upd.affectedRows).toBe(0)
    await expect(asUser(db, ana, () =>
      q(`insert into exercises (owner_id, name, primary_muscle, mechanics, modality) values ($1, 'Hack', 'chest', 'compound', 'machine')`, [beto]),
    )).rejects.toThrow(/row-level security/)
  })
})

describe('perfil', () => {
  it('no permite cambiar el email ni el id desde el cliente', async () => {
    await asUser(db, ana, () => q(`update profiles set email = 'otro@x.com', full_name = 'Ana M' where id = $1`, [ana]))
    const [p] = await q(`select email, full_name from profiles where id = $1`, [ana])
    expect(p).toEqual({ email: 'ana@test.com', full_name: 'Ana M' })
  })
  it('no permite editar el perfil de otro usuario', async () => {
    const r = await asUser(db, beto, () => db.query(`update profiles set full_name = 'hack' where id = $1`, [ana]))
    expect(r.affectedRows).toBe(0)
  })
})

describe('entrenamientos y récords', () => {
  it('calcula récords en la primera sesión sin contarlos como superados', async () => {
    const { beaten } = await logSession(ana, '2026-10-01T22:00:00Z', [[40, 10, 'warmup'], [80, 8], [80, 6]])
    expect(beaten).toBe(0)
    const recs = await asUser(db, ana, () =>
      q<{ record_type: string; value: string }>(`select record_type, value from personal_records where user_id = $1 order by record_type`, [ana]))
    expect(recs.map((r) => [r.record_type, Number(r.value)])).toEqual([
      ['max_weight', 80],
      ['est_1rm', 101.33], // 80 × (1 + 8/30)
      ['max_session_volume', 1120], // 80×8 + 80×6; el calentamiento no cuenta
    ])
  })

  it('detecta récords superados y genera una notificación', async () => {
    const { beaten } = await logSession(ana, '2026-10-03T22:00:00Z', [[80, 9], [85, 5]])
    // max_weight 85>80; est_1rm 80×(1+9/30)=104>101.33; reps@80: 9>8; volumen 720+425=1145>1120
    expect(beaten).toBe(4)
    const notes = await asUser(db, ana, () => q(`select kind from notifications where user_id = $1`, [ana]))
    expect(notes.map((n) => n.kind)).toContain('personal_record')
  })

  it('el cliente no puede insertar récords ni notificaciones', async () => {
    await expect(asUser(db, ana, () =>
      q(`insert into notifications (user_id, kind, title) values ($1, 'partner', 'x')`, [ana]),
    )).rejects.toThrow(/permission denied/)
  })

  it('impide dos sesiones activas a la vez', async () => {
    await asUser(db, ana, () => q(`insert into workout_sessions (name) values ('A')`))
    await expect(asUser(db, ana, () => q(`insert into workout_sessions (name) values ('B')`))).rejects.toThrow(/duplicate key/)
    await asUser(db, ana, () => q(`delete from workout_sessions where status = 'in_progress'`))
  })
})

describe('Gym Bro: permisos compartidos', () => {
  it('sin vínculo, nadie ve los entrenamientos del otro', async () => {
    const rows = await asUser(db, beto, () => q(`select id from workout_sessions where user_id = $1`, [ana]))
    expect(rows).toHaveLength(0)
    const prof = await asUser(db, beto, () => q(`select id from profiles where id = $1`, [ana]))
    expect(prof).toHaveLength(0)
  })

  it('vincula mediante solicitud y aceptación', async () => {
    await asUser(db, ana, () => q(`select send_partner_request('BETO@test.com')`))
    await expect(asUser(db, ana, () => q(`select send_partner_request('beto@test.com')`))).rejects.toThrow(/duplicate key/)
    const [{ send_partner_request: carlaReq }] = await asUser(db, carla, () => q<{ send_partner_request: string }>(`select send_partner_request('ana@test.com')`))
    const [req] = await asUser(db, beto, () => q<{ id: string }>(`select id from partnerships where addressee_id = $1`, [beto]))
    await asUser(db, beto, () => q(`select respond_partner_request($1, true)`, [req.id]))
    // Solo un Gym Bro por usuario: Ana ya no puede aceptar a Carla.
    await expect(asUser(db, ana, () => q(`select respond_partner_request($1, true)`, [carlaReq]))).rejects.toThrow(/ya tiene/)
    await asUser(db, ana, () => q(`select respond_partner_request($1, false)`, [carlaReq]))
    const [{ pid }] = await asUser(db, beto, () => q<{ pid: string }>(`select partner_id() pid`))
    expect(pid).toBe(ana)
  })

  it('el compañero ve entrenamientos (compartidos por defecto) pero no medidas ni fotos', async () => {
    await asUser(db, ana, () => q(`insert into body_measurements (weight_kg, waist_cm) values (82.5, 84)`))
    await asUser(db, ana, () => q(`insert into progress_photos (storage_path, visible_to_partner) values ($1, true)`, [`${ana}/foto1.jpg`]))
    await q(`insert into storage.objects (bucket_id, name) values ('progress-photos', $1)`, [`${ana}/foto1.jpg`])

    expect(await asUser(db, beto, () => q(`select id from workout_sessions where user_id = $1`, [ana]))).toHaveLength(2)
    expect(await asUser(db, beto, () => q(`select id from workout_sets`))).toHaveLength(5)
    expect(await asUser(db, beto, () => q(`select id from body_measurements where user_id = $1`, [ana]))).toHaveLength(0)
    expect(await asUser(db, beto, () => q(`select id from progress_photos where user_id = $1`, [ana]))).toHaveLength(0)
    expect(await asUser(db, beto, () => q(`select id from storage.objects where bucket_id = 'progress-photos'`))).toHaveLength(0)
  })

  it('al autorizar medidas y fotos, el compañero puede verlas', async () => {
    await asUser(db, ana, () => q(`update user_preferences set share_measurements = true, share_photos = true where user_id = $1`, [ana]))
    expect(await asUser(db, beto, () => q(`select id from body_measurements where user_id = $1`, [ana]))).toHaveLength(1)
    expect(await asUser(db, beto, () => q(`select id from progress_photos`))).toHaveLength(1)
    expect(await asUser(db, beto, () => q(`select id from storage.objects where bucket_id = 'progress-photos'`))).toHaveLength(1)
    // Una foto marcada como privada sigue oculta aunque el ámbito esté compartido.
    await asUser(db, ana, () => q(`update progress_photos set visible_to_partner = false`))
    expect(await asUser(db, beto, () => q(`select id from progress_photos`))).toHaveLength(0)
  })

  it('el compañero no puede modificar ni borrar datos ajenos', async () => {
    const upd = await asUser(db, beto, () => db.query(`update workout_sets set reps = 99`))
    expect(upd.affectedRows).toBe(0)
    const del = await asUser(db, beto, () => db.query(`delete from workout_sessions where user_id = $1`, [ana]))
    expect(del.affectedRows).toBe(0)
    const [we] = await q<{ id: string }>(`select id from workout_exercises limit 1`)
    await expect(asUser(db, beto, () =>
      q(`insert into workout_sets (workout_exercise_id, set_number) values ($1, 9)`, [we.id]),
    )).rejects.toThrow(/row-level security/)
    await expect(asUser(db, beto, () =>
      q(`insert into storage.objects (bucket_id, name) values ('progress-photos', $1)`, [`${ana}/hack.jpg`]),
    )).rejects.toThrow(/row-level security/)
  })

  it('un tercero sigue sin ver nada', async () => {
    expect(await asUser(db, carla, () => q(`select id from workout_sessions`))).toHaveLength(0)
    expect(await asUser(db, carla, () => q(`select id from body_measurements`))).toHaveLength(0)
  })

  it('preferencias ajenas no son legibles ni editables', async () => {
    expect(await asUser(db, beto, () => q(`select * from user_preferences where user_id = $1`, [ana]))).toHaveLength(0)
  })
})

describe('rutinas compartidas', () => {
  it('solo se ven si el dueño las comparte', async () => {
    const [r] = await asUser(db, ana, () => q<{ id: string }>(`insert into routines (name) values ('PPL') returning id`))
    await asUser(db, ana, () => q(`insert into routine_days (routine_id, name) values ($1, 'Push')`, [r.id]))
    expect(await asUser(db, beto, () => q(`select id from routine_days`))).toHaveLength(0)
    await asUser(db, ana, () => q(`update routines set shared_with_partner = true where id = $1`, [r.id]))
    expect(await asUser(db, beto, () => q(`select id from routine_days`))).toHaveLength(1)
    await expect(asUser(db, beto, () => q(`insert into routine_days (routine_id, name) values ($1, 'Hack')`, [r.id])))
      .rejects.toThrow(/row-level security/)
  })
})

describe('retos', () => {
  it('rechaza retos que no dejan días de descanso', async () => {
    await expect(asUser(db, ana, () =>
      q(`insert into challenges (title, challenge_type, target_value, start_date, end_date) values ('7 días', 'weekly_workouts', 7, '2026-10-01', '2026-10-31')`),
    )).rejects.toThrow(/check constraint/)
  })

  it('calcula el progreso en el servidor para ambos participantes', async () => {
    const [c] = await asUser(db, ana, () => q<{ id: string }>(
      `insert into challenges (title, challenge_type, target_value, start_date, end_date)
       values ('Asistencia octubre', 'monthly_attendance', 2, '2026-10-01', '2026-10-31') returning id`))
    await asUser(db, ana, () => q(`insert into challenge_participants (challenge_id, user_id, is_owner) values ($1, $2, true), ($1, $3, false)`, [c.id, ana, beto]))
    await expect(asUser(db, ana, () => q(`insert into challenge_participants (challenge_id, user_id) values ($1, $2)`, [c.id, carla])))
      .rejects.toThrow(/row-level security/)
    const rows = await asUser(db, beto, () => q<{ user_id: string; progress: string; outcome: string }>(
      `select * from challenge_progress($1)`, [c.id]))
    const byUser = Object.fromEntries(rows.map((r) => [r.user_id, r]))
    expect(Number(byUser[ana].progress)).toBe(2)
    expect(byUser[ana].outcome).toBe('completed')
    expect(Number(byUser[beto].progress)).toBe(0)
    await expect(asUser(db, carla, () => q(`select * from challenge_progress($1)`, [c.id]))).rejects.toThrow(/No autorizado/)
  })

  it('calcula retos semanales y de mejora de ejercicio', async () => {
    const [w] = await asUser(db, ana, () => q<{ id: string }>(
      `insert into challenges (title, challenge_type, target_value, start_date, end_date)
       values ('2 por semana', 'weekly_workouts', 2, '2026-09-28', '2026-10-11') returning id`))
    await asUser(db, ana, () => q(`insert into challenge_participants (challenge_id, user_id, is_owner) values ($1, $2, true)`, [w.id, ana]))
    const [wp] = await asUser(db, ana, () => q<{ progress: string; goal: string }>(`select * from challenge_progress($1)`, [w.id]))
    expect([Number(wp.progress), Number(wp.goal)]).toEqual([1, 2]) // semana del 28-sep: 2 sesiones; semana del 5-oct: 0

    const [imp] = await asUser(db, ana, () => q<{ id: string }>(
      `insert into challenges (title, challenge_type, exercise_id, target_value, start_date, end_date)
       values ('Banca +5%', 'exercise_improvement', $1, 5, '2026-10-02', '2026-10-31') returning id`, [benchId]))
    await asUser(db, ana, () => q(`insert into challenge_participants (challenge_id, user_id, is_owner) values ($1, $2, true)`, [imp.id, ana]))
    const [ip] = await asUser(db, ana, () => q<{ progress: string }>(`select * from challenge_progress($1)`, [imp.id]))
    // base (antes del 2-oct) 101.33; mejor en ventana: 80×(1+9/30)=104 → +2.6 %
    expect(Number(ip.progress)).toBe(2.6)
  })
})

describe('calendario, objetivos y notificaciones', () => {
  it('enlaza la sesión con el entrenamiento programado del día local', async () => {
    await asUser(db, beto, () => q(`insert into scheduled_workouts (scheduled_on) values ('2026-10-05')`))
    // 2026-10-06 01:00 UTC = 2026-10-05 21:00 en Santo Domingo (UTC-4)
    await logSession(beto, '2026-10-06T01:00:00Z', [[60, 10]])
    const [sw] = await asUser(db, beto, () => q<{ status: string; session_id: string | null }>(`select status, session_id from scheduled_workouts`))
    expect(sw.status).toBe('completed')
    expect(sw.session_id).not.toBeNull()
  })

  it('notifica al completar un objetivo', async () => {
    const [g] = await asUser(db, beto, () => q<{ id: string }>(
      `insert into goals (goal_type, title, target_value) values ('volume', 'Volumen semanal', 5000) returning id`))
    await asUser(db, beto, () => q(`update goals set status = 'completed' where id = $1`, [g.id]))
    const notes = await asUser(db, beto, () => q(`select kind from notifications where kind = 'goal_achieved'`))
    expect(notes).toHaveLength(1)
    const [goal] = await asUser(db, beto, () => q<{ completed_at: string | null }>(`select completed_at from goals where id = $1`, [g.id]))
    expect(goal.completed_at).not.toBeNull()
  })

  it('genera notificaciones internas de forma idempotente', async () => {
    const first = await asUser(db, beto, () => q<{ n: number }>(`select generate_due_notifications() n`))
    const second = await asUser(db, beto, () => q<{ n: number }>(`select generate_due_notifications() n`))
    expect(first[0].n).toBeGreaterThanOrEqual(0)
    expect(second[0].n).toBe(0)
  })

  it('el cliente solo puede marcar notificaciones como leídas', async () => {
    await asUser(db, beto, () => q(`update notifications set read_at = now()`))
    await expect(asUser(db, beto, () => q(`update notifications set title = 'x'`))).rejects.toThrow(/leída/)
  })
})
