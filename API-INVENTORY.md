# API inventory for the Flutter employee app (milestone M0)

Generated from `src/app/api/**/route.ts` (one row per route file). Re-run the script after changing routes.

Access: **session** = signed-in user (web cookie or mobile bearer token); **app-only (employee)** = refused to web
requests, passes for bearer tokens; **public** = no session; **cron secret** = scheduled jobs only.

## 1. Employee app endpoints (Flutter must call these)

| Route | Methods | Access |
|---|---|---|
| `/api/agreements` | GET, POST | session |
| `/api/agreements/respond` | POST | session; app-only (employee) |
| `/api/attendance` | GET, POST | session; app-only (employee) |
| `/api/attendance/[id]` | DELETE, GET, PATCH | session |
| `/api/attendance/[id]/excuse` | POST | session |
| `/api/attendance/[id]/photo` | GET | session |
| `/api/attendance/challenge` | GET | session; app-only (employee) |
| `/api/attendance/photos` | GET | session |
| `/api/auth/login` | POST | public |
| `/api/auth/logout` | POST | public |
| `/api/auth/me` | GET | session |
| `/api/auth/password/forgot` | POST | public |
| `/api/auth/password/reset` | POST | public |
| `/api/auth/password/verify` | POST | public |
| `/api/auth/profile` | PATCH | session |
| `/api/auth/register` | POST | public |
| `/api/auth/register/verify` | POST | public |
| `/api/company/logo` | DELETE, GET, POST | session |
| `/api/dashboard` | GET | session |
| `/api/feedback` | GET, POST | session |
| `/api/health` | GET | public |
| `/api/leaves` | GET, POST | session; app-only (employee) |
| `/api/leaves/[id]` | PATCH | session |
| `/api/mobile/auth/login` | POST | public |
| `/api/notice` | GET, POST | session; app-only (employee) |
| `/api/notifications` | GET, POST | session |
| `/api/salary` | GET, POST | session; app-only (employee) |
| `/api/salary/export` | GET | session |
| `/api/salary/overview` | GET | session; app-only (employee) |
| `/api/salary/slips` | GET, POST | session; app-only (employee) |
| `/api/salary/slips/[id]` | GET | session; app-only (employee) |

## 2. Other endpoints (admin, manager, specialist, billing, platform owner)

| Route | Methods | Access |
|---|---|---|
| `/api/admin/stats` | GET | session |
| `/api/app-downloads/[platform]` | GET | session (allowed when locked) |
| `/api/auth/specialist/login` | POST | public |
| `/api/billing` | GET | session (allowed when locked) |
| `/api/billing/checkout` | POST | session (allowed when locked) |
| `/api/billing/confirm` | POST | session (allowed when locked) |
| `/api/billing/subscribe` | POST | session (allowed when locked) |
| `/api/departments` | GET, POST | session |
| `/api/departments/[id]` | DELETE, PATCH | session |
| `/api/employees` | GET, POST | session |
| `/api/employees/[id]` | DELETE, PATCH | session |
| `/api/employees/[id]/promote` | POST | session |
| `/api/employees/username-check` | GET | session |
| `/api/locations` | GET, POST | session |
| `/api/locations/[id]` | DELETE, PATCH | session |
| `/api/maintenance/purge-photos` | ? | cron secret |
| `/api/managers` | GET, POST | session |
| `/api/managers/[id]` | PATCH | session |
| `/api/onboarding` | GET | session |
| `/api/onboarding/checkout` | POST | session |
| `/api/onboarding/confirm` | POST | session |
| `/api/onboarding/quote` | POST | session |
| `/api/onboarding/rate` | POST | session |
| `/api/payments/cashfree/webhook` | POST | public |
| `/api/payments/razorpay/webhook` | POST | public |
| `/api/reports` | GET | session |
| `/api/settings` | GET, POST | session |
| `/api/specialist` | GET | session; roles: onboarding_specialist |
| `/api/specialist/requests/[id]` | POST | session; roles: onboarding_specialist |
| `/api/superadmin` | GET, POST | session |
| `/api/superadmin/analytics` | GET | session |
| `/api/superadmin/app-links` | GET, PUT | session |
| `/api/superadmin/app-links/file` | DELETE, POST | session |
| `/api/superadmin/onboarding` | GET, PUT | session |
| `/api/superadmin/onboarding/specialists` | POST | session |
| `/api/superadmin/onboarding/specialists/[id]` | PATCH | session |
| `/api/superadmin/payments` | GET | session |
| `/api/superadmin/payments/[id]` | GET | session |
| `/api/superadmin/payments/export` | GET | session |
| `/api/superadmin/plans` | GET, POST | session |

Total route files: 71; employee app endpoints: 31.
