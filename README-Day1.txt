# Day 1 Patch
This patch implements real endpoints in `services/api/functions/src/index.ts`:

- `POST /api/v1/auth/ensureUser` — creates/fetches a user, assigns role ID (OGC/OGD/OGP...), sets custom claims.
- `POST /api/v1/fares/quote` — simple fare calculation with km input (default 100km).
- `POST /api/v1/rides/createDraft` — creates a draft ride document.

## Apply
Unzip over your repo root so it replaces the file:
`services/api/functions/src/index.ts`

Then run:
1. `pnpm --filter @og/services-api build`
2. `pnpm dev:api` (restart emulators)
3. Test the endpoints.
