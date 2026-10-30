# 🏫 RBG School — College Management System

A professional, full-stack **School Management System** for Classes I–XII built with **Node.js**, **Express**, **MongoDB**, and a fully responsive **HTML/CSS/JS frontend dashboard**.

---

## 🚀 Features

### 👨‍💼 Admin
- Full dashboard with live stats & charts
- Student enrollment, promotion, TC management
- Faculty / staff management
- Attendance tracking & reports
- Marks entry, grade computation, result publishing
- Notice board (pinned, categorized)
- Fee management & collection
- Timetable management
- Export reports (PDF/Excel ready)

### 👩‍🏫 Faculty
- Mark class attendance (bulk)
- Enter subject marks
- View class roster & student profiles
- Post notices
- Apply for leave

### 👨‍🎓 Student / Parent
- View own attendance summary
- View published results / report card
- View notices
- Fee statement

---

## 🛠️ Tech Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js 18+ |
| Framework | Express.js 4 |
| Database | MongoDB + Mongoose |
| Auth | JWT (access token + httpOnly cookie) |
| Security | Helmet, CORS, Rate Limiting, Mongo-Sanitize |
| Validation | Express-Validator + Joi |
| Logging | Winston |
| Frontend | Vanilla HTML5 / CSS3 / ES6+ |
| Charts | Chart.js 4 |
| Icons | Font Awesome 6 |
| Fonts | Inter + Poppins (Google Fonts) |

---

## 📁 Project Structure

```
college-management-system/
├── config/          # DB + env config
├── controllers/     # Route handlers
├── models/          # Mongoose schemas
├── routes/          # Express routers
├── middleware/      # Auth, role, error, validate
├── services/        # Business logic layer
├── utils/           # Helpers (token, hash, features, logger)
├── validators/      # Input validation rules
├── seeds/           # Database seeder
├── public/          # Frontend (HTML, CSS, JS)
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── uploads/         # File uploads
├── logs/            # Winston log files
├── server.js        # App entry point
└── .env.example
```

---

## ⚡ Quick Start

### 1. Install dependencies
```bash
cd college-management-system
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your MongoDB URI and JWT secret
```

### 3. Seed the database
```bash
npm run seed
```

### 4. Start the server
```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

### 5. Open browser
```
http://localhost:5000
```

---

## 🔑 Demo Credentials

| Role    | Email                  | Password      |
|---------|------------------------|---------------|
| Admin   | admin@school.edu       | Admin@1234    |
| Faculty | faculty@school.edu     | Faculty@1234  |
| Student | student@school.edu     | Student@1234  |

---

## 📡 API Endpoints

### Auth
```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
PUT    /api/v1/auth/update-profile
PUT    /api/v1/auth/change-password
POST   /api/v1/auth/forgot-password
PUT    /api/v1/auth/reset-password/:token
```

### Students
```
GET    /api/v1/students             (Admin, Faculty)
POST   /api/v1/students             (Admin)
GET    /api/v1/students/:id         (Admin, Faculty)
PUT    /api/v1/students/:id         (Admin)
DELETE /api/v1/students/:id         (Admin)
GET    /api/v1/students/class/:class
POST   /api/v1/students/promote
PUT    /api/v1/students/:id/fees
GET    /api/v1/students/stats
GET    /api/v1/students/my-profile  (Student)
```

### Faculty
```
GET    /api/v1/faculty
POST   /api/v1/faculty
GET    /api/v1/faculty/:id
PUT    /api/v1/faculty/:id
DELETE /api/v1/faculty/:id
POST   /api/v1/faculty/:id/leave
GET    /api/v1/faculty/stats
```

### Attendance
```
POST   /api/v1/attendance/mark
GET    /api/v1/attendance/class/:class/:section
GET    /api/v1/attendance/student/:id/summary
GET    /api/v1/attendance/student/:id/monthly
GET    /api/v1/attendance/report
PUT    /api/v1/attendance/:id
GET    /api/v1/attendance/low
```

### Marks
```
POST   /api/v1/marks
GET    /api/v1/marks/student/:id
GET    /api/v1/marks/class
POST   /api/v1/marks/publish
POST   /api/v1/marks/rank
GET    /api/v1/marks/my-marks
GET    /api/v1/marks/stats
DELETE /api/v1/marks/:id
```

### Notices
```
GET    /api/v1/notices
POST   /api/v1/notices
GET    /api/v1/notices/pinned
GET    /api/v1/notices/:id
PUT    /api/v1/notices/:id
DELETE /api/v1/notices/:id
PUT    /api/v1/notices/:id/pin
GET    /api/v1/notices/type/:type
```

---

## 🔒 Security Features

- JWT authentication with httpOnly cookies
- Bcrypt password hashing (12 rounds)
- Account lockout after 5 failed login attempts
- Rate limiting (200 req/15min global, 20 req/15min for auth)
- MongoDB query injection sanitization
- XSS protection via Helmet
- Input validation on all routes
- Soft delete (data preservation)

---

## 📊 Grading System (CBSE)

| Marks % | Grade | Grade Point |
|---------|-------|-------------|
| 90–100  | A1    | 10 |
| 80–89   | A2    | 9  |
| 70–79   | B1    | 8  |
| 60–69   | B2    | 7  |
| 50–59   | C1    | 6  |
| 40–49   | C2    | 5  |
| 33–39   | D     | 4  |
| Below 33| E (Fail) | 0 |

---

## 📝 License

MIT License — Free to use for educational purposes.
