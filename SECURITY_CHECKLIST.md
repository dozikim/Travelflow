# Traveloop Security Checklist

Implemented:

- Passwords are hashed with bcrypt.
- JWT sessions are signed and expire.
- Auth can use an httpOnly `traveloop_session` cookie.
- Unsafe API requests require an `X-CSRF-Token` matching the CSRF cookie.
- Login/signup/reset endpoints are rate limited.
- Login requires a server-issued CAPTCHA challenge.
- Helmet security headers are enabled.
- Input is sanitized server-side with `xss` and validated with `zod`.
- SQL uses parameterized queries.
- Admin APIs require authenticated `role = admin`.
- Blocked users cannot authenticate or use protected APIs.
- Audit logs record auth, admin, community, expense, and invoice actions.
- PDF invoice generation uses server-side trip and expense data.

Production hardening still recommended before public launch:

- Replace local `sql.js` with PostgreSQL and managed migrations.
- Use a real CAPTCHA provider.
- Send real email verification and password reset emails.
- Store JWT only in secure httpOnly cookies in production.
- Add refresh-token rotation and session revocation.
- Add antivirus/file scanning if direct uploads are enabled.
- Put uploads in object storage with signed URLs.
- Enable strict CSP after final asset domains are known.
- Add automated dependency scanning and SAST in CI.
- Add structured logs and alerting.
- Add E2E tests for RBAC and CSRF failures.
