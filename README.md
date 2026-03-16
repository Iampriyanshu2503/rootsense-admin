# Rootsense Admin Console

Separate admin panel for Synergy Rootsense — runs on port 3001.

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in values
cp .env.local.example .env.local

# 3. Run dev server (port 3001)
npm run dev
```

Open: http://localhost:3001

## Kinde Setup

Create a **separate** Kinde application for admin at https://app.kinde.com

Add these URLs in Kinde → your app → Settings → URLs:
- Allowed callback URL: `http://localhost:3001/api/auth/kinde_callback`
- Allowed logout URL:   `http://localhost:3001`

## Access Control

Add your admin email(s) to `.env.local`:
```
ADMIN_EMAILS=you@email.com,colleague@email.com
```

Anyone not in this list gets redirected to `/unauthorized`.

## Project Structure

```
app/
├── admin/
│   ├── page.tsx           # Search page (entry)
│   ├── dashboard/
│   │   └── page.tsx       # Full dashboard
│   └── user/[id]/
│       └── page.tsx       # User edit page
├── api/auth/[kindeAuth]/
│   └── route.ts           # Kinde auth handler
├── unauthorized/
│   └── page.tsx           # Access denied page
├── layout.tsx
└── page.tsx               # Redirects to /admin
middleware.ts              # Auth + email whitelist guard
```

## Supabase

Uses the **same** Supabase project as the main app.
The admin client uses the **service role key** which bypasses RLS — keep it server-side only.
