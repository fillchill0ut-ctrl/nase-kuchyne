-- Naše kuchyně – databáze
-- Spusťte celé v Supabase: SQL Editor → New query → vložit → Run.

-- Kdo smí do aplikace (vaše dva e-maily doplníte na konci souboru)
create table if not exists public.members (
  email text primary key
);

-- Recepty, nákupní seznam a „dokumenty“ (plán, profil, akce) jako JSON,
-- stejně jako ve verzi na claude.ai, ať se dá všechno převést 1:1.
create table if not exists public.recipes (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.items (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.docs (
  id text primary key,            -- 'plan', 'profile', 'deals'
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Při každé změně aktualizovat čas
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
do $$ declare t text; begin
  foreach t in array array['recipes','items','docs'] loop
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- Přístup: jen přihlášení uživatelé, jejichž e-mail je v members
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where lower(m.email) = lower(auth.jwt() ->> 'email'));
$$;

alter table public.members enable row level security;
alter table public.recipes enable row level security;
alter table public.items enable row level security;
alter table public.docs enable row level security;

drop policy if exists "members read self" on public.members;
create policy "members read self" on public.members for select to authenticated using (public.is_member());

do $$ declare t text; begin
  foreach t in array array['recipes','items','docs'] loop
    execute format('drop policy if exists "household all" on public.%I', t);
    execute format('create policy "household all" on public.%I for all to authenticated using (public.is_member()) with check (public.is_member())', t);
  end loop;
end $$;

-- Živé změny mezi telefony (odškrtnutí se hned ukáže i druhému)
do $$ begin
  begin alter publication supabase_realtime add table public.items; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.recipes; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.docs; exception when duplicate_object then null; end;
end $$;

-- Fotky jídel
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
  on conflict (id) do nothing;
drop policy if exists "household photos" on storage.objects;
create policy "household photos" on storage.objects for all to authenticated
  using (bucket_id = 'photos' and public.is_member())
  with check (bucket_id = 'photos' and public.is_member());

-- >>> SEM DOPLŇTE SVÉ DVA E-MAILY <<<
insert into public.members (email) values
  ('vas.email@example.com'),
  ('partner.email@example.com')
on conflict do nothing;
