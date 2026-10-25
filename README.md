# NOC Check-in App

Attendance tracking system for NOC Ops team — check-in/out with photo, real-time dashboard, Discord/Teams notifications.

![Demo](./acccs.png)

## Features

| Feature | Description |
|---------|-------------|
| **Secure Login** | Team code + employee name dropdown (10 staff) |
| **Check-in / Check-out** | Camera capture → photo + timestamp → stored centrally |
| **Real-time Dashboard** | See who checked in today, your open shift |
| **Attendance Export** | Date range filter → HTML table (Excel/Sheets compatible) |
| **Discord Notifications** | Auto-post check-in/out embeds with photo |
| **Microsoft Teams** | Auto-post Adaptive Cards with attendance details |
| **Responsive** | Mobile-first design, works on phones and desktops |

## Screenshots

### Login
Team code + name selection with dropdown.

### Dashboard
Today's attendance list with check-in/check-out status.

### Export
Date range picker → downloads HTML attendance report table.

## Quick Start

### Local Development

```bash
# Clone repo
git clone https://github.com/diamo6/Acces.git
cd Acces

# Start local dev server (SQLite, no Cloudflare needed)
python dev-server.py

# Open in browser
http://127.0.0.1:8080
```

**Default team code:** `LOCAL-TEST-CODE` (set via `TEAM_CODE` env var or `dev-server.py`)

### Production Deploy

#### Option 1: Cloudflare Pages
```bash
# Install Wrangler CLI
npm install -g wrangler

# Deploy
cd site
wrangler deploy
```

#### Option 2: Cloudflare Workers + D1
```bash
# Create D1 database
wrangler d1 create checkin-db

# Bind and deploy
wrangler deploy --env production
```

#### Option 3: Manual Upload
Upload `site/worker.js` and `site/manifest.json` to your Cloudflare Worker.

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  index.html   │────▶│  Cloudflare      │────▶│  D1 Database     │
│  (frontend)   │◀────│  Worker (API)    │◀────│  (SQLite)        │
└──────────────┘     └────────┬─────────┘     └─────────────────┘
                              │
                      ┌───────┴───────┐
                      │               │
              ┌───────▼──────┐  ┌────▼────────┐
              │  Discord     │  │ Microsoft   │
              │  Webhook     │  │ Teams       │
              └──────────────┘  └─────────────┘
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/session` | Authenticate with team code → `{"ok": true}` |
| POST | `/api/attendance` | Check-in: name, shift, status, photo, thumb |
| POST | `/api/attendance/:id/checkout` | Check-out: photo, thumb |
| GET | `/api/attendance` | Today's attendance records |
| GET | `/api/attendance?all=1&from=&to=` | Export date range |
| GET | `/api/attendance/:id` | Single record detail |
| GET | `/api/recent?limit=20` | Recent attendance (any date) |
| POST | `/api/notify/discord` | Server-side Discord webhook dispatch |
| POST | `/api/notify/teams` | Server-side Teams webhook dispatch |

**Auth header:** `x-team-code: <your-team-code>`

## Security

| Protection | How |
|------------|-----|
| **No secrets in client** | Webhook URLs stored in server env only |
| **Timing-safe auth** | `safe_equal()` prevents timing attacks |
| **Input sanitization** | `clean_text()` truncates + strips all inputs |
| **Photo validation** | `isPhoto()` / `isThumb()` verify JPEG format |
| **Origin checking** | `originAllowed()` validates same-origin POST |
| **Parameterized SQL** | All queries use `?` bind parameters |

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TEAM_CODE` | Auth code for login | (required) |
| `DISCORD_WEBHOOK_URL` | Discord webhook URL | (required) |
| `TEAMS_WEBHOOK_URL` | Teams webhook URL | (required) |

### Employee Roster

Edit `roster.json` or `noc_roster.json` to add/remove staff names. Names populate the login dropdown.

## Employee Roster (10)

1. Apisit Kogram
2. Phanuphong Lachantha
3. Phanuwat Keawon
4. Phudtan Sodsai
5. Pipatpong Srisara
6. Prapatsorn Sodjaimai
7. Sasiwan Laohapornsvan
8. Supaporn Khumsombat
9. Thanachot Phuttiwarakul
10. Tinapat Sangdang

## Shifts

| Shift | Hours | Type |
|-------|-------|------|
| 07:00–19:00 | 12h | Morning (เช้า) |
| 08:00–20:00 | 12h | Evening (บ่าย) |
| 19:00–07:00 | 12h | Night (ดึก) |
| 20:00–08:00 | 12h | Night (ดึก) |

## Status Types

| Status | Description |
|--------|-------------|
| On-site | On-site at operations center |
| Remote-work | Remote work (ทางไกล) |

## File Structure

```
Acces/
├── index.html          # Frontend (SPA, ~80KB, single file)
├── site/
│   ├── worker.js       # Cloudflare Worker API
│   ├── wrangler.toml   # Wrangler config
│   └── manifest.json   # PWA manifest
├── dev-server.py       # Local dev server (Python + SQLite)
├── server.py           # Legacy server
├── roster.json         # Employee names list
├── config.json         # App config
├── workers.json        # Worker config
├── styles.css          # Additional styles
├── ac2.png, ac3.png    # Brand images
├── .gitignore          # Git ignore rules
└── README.md
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Login fails after update | Clear localStorage: `localStorage.clear()` in DevTools |
| Dropdown not showing | Check browser console for errors |
| Export API 401 | Verify `x-team-code` header matches |
| Photo upload fails | Check image is JPEG, < 700KB (base64) |
| Local server crashes | Kill process, restart: `python dev-server.py` |

## License

Internal use — NOC Ops Team
