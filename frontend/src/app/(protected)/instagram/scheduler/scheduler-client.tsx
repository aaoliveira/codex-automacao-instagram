'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ListFilter,
  LockKeyhole,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSession } from '@/components/session-context';
import { InlineError, LoadingState } from '@/components/ui/states';
import { instagramAccountsQueryKey, listInstagramAccounts } from '@/lib/api/instagram';
import type { Publication, PublicationMediaType } from '@/lib/api/publications';
import {
  cancelPublicationJob,
  listAllPublications,
  listPublicationJobs,
  retryPublicationJob,
  schedulePublication,
  schedulerJobsQueryKey,
  schedulerPublicationsQueryKey,
  type PublicationJob,
  type QueueJobState,
} from '@/lib/api/scheduler';
import type { InstagramAccount } from '@/lib/api/types';
import { canManageTeam } from '@/lib/auth/permissions';
import {
  calendarDateKey,
  currentDateInTimezone,
  dateTimeInputForInstant,
  formatInTimezone,
  zonedDateTimeToIso,
} from '@/lib/scheduler-time';

type Notice = { tone: 'success' | 'error'; message: string };
type ViewMode = 'month' | 'week';
type ScheduleDialog = null | { kind: 'create' } | { kind: 'edit'; job: PublicationJob };
type ScheduleFields = {
  accountId: string;
  publicationId: string;
  date: string;
  time: string;
  timezone: string;
};
type ScheduledItem = {
  job: PublicationJob;
  publication: Publication | undefined;
};

const JOB_STATES: Array<{ value: QueueJobState | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'WAITING', label: 'Waiting' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'CANCELED', label: 'Canceled' },
];

const TIMEZONE_SUGGESTIONS = [
  'UTC',
  'America/Bahia',
  'America/Fortaleza',
  'America/Manaus',
  'America/Recife',
  'America/Sao_Paulo',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Paris',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Australia/Sydney',
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function InstagramScheduler() {
  const session = useSession();
  const queryClient = useQueryClient();
  const organizationId = session.membership.organization.id;
  const canSchedule = canManageTeam(session.membership.role);
  const [mode, setMode] = useState<ViewMode>('month');
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [accountFilter, setAccountFilter] = useState('');
  const [stateFilter, setStateFilter] = useState<QueueJobState | ''>('');
  const [dialog, setDialog] = useState<ScheduleDialog>(null);
  const [fields, setFields] = useState<ScheduleFields>(() => emptyFields());
  const [replaceConfirmation, setReplaceConfirmation] = useState(false);
  const [cancelConfirmation, setCancelConfirmation] = useState<PublicationJob | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const updateClock = () => setCurrentTime(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const accountsQuery = useQuery({
    queryKey: instagramAccountsQueryKey(organizationId),
    queryFn: () => listInstagramAccounts(organizationId),
    enabled: canSchedule,
  });
  const jobsQuery = useQuery({
    queryKey: schedulerJobsQueryKey(organizationId),
    queryFn: () => listPublicationJobs(organizationId),
    enabled: canSchedule,
    refetchInterval: (query) =>
      query.state.data?.some((job) => job.state === 'WAITING' || job.state === 'PROCESSING')
        ? 5_000
        : false,
    refetchIntervalInBackground: false,
  });
  const publicationsQuery = useQuery({
    queryKey: schedulerPublicationsQueryKey(organizationId),
    queryFn: () => listAllPublications(organizationId),
    enabled: canSchedule,
  });

  const publicationsById = useMemo(
    () => new Map((publicationsQuery.data ?? []).map((publication) => [publication.id, publication])),
    [publicationsQuery.data],
  );
  const allScheduledItems = useMemo(
    () => (jobsQuery.data ?? [])
      .map((job) => ({ job, publication: publicationsById.get(job.publicationId) })),
    [jobsQuery.data, publicationsById],
  );
  const visibleItems = useMemo(
    () => allScheduledItems.filter(({ job }) =>
      (!accountFilter || job.instagramAccountId === accountFilter) &&
      (!stateFilter || job.state === stateFilter),
    ),
    [accountFilter, allScheduledItems, stateFilter],
  );
  const connectedAccounts = useMemo(
    () => (accountsQuery.data ?? []).filter((account) => account.status === 'CONNECTED'),
    [accountsQuery.data],
  );
  const drafts = useMemo(
    () => (publicationsQuery.data ?? []).filter((publication) => publication.status === 'DRAFT'),
    [publicationsQuery.data],
  );
  const calendarDays = useMemo(() => getCalendarDays(calendarDate, mode), [calendarDate, mode]);
  const calendarTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const eventsByDay = useMemo(() => {
    const events = new Map<string, ScheduledItem[]>();
    for (const item of visibleItems) {
      if (!item.job.scheduledAt) continue;
      const key = calendarDateKey(new Date(item.job.scheduledAt), calendarTimezone);
      events.set(key, [...(events.get(key) ?? []), item]);
    }
    return events;
  }, [calendarTimezone, visibleItems]);

  const refreshScheduler = () => {
    void queryClient.invalidateQueries({ queryKey: schedulerJobsQueryKey(organizationId) });
    void queryClient.invalidateQueries({ queryKey: schedulerPublicationsQueryKey(organizationId) });
    void queryClient.invalidateQueries({ queryKey: ['instagram-publications', organizationId] });
  };

  const scheduleMutation = useMutation({
    mutationFn: async ({ values, originalJob }: { values: ScheduleFields; originalJob?: PublicationJob }) => {
      const scheduledAt = zonedDateTimeToIso(values.date, values.time, values.timezone.trim());
      if (new Date(scheduledAt).getTime() <= Date.now()) {
        throw new Error('Choose a date and time in the future.');
      }
      const replacement = await schedulePublication(organizationId, values.publicationId, {
        scheduledAt,
        timezone: values.timezone.trim(),
      });
      if (originalJob) {
        try {
          await cancelPublicationJob(organizationId, originalJob.publicationId);
        } catch (error) {
          try {
            await cancelPublicationJob(organizationId, replacement.id);
          } catch {
            throw new Error(
              `The replacement was scheduled, but neither job could be safely canceled. Review both entries. ${error instanceof Error ? error.message : ''}`,
            );
          }
          throw new Error(
            `The original schedule could not be canceled, so the replacement was canceled. ${error instanceof Error ? error.message : ''}`,
          );
        }
      }
      return { replacement, replaced: Boolean(originalJob) };
    },
    onSuccess: ({ replaced }) => {
      refreshScheduler();
      setDialog(null);
      setReplaceConfirmation(false);
      setNotice({
        tone: 'success',
        message: replaced
          ? 'Schedule updated with the replacement draft. The previous job was canceled.'
          : 'Publication scheduled successfully.',
      });
    },
    onError: (error) => setNotice({ tone: 'error', message: error.message }),
  });

  const cancelMutation = useMutation({
    mutationFn: (job: PublicationJob) => cancelPublicationJob(organizationId, job.publicationId),
    onSuccess: () => {
      refreshScheduler();
      setCancelConfirmation(null);
      setNotice({ tone: 'success', message: 'Scheduled publication canceled.' });
    },
    onError: (error) => {
      setCancelConfirmation(null);
      setNotice({ tone: 'error', message: error.message });
    },
  });

  const retryMutation = useMutation({
    mutationFn: (job: PublicationJob) => retryPublicationJob(organizationId, job.publicationId),
    onSuccess: () => {
      refreshScheduler();
      setNotice({ tone: 'success', message: 'Failed job added to the queue again.' });
    },
    onError: (error) => setNotice({ tone: 'error', message: error.message }),
  });

  function openCreateDialog() {
    scheduleMutation.reset();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dateTime = dateTimeInputForInstant(tomorrow.toISOString(), timezone);
    setFields({
      accountId: connectedAccounts[0]?.id ?? '',
      publicationId: '',
      date: dateTime.date,
      time: '09:00',
      timezone,
    });
    setReplaceConfirmation(false);
    setDialog({ kind: 'create' });
    setNotice(null);
  }

  function openEditDialog(job: PublicationJob) {
    scheduleMutation.reset();
    const timezone = job.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const dateTime = dateTimeInputForInstant(job.scheduledAt!, timezone);
    setFields({
      accountId: job.instagramAccountId,
      publicationId: '',
      date: dateTime.date,
      time: dateTime.time,
      timezone,
    });
    setReplaceConfirmation(false);
    setDialog({ kind: 'edit', job });
    setNotice(null);
  }

  const isLoading = accountsQuery.isLoading || jobsQuery.isLoading || publicationsQuery.isLoading;
  const queryError = accountsQuery.error || jobsQuery.error || publicationsQuery.error;
  if (!canSchedule) {
    return (
      <div className="rounded-[24px] border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><LockKeyhole className="size-5" aria-hidden="true" /></span>
        <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-950">Scheduler access is restricted</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">The queue operations API allows owners and admins to view and manage jobs.</p>
        <Link href="/instagram/publications" className="mt-5 inline-flex h-10 items-center rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50">Open publishing history</Link>
      </div>
    );
  }
  if (isLoading) return <LoadingState label="Loading your publishing schedule" />;
  if (queryError) {
    return (
      <InlineError
        message={queryError.message}
        retry={() => {
          void accountsQuery.refetch();
          void jobsQuery.refetch();
          void publicationsQuery.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-7 sm:space-y-8">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-indigo-600">
            Publishing operations
          </p>
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[34px]">
            Scheduler<span className="text-indigo-600">.</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
            Plan publication times across connected Instagram accounts and keep an eye on every job.
          </p>
        </div>
        {canSchedule && (
          <button
            type="button"
            onClick={openCreateDialog}
            className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 sm:self-auto"
          >
            <Plus className="size-3.5" aria-hidden="true" /> Schedule a post
          </button>
        )}
      </div>

      {!canSchedule && (
        <div className="flex items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 text-sm text-indigo-900">
          <LockKeyhole className="mt-0.5 size-4 shrink-0 text-indigo-600" aria-hidden="true" />
          <p className="leading-5">You can review the schedule. An owner or admin can create, edit, cancel, and retry jobs.</p>
        </div>
      )}

      {notice && <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />}

      <section aria-label="Scheduler filters" className="rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <ListFilter className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Filter scheduled jobs</h2>
            <p className="mt-0.5 text-xs text-slate-500">Choose an account or job state.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-xs font-medium text-slate-600">
            Instagram account
            <select
              aria-label="Filter by Instagram account"
              value={accountFilter}
              onChange={(event) => setAccountFilter(event.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            >
              <option value="">All accounts</option>
              {(accountsQuery.data ?? []).map((account) => (
                <option key={account.id} value={account.id}>{accountLabel(account)}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-medium text-slate-600">
            Job status
            <select
              aria-label="Filter by job status"
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value as QueueJobState | '')}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            >
              {JOB_STATES.map((state) => <option key={state.value} value={state.value}>{state.label}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section aria-label="Publication calendar" className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-sm">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <CalendarDays className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">{calendarHeading(calendarDate, mode)}</h2>
              <p className="mt-0.5 text-xs text-slate-500">Calendar dates use {calendarTimezone}; each item shows its selected timezone.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1" aria-label="Calendar view">
              <button type="button" aria-pressed={mode === 'month'} onClick={() => setMode('month')} className={viewButtonClass(mode === 'month')}>Month</button>
              <button type="button" aria-pressed={mode === 'week'} onClick={() => setMode('week')} className={viewButtonClass(mode === 'week')}>Week</button>
            </div>
            <button type="button" aria-label="Previous calendar period" onClick={() => moveCalendar(-1, mode, calendarDate, setCalendarDate)} className="flex size-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50">
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setCalendarDate(new Date())} className="h-9 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50">Today</button>
            <button type="button" aria-label="Next calendar period" onClick={() => moveCalendar(1, mode, calendarDate, setCalendarDate)} className="flex size-9 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50">
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/70">
          {DAY_NAMES.map((day) => <div key={day} className="px-1 py-2.5 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400 sm:px-3">{day}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {calendarDays.map(({ date, key, inCurrentMonth }) => {
            const events = eventsByDay.get(key) ?? [];
            return (
              <div key={key} className={`min-h-[112px] border-b border-r border-slate-100 p-1.5 sm:min-h-[138px] sm:p-2.5 ${mode === 'month' && !inCurrentMonth ? 'bg-slate-50/50' : 'bg-white'}`}>
                <span className={`flex size-6 items-center justify-center rounded-full text-[11px] font-semibold sm:size-7 sm:text-xs ${isToday(date) ? 'bg-indigo-600 text-white' : inCurrentMonth ? 'text-slate-700' : 'text-slate-300'}`}>
                  {date.getDate()}
                </span>
                <div className="mt-1 space-y-1">
                  {events.slice(0, mode === 'week' ? 5 : 2).map((item) => (
                    <CalendarEvent
                      key={item.job.id}
                      item={item}
                      canSchedule={canSchedule}
                      currentTime={currentTime}
                      onEdit={() => openEditDialog(item.job)}
                    />
                  ))}
                  {events.length > (mode === 'week' ? 5 : 2) && (
                    <p className="px-1 text-[9px] font-medium text-slate-400 sm:text-[10px]">+{events.length - (mode === 'week' ? 5 : 2)} more</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-label="Scheduled jobs" className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-sm">
        <div className="flex flex-col justify-between gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Scheduled posts and queue jobs</h2>
            <p className="mt-1 text-xs text-slate-500">{visibleItems.length} matching {visibleItems.length === 1 ? 'job' : 'jobs'} · scheduled posts appear on the calendar</p>
          </div>
          {jobsQuery.isFetching && <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400"><RefreshCw className="size-3 animate-spin" aria-hidden="true" /> Updating</span>}
        </div>
        {visibleItems.length === 0 ? (
          <div className="flex min-h-52 flex-col items-center justify-center px-5 text-center">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><CalendarClock className="size-5" aria-hidden="true" /></span>
            <h3 className="mt-3 text-sm font-semibold text-slate-900">No matching queue jobs</h3>
            <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">Try another account or status, or schedule a saved draft for a future time.</p>
            {canSchedule && <button type="button" onClick={openCreateDialog} className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl bg-slate-900 px-3.5 text-xs font-semibold text-white transition hover:bg-indigo-700"><Plus className="size-3.5" aria-hidden="true" /> Schedule a post</button>}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {visibleItems.map((item) => (
              <ScheduledJobRow
                key={item.job.id}
                item={item}
                canSchedule={canSchedule}
                currentTime={currentTime}
                onEdit={() => openEditDialog(item.job)}
                onCancel={() => setCancelConfirmation(item.job)}
                onRetry={() => retryMutation.mutate(item.job)}
                isCanceling={cancelMutation.isPending && cancelMutation.variables?.id === item.job.id}
                isRetrying={retryMutation.isPending && retryMutation.variables?.id === item.job.id}
              />
            ))}
          </div>
        )}
      </section>

      {dialog && (
        <ScheduleDialogView
          dialog={dialog}
          fields={fields}
          setFields={setFields}
          accounts={connectedAccounts}
          drafts={drafts}
          canSubmit={canSchedule}
          currentTime={currentTime}
          pending={scheduleMutation.isPending}
          error={scheduleMutation.error?.message ?? null}
          replaceConfirmation={replaceConfirmation}
          setReplaceConfirmation={setReplaceConfirmation}
          onClose={() => {
            if (!scheduleMutation.isPending) {
              setDialog(null);
              setReplaceConfirmation(false);
              scheduleMutation.reset();
            }
          }}
          onSubmit={() => {
            if (!fields.publicationId) return;
            if (dialog.kind === 'edit') setReplaceConfirmation(true);
            else scheduleMutation.mutate({ values: fields });
          }}
          onConfirmReplace={() => {
            if (dialog.kind === 'edit' && fields.publicationId) {
              scheduleMutation.mutate({ values: fields, originalJob: dialog.job });
            }
          }}
        />
      )}

      {cancelConfirmation && (
        <ConfirmationDialog
          title="Cancel scheduled publication?"
          message="This removes the waiting job from the publication queue. A job that has already started can no longer be canceled."
          confirmLabel={cancelMutation.isPending ? 'Canceling…' : 'Cancel publication'}
          pending={cancelMutation.isPending}
          onClose={() => !cancelMutation.isPending && setCancelConfirmation(null)}
          onConfirm={() => cancelMutation.mutate(cancelConfirmation)}
        />
      )}
    </div>
  );
}

function ScheduleDialogView({
  dialog,
  fields,
  setFields,
  accounts,
  drafts,
  canSubmit,
  currentTime,
  pending,
  error,
  replaceConfirmation,
  setReplaceConfirmation,
  onClose,
  onSubmit,
  onConfirmReplace,
}: {
  dialog: Exclude<ScheduleDialog, null>;
  fields: ScheduleFields;
  setFields: (fields: ScheduleFields) => void;
  accounts: InstagramAccount[];
  drafts: Publication[];
  canSubmit: boolean;
  currentTime: number;
  pending: boolean;
  error: string | null;
  replaceConfirmation: boolean;
  setReplaceConfirmation: (value: boolean) => void;
  onClose: () => void;
  onSubmit: () => void;
  onConfirmReplace: () => void;
}) {
  const selectableDrafts = drafts.filter((draft) => draft.instagramAccountId === fields.accountId);
  const timezoneValid = isValidTimezone(fields.timezone.trim());
  const validationError = useMemo(() => {
    if (!fields.date || !fields.time || !fields.timezone.trim()) return 'Choose a date, time, and timezone.';
    if (!timezoneValid) return 'Enter a valid IANA timezone, such as America/Bahia.';
    try {
      const instant = zonedDateTimeToIso(fields.date, fields.time, fields.timezone.trim());
      if (currentTime === 0) return 'Checking the current time…';
      if (new Date(instant).getTime() <= currentTime) return 'Choose a date and time in the future.';
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'Enter a valid date and time.';
    }
  }, [currentTime, fields.date, fields.time, fields.timezone, timezoneValid]);
  const currentDate = timezoneValid ? safeCurrentDate(fields.timezone) : undefined;

  function update<Key extends keyof ScheduleFields>(key: Key, value: ScheduleFields[Key]) {
    setFields({ ...fields, [key]: value });
  }

  const originalPublicationName = dialog.kind === 'edit'
    ? publicationTitle(dialog.job, undefined)
    : null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="schedule-dialog-title" className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-t-[24px] bg-white shadow-2xl sm:rounded-[24px]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-600">Instagram scheduler</p>
            <h2 id="schedule-dialog-title" className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
              {dialog.kind === 'edit' ? 'Edit scheduled post' : 'Schedule a post'}
            </h2>
            <p className="mt-1 max-w-lg text-xs leading-5 text-slate-500">
              {dialog.kind === 'edit'
                ? 'Queued jobs cannot be moved in place. Choose a saved draft to replace this slot; the current job will be canceled after the replacement is queued.'
                : 'Choose a saved draft and set its local date, time, and IANA timezone.'}
            </p>
          </div>
          <button type="button" aria-label="Close schedule dialog" onClick={onClose} className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50"><X className="size-4" aria-hidden="true" /></button>
        </div>

        {replaceConfirmation ? (
          <div role="alertdialog" aria-label="Confirm schedule change" className="p-5 sm:p-7">
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-semibold">Replace this scheduled publication?</h3>
                <p className="mt-1 text-xs leading-5 text-amber-900/80">
                  “{originalPublicationName}” will be canceled after the replacement draft is scheduled. The new job is set for {formatRequestedTime(fields)}.
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setReplaceConfirmation(false)} disabled={pending} className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Back to edit</button>
              <button type="button" onClick={onConfirmReplace} disabled={pending || !canSubmit} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-indigo-700 px-4 text-xs font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50">
                {pending ? <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" /> : <CalendarClock className="size-3.5" aria-hidden="true" />}
                {pending ? 'Updating schedule…' : 'Confirm replacement'}
              </button>
            </div>
            {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">{error}</p>}
          </div>
        ) : (
          <form className="space-y-5 p-5 sm:p-7" onSubmit={(event) => { event.preventDefault(); if (!validationError && fields.accountId && fields.publicationId && canSubmit) onSubmit(); }}>
            {dialog.kind === 'edit' && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-600">
                Replacing: <span className="font-semibold text-slate-800">{originalPublicationName}</span>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-semibold text-slate-700">
                Instagram account
                <select aria-label="Instagram account" required value={fields.accountId} onChange={(event) => setFields({ ...fields, accountId: event.target.value, publicationId: '' })} disabled={!canSubmit} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50">
                  <option value="">Select an account</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
                </select>
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-700">
                {dialog.kind === 'edit' ? 'Replacement draft' : 'Publication draft'}
                <select aria-label={dialog.kind === 'edit' ? 'Replacement draft' : 'Publication draft'} required value={fields.publicationId} onChange={(event) => update('publicationId', event.target.value)} disabled={!fields.accountId || !canSubmit} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50">
                  <option value="">{fields.accountId ? 'Select a saved draft' : 'Select an account first'}</option>
                  {selectableDrafts.map((draft) => <option key={draft.id} value={draft.id}>{draftTitle(draft)}</option>)}
                </select>
              </label>
            </div>
            {fields.accountId && selectableDrafts.length === 0 && (
              <div className="flex flex-col justify-between gap-2 rounded-xl border border-amber-100 bg-amber-50/70 px-3.5 py-3 text-xs text-amber-900 sm:flex-row sm:items-center">
                <span>No saved drafts for this account. Create one in Composer first.</span>
                <Link href="/instagram/compose" onClick={onClose} className="shrink-0 font-semibold underline decoration-amber-400 underline-offset-2">Open Composer</Link>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-semibold text-slate-700">
                Date
                <input aria-label="Scheduling date" type="date" required min={currentDate} value={fields.date} onChange={(event) => update('date', event.target.value)} disabled={!canSubmit} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50" />
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-slate-700">
                Time
                <input aria-label="Scheduling time" type="time" required value={fields.time} onChange={(event) => update('time', event.target.value)} disabled={!canSubmit} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50" />
              </label>
            </div>
            <label className="block space-y-1.5 text-xs font-semibold text-slate-700">
              Timezone (IANA)
              <input aria-label="Timezone" type="text" list="scheduler-timezones" required autoComplete="off" value={fields.timezone} onChange={(event) => update('timezone', event.target.value)} disabled={!canSubmit} placeholder="America/Bahia" className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal text-slate-800 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50" />
              <datalist id="scheduler-timezones">{TIMEZONE_SUGGESTIONS.map((timezone) => <option key={timezone} value={timezone} />)}</datalist>
              <span className="block font-normal text-slate-400">Examples: America/Bahia, Europe/Lisbon, UTC</span>
            </label>
            {fields.date && fields.time && (
              <p className={`rounded-xl px-3.5 py-2.5 text-xs leading-5 ${validationError ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-800'}`}>
                {validationError ?? `Will run ${formatRequestedTime(fields)}.`}
              </p>
            )}
            {!canSubmit && <p className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500">Only organization owners and admins can manage scheduled jobs.</p>}
            {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">{error}</p>}
            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={onClose} disabled={pending} className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Close</button>
              <button type="submit" disabled={pending || !canSubmit || !fields.accountId || !fields.publicationId || Boolean(validationError)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-45">
                {dialog.kind === 'edit' ? <RotateCcw className="size-3.5" aria-hidden="true" /> : <CalendarClock className="size-3.5" aria-hidden="true" />}
                {dialog.kind === 'edit' ? 'Review schedule change' : 'Schedule publication'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function ScheduledJobRow({
  item,
  canSchedule,
  currentTime,
  onEdit,
  onCancel,
  onRetry,
  isCanceling,
  isRetrying,
}: {
  item: ScheduledItem;
  canSchedule: boolean;
  currentTime: number;
  onEdit: () => void;
  onCancel: () => void;
  onRetry: () => void;
  isCanceling: boolean;
  isRetrying: boolean;
}) {
  const { job, publication } = item;
  const schedule = job.scheduledAt
    ? formatInTimezone(job.scheduledAt, job.timezone || 'UTC')
    : job.enqueuedAt
      ? `Queued ${formatInTimezone(job.enqueuedAt, job.timezone || 'UTC')}`
      : 'Not scheduled';
  const editable = canSchedule && job.state === 'WAITING' && job.scheduledAt && new Date(job.scheduledAt).getTime() > currentTime;
  return (
    <article className="flex flex-col gap-4 px-5 py-4 transition hover:bg-slate-50/60 sm:flex-row sm:items-center sm:px-6">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl ${job.state === 'FAILED' ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600'}`}>
          {job.state === 'FAILED' ? <AlertTriangle className="size-4" aria-hidden="true" /> : <CalendarClock className="size-4" aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="max-w-full truncate text-sm font-semibold text-slate-900">{publication ? publicationTitle(job, publication) : `Publication ${job.publicationId.slice(0, 8)}`}</h3>
            <JobStateBadge state={job.state} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span>{accountLabel(job.instagramAccount)}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1"><Clock3 className="size-3" aria-hidden="true" />{schedule}{job.timezone ? ` · ${job.timezone}` : ''}</span>
          </p>
          <p className="mt-1 text-[10px] text-slate-400">Attempts {job.attemptsMade}/{job.maxAttempts}{job.errorCode ? ` · ${job.errorCode}` : ''}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {publication && <Link href={`/instagram/publications/${publication.id}`} className="inline-flex h-9 items-center rounded-lg px-2.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50">Details</Link>}
        {job.state === 'FAILED' && canSchedule && <button type="button" onClick={onRetry} disabled={isRetrying} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"><RotateCcw className={`size-3.5 ${isRetrying ? 'animate-spin' : ''}`} aria-hidden="true" />{isRetrying ? 'Retrying…' : 'Retry'}</button>}
        {editable && <button type="button" onClick={onEdit} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"><CalendarClock className="size-3.5" aria-hidden="true" />Edit</button>}
        {canSchedule && job.state === 'WAITING' && <button type="button" onClick={onCancel} disabled={isCanceling} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"><X className="size-3.5" aria-hidden="true" />{isCanceling ? 'Canceling…' : 'Cancel'}</button>}
      </div>
    </article>
  );
}

function CalendarEvent({ item, canSchedule, currentTime, onEdit }: { item: ScheduledItem; canSchedule: boolean; currentTime: number; onEdit: () => void }) {
  const { job, publication } = item;
  const time = job.scheduledAt
    ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: job.timezone || 'UTC' }).format(new Date(job.scheduledAt))
    : '';
  const label = `${time} ${publication ? publicationTitle(job, publication) : `Publication ${job.publicationId.slice(0, 8)}`} · ${jobStateLabel(job.state)}`;
  const active = job.state === 'WAITING' && job.scheduledAt && new Date(job.scheduledAt).getTime() > currentTime;
  return (
    <button
      type="button"
      onClick={canSchedule && active ? onEdit : undefined}
      title={label}
      aria-label={label}
      className={`block w-full truncate rounded-md border px-1.5 py-1 text-left text-[9px] font-semibold leading-3 sm:px-2 sm:text-[10px] ${job.state === 'FAILED' ? 'border-rose-100 bg-rose-50 text-rose-700' : job.state === 'WAITING' ? 'border-indigo-100 bg-indigo-50 text-indigo-700' : job.state === 'COMPLETED' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : job.state === 'PROCESSING' ? 'border-amber-100 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-100 text-slate-500'} ${canSchedule && active ? 'cursor-pointer hover:ring-2 hover:ring-indigo-200' : 'cursor-default'}`}
    >
      <span className="hidden sm:inline">{time} · </span>{publication?.caption || mediaTypeLabel(publication?.mediaType)}
    </button>
  );
}

function ConfirmationDialog({
  title,
  message,
  confirmLabel,
  pending,
  onClose,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]">
      <section role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" className="w-full max-w-md rounded-[22px] bg-white p-5 shadow-2xl sm:p-6">
        <span className="flex size-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600"><AlertTriangle className="size-5" aria-hidden="true" /></span>
        <h2 id="confirmation-title" className="mt-4 text-base font-semibold text-slate-950">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">{message}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={pending} className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Keep job</button>
          <button type="button" onClick={onConfirm} disabled={pending} className="h-10 rounded-xl bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50">{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

function NoticeBanner({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const success = notice.tone === 'success';
  return (
    <div role={success ? 'status' : 'alert'} className={`flex items-start gap-3 rounded-2xl border p-4 text-sm ${success ? 'border-emerald-100 bg-emerald-50 text-emerald-900' : 'border-rose-100 bg-rose-50 text-rose-900'}`}>
      {success ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
      <p className="flex-1 leading-5">{notice.message}</p>
      <button type="button" aria-label="Dismiss notification" onClick={onDismiss} className="-mr-1 -mt-1 rounded-lg p-1 text-current/60 hover:bg-black/5 hover:text-current"><X className="size-4" aria-hidden="true" /></button>
    </div>
  );
}

function JobStateBadge({ state }: { state: QueueJobState }) {
  const style: Record<QueueJobState, string> = {
    WAITING: 'bg-indigo-50 text-indigo-700',
    PROCESSING: 'bg-amber-50 text-amber-700',
    COMPLETED: 'bg-emerald-50 text-emerald-700',
    FAILED: 'bg-rose-50 text-rose-700',
    CANCELED: 'bg-slate-100 text-slate-600',
  };
  return <span data-job-state={state} className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${style[state]}`}>{jobStateLabel(state)}</span>;
}

function getCalendarDays(date: Date, mode: ViewMode): Array<{ date: Date; key: string; inCurrentMonth: boolean }> {
  const first = mode === 'month' ? new Date(date.getFullYear(), date.getMonth(), 1) : new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const start = new Date(first);
  start.setDate(start.getDate() - start.getDay());
  const count = mode === 'month' ? 42 : 7;
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return {
      date: day,
      key: localDateKey(day),
      inCurrentMonth: day.getMonth() === date.getMonth(),
    };
  });
}

function localDateKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function calendarHeading(date: Date, mode: ViewMode): string {
  if (mode === 'month') return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date);
  const days = getCalendarDays(date, 'week');
  const first = days[0].date;
  const last = days[6].date;
  const start = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(first);
  const end = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(last);
  return `${start} – ${end}`;
}

function moveCalendar(delta: number, mode: ViewMode, date: Date, setDate: (date: Date) => void) {
  const next = new Date(date);
  if (mode === 'month') next.setMonth(next.getMonth() + delta);
  else next.setDate(next.getDate() + 7 * delta);
  setDate(next);
}

function isToday(date: Date): boolean {
  const today = new Date();
  return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
}

function viewButtonClass(active: boolean): string {
  return `h-8 rounded-lg px-3 text-xs font-semibold transition ${active ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`;
}

function accountLabel(account: Pick<InstagramAccount, 'username' | 'name'>): string {
  return account.username ? `@${account.username}` : account.name || 'Instagram account';
}

function publicationTitle(job: PublicationJob, publication: Publication | undefined): string {
  if (!publication) return `Publication ${job.publicationId.slice(0, 8)}`;
  return publication.caption?.trim() || `${mediaTypeLabel(publication.mediaType)} · ${job.publicationId.slice(0, 8)}`;
}

function draftTitle(publication: Publication): string {
  const type = mediaTypeLabel(publication.mediaType);
  return `${type} · ${publication.caption?.trim() || `Draft ${publication.id.slice(0, 8)}`}`;
}

function mediaTypeLabel(type: PublicationMediaType | undefined): string {
  if (type === 'VIDEO') return 'Video post';
  if (type === 'REEL') return 'Instagram Reel';
  return 'Photo post';
}

function jobStateLabel(state: QueueJobState): string {
  return state.charAt(0) + state.slice(1).toLowerCase();
}

function emptyFields(): ScheduleFields {
  return { accountId: '', publicationId: '', date: '', time: '', timezone: 'UTC' };
}

function isValidTimezone(timezone: string): boolean {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function safeCurrentDate(timezone: string): string | undefined {
  try {
    return currentDateInTimezone(timezone);
  } catch {
    return undefined;
  }
}

function formatRequestedTime(fields: ScheduleFields): string {
  try {
    const instant = zonedDateTimeToIso(fields.date, fields.time, fields.timezone.trim());
    return `${formatInTimezone(instant, fields.timezone.trim())} (${fields.timezone.trim()})`;
  } catch {
    return `${fields.date} ${fields.time} (${fields.timezone})`;
  }
}
