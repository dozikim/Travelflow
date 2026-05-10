# Traveloop

Traveloop is a full-stack travel planning platform with trip planning, itinerary management, community memories, expense tracking, PDF invoices, and an admin panel with role-based access control.

## Setup

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install
node server/seed.js
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dev
```

Open `http://localhost:5173`.

## Demo Credentials

Admin:

```text
admin@traveloop.test
admin12345
```

Traveler:

```text
mira@traveloop.test
traveloop123
```

## Updated Folder Structure

```text
traveloop/
  server/
    auth.js
    catalog.js
    db.js
    index.js
    security.js
    seed.js
    traveloop.sqlite
  src/
    main.jsx
    styles.css
  index.html
  package.json
  vite.config.js
  .env.example
  README.md
  SECURITY_CHECKLIST.md
  API.md
```

## Main Features

- JWT auth with httpOnly session cookie fallback
- CSRF token enforcement on unsafe requests
- Login CAPTCHA and rate limiting
- bcrypt password hashing
- Admin role with protected APIs
- User block/unblock, delete, staff privilege management
- Community posts with image URLs, likes, comments, moderation status
- Real expenses persisted by trip
- Backend-generated PDF invoices with trip/user/expense data
- Audit logs for sensitive actions
- Destination management and featured location data

## Notes

The local database uses `sql.js` for zero-native-build local development. For production, move the repository layer to PostgreSQL, keep the parameterized query pattern, and run migrations through a migration tool.
