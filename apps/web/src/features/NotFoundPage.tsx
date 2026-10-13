import { Link } from 'react-router'
import { Compass } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/display'

export default function NotFoundPage() {
  return (
    <EmptyState
      icon={<Compass className="size-5" />}
      title="Seite nicht gefunden"
      description="Die aufgerufene Seite existiert nicht oder wurde verschoben."
      action={
        <Button asChild>
          <Link to="/">Zur Startseite</Link>
        </Button>
      }
    />
  )
}
