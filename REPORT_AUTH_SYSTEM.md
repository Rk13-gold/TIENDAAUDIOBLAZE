# Informe: Sistema de autenticación con Supabase Auth

## Resumen
Se implementó un sistema de autenticación completo usando Supabase Auth, incluyendo:
- Tabla pública de perfiles extendida
- Trigger automático de creación de perfil
- Páginas de login y registro
- Protección de rutas que requieren autenticación

## 1. Migración SQL aplicada

Se creó la migración `supabase/migrations/0004_profiles.sql` que incluye:

### Tabla de perfiles públicos
```sql
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  full_name text,
  phone text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### Seguridad a nivel de filas (RLS)
- Se habilitó RLS en la tabla `public.profiles`
- Policies creadas:
  - `profiles_select_own`: usuarios pueden ver solo su propio perfil
  - `profiles_update_own`: usuarios pueden actualizar solo su propio perfil
  - `profiles_insert_own`: solo el trigger puede insertar (usuarios normales no insertan directamente)

### Trigger automático
```sql
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
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();
```
Este trigger crea automáticamente un perfil en `public.profiles` cada vez que se registra un nuevo usuario en `auth.users`, copiando el email, nombre completo y teléfono desde los metadata del usuario.

## 2. Páginas de autenticación

### login.html (existente)
- Formulario de email y contraseña
- Enlace a registro.html
- Preserva el parámetro `next` para redirección post-login
- Usa el SDK de Supabase JS v2 cargado directamente en la página
- El manejo del formulario está en `app.js` (función `bindAuthForms`)

### registro.html (existente)
- Formulario de email, contraseña, nombre (opcional) y teléfono (opcional)
- Enlace a login.html
- Preserva el parámetro `next`
- El manejo del formulario está en `app.js` (función `bindAuthForms`)

## 3. Lógica de protección de rutas implementada

### gracias.html
Se agregó un script de verificación de autenticación al inicio:
```javascript
(function () {
  const currentPath = window.location.pathname;
  if (!currentPath.endsWith('login.html') && !currentPath.endsWith('registro.html')) {
    const token = localStorage.getItem('sb://kxlbpxprtgupvzyxsuxn.supabase.co/auth-token') ||
                  sessionStorage.getItem('sb://kxlbpxprtgupvzyxsuxn.supabase.co/auth-token');
    if (!token) {
      const next = window.location.pathname + window.location.search;
      window.location.href = `login.html?next=${encodeURIComponent(next)}`;
      return;
    }
  }
})();
```
Esto verifica si existe una sesión de Supabase (en localStorage o sessionStorage). Si no hay sesión y no estamos en las páginas de login o registro, redirige a login.html preservando la página actual en el parámetro `next`.

### mis-packs.html
Ya estaba protegido mediante la lógica en `app.js`:
- La función `initMisPacks()` (llamada en `DOMContentLoaded`) llama a `requireLogin('mis-packs.html')`
- `requireLogin()` verifica la sesión y, si no existe, redirige a `login.html?next=mis-packs.html`
- Si no hay sesión, la función retorna temprano y no muestra contenido

### Flujo de autenticación en app.js
El archivo `app.js` contiene:
1. **Inicialización del cliente Supabase Auth** (función `getAuthClient`)
2. **Manejo de sesión** (funciones `getSession`, `requireLogin`, `redirectAfterAuth`)
3. **Vinculación de formularios** (función `bindAuthForms` para login y registro)
4. **Protección de rutas** (vía `requireLogin` en `initMisPacks` y en la lógica de compra)
5. **Persistencia de sesión** (usa el almacenamiento nativo de Supabase JS)

## Validación esperada

### Registro
1. Usuario completa el formulario en registro.html
2. Al enviar, se crea un usuario en `auth.users`
3. El trigger `on_auth_user_created` se dispara y crea una fila en `public.profiles`
4. El usuario es redirigido a la página indicada en `next` (o index.html por defecto)

### Login
1. Usuario ingresa credenciales en login.html
2. Al enviar, se verifica contra Supabase Auth
3. Si es válido, se crea una sesión y se guarda en localStorage/sessionStorage
4. El usuario es redirigido a la página indicada en `next` (o index.html por defecto)

### Rutas protegidas
- **gracias.html**: Si no hay sesión, redirige a login.html?next=gracias.html
- **mis-packs.html**: Si no hay sesión, redirige a login.html?next=mis-packs.html (vía app.js)
- Otras rutas (como index.html) no requieren autenticación y permanecen accesibles

## Archivos modificados/creados

| Archivo | Descripción |
|---|---|
| supabase/migrations/0004_profiles.sql | Migración que crea tabla de perfiles, RLS y trigger |
| gracias.html | Agregado script de verificación de autenticación en el encabezado |
| REPORT_AUTH_SYSTEM.md | Este informe |

## Próximos pasos

1. Aplicar la migración en Supabase:
   ```bash
   supabase db push
   ```

2. Probar el flujo completo:
   - Registrar un nuevo usuario
   - Verificar que se crea fila en `auth.users` y `public.profiles`
   - Iniciar sesión con ese usuario
   - Acceder a gracias.html y mis-packs.html sin ser redirigido
   - Cerrar sesión y verificar que se redirige a login al intentar acceder a rutas protegidas

3. (Opcional) Mejorar la experiencia de usuario:
   - Mostrar indicador de carga mientras se verifica la sesión
   - Personalizar mensajes de error de autenticación
   - Añadir funcionalidad de "olvidé mi contrasezza"

---
Informe generado el 2026-09-23