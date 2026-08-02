# Ferryspeed-TrailerHub

A Next.js dashboard for managing trailer bookings, arrivals, departures, and company trailers.

## Environment

Set these server-side variables for the AI Assistant and dashboard runtime:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `GMAIL_FROM_EMAIL`
- `GMAIL_FROM_NAME`

Set these additional private server-side variables for automation scheduler execution:

- `SUPABASE_SERVICE_ROLE_KEY`
- `AUTOMATION_SCHEDULER_TOKEN`

On Cloudflare, define the OpenAI variables in the Worker environment or secrets for the deployed app. Keep `OPENAI_API_KEY` private and do not expose it to the browser.
Define `SUPABASE_SERVICE_ROLE_KEY` and `AUTOMATION_SCHEDULER_TOKEN` as private Worker secrets/variables only. Do not prefix them with `NEXT_PUBLIC_`.

## Deployment

Use one deployment command for local and CI:

- `npm run deploy`

This command runs:

1. `npm run clean` (removes `.next` and `.open-next`)
2. `npm run cloudflare:build` (OpenNext Cloudflare build)
3. `wrangler deploy`
4. `npm run smoke:postdeploy`

Set `SMOKE_BASE_URL` before running deploy so the post-deployment smoke test can validate `/, /login, /dashboard`.

For AI Vessel Report email delivery, configure Gmail API server-side only:

- `GMAIL_CLIENT_ID`: OAuth client id used to obtain Gmail access tokens.
- `GMAIL_CLIENT_SECRET`: OAuth client secret used to obtain Gmail access tokens.
- `GMAIL_REFRESH_TOKEN`: Refresh token granted with `https://www.googleapis.com/auth/gmail.send` scope.
- `GMAIL_FROM_EMAIL`: Fixed sender email address (expected: `diogofx.04@gmail.com`).
- `GMAIL_FROM_NAME`: Fixed sender display name (expected: `Diogo Ferreira`).

Do not prefix these variables with `NEXT_PUBLIC_`. They must never be exposed to client-side bundles.
