# Ferryspeed-TrailerHub

A Next.js dashboard for managing trailer bookings, arrivals, departures, and company trailers.

## Environment

Set these server-side variables for the AI Assistant and dashboard runtime:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

On Cloudflare, define the OpenAI variables in the Worker environment or secrets for the deployed app. Keep `OPENAI_API_KEY` private and do not expose it to the browser.
