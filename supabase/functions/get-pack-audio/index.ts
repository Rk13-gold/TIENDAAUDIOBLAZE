import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Rate limiting: max 30 requests per hour per user
const RATE_LIMIT_COUNT = 30
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour

// In-memory store for rate limiting (in production, use Redis or similar)
// For simplicity in this example, we'll use a Map - note this resets on function restart
const requestCounts = new Map<string, { count: number; resetTime: number }>()

function checkRateLimit(userId: string): boolean {
  const now = Date.now()
  const userData = requestCounts.get(userId)

  if (!userData || now > userData.resetTime) {
    // First request or window expired
    requestCounts.set(userId, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW_MS
    })
    return true
  }

  if (userData.count >= RATE_LIMIT_COUNT) {
    return false
  }

  userData.count++
  return true
}

function cleanUpRateLimitStore() {
  const now = Date.now()
  for (const [userId, data] of requestCounts.entries()) {
    if (now > data.resetTime) {
      requestCounts.delete(userId)
    }
  }
}

// Call cleanup occasionally (every 10 requests)
let cleanupCounter = 0

function maybeCleanup() {
  cleanupCounter++
  if (cleanupCounter >= 10) {
    cleanupCounter = 0
    cleanUpRateLimitStore()
  }
}

function getSupabaseAdminClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey)
}

// UUID validation (same as verify-payment)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') +
      '='.repeat((4 - (part.length % 4)) % 4)
    const bin = atob(b64)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractUserId(req: Request): string | null {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const payload = token ? decodeJwtPayload(token) : null
  const sub = payload?.sub
  return typeof sub === 'string' && UUID_RE.test(sub) ? sub : null
}

interface Payload {
  audio_asset_id: string
}

interface AudioAsset {
  id: string
  product_id: string
  titulo: string
  storage_path: string
  activo: boolean
}

// CORS: origen del front (GitHub Pages). En producción, el dominio real.
const ALLOWED_ORIGIN = Deno.env.get('CORS_ORIGIN') ?? 'https://rk13-gold.github.io';

async function handler(req: Request): Promise<Response> {
  // Clean up rate limit store occasionally
  maybeCleanup()

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    })
  }

  // Only POST allowed
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Extract user ID from JWT
  const userId = extractUserId(req)
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Authentication required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Check rate limit
  if (!checkRateLimit(userId)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Parse JSON body
  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { audio_asset_id } = payload

  if (!audio_asset_id || typeof audio_asset_id !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing audio_asset_id' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Validate UUID format for audio_asset_id
  if (!UUID_RE.test(audio_asset_id)) {
    return new Response(JSON.stringify({ error: 'Invalid audio asset ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabase = getSupabaseAdminClient()

    // 1. Get the audio asset details
    const { data: asset, error: assetError } = await supabase
      .from('audio_assets')
      .select('id, product_id, titulo, storage_path, activo')
      .eq('id', audio_asset_id)
      .single()

    if (assetError || !asset) {
      // Generic error to not reveal whether asset exists or not
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!asset.activo) {
      // Generic error
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 2. Verify the user has a valid purchase for the product
    // Valid purchase: orders with status = 'completed' and user_id = auth.uid()
    const { data: purchase, error: purchaseError } = await supabase
      .from('orders')
      .select('id')
      .eq('pack_id', asset.product_id)
      .eq('user_id', userId)
      .eq('status', 'completed')
      .maybeSingle() // Expect at most one row

    if (purchaseError && !purchaseError.message.includes('0 rows')) {
      // Handle actual database errors
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // If no purchase found, return generic error
    if (!purchase) {
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 3. Generate signed URL for the audio file (300 seconds expiration)
    const { data: urlData, error: urlError } = await supabase
      .storage
      .from('packs-private')
      .createSignedUrl(asset.storage_path, 300)

    if (urlError || !urlData?.signedUrl) {
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 4. Return the signed URL
    return new Response(JSON.stringify({ signedUrl: urlData.signedUrl }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('get-pack-audio error:', err)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// Register the handler with Deno.serve for the Edge Function runtime
Deno.serve.handler(handler)