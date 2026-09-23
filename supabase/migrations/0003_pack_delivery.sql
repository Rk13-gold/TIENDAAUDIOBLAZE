-- ============================================================
-- TiendaAudioBlaze — esquema 0003: entrega de packs protegidos
-- · Tabla audio_assets: archivos de audio por pack
-- · Bucket privado 'packs-private' para almacenar los audios
-- · Edge Function get-pack-audio: firma URLs temporales tras validar compra
-- · RLS: solo se pueden leer audio_assets si el usuario tiene una compra válida del pack
-- ============================================================

-- Extensión uuid-ossp (si no estuviera ya creada por migraciones previas)
create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- Tabla: audio_assets
-- ------------------------------------------------------------
create table if not exists public.audio_assets (
  id              uuid primary key default uuid_generate_v4(),
  product_id      text not null references public.packs (id) on delete cascade,
  titulo          text not null,
  storage_path    text not null,   -- ruta dentro del bucket, ej: packs/ansiedad-01/audio-01.mp3
  orden           integer not null default 1,
  duracion_seg    integer,         -- opcional, en segundos
  activo          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- Índices útiles
create index if not exists audio_assets_product_id_idx on public.audio_assets (product_id);
create index if not exists audio_assets_orden_idx on public.audio_assets (product_id, orden);

-- ------------------------------------------------------------
-- RLS para audio_assets
-- ------------------------------------------------------------
alter table public.audio_assets enable row level security;

-- Política: lectura pública? No. Solo lectura si el usuario tiene una compra válida del producto.
-- Compra válida: órdenes con status = 'completed' y user_id = auth.uid()
drop policy if exists "audio_assets_select_by_purchase" on public.audio_assets;
create policy "audio_assets_select_by_purchase"
  on public.audio_assets for select
  using (
    exists (
      select 1 from public.orders o
      where o.pack_id = audio_assets.product_id
        and o.status = 'completed'
        and o.user_id = auth.uid()
    )
  );

-- El producto (packs) sigue siendo de lectura pública (como antes)
-- No se modifica la policy existente packs_public_read.

-- ------------------------------------------------------------
-- Bucket privado: packs-private
-- ------------------------------------------------------------
-- En Supabase, los buckets se pueden crear vía SQL usando el esquema storage.
-- Verificamos si el bucket ya existe; si no, lo creamos como privado.
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'packs-private') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('packs-private', 'packs-private', false, 52428800, '{audio/mpeg}');
  end if;
end $$;

-- Nota: Para crear la carpeta raíz dentro del bucket (opcional) no es necesario;
-- los objetos se crearán con la ruta completa al subir.

-- ------------------------------------------------------------
-- Comentarios
-- ------------------------------------------------------------
comment on table public.audio_assets is 'Archivos de audio asociados a cada pack. Los archivos reales viven en el bucket privado packs-private.';
comment on column public.audio_assets.product_id is 'FK hacia public.packs (id).';
comment on column public.audio_assets.storage_path is 'Ruta relativa dentro del bucket packs-private, ej: packs/ansiedad-01/audio-01.mp3.';
comment on column public.audio_assets.orden is 'Orden de reproducción dentro del pack (1-based).';
comment on column public.audio_assets.duracion_seg is 'Duración en segundos (opcional).';
comment on column public.audio_assets.activo is 'Si el activo está disponible para descarga.';