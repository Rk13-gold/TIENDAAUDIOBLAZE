-- ============================================================
-- TiendaAudioBlaze — esquema 0004: perfiles de usuario
-- · Tabla pública para metadata adicional (nombre, teléfono, etc.)
-- · Trigger automático que crea el perfil al registrarse un usuario
-- ============================================================

-- Tabla pública de perfiles (extiende auth.users)
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  full_name text,
  phone text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Row Level Security: cada usuario solo puede ver/editar su propio perfil
alter table public.profiles enable row level security;

-- Policy: SELECT propio perfil
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

-- Policy: UPDATE propio perfil
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- Policy: INSERT propio perfil (solo para el trigger, usuarios normales no insertan directamente)
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Función trigger: crear perfil al insertar un nuevo usuario en auth.users
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do nothing; -- idempotente por si ya existe
  return new;
end;
$$ language plpgsql security definer;

-- Trigger: después de insertar en auth.users, crear perfil
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();