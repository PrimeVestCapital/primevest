# PrimeVest Capital – Full-Stack Investment Platform

A production-ready investment management platform with a React frontend and Node.js/Express backend, featuring JWT authentication, SQLite persistence, PIN-verified withdrawals, admin dashboard, and email notifications.

---

## Project Structure

```
primevest/
├── primevest-backend/          # Node.js + Express API
│   ├── db/
│   │   └── database.js         # SQLite schema & connection
│   ├── middleware/
│   │   ├── auth.js             # JWT auth & role guards
│   │   └── errorHandler.js     # Global error handling
│   ├── routes/
│   │   ├── auth.js             # Register, Login, Refresh, Logout
│   │   ├── users.js            # Profile, Transactions, Withdrawal
│   │   └── admin.js            # Admin: clients, portfolio, notify
│   ├── scripts/
│   │   └── seed.js             # Database seeder (demo data)
│   ├── utils/
│   │   ├── jwt.js              # Token generation & verification
│   │   └── email.js            # Nodemailer + HTML email templates
│   ├── .env.example            # Environment config template
│   ├── package.json
│   └── server.js               # Express app entry point
│
└── primevest-frontend/         # React + Vite frontend
    ├── public/
    │   └── favicon.svg
    ├── src/
    │   ├── App.jsx             # Full app (Auth, User Dashboard, Admin)
    │   └── main.jsx            # React entry point
    ├── .env.example
    ├── index.html
    ├── package.json
    └── vite.config.js          # Vite config with API proxy
```

---

## Quick Start

### 1. Backend Setup

```bash
cd primevest-backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env – set your JWT secrets and email credentials

# Seed demo data
npm run seed

# Start server (development)
npm run dev

# Start server (production)
npm start
```

Backend runs on **http://localhost:5000**

### 2. Frontend Setup

```bash
cd primevest-frontend

# Install dependencies
npm install

# Configure environment (optional – proxy handles /api in dev)
cp .env.example .env

# Start development server
npm run dev

# Build for production
npm run build
npm run preview
```

Frontend runs on **http://localhost:3000**

---

## Default Credentials

| Role  | Email                    | Password    | PIN  |
|-------|--------------------------|-------------|------|
| Admin | admin@primevest.com      | Admin@2024  | —    |
| Demo  | alex@example.com         | Demo@1234   | 1234 |

---

## API Endpoints

### Auth (`/api/auth`)
| Method | Route       | Description               | Auth |
|--------|-------------|---------------------------|------|
| POST   | /register   | Create new account        | No   |
| POST   | /login      | Login (user or admin)     | No   |
| POST   | /refresh    | Refresh access token      | No   |
| POST   | /logout     | Invalidate session        | Yes  |

### Users (`/api/users`) – requires user JWT
| Method | Route          | Description                      |
|--------|----------------|----------------------------------|
| GET    | /me            | Get full profile + transactions  |
| GET    | /transactions  | Paginated transaction history    |
| POST   | /withdraw      | Withdraw (PIN verified)          |
| PUT    | /profile       | Update name/password/PIN         |

### Admin (`/api/admin`) – requires admin JWT
| Method | Route                          | Description                  |
|--------|--------------------------------|------------------------------|
| GET    | /dashboard                     | Stats + recent transactions  |
| GET    | /users                         | List all clients             |
| GET    | /users/:id                     | Single client detail         |
| PUT    | /users/:id/portfolio           | Update balance/profit/plan   |
| POST   | /users/:id/deposit             | Manual deposit               |
| POST   | /users/:id/credit-profit       | Credit profit                |
| PUT    | /users/:id/status              | Activate/deactivate account  |
| POST   | /notify                        | Send email notification      |
| GET    | /notifications                 | Notification log             |

---

## Security Features

- **JWT Access Tokens** (7-day) with automatic refresh (30-day rotation)
- **bcrypt** password & PIN hashing (cost factor 12/10)
- **Rate limiting** on auth endpoints (10 req / 15min)
- **Helmet** security headers
- **CORS** with allowlist
- **Input validation** on all endpoints
- **SQL injection protection** via parameterised queries (better-sqlite3)
- **Timing-safe** login (prevents email enumeration)
- **Session auto-restore** on page reload via stored tokens

---

## Email Configuration

The backend uses Nodemailer. In **development**, emails are logged to the console (no SMTP needed). In **production**, configure SMTP in `.env`:

```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your@gmail.com
EMAIL_PASS=your_app_password
EMAIL_FROM="PrimeVest Capital <noreply@primevest.com>"
```

For **Gmail**: create an [App Password](https://myaccount.google.com/apppasswords) (2FA required).

For production, services like [Resend](https://resend.com), [SendGrid](https://sendgrid.com), or [Mailgun](https://mailgun.com) are recommended.

---

## Production Deployment

### Backend
```bash
NODE_ENV=production
PORT=5000
JWT_SECRET=<strong-random-64-char-string>
JWT_REFRESH_SECRET=<strong-random-64-char-string>
FRONTEND_URL=https://yourdomain.com
DB_PATH=/var/data/primevest.db
```

Use a process manager like **PM2**:
```bash
npm install -g pm2
pm2 start server.js --name primevest-api
pm2 save && pm2 startup
```

### Frontend
```bash
# In primevest-frontend/.env
VITE_API_URL=https://api.yourdomain.com/api

npm run build
# Deploy /dist to Nginx, Vercel, Netlify, etc.
```

### Nginx Reverse Proxy (example)
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Frontend
    root /path/to/primevest-frontend/dist;
    index index.html;
    try_files $uri $uri/ /index.html;

    # Backend API
    location /api {
        proxy_pass http://localhost:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## Technology Stack

| Layer     | Technology                        |
|-----------|-----------------------------------|
| Frontend  | React 18, Vite, vanilla CSS       |
| Backend   | Node.js, Express 4                |
| Database  | SQLite (better-sqlite3) – WAL mode|
| Auth      | JWT (jsonwebtoken) + bcryptjs     |
| Email     | Nodemailer + HTML templates       |
| Security  | Helmet, express-rate-limit, CORS  |
