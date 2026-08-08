-- PATCH SUMMARY:
-- ✔ Explicit ownership columns on every application record
-- ✔ Composite owner constraints on image/audio share links
-- ✔ Evidence immutability and append-only audit triggers
-- ✔ Concise COMMENT ON TABLE metadata for all tables
-- ✔ Follow with migrations/001_lock_down_evidence_writes.sql

-- ============================================================
-- ProofLens — Database Schema
-- Cryptographic evidence pipeline for media provenance
-- ============================================================
-- Run this entire file in the Supabase SQL Editor to provision
-- all tables, functions, triggers, indexes, and initial RLS policies.
-- Requires a fresh Supabase project (public schema empty).
-- ============================================================


-- ============================================================
-- 1. EXTENSIONS
-- ============================================================

-- pgcrypto: used by gen_random_uuid() and digest() for token hashing
create extension if not exists pgcrypto with schema extensions;


-- ============================================================
-- 2. TYPES
-- ============================================================

create type public.credential_status as enum (
  'submitted',
  'anchored',
  'failed'
);


-- ============================================================
-- 3. TABLES
-- ============================================================
-- Ordered by dependency: independent tables first, then those
-- that reference them via foreign keys.


-- Device identity binding (one device-id ↔ one public key per user).
-- Trigger-guarded: only revoked_at may be updated after insert.
create table public.device_keys (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null,
  device_id       text        not null,
  public_key_b64  text        not null,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz
);

-- Append-only audit log for device registration events.
create table public.device_key_audit (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid,
  device_id       text,
  public_key_b64  text,
  action          text        not null,
  reason          text,
  ip              text,
  ua              text,
  created_at      timestamptz not null default now()
);

-- Append-only audit log for credential upload attempts.
create table public.upload_audit (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid,
  device_id       text,
  sha256          text,
  computed_sha256 text,
  media_key       text,
  signature_valid boolean,
  status          text        not null,
  reason          text,
  ip              text,
  ua              text,
  created_at      timestamptz not null default now()
);

-- Burst capture groups (single or multi-frame).
create table public.bursts (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null,
  capture_device_id   text        not null,
  mode                text        not null,
  trigger             text        not null,
  frame_total         integer     not null,
  status              text        not null,
  cover_credential_id uuid,       -- set after first frame is anchored
  created_at          timestamptz not null default now(),

  constraint bursts_mode_check        check (mode    in ('single', 'burst')),
  constraint bursts_trigger_check     check (trigger in ('manual', 'motion')),
  constraint bursts_frame_total_check check (frame_total in (1, 5, 10)),
  constraint bursts_status_check      check (status  in (
    'pending_capture', 'pending_upload', 'pending_anchor',
    'anchored', 'partial', 'failed'
  ))
);

-- Submitted image credentials. Trigger-guarded: immutable except TSA fields.
create table public.credentials (
  id                  uuid                     primary key default gen_random_uuid(),
  user_id             uuid                     not null,
  sha256              text                     not null,
  device_id           text,
  capture_device_id   text,
  submitter_device_id text,
  public_key_b64      text,
  signature_b64       text                     not null,
  media_key           text                     not null,
  thumbnail_key       text,
  "timestamp"         timestamptz,
  gps                 jsonb,
  exif                jsonb,
  credential_json     jsonb                    not null default '{}'::jsonb,
  status              public.credential_status not null default 'submitted',
  created_at          timestamptz              not null default now(),

  -- TSA anchoring fields (mutable via trigger guard)
  tsa_token_base64    text,
  tsa_time            timestamptz,
  tsa_serial          text,
  tsa_policy_oid      text,
  tsa_verified        boolean     default false,
  tsa_verified_at     timestamptz,

  -- Burst linkage
  burst_id            uuid        references public.bursts(id),
  frame_index         integer,
  frame_total         integer,

  constraint credentials_user_sha_unique unique (user_id, sha256),
  constraint credentials_id_user_uniq unique (id, user_id)
);

comment on column public.credentials.thumbnail_key is 'S3 key for thumbnail image';

-- Image capture drafts (staging before credential promotion).
create table public.drafts (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null default auth.uid(),
  sha256              text        not null,
  media_key           text,
  thumbnail_key       text,
  credential_json     jsonb       not null,
  capture_device_id   text        not null,
  submitter_device_id text,
  status              text        not null default 'pending',
  has_media_blob      boolean     not null default false,
  burst_id            uuid        references public.bursts(id),
  created_at          timestamptz default now(),

  constraint drafts_unique_user_sha unique (user_id, sha256),
  constraint drafts_status_check    check  (status in ('pending', 'submitted', 'failed'))
);

-- Audio evidence records. Trigger-guarded: immutable except TSA fields.
create table public.audio_records (
  id                   uuid        primary key default gen_random_uuid(),
  user_id              uuid        not null,
  title                text,
  duration             integer,
  sha256               text,
  signature            text,
  device_id            text,
  public_key_b64       text,
  gps                  jsonb,
  s3_key               text,
  credential_json      jsonb,
  credential_canonical text,
  tsa_status           text,
  tsa_token_base64     text,
  anchor_timestamp     timestamptz,
  created_at           timestamptz default now(),

  constraint audio_records_id_user_uniq unique (id, user_id)
);

-- Audio capture drafts (staging before audio record promotion).
create table public.audio_drafts (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null,
  sha256            text        not null,
  media_key         text,
  duration_ms       integer,
  credential_json   jsonb       not null,
  capture_device_id text        not null,
  created_at        timestamptz default now(),

  constraint audio_drafts_unique_user_sha unique (user_id, sha256)
);

-- Token-based share links for image credential verification.
-- Raw token is never stored; only the SHA-256 hash is persisted.
create table public.verification_shares (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null,
  capture_id  uuid        not null,
  token_hash  text        not null unique,
  expires_at  timestamptz not null,
  revoked     boolean     not null default false,
  created_at  timestamptz not null default now(),

  constraint verification_shares_owner_fk
    foreign key (capture_id, user_id)
    references public.credentials (id, user_id)
    on delete cascade
);

-- Token-based share links for audio record verification.
create table public.audio_shares (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null,
  audio_id    uuid        not null,
  token_hash  text        not null unique,
  expires_at  timestamptz not null,
  revoked     boolean     not null default false,
  created_at  timestamptz not null default now(),

  constraint audio_shares_owner_fk
    foreign key (audio_id, user_id)
    references public.audio_records (id, user_id)
    on delete cascade
);

comment on table public.device_keys is 'Registered device public keys per user.';
comment on table public.device_key_audit is 'Append-only audit log for device key events.';
comment on table public.upload_audit is 'Append-only audit log for upload verification attempts.';
comment on table public.bursts is 'Capture burst groups and lifecycle status.';
comment on table public.credentials is 'Submitted image evidence credentials and TSA anchoring fields.';
comment on table public.drafts is 'Staging table for image capture drafts.';
comment on table public.audio_records is 'Submitted audio evidence records and TSA anchoring fields.';
comment on table public.audio_drafts is 'Staging table for audio capture drafts.';
comment on table public.verification_shares is 'Token-hash based public verification links for image evidence.';
comment on table public.audio_shares is 'Token-hash based public verification links for audio evidence.';


-- ============================================================
-- 3.1 INTEGRITY CONSTRAINT PATCHES
-- ============================================================

-- Enforce NOT NULL ownership on all user-scoped tables.
alter table public.device_keys         alter column user_id set not null;
alter table public.device_key_audit    alter column user_id set not null;
alter table public.upload_audit        alter column user_id set not null;
alter table public.bursts              alter column user_id set not null;
alter table public.credentials         alter column user_id set not null;
alter table public.drafts              alter column user_id set not null;
alter table public.audio_records       alter column user_id set not null;
alter table public.audio_drafts        alter column user_id set not null;
alter table public.verification_shares alter column user_id set not null;
alter table public.audio_shares        alter column user_id set not null;

-- Light structural polish for required evidence hash integrity.
alter table public.audio_records alter column sha256 set not null;

-- User ownership foreign keys to Supabase Auth users.
alter table public.device_keys
  add constraint device_keys_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.device_key_audit
  add constraint device_key_audit_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.upload_audit
  add constraint upload_audit_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.bursts
  add constraint bursts_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.credentials
  add constraint credentials_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.drafts
  add constraint drafts_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.audio_records
  add constraint audio_records_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.audio_drafts
  add constraint audio_drafts_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.verification_shares
  add constraint verification_shares_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.audio_shares
  add constraint audio_shares_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- Ensure non-user share FKs are explicit.
alter table public.verification_shares
  add constraint verification_shares_capture_id_fkey
  foreign key (capture_id) references public.credentials(id);

alter table public.audio_shares
  add constraint audio_shares_audio_id_fkey
  foreign key (audio_id) references public.audio_records(id);

-- Remove redundant uniqueness overlap while preserving (user_id, sha256) uniqueness.
drop index if exists public.credentials_user_sha256_pubkey_uniq;


-- ============================================================
-- 4. INDEXES
-- ============================================================

-- device_keys
create unique index device_keys_user_device_uniq on public.device_keys (user_id, device_id);
create index device_keys_device_id_idx          on public.device_keys (device_id);

-- device_key_audit
create index device_key_audit_user_id_idx on public.device_key_audit (user_id);

-- upload_audit
create index upload_audit_user_id_idx on public.upload_audit (user_id);
create index upload_audit_sha256_idx  on public.upload_audit (sha256);

-- credentials
create index credentials_sha256_idx              on public.credentials (sha256);
create index credentials_user_id_created_at_idx  on public.credentials (user_id, created_at desc);
create index credentials_tsa_verified_idx        on public.credentials (tsa_verified, tsa_time);
create index credentials_created_at_idx          on public.credentials (created_at);
create index credentials_media_key_idx           on public.credentials (media_key);

-- drafts
create index drafts_user_idx        on public.drafts (user_id);
create index drafts_user_status_idx on public.drafts (user_id, status);

-- audio_drafts
create index audio_drafts_user_idx       on public.audio_drafts (user_id);
create index audio_drafts_created_at_idx on public.audio_drafts (created_at);

-- verification_shares  (token_hash already has a unique index via constraint)
create index verification_shares_capture_id_idx on public.verification_shares (capture_id);

-- audio_shares  (token_hash already has a unique index via constraint)
create index audio_shares_audio_id_idx on public.audio_shares (audio_id);


-- ============================================================
-- 5. FUNCTIONS
-- ============================================================

-- Generic append-only guard: blocks all updates and deletes.
create or replace function public._append_only_block_updates()
returns trigger language plpgsql as $$
begin
  raise exception 'append_only_table: updates/deletes are not allowed on %', tg_table_name;
end;
$$;

-- Allows only TSA-related column updates on audio_records.
create or replace function public._audio_records_tsa_only_updates()
returns trigger language plpgsql as $$
declare
  allowed_cols text[] := array['tsa_token_base64', 'tsa_status', 'anchor_timestamp'];
  new_filtered jsonb;
  old_filtered jsonb;
  col text;
begin
  if tg_op = 'DELETE' then
    raise exception 'immutable_audio_records: deletes are not allowed';
  end if;
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  new_filtered := to_jsonb(new);
  old_filtered := to_jsonb(old);
  foreach col in array allowed_cols loop
    new_filtered := new_filtered - col;
    old_filtered := old_filtered - col;
  end loop;
  if new_filtered <> old_filtered then
    raise exception 'immutable_audio_records: only TSA fields may be updated';
  end if;
  return new;
end;
$$;

-- Allows only TSA-related column updates on credentials.
create or replace function public._credentials_tsa_only_updates()
returns trigger language plpgsql as $$
declare
  allowed_cols text[] := array[
    'tsa_token_base64', 'tsa_time', 'tsa_policy_oid',
    'tsa_serial', 'tsa_verified', 'tsa_verified_at', 'status'
  ];
  new_filtered jsonb;
  old_filtered jsonb;
  col text;
begin
  if tg_op = 'DELETE' then
    raise exception 'immutable_credentials: deletes are not allowed';
  end if;
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  new_filtered := to_jsonb(new);
  old_filtered := to_jsonb(old);
  foreach col in array allowed_cols loop
    new_filtered := new_filtered - col;
    old_filtered := old_filtered - col;
  end loop;
  if new_filtered <> old_filtered then
    raise exception 'immutable_credentials: only TSA fields may be updated';
  end if;
  return new;
end;
$$;

-- Allows only revoked_at updates on device_keys.
create or replace function public._device_keys_revoke_only_updates()
returns trigger language plpgsql as $$
declare
  allowed_cols text[] := array['revoked_at'];
  new_filtered jsonb;
  old_filtered jsonb;
  col text;
begin
  if tg_op = 'DELETE' then
    raise exception 'immutable_device_keys: deletes are not allowed';
  end if;
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  new_filtered := to_jsonb(new);
  old_filtered := to_jsonb(old);
  foreach col in array allowed_cols loop
    new_filtered := new_filtered - col;
    old_filtered := old_filtered - col;
  end loop;
  if new_filtered <> old_filtered then
    raise exception 'immutable_device_keys: only revoked_at may be updated';
  end if;
  return new;
end;
$$;

-- Legacy share-token RPC retained for schema compatibility. The hardening
-- migration revokes browser execution; public verification runs through API.
create or replace function public.get_shared_credential(p_token text)
returns table (
  credential_id     uuid,
  sha256            text,
  device_id         text,
  capture_device_id text,
  created_at        timestamptz,
  capture_timestamp timestamptz,
  media_key         text,
  thumbnail_key     text,
  credential_json   jsonb,
  signature_b64     text,
  public_key_b64    text,
  tsa_token_base64  text,
  tsa_time          timestamptz,
  tsa_serial        text,
  tsa_policy_oid    text,
  tsa_verified      boolean,
  tsa_verified_at   timestamptz,
  exif_json         jsonb,
  gps               jsonb,
  status            text,
  burst_id          uuid,
  frame_index       integer,
  frame_total       integer
) language sql security definer set search_path = public
as $$
  with s as (
    select *
    from public.verification_shares
    where token_hash = encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex')
      and revoked = false
      and (expires_at is null or expires_at > now())
    limit 1
  )
  select
    c.id as credential_id,
    c.sha256,
    c.device_id,
    c.capture_device_id,
    c.created_at,
    c."timestamp" as capture_timestamp,
    c.media_key,
    c.thumbnail_key,
    c.credential_json,
    c.signature_b64,
    c.public_key_b64,
    c.tsa_token_base64,
    c.tsa_time,
    c.tsa_serial,
    c.tsa_policy_oid,
    c.tsa_verified,
    c.tsa_verified_at,
    c.exif as exif_json,
    c.gps,
    c.status::text,
    c.burst_id,
    c.frame_index,
    c.frame_total
  from public.credentials c
  join s on s.capture_id = c.id;
$$;


-- ============================================================
-- 6. TRIGGERS
-- ============================================================

-- Credentials: immutable except TSA fields
create trigger credentials_immutable_except_tsa
  before delete or update on public.credentials
  for each row execute function public._credentials_tsa_only_updates();

-- Audio records: immutable except TSA fields
create trigger audio_records_immutable_except_tsa
  before delete or update on public.audio_records
  for each row execute function public._audio_records_tsa_only_updates();

-- Device keys: only revoked_at may be updated
create trigger device_keys_revoke_only
  before delete or update on public.device_keys
  for each row execute function public._device_keys_revoke_only_updates();

-- Audit tables: append-only (no updates or deletes)
create trigger device_key_audit_append_only
  before delete or update on public.device_key_audit
  for each row execute function public._append_only_block_updates();

create trigger upload_audit_append_only
  before delete or update on public.upload_audit
  for each row execute function public._append_only_block_updates();


-- ============================================================
-- 7. VIEWS
-- ============================================================

-- Unified queue view: pending drafts + submitted credentials.
create view public.v_queue with (security_invoker = true) as
select
  d.id,
  d.user_id,
  d.sha256,
  d.credential_json,
  d.capture_device_id,
  null::text as submitter_device_id,
  'pending'::text as stage,
  d.created_at
from public.drafts d
where d.status = 'pending'
union all
select
  c.id,
  c.user_id,
  c.sha256,
  c.credential_json,
  c.capture_device_id,
  c.submitter_device_id,
  'submitted'::text as stage,
  c.created_at
from public.credentials c;


-- ============================================================
-- 8. ROW-LEVEL SECURITY
-- ============================================================
-- The backend connects via the Supabase service key, which
-- bypasses RLS. These policies protect against direct client
-- access through the Supabase JS client.

-- ---- device_keys (no client policies — service key only) ----
alter table public.device_keys enable row level security;
alter table public.device_keys force row level security;

-- ---- device_key_audit (no client policies — service key only) ----
alter table public.device_key_audit enable row level security;
alter table public.device_key_audit force row level security;

-- ---- upload_audit (no client policies — service key only) ----
alter table public.upload_audit enable row level security;
alter table public.upload_audit force row level security;

-- ---- bursts ----
alter table public.bursts enable row level security;

create policy bursts_select_own on public.bursts
  for select to authenticated using (user_id = auth.uid());
create policy bursts_insert_own on public.bursts
  for insert to authenticated with check (user_id = auth.uid());
create policy bursts_update_own on public.bursts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy bursts_delete_own on public.bursts
  for delete to authenticated using (user_id = auth.uid());

-- ---- credentials ----
alter table public.credentials enable row level security;
alter table public.credentials force row level security;

create policy credentials_select_own on public.credentials
  for select to authenticated using (user_id = auth.uid());
create policy credentials_insert_own on public.credentials
  for insert to authenticated with check (user_id = auth.uid());
create policy credentials_update_own on public.credentials
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy credentials_delete_never on public.credentials
  for delete to authenticated using (false);

-- ---- drafts ----
alter table public.drafts enable row level security;
alter table public.drafts force row level security;

create policy drafts_select_own on public.drafts
  for select to authenticated using (user_id = auth.uid());
create policy drafts_insert_own on public.drafts
  for insert to authenticated with check (user_id = auth.uid());
create policy drafts_update_own on public.drafts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy drafts_delete_own on public.drafts
  for delete to authenticated using (user_id = auth.uid());

-- ---- audio_records ----
alter table public.audio_records enable row level security;

create policy audio_records_select_own on public.audio_records
  for select to authenticated using (user_id = auth.uid());
create policy audio_records_insert_own on public.audio_records
  for insert to authenticated with check (user_id = auth.uid());
create policy audio_records_update_own on public.audio_records
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy audio_records_delete_never on public.audio_records
  for delete to authenticated using (false);

-- ---- audio_drafts ----
alter table public.audio_drafts enable row level security;
alter table public.audio_drafts force row level security;

create policy audio_drafts_select_own on public.audio_drafts
  for select to authenticated using (user_id = auth.uid());
create policy audio_drafts_insert_own on public.audio_drafts
  for insert to authenticated with check (user_id = auth.uid());
create policy audio_drafts_update_own on public.audio_drafts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy audio_drafts_delete_own on public.audio_drafts
  for delete to authenticated using (user_id = auth.uid());

-- ---- verification_shares ----
alter table public.verification_shares enable row level security;
alter table public.verification_shares force row level security;

create policy shares_select_own on public.verification_shares
  for select to authenticated using (user_id = auth.uid());
create policy shares_insert_own on public.verification_shares
  for insert to authenticated with check (user_id = auth.uid());
create policy shares_update_own on public.verification_shares
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy shares_delete_own on public.verification_shares
  for delete to authenticated using (user_id = auth.uid());

-- ---- audio_shares ----
alter table public.audio_shares enable row level security;

create policy audio_shares_select_own on public.audio_shares
  for select to authenticated using (user_id = auth.uid());
create policy audio_shares_insert_own on public.audio_shares
  for insert to authenticated with check (user_id = auth.uid());
create policy audio_shares_update_own on public.audio_shares
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy audio_shares_delete_own on public.audio_shares
  for delete to authenticated using (user_id = auth.uid());
