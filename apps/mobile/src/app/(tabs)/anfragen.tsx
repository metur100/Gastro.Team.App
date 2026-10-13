import { useEffect, useState } from 'react'
import { Modal, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, errorMessage } from '@/lib/api'
import { usePermissions } from '@/lib/auth'
import { fmt, plural } from '@/lib/format'
import { colors, radius, space, type } from '@/lib/theme'
import { Badge, Banner, Button, Card, EmptyState, ErrorState, Loading, Screen, Segmented, SectionTitle, TextField } from '@/components/ui'
import type { LeaveRequest, LeaveStatus, Paged, Swap, SwapStatus } from '@/types/api'

type Tab = 'urlaub' | 'tausch' | 'freigaben'

const LEAVE_LABEL: Record<string, string> = { Vacation: 'Urlaub', Sick: 'Krankmeldung', Unpaid: 'Unbezahlt', Training: 'Fortbildung', Other: 'Sonstiges' }
const LEAVE_STATUS: Record<LeaveStatus, [string, 'warning' | 'success' | 'danger' | 'neutral']> = {
  Pending: ['Offen', 'warning'], Approved: ['Genehmigt', 'success'], Rejected: ['Abgelehnt', 'danger'], Cancelled: ['Storniert', 'neutral'],
}
const SWAP_STATUS: Record<SwapStatus, [string, 'warning' | 'success' | 'danger' | 'neutral' | 'info']> = {
  Pending: ['Wartet auf Antwort', 'warning'], AwaitingApproval: ['Wartet auf Freigabe', 'info'], Completed: ['Abgeschlossen', 'success'],
  Declined: ['Abgelehnt', 'danger'], Rejected: ['Von Leitung abgelehnt', 'danger'], Cancelled: ['Zurückgezogen', 'neutral'], Invalidated: ['Hinfällig', 'neutral'],
}

export default function Requests() {
  const params = useLocalSearchParams<{ tab?: Tab }>()
  const p = usePermissions()
  const manager = p.can('ApproveLeave') || p.can('ManageSwaps')
  const [tab, setTab] = useState<Tab>(params.tab ?? (p.employeeId ? 'urlaub' : 'freigaben'))
  const [feedback, setFeedback] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null)
  useEffect(() => {
    if (params.tab) setTab(params.tab)
  }, [params.tab])

  const options: { value: Tab; label: string }[] = [
    ...(p.employeeId ? [{ value: 'urlaub' as Tab, label: 'Urlaub' }] : []),
    ...(p.employeeId && p.hasFeature('ShiftSwaps') ? [{ value: 'tausch' as Tab, label: 'Tausch' }] : []),
    ...(manager ? [{ value: 'freigaben' as Tab, label: 'Freigaben' }] : []),
  ]
  const notify = (text: string, tone: 'success' | 'danger' = 'success') => setFeedback({ text, tone })

  return (
    <Screen title="Anfragen">
      <Banner message={feedback?.text ?? null} tone={feedback?.tone} onHide={() => setFeedback(null)} />
      {options.length > 1 && <Segmented value={tab} options={options} onChange={setTab} />}
      {tab === 'urlaub' && <MyLeave notify={notify} />}
      {tab === 'tausch' && <MySwaps notify={notify} />}
      {tab === 'freigaben' && manager && <Approvals notify={notify} />}
    </Screen>
  )
}

function useAct(notify: (t: string, tone?: 'success' | 'danger') => void, keys: string[][]) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (id: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(id)
    try {
      await fn()
      await Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })))
      notify(success)
    } catch (e) {
      notify(errorMessage(e), 'danger')
      await Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })))
    } finally {
      setBusy(null)
    }
  }
  return { busy, run }
}

function LeaveCard({ r, children, showName }: { r: LeaveRequest; children?: React.ReactNode; showName?: boolean }) {
  const [label, tone] = LEAVE_STATUS[r.status]
  return (
    <Card style={{ marginBottom: space.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm }}>
        <Text style={type.heading}>{showName ? `${r.employeeName} · ` : ''}{LEAVE_LABEL[r.type]}</Text>
        <Badge label={label} tone={tone} />
      </View>
      <Text style={[type.muted, { marginTop: 4 }]}>
        {r.startDate === r.endDate ? fmt.date(r.startDate) : `${fmt.date(r.startDate)} – ${fmt.date(r.endDate)}`} · {plural(r.days, 'Tag', 'Tage')}
      </Text>
      {r.note ? <Text style={[type.body, { marginTop: 4 }]}>„{r.note}“</Text> : null}
      {r.decisionReason ? <Text style={[type.small, { marginTop: 4 }]}>Begründung: {r.decisionReason}</Text> : null}
      {children ? <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>{children}</View> : null}
    </Card>
  )
}

function MyLeave({ notify }: { notify: (t: string, tone?: 'success' | 'danger') => void }) {
  const q = useQuery({ queryKey: ['leave', 'mine'], queryFn: () => api.get<Paged<LeaveRequest>>('/leave-requests?mine=true&pageSize=50') })
  const { busy, run } = useAct(notify, [['leave']])
  return (
    <>
      <Button title="Neuer Antrag" icon="add" onPress={() => router.push('/urlaub-neu')} />
      <SectionTitle>Meine Anträge</SectionTitle>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState icon="airplane-outline" title="Noch keine Anträge" text="Beantragen Sie Urlaub oder melden Sie eine Abwesenheit." />
      ) : (
        q.data.items.map((r) => (
          <LeaveCard key={r.id} r={r}>
            {r.canCancel && r.status === 'Pending' ? (
              <Button title="Stornieren" variant="outline" loading={busy === r.id} onPress={() => void run(r.id, () => api.post(`/leave-requests/${r.id}/cancel`, { version: r.version }), 'Antrag storniert.')} />
            ) : null}
          </LeaveCard>
        ))
      )}
    </>
  )
}

function SwapCard({ s, children }: { s: Swap; children?: React.ReactNode }) {
  const [label, tone] = SWAP_STATUS[s.status]
  return (
    <Card style={{ marginBottom: space.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <Text style={type.heading}>{fmt.dayShort(s.shift.date)} · {fmt.timeRange(s.shift.startTime, s.shift.endTime)}</Text>
        <Badge label={label} tone={tone} />
      </View>
      <Text style={[type.muted, { marginTop: 4 }]}>{s.shift.jobRoleName}{s.shift.locationName ? ` · ${s.shift.locationName}` : ''}</Text>
      <Text style={[type.body, { marginTop: 6 }]}>{s.requesterName} → {s.acceptedByName ?? s.targetName ?? 'Offenes Angebot an alle'}</Text>
      {s.message ? <Text style={[type.small, { marginTop: 4 }]}>„{s.message}“</Text> : null}
      {children ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md }}>{children}</View> : null}
    </Card>
  )
}

function MySwaps({ notify }: { notify: (t: string, tone?: 'success' | 'danger') => void }) {
  const mine = useQuery({ queryKey: ['swaps', 'mine'], queryFn: () => api.get<Swap[]>('/shift-swaps?scope=mine') })
  const open = useQuery({ queryKey: ['swaps', 'open'], queryFn: () => api.get<Swap[]>('/shift-swaps?scope=open') })
  const { busy, run } = useAct(notify, [['swaps'], ['my-shifts'], ['overview']])
  const act = (s: Swap, action: string, msg: string) => run(s.id + action, () => api.post(`/shift-swaps/${s.id}/${action}`, { version: s.version, reason: null }), msg)
  const actions = (s: Swap) => (
    <>
      {s.canAccept && <Button title="Übernehmen" loading={busy === s.id + 'accept'} onPress={() => void act(s, 'accept', 'Angenommen.')} />}
      {s.canDecline && <Button title="Ablehnen" variant="outline" onPress={() => void act(s, 'decline', 'Abgelehnt.')} />}
      {s.canCancel && <Button title="Zurückziehen" variant="ghost" onPress={() => void act(s, 'cancel', 'Anfrage zurückgezogen.')} />}
    </>
  )
  return (
    <>
      <Text style={[type.small, { marginBottom: space.md }]}>Eine eigene Schicht bieten Sie über „Schichten“ → Schicht antippen → „Schicht tauschen“ an.</Text>
      <SectionTitle>Offene Angebote</SectionTitle>
      {open.isPending ? <Loading /> : open.isError ? <ErrorState error={open.error} onRetry={() => void open.refetch()} /> : open.data.length === 0 ? (
        <EmptyState icon="swap-horizontal-outline" title="Keine offenen Angebote" />
      ) : open.data.map((s) => <SwapCard key={s.id} s={s}>{actions(s)}</SwapCard>)}
      <SectionTitle>Meine Tauschanfragen</SectionTitle>
      {mine.isPending ? <Loading /> : mine.isError ? <ErrorState error={mine.error} onRetry={() => void mine.refetch()} /> : mine.data.length === 0 ? (
        <EmptyState icon="swap-horizontal-outline" title="Keine Tauschanfragen" />
      ) : mine.data.map((s) => <SwapCard key={s.id} s={s}>{actions(s)}</SwapCard>)}
    </>
  )
}

function Approvals({ notify }: { notify: (t: string, tone?: 'success' | 'danger') => void }) {
  const p = usePermissions()
  const leave = useQuery({ queryKey: ['leave', 'pending'], queryFn: () => api.get<Paged<LeaveRequest>>('/leave-requests?status=Pending&pageSize=50'), enabled: p.can('ApproveLeave') })
  const swaps = useQuery({ queryKey: ['swaps', 'manage'], queryFn: () => api.get<Swap[]>('/shift-swaps?scope=manage&openOnly=true'), enabled: p.can('ManageSwaps') && p.hasFeature('ShiftSwaps') })
  const { busy, run } = useAct(notify, [['leave'], ['swaps'], ['summary']])
  const [rejecting, setRejecting] = useState<{ kind: 'leave' | 'swap'; id: string; version: string } | null>(null)
  const [reason, setReason] = useState('')

  return (
    <>
      {p.can('ApproveLeave') && (
        <>
          <SectionTitle>Urlaubsanträge</SectionTitle>
          {leave.isPending ? <Loading /> : leave.isError ? <ErrorState error={leave.error} onRetry={() => void leave.refetch()} /> : leave.data.items.length === 0 ? (
            <EmptyState icon="checkmark-done-outline" title="Keine offenen Anträge" />
          ) : leave.data.items.map((r) => (
            <LeaveCard key={r.id} r={r} showName>
              {r.canDecide ? (
                <>
                  <Button title="Genehmigen" loading={busy === r.id} onPress={() => void run(r.id, () => api.post(`/leave-requests/${r.id}/approve`, { version: r.version, reason: null }), 'Antrag genehmigt.')} />
                  <Button title="Ablehnen" variant="outline" onPress={() => setRejecting({ kind: 'leave', id: r.id, version: r.version })} />
                </>
              ) : null}
            </LeaveCard>
          ))}
        </>
      )}
      {p.can('ManageSwaps') && p.hasFeature('ShiftSwaps') && (
        <>
          <SectionTitle>Schichttausch</SectionTitle>
          {swaps.isPending ? <Loading /> : swaps.isError ? <ErrorState error={swaps.error} onRetry={() => void swaps.refetch()} /> : swaps.data.length === 0 ? (
            <EmptyState icon="checkmark-done-outline" title="Keine offenen Tauschanfragen" />
          ) : swaps.data.map((s) => (
            <SwapCard key={s.id} s={s}>
              {s.canApprove && <Button title="Freigeben" loading={busy === s.id} onPress={() => void run(s.id, () => api.post(`/shift-swaps/${s.id}/approve`, { version: s.version, reason: null }), 'Schichttausch freigegeben.')} />}
              {s.canReject && <Button title="Ablehnen" variant="outline" onPress={() => setRejecting({ kind: 'swap', id: s.id, version: s.version })} />}
            </SwapCard>
          ))}
        </>
      )}
      <Modal visible={Boolean(rejecting)} transparent animationType="fade" onRequestClose={() => setRejecting(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(28,27,24,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, paddingBottom: space.xxl }}>
            <Text style={[type.heading, { marginBottom: space.md }]} accessibilityRole="header">Ablehnen</Text>
            <TextField label={rejecting?.kind === 'leave' ? 'Begründung' : 'Begründung (optional)'} value={reason} onChangeText={setReason} multiline maxLength={500} />
            <View style={{ gap: space.sm }}>
              <Button
                title="Ablehnen"
                variant="danger"
                onPress={() => {
                  if (!rejecting) return
                  if (rejecting.kind === 'leave' && !reason.trim()) return notify('Bitte geben Sie einen Grund für die Ablehnung an.', 'danger')
                  const r = rejecting
                  setRejecting(null)
                  const path = r.kind === 'leave' ? `/leave-requests/${r.id}/reject` : `/shift-swaps/${r.id}/reject`
                  void run(r.id, () => api.post(path, { version: r.version, reason: reason.trim() || null }), 'Abgelehnt.').then(() => setReason(''))
                }}
              />
              <Button title="Abbrechen" variant="ghost" onPress={() => setRejecting(null)} />
            </View>
          </View>
        </View>
      </Modal>
    </>
  )
}
