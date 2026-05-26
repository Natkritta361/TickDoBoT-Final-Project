# 🤖 TickDoBot — LINE Group Task Manager

> A full-stack chatbot system for real-time task management inside LINE groups, built with Node.js, Express, Firebase Firestore, and the LINE Messaging API.

---

## 📌 Project Overview

**TickDoBot** is a productivity bot designed to streamline team task tracking directly inside LINE group chats — without requiring any external apps or sign-ups. Group members can create tasks, assign them to specific people, submit proof of completion, and view a live leaderboard, all through LINE's native interface.

This project was built to solve a common problem in student project groups and small teams: tasks get lost in chat threads and there's no easy way to track accountability. TickDoBot brings structure and gamification into a familiar messaging environment.

---

## 🏗️ System Architecture

The application follows a **3-Tier Architecture**:

```
┌─────────────────────────────────────────────────┐
│  Frontend (LIFF — LINE In-App Browser)          │
│  Vanilla HTML / CSS / JavaScript (SPA)          │
└───────────────────┬─────────────────────────────┘
                    │  REST API + LINE Webhook
┌───────────────────▼─────────────────────────────┐
│  Backend (Node.js + Express.js)                 │
│  Webhook Handler · REST APIs · Cron Scheduler   │
└───────────────────┬─────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────┐
│  Database & Storage                             │
│  Google Firebase Firestore (NoSQL)              │
│  Local Filesystem (Proof Image Uploads)         │
└─────────────────────────────────────────────────┘
```

---

## ✨ Key Features

| Feature | Description |
|---|---|
| **Task Creation** | Create tasks with title, description, deadline, and specific assignees via a LIFF web form |
| **Assignment Tracking** | Each member's assignment is tracked individually (`pending` → `submitted` / `late`) |
| **Proof Submission** | Assignees upload photo evidence and optional notes through a mobile-friendly form |
| **Automated Reminders** | Cron jobs scan deadlines and push LINE notifications for upcoming/overdue tasks |
| **Live Dashboard** | View task progress, completion rates, and proof images in real-time |
| **Leaderboard** | Gamified ranking page to encourage healthy competition among members |
| **Flex Messages** | Rich, interactive LINE message cards for task notifications and confirmations |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js |
| **Web Framework** | Express.js |
| **Messaging Platform** | LINE Messaging API + LIFF SDK |
| **Database** | Google Firebase Firestore |
| **File Uploads** | Multer (multipart/form-data) |
| **Scheduled Jobs** | node-cron |
| **Frontend** | Vanilla HTML / CSS / JavaScript |
| **Dev Tools** | Nodemon, dotenv |

---

## 📂 Project Structure

```
TickDoBot/
├── index.js                  # Express server, REST APIs, Multer config
├── src/
│   ├── config/
│   │   ├── firebase.js       # Firestore client & CRUD helper functions
│   │   └── schema.js         # NoSQL document schema definitions
│   ├── handlers/
│   │   └── webhook.js        # LINE event handlers (join group, commands, etc.)
│   └── services/
│       ├── flexMessages.js   # LINE Flex Message UI templates
│       └── scheduler.js      # Cron jobs for deadline reminders
├── public/                   # Static files served to LIFF
│   ├── index.html            # Task dashboard (progress & assignees)
│   ├── view-tasks.html       # Detailed task list view
│   ├── create-task.html      # Task creation form
│   ├── confirm.html          # Proof submission form
│   └── ranking.html          # Member leaderboard
├── .env.example              # Environment variable template
└── package.json
```

---

## 🗄️ Database Schema (Firestore)

```
users/{lineUserId}
  └── displayName, pictureUrl

groups/{groupId}
  ├── members/{lineUserId}
  │     └── displayName, pictureUrl, score
  └── tasks/{taskId}
        ├── title, description, deadline, status
        └── assignments/{assignmentId}
              └── assigneeId, status, proofUrl, proofNote, submittedAt
```

**Task Status:** `pending` → `done` | `overdue` | `deleted`  
**Assignment Status:** `pending` → `submitted` | `late`

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```env
# LINE Messaging API
LINE_CHANNEL_ACCESS_TOKEN=your_token_here
LINE_CHANNEL_SECRET=your_secret_here

# LIFF IDs
LIFF_ID_DASHBOARD=your_liff_id
LIFF_ID_CREATE_TASK=your_liff_id
LIFF_ID_CONFIRM=your_liff_id
LIFF_ID_RANKING=your_liff_id

# Server
PORT=3000
BASE_URL=https://your-domain.com
```

> ⚠️ Never commit `.env` or `serviceAccountKey.json` — both are listed in `.gitignore`.

---

## 🚀 Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/natkrittap/TickDoBoT.git
cd TickDoBoT

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Add your LINE API keys and Firebase credentials

# 4. Place your Firebase service account key
# Save as: serviceAccountKey.json (in project root)

# 5. Run in development mode
npm run dev

# 6. Run in production
npm start
```

> The server requires a public HTTPS URL (e.g., via [ngrok](https://ngrok.com/) for local dev) to receive LINE webhooks.

---

## 🔄 How It Works

1. **Bot joins a LINE group** → Automatically registers the group in Firestore
2. **Admin sends a command** (e.g., `สร้างงาน`) → LIFF web form opens in-app
3. **Task is created** → LINE sends a Flex Message card to the group with assignee list
4. **Assignee taps SUBMIT** → Opens `confirm.html` to upload proof + notes
5. **Submission saved** → Firestore updated, group notified with confirmation card
6. **Cron job runs** → Checks deadlines, sends reminders for `pending` assignments
7. **Leaderboard updates** → Points awarded for on-time submissions

---

## 👨‍💻 Developer

**Natkritta Poonkham**  
BSc. Computer Science — Thammasat University  
GitHub: [@Natkritta361](https://github.com/Natkritta361)

---

## 📄 License

This project was developed as a **Senior Final Project** for a Bachelor of Science in Computer Science degree.  
All rights reserved © 2025 Natkritta Poonkham.

