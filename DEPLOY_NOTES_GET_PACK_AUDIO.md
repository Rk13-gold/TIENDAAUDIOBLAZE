# Deploy Notes for get-pack-audio Edge Function

## Prerequisites
1. Supabase project with:
   - `audio_assets` table created (via migration 0003_pack_delivery.sql)
   - `packs-private` storage bucket created (private, audio/mpeg only)
   - Service role key available

## Deployment Steps

### 1. Apply the migration
```bash
supabase db push --linked --max-size 10MB
# Or manually run supabase/migrations/0003_pack_delivery.sql
```

### 2. Deploy the Edge Function
```bash
supabase functions deploy get-pack-audio --no-verify-jwt
```

### 3. Environment Variables
Ensure these are set in your Supabase project (Settings > API):
- `SUPABASE_URL` (should be automatic)
- `SUPABASE_SERVICE_ROLE_KEY` (should be automatic for Edge Functions)

### 4. CORS Configuration
The function sets CORS headers to allow all origins (`*`). In production, consider restricting to your domain.

### 5. Rate Limiting Notes
- Current implementation uses in-memory rate limiting (resets on function restart)
- For production, consider using Redis or Supabase database for persistent rate limiting
- Limit: 30 requests per hour per user

## Testing with curl

### Get a signed URL for an audio asset
```bash
curl -X POST 'https://[YOUR_PROJECT_ID].supabase.co/functions/v1/get-pack-audio' \
  -H 'Authorization: Bearer [USER_JWT_TOKEN]' \
  -H 'Content-Type: application/json' \
  -d '{"audio_asset_id": "[AUDIO_ASSET_UUID]"}'
```

### Example with actual values
```bash
curl -X POST 'https://abcdefg.supabase.co/functions/v1/get-pack-audio' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' \
  -H 'Content-Type: application/json' \
  -d '{"audio_asset_id": "a1b2c3d4-e5f6-7890-g1h2-i3j4k5l6m7n8"}'
```

### Expected Response
```json
{
  "signedUrl": "https://[YOUR_PROJECT_ID].supabase.co/storage/v1/object/sign/packs-private/ansiedad-01/audio-01.mp3?token=..."
}
```

### Error Responses
- 401: Authentication required (missing/invalid JWT)
- 400: Invalid JSON, missing audio_asset_id, invalid UUID format
- 429: Too many requests (rate limit exceeded)
- 500: Internal error (generic - does not reveal if asset exists or not)

## Integration with Frontend
In your audio player component:
1. After successful payment, store the audio asset IDs associated with the purchased pack
2. When user wants to play an audio, call get-pack-audio with the asset ID
3. Use the returned signedUrl as the src for your audio element
4. Signed URLs expire in 300 seconds (5 minutes) - generate new ones as needed

## Security Notes
- The function validates that the user has a completed purchase for the pack associated with the audio asset
- Generic error messages prevent information leakage about asset existence
- Audio files are stored in a private bucket and only accessible via signed URLs
- JWT authentication ensures only authenticated users can request URLs