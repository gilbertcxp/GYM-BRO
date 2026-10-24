import { useQuery } from '@tanstack/react-query'
import { Camera, Columns2, Eye, EyeOff, Lock, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBlock, Field, Input, LoadingBlock, Modal, PageHeader, Select, Switch, Tabs, Textarea,
} from '@/components/ui'
import { keys, unwrap, useMut, usePartnership, usePhotos, useProfile } from '@/data/queries'
import { useUserId } from '@/features/auth/AuthProvider'
import { fmtDate, todayKey } from '@/lib/dates'
import { errorMessage } from '@/lib/errors'
import { PHOTO_CATEGORY_LABELS } from '@/lib/labels'
import { PHOTO_BUCKET, signedUrl, supabase } from '@/lib/supabase'
import type { PhotoCategory, ProgressPhoto } from '@/lib/types'
import { cn, uuid } from '@/lib/utils'

const MAX_BYTES = 10 * 1024 * 1024
const TYPES = ['image/jpeg', 'image/png', 'image/webp']

function PhotoImg({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const { data: url, isLoading } = useQuery({ queryKey: ['signed', PHOTO_BUCKET, path], queryFn: () => signedUrl(PHOTO_BUCKET, path, 3600), staleTime: 50 * 60_000 })
  if (isLoading || !url) return <div className={cn('animate-pulse bg-surface-3', className)} />
  return <img src={url} alt={alt} className={cn('object-cover', className)} loading="lazy" />
}

export default function PhotosPage() {
  const me = useUserId()
  const { data: partner } = usePartnership()
  const [owner, setOwner] = useState<'me' | 'partner'>('me')
  const ownerId = owner === 'me' ? me : partner?.partnerId ?? me
  const { data: photos, isLoading, error, refetch } = usePhotos(ownerId)
  const partnerProfile = useProfile(partner?.partnerId ?? undefined)
  const [category, setCategory] = useState<PhotoCategory | ''>('')
  const [upload, setUpload] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [compare, setCompare] = useState(false)
  const [toDelete, setToDelete] = useState<ProgressPhoto | null>(null)
  const isMine = ownerId === me

  const del = useMut(async (p: ProgressPhoto) => {
    const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([p.storage_path])
    if (error) throw error
    await unwrap(supabase.from('progress_photos').delete().eq('id', p.id))
  }, { invalidate: [keys.photos(me)], success: 'Foto eliminada', onSuccess: () => setToDelete(null) })
  const toggleVis = useMut(async (p: ProgressPhoto) =>
    unwrap(supabase.from('progress_photos').update({ visible_to_partner: !p.visible_to_partner }).eq('id', p.id)), { invalidate: [keys.photos(me)] })

  const list = (photos ?? []).filter((p) => !category || p.category === category)
  const pick = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.slice(-1), id]))
  const comparePhotos = (photos ?? []).filter((p) => selected.includes(p.id)).sort((a, b) => a.taken_on.localeCompare(b.taken_on))

  return (
    <div className="animate-fade-up">
      <PageHeader title="Fotografías de progreso"
        subtitle={<span className="inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" /> Galería privada. Solo tu Gym Bro puede ver las fotos que marques como visibles.</span>}
        actions={<>
          <Button variant="outline" disabled={selected.length !== 2} onClick={() => setCompare(true)}><Columns2 className="h-4 w-4" /> Comparar ({selected.length}/2)</Button>
          {isMine && <Button onClick={() => setUpload(true)}><Upload className="h-4 w-4" /> Subir foto</Button>}
        </>} />
      <div className="mb-4 flex flex-wrap gap-2">
        {partner?.partnerId && <Tabs value={owner} onChange={(v) => { setOwner(v); setSelected([]) }} options={[
          { value: 'me', label: 'Mis fotos' }, { value: 'partner', label: `De ${partnerProfile.data?.full_name?.split(' ')[0] || 'mi Gym Bro'}` },
        ]} />}
        <Tabs value={category} onChange={setCategory} options={[{ value: '', label: 'Todas' }, ...Object.entries(PHOTO_CATEGORY_LABELS).map(([k, v]) => ({ value: k as PhotoCategory, label: v }))]} />
      </div>

      {isLoading ? <LoadingBlock /> : error ? <ErrorBlock error={errorMessage(error)} onRetry={refetch} /> : !list.length ? (
        <EmptyState icon={<Camera className="h-8 w-8" />} title={isMine ? 'Sin fotos todavía' : 'Tu Gym Bro no comparte fotos'}
          description={isMine ? 'Sube fotos frontales, laterales y de espalda con la misma luz y postura para comparar mejor.' : 'Solo verás las fotos que tu compañero marque como visibles y si autorizó compartir fotos.'} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((p) => (
            <Card key={p.id} className={cn('overflow-hidden p-0', selected.includes(p.id) && 'ring-2 ring-accent')}>
              <button type="button" onClick={() => pick(p.id)} className="block w-full" aria-pressed={selected.includes(p.id)} aria-label={`Seleccionar foto del ${fmtDate(p.taken_on)} para comparar`}>
                <PhotoImg path={p.storage_path} alt={`${PHOTO_CATEGORY_LABELS[p.category]} ${fmtDate(p.taken_on)}`} className="aspect-[3/4] w-full" />
              </button>
              <div className="p-2.5">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-sm font-semibold">{fmtDate(p.taken_on, 'd MMM yyyy')}</p>
                  <Badge>{PHOTO_CATEGORY_LABELS[p.category]}</Badge>
                </div>
                {p.notes && <p className="mt-1 line-clamp-2 text-xs text-muted">{p.notes}</p>}
                {isMine && (
                  <div className="mt-2 flex justify-between">
                    <Button size="sm" variant="ghost" onClick={() => toggleVis.mutate(p)} aria-label={p.visible_to_partner ? 'Ocultar al Gym Bro' : 'Mostrar al Gym Bro'}>
                      {p.visible_to_partner ? <><Eye className="h-4 w-4 text-accent" /> Visible</> : <><EyeOff className="h-4 w-4" /> Privada</>}
                    </Button>
                    <Button size="icon" variant="ghost" className="text-danger" aria-label="Eliminar foto" onClick={() => setToDelete(p)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {upload && <UploadForm onClose={() => setUpload(false)} />}
      <Modal open={compare} onOpenChange={setCompare} title="Comparación" className="sm:max-w-4xl">
        <div className="grid grid-cols-2 gap-3">
          {comparePhotos.map((p) => (
            <figure key={p.id}>
              <PhotoImg path={p.storage_path} alt={fmtDate(p.taken_on)} className="aspect-[3/4] w-full rounded-xl" />
              <figcaption className="mt-1 text-center text-sm">{fmtDate(p.taken_on)} · {PHOTO_CATEGORY_LABELS[p.category]}</figcaption>
            </figure>
          ))}
        </div>
      </Modal>
      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} danger title="¿Eliminar foto?" confirmLabel="Eliminar"
        description="La foto se borrará del almacenamiento de forma permanente." loading={del.isPending} onConfirm={() => toDelete && del.mutate(toDelete)} />
    </div>
  )
}

function UploadForm({ onClose }: { onClose: () => void }) {
  const me = useUserId()
  const [file, setFile] = useState<File | null>(null)
  const [date, setDate] = useState(todayKey())
  const [category, setCategory] = useState<PhotoCategory>('front')
  const [visible, setVisible] = useState(false)
  const [notes, setNotes] = useState('')
  const save = useMut(async () => {
    if (!file) throw new Error('Selecciona una imagen')
    if (!TYPES.includes(file.type)) throw new Error('Formato no permitido (JPG, PNG o WebP)')
    if (file.size > MAX_BYTES) throw new Error('La imagen supera 10 MB')
    const ext = file.type.split('/')[1].replace('jpeg', 'jpg')
    const path = `${me}/${uuid()}.${ext}`
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
    if (error) throw error
    try {
      await unwrap(supabase.from('progress_photos').insert({ user_id: me, storage_path: path, taken_on: date, category, visible_to_partner: visible, notes: notes.trim() || null }))
    } catch (e) {
      await supabase.storage.from(PHOTO_BUCKET).remove([path])
      throw e
    }
  }, { invalidate: [keys.photos(me)], success: 'Foto subida', onSuccess: onClose })

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Subir foto de progreso">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(undefined) }} className="space-y-3">
        <Field label="Imagen (JPG, PNG o WebP, máx. 10 MB)">{(id) => (
          <Input id={id} type="file" accept={TYPES.join(',')} className="py-2" onChange={(e) => {
            const f = e.target.files?.[0] ?? null
            if (f && f.size > MAX_BYTES) toast.error('La imagen supera 10 MB')
            setFile(f)
          }} />
        )}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha">{(id) => <Input id={id} type="date" max={todayKey()} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Categoría">{(id) => (
            <Select id={id} value={category} onChange={(e) => setCategory(e.target.value as PhotoCategory)}>
              {Object.entries(PHOTO_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          )}</Field>
        </div>
        <Switch checked={visible} onChange={setVisible} label="Visible para mi Gym Bro" description="Además debe estar activado 'Compartir fotos' en Configuración > Privacidad." />
        <Field label="Notas">{(id) => <Textarea id={id} rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={save.isPending} disabled={!file}>Subir</Button></div>
      </form>
    </Modal>
  )
}
