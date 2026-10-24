import { useQuery } from '@tanstack/react-query'
import { AVATAR_BUCKET, signedUrl } from '@/lib/supabase'
import { cn, initials } from '@/lib/utils'

/** Avatar privado: se muestra con una URL firmada temporal. */
export function Avatar({ path, name, size = 40, className }: { path?: string | null; name: string; size?: number; className?: string }) {
  const { data: url } = useQuery({
    queryKey: ['signed', AVATAR_BUCKET, path],
    queryFn: () => signedUrl(AVATAR_BUCKET, path!),
    enabled: !!path,
    staleTime: 50 * 60_000,
  })
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-3 font-bold text-muted', className)}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {url ? <img src={url} alt={name} className="h-full w-full object-cover" /> : initials(name)}
    </span>
  )
}
