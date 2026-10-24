import { Bell, CalendarClock, CheckCheck, Swords, Target, Trash2, Trophy, BarChart3, UserPlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, Card, EmptyState, LoadingBlock, PageHeader } from '@/components/ui'
import { keys, unwrap, useMut, useNotifications } from '@/data/queries'
import { useUserId } from '@/features/auth/AuthProvider'
import { fmtDateTime } from '@/lib/dates'
import { supabase } from '@/lib/supabase'
import type { AppNotification } from '@/lib/types'
import { cn } from '@/lib/utils'

const ICONS: Record<AppNotification['kind'], typeof Bell> = {
  scheduled_workout: CalendarClock, challenge_ending: Swords, personal_record: Trophy, goal_achieved: Target, weekly_summary: BarChart3, partner: UserPlus,
}

export default function NotificationsPage() {
  const me = useUserId()
  const { data, isLoading } = useNotifications()
  const inv = [keys.notifications(me)]
  const markAll = useMut(async () => unwrap(supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', me).is('read_at', null)), { invalidate: inv })
  const mark = useMut(async (id: string) => unwrap(supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)), { invalidate: inv })
  const del = useMut(async (id: string) => unwrap(supabase.from('notifications').delete().eq('id', id)), { invalidate: inv })
  if (isLoading) return <LoadingBlock />
  const unread = (data ?? []).filter((n) => !n.read_at).length

  return (
    <div className="animate-fade-up">
      <PageHeader title="Notificaciones" subtitle="Avisos internos de la app. No se envían correos ni notificaciones push."
        actions={<>
          <Link to="/configuracion"><Button variant="ghost">Preferencias</Button></Link>
          <Button variant="outline" disabled={!unread} onClick={() => markAll.mutate(undefined)}><CheckCheck className="h-4 w-4" /> Marcar todas como leídas</Button>
        </>} />
      {!data?.length ? <EmptyState icon={<Bell className="h-8 w-8" />} title="Sin notificaciones" /> : (
        <ul className="space-y-2">
          {data.map((n) => {
            const Icon = ICONS[n.kind]
            return (
              <li key={n.id}>
                <Card className={cn('flex items-start gap-3', !n.read_at && 'border-accent/40')}>
                  <span className={cn('mt-0.5 rounded-xl p-2', n.read_at ? 'bg-surface-3 text-muted' : 'bg-accent/15 text-accent')}><Icon className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{n.title}</p>
                    {n.body && <p className="text-sm text-muted">{n.body}</p>}
                    <p className="mt-1 text-xs text-muted">{fmtDateTime(n.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {n.link && <Link to={n.link} onClick={() => !n.read_at && mark.mutate(n.id)}><Button size="sm" variant="secondary">Ver</Button></Link>}
                    {!n.read_at && <Button size="sm" variant="ghost" onClick={() => mark.mutate(n.id)}>Leída</Button>}
                    <Button size="icon" variant="ghost" aria-label="Eliminar notificación" onClick={() => del.mutate(n.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
