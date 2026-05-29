-- Créer la table issuers
create table if not exists public.issuers (
  id uuid default gen_random_uuid() primary key,
  ticker text not null,
  name text not null,
  sector text default '',
  investor_relations_url text,
  docs jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

-- Activer Row Level Security
alter table public.issuers enable row level security;

-- Politique : lecture publique (collaboratif, pas d'auth)
create policy "Lecture publique"
  on public.issuers for select
  using (true);

-- Politique : insertion publique
create policy "Insertion publique"
  on public.issuers for insert
  with check (true);

-- Politique : mise à jour publique
create policy "Mise à jour publique"
  on public.issuers for update
  using (true);

-- Politique : suppression publique
create policy "Suppression publique"
  on public.issuers for delete
  using (true);

-- Activer Realtime sur la table
alter publication supabase_realtime add table public.issuers;
