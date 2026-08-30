-- ---------------------------------------------------------------------------
-- Links our appointment rows to the Cal.com booking they represent, so
-- Cal.com's own webhooks (app/api/webhooks/calcom) can keep them current.
--
-- Until now `appointments` was a write-only log of what the agent attempted:
-- there was no way to find the row again when the booking was later moved or
-- cancelled — whether by the agent, by the business in their own calendar, or
-- by the attendee via Cal.com's cancellation link. calcom_booking_uid is that
-- handle, and it is unique so a redelivered webhook updates rather than
-- duplicates.
--
-- The status check gains 'rescheduled' and 'cancelled': a booking that was
-- moved or called off is neither 'booked' nor 'failed', and collapsing it
-- into either would misreport it on the dashboard.
-- ---------------------------------------------------------------------------

alter table public.appointments
  add column if not exists calcom_booking_uid text,
  add column if not exists calcom_booking_id integer;

create unique index if not exists appointments_calcom_booking_uid_key
  on public.appointments (calcom_booking_uid)
  where calcom_booking_uid is not null;

alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments
  add constraint appointments_status_check
  check (status in ('booked', 'failed', 'rescheduled', 'cancelled'));

comment on column public.appointments.calcom_booking_uid is
  'Cal.com booking uid — the join key for Cal.com webhook updates. Null for attempts that never reached Cal.com.';
