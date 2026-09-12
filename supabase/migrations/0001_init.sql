-- ============================================================
-- TiendaAudioBlaze — esquema inicial (0001)
-- Tablas packs y orders, más las políticas RLS.
-- ============================================================

-- Catálogo de packs.
-- price_cents es la ÚNICA fuente de verdad del precio: la Edge Function
-- lo re-resuelve y valida contra el importe que devuelve PayPal (T2).
create table if not exists public.packs (
  id           text primary key,                 -- slug estable: 'ansiedad-01'
  name         text not null,
  description  text,
  cover_path   text,                             -- Fase 2: objeto en el bucket 'covers'
  price_cents  integer not null check (price_cents > 0),
  currency     text not null default 'USD',
  sort_order   integer not null default 100,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Pedidos. Una fila por order_id de PayPal; UNIQUE para idempotencia (T12):
-- un reintento del comprador sobre el mismo order no duplica la fila.
create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  paypal_order_id  text not null unique,
  pack_id          text references public.packs (id),
  buyer_name       text,
  buyer_email      text not null,                -- SIEMPRE del objeto payer de PayPal
  buyer_phone      text,                         -- opcional (T3)
  amount_cents     integer not null,
  currency         text not null,
  status           text not null default 'completed'
                     check (status in ('completed', 'refunded')),
  notify_status    text not null default 'pending'
                     check (notify_status in ('pending', 'sent', 'error')),
  delivered_at     timestamptz,                  -- se marca al entregar el enlace (T11)
  raw              jsonb,                        -- payload de PayPal, para auditoría
  created_at       timestamptz not null default now()
);

create index if not exists orders_pack_id_idx on public.orders (pack_id);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.packs  enable row level security;
alter table public.orders enable row level security;

-- El catálogo es público de solo lectura (solo packs activos).
-- Las policies no admiten IF NOT EXISTS: se dropean primero para que la
-- migración sea re-ejecutable (db push / reset con la tabla ya creada).
drop policy if exists "packs_public_read" on public.packs;
create policy "packs_public_read"
  on public.packs for select
  to anon, authenticated
  using (active = true);

-- orders: sin política para anon/authenticated. Solo la service-role
-- (que salta RLS) puede leer/escribir. Ninguna key pública toca pedidos.

-- ------------------------------------------------------------
-- Semilla: pack #1
-- ------------------------------------------------------------
-- cover_path NULL en MVP: la cubierta vive en assets/ (pública en GitHub Pages).
-- Para Fase 2 (Storage), rellenar con el objeto del bucket 'covers' y dejar
-- la policy de lectura pública de ese bucket.
insert into public.packs (id, name, description, cover_path, price_cents, currency, sort_order)
values (
  'ansiedad-01',
  'Pack Ansiedad 01',
  '6 sesiones guiadas para bajar la ansiedad y dormir mejor. Solo escuchar.',
  null,
  2700,                          -- 27,00 $ (precios en dólares)
  'USD',
  1
)
on conflict (id) do nothing;