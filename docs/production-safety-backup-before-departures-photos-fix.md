# Production Safety Snapshot (Before Departures + Photos Fix)

Date: 2026-07-27

## Git Baseline
- Current branch: main
- Commit (full): 19355b37fba50af3c528054af1078a73a4207952
- Commit (short): 19355b3

## Safety Anchors
- Backup branch: backup/before-departures-photos-fix
- Backup tag: backup-before-departures-photos-fix

## Supabase Linkage Check (No secrets exposed)
- Env files detected: .env.example, .env.local
- NEXT_PUBLIC_SUPABASE_URL appears configured
- Project ref (masked): mdbkgd***
- NEXT_PUBLIC_SUPABASE_ANON_KEY appears configured (masked)

## Scope of Intended Code Changes (minimum required)
- src/app/dashboard/departure/page.tsx
- src/app/dashboard/vessel-operations/[id]/boat-check/[vesselTrailerId]/page.tsx
- src/components/mobile/supervisor-mobile-dashboard.tsx (only if needed for upload consistency)

## Safety Constraints Applied
- No destructive SQL commands.
- No data reset.
- No mass updates/deletes.
- No production writes during diagnosis phase.
