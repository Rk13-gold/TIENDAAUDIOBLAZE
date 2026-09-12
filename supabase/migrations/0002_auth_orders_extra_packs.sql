-- ============================================================
-- TiendaAudioBlaze — esquema 0002: cuentas + más packs
-- · orders.user_id (null): vincula la venta a la cuenta que la
--   compró. Nullable de propósito: el fundador hace reconciliaciones
--   manuales insertando filas sin conocer el UUID.
-- · RLS orders_owner_select: cada usuario ve SOLO sus pedidos
--   (caja fuerte: el insert sigue siendo solo service-role).
-- · Seed: 3 packs nuevos (precios distintos).
-- ============================================================

alter table public.orders
  add column if not exists user_id uuid references auth.users (id) on delete set null;

create index if not exists orders_user_id_idx on public.orders (user_id);

-- Cada usuario lee sus propios pedidos (para "mis-packs").
-- Las policies no admiten IF NOT EXISTS: drop + create para re-ejecutar.
drop policy if exists "orders_owner_select" on public.orders;
create policy "orders_owner_select"
  on public.orders for select
  to authenticated
  using (user_id = auth.uid());

-- ------------------------------------------------------------
-- Seed: packs 2, 3 y 4 (precios distintos; cubiertas en assets/covers/)
-- ------------------------------------------------------------
insert into public.packs (id, name, description, cover_path, price_cents, currency, sort_order)
values (
  'sueno-profundo',
  'Pack Sueño Profundo',
  'Guias para conciliar el sueño, soltar el día y dormir de un tirón. Solo escuchar.',
  null,
  2700,                          -- 27,00 $
  'USD',
  2
)
on conflict (id) do nothing;

insert into public.packs (id, name, description, cover_path, price_cents, currency, sort_order)
values (
  'autoestima',
  'Pack Autoestima',
  'Sesiones para callar al crítico interno y recuperar tu confianza. Solo escuchar.',
  null,
  1900,                          -- 19,00 $
  'USD',
  3
)
on conflict (id) do nothing;

insert into public.packs (id, name, description, cover_path, price_cents, currency, sort_order)
values (
  'estres-laboral',
  'Pack Estrés Laboral',
  'Herramientas de bolsillo para el agobio del trabajo: pausas, respiración y límites. Solo escuchar.',
  null,
  3500,                          -- 35,00 $
  'USD',
  4
)
on conflict (id) do nothing;