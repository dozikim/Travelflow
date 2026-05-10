# Traveloop API

Base URL: `http://localhost:4100/api`

## Security

- `GET /security/csrf` returns a CSRF token and sets `traveloop_csrf`.
- `GET /security/captcha` returns a math challenge for login.
- Send `X-CSRF-Token` on POST/PUT/DELETE.
- Protected endpoints require `Authorization: Bearer <jwt>` or the httpOnly session cookie.

## Auth

- `POST /auth/signup`
- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/forgot`
- `POST /auth/reset`
- `GET /auth/verify/:token`
- `GET /me`
- `PUT /me`
- `DELETE /me`

## Trips

- `GET /dashboard`
- `GET /trips`
- `POST /trips`
- `GET /trips/:id`
- `PUT /trips/:id`
- `DELETE /trips/:id`
- `POST /trips/:id/stops`
- `PUT /stops/:id`
- `DELETE /stops/:id`
- `POST /trips/:id/activities`
- `DELETE /trip-activities/:id`

## Community

- `GET /community/posts?q=`
- `POST /community/posts`
- `POST /community/posts/:id/like`
- `GET /community/posts/:id/comments`
- `POST /community/posts/:id/comments`

## Expenses and Invoices

- `GET /trips/:id/expenses`
- `POST /trips/:id/expenses`
- `DELETE /expenses/:id`
- `GET /invoices`
- `POST /trips/:id/invoices`
- `GET /invoices/:id/pdf`

## Admin

Admin role required.

- `GET /admin/analytics`
- `GET /admin/staff`
- `PUT /admin/staff/:id`
- `GET /admin/users/:id`
- `DELETE /admin/users/:id`
- `GET /admin/trips`
- `DELETE /admin/trips/:id`
- `GET /admin/community`
- `PUT /admin/community/:id`
- `GET /admin/destinations`
- `POST /admin/destinations`
- `GET /admin/settings`
- `PUT /admin/settings/:key`
- `GET /admin/feedback`

## Database Schema Updates

Added:

- `users.role`, `users.staff_status`, `users.blocked`, `users.email_verified`
- `community_posts`
- `community_comments`
- `expenses`
- `invoices`
- `destinations`
- `feedback_reports`
- `audit_logs`
- `system_settings`

Indexes added for trips, stops, expenses, community posts, and audit logs.
