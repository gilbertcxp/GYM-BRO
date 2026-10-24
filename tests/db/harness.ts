// Banco de pruebas de base de datos: aplica las migraciones reales sobre PGlite
// (Postgres en WASM) con stubs mínimos de los esquemas `auth` y `storage` de Supabase.
// Sirve para validar sintaxis SQL, RLS y funciones sin depender de un proyecto remoto.
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SUPABASE_STUBS = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  raw_user_meta_data jsonb not null default '{}'
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to authenticated;
grant all on storage.objects to authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
`

export async function createDb() {
  const db = new PGlite()
  await db.exec(SUPABASE_STUBS)
  const dir = path.resolve(__dirname, '../../supabase/migrations')
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(path.join(dir, file), 'utf8'))
    } catch (e) {
      throw new Error(`Error en migración ${file}: ${(e as Error).message}`)
    }
  }
  return db
}

export type Db = Awaited<ReturnType<typeof createDb>>

/** Ejecuta `fn` como un usuario autenticado (rol `authenticated` + auth.uid()). */
export async function asUser<T>(db: Db, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }
}

export async function createUser(db: Db, email: string, fullName = '') {
  const res = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [email, JSON.stringify({ full_name: fullName })],
  )
  return res.rows[0].id
}
