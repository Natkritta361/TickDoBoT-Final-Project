# Project Instructions: TickDoBot (LINE Chatbot & LIFF Task Manager)

Welcome! This document provides the complete context, rules, and technical instructions for AI assistants working on the **TickDoBot** codebase.

---

## 1. Project Overview & Architecture
TickDoBot is a task tracking and group management system designed to run directly inside LINE groups. It uses a **3-Tier Architecture**:
1. **Frontend (Client):** Single Page Applications (SPAs) inside LINE's In-App Browser using **LINE Front-end Framework (LIFF SDK)**. Built with Vanilla HTML/CSS/JS (no Tailwind).
2. **Backend (Server):** Node.js + Express. Handles LINE Webhook events, serves static files from `public/`, and provides RESTful APIs for the LIFF pages.
3. **Database & Storage:** Google Firebase Firestore (NoSQL database) and local filesystem storage (`public/uploads`) for submitted evidence.

---

## 2. Directory Structure & Key Files
*   `index.js`: Express server setup, REST APIs (tasks creation, confirmation, member profiles), Multer configurations for file uploads, static file routing.
*   `public/`: Static files served to LIFF.
    *   `index.html` / `view-tasks.html`: Main dashboard showing task progress, assignees, and action buttons.
    *   `create-task.html`: Web interface for creating and assigning tasks.
    *   `confirm.html`: Submission form where assignees upload files and add notes.
    *   `ranking.html`: Leaderboard displaying member scores.
*   `src/`: Main source logic.
    *   `config/firebase.js`: Firestore database pointers (`col` object) and CRUD helper functions (e.g., `submitAssignment`).
    *   `config/schema.js`: NoSQL document schema structures.
    *   `handlers/webhook.js`: Handlers for LINE events (e.g., bot joining group, text commands).
    *   `services/flexMessages.js`: UI code templates for LINE Flex Messages.
    *   `services/scheduler.js`: Cron jobs running `node-cron` to scan deadlines and send automated notifications.

---

## 3. Database Subcollection Structure (Firestore)
Ensure you query documents following the exact subcollection hierarchy:
*   `users/{lineUserId}`: User profile documents (displayName, pictureUrl).
*   `groups/{groupId}`: Group configuration.
    *   `members/{lineUserId}`: Members belonging to the group.
    *   `tasks/{taskId}`: Task documents (status = 'pending' | 'done' | 'overdue' | 'deleted').
        *   `assignments/{assignmentId}`: Assignments for individual users under that task (status = 'pending' | 'submitted' | 'late', proofUrl, proofNote, submittedAt).

---

## 4. Key Rules for Modifying Frontend Files
*   **Aesthetics:** Always maintain a modern, clean, premium UI with smooth micro-animations. Default to glassmorphism styles, curated HSL color schemes, and modern typography (e.g., Inter). Do NOT use Tailwind CSS unless explicitly requested.
*   **Assignee Names:** When rendering assignees in `index.html` or `view-tasks.html`, always fetch names using `memberMap` populated by the backend. Do NOT fall back to legacy `profileMap` or display truncated raw user IDs (e.g., `Ubbe2`) unless no profile is found.
*   **Action Buttons (Dynamic Rendering):**
    *   Completed assignments (`submitted`) must display a **`PROOF`** button that calls `viewProof(proofUrl, proofNote)`.
    *   Active assignments (`pending`) must show a green **`SUBMIT`** button.
    *   If a task's status is `done` (completed by everyone), hide both the `Edit Task` and `SUBMIT` buttons to ensure data security.
*   **Submission Auto-lookup:** In `confirm.html`, if the URL parameter `assignmentId` is missing, use `liff.getProfile()` to fetch the current user's LINE ID, query `/api/tasks/:groupId/:taskId`, and automatically map the user to their matching `assignmentId`.

---

## 5. Key Rules for Modifying Backend Files
*   **File Upload Safety:** When configuring `multer` disk storage, sanitize the original filename using regex (remove special non-alphanumeric characters) and prepend `Date.now()` to prevent duplicate file overwriting.
*   **Profile Caching (memberMap):** To avoid hitting LINE API Rate Limits, lookup profiles from the local `users` collection first. If missing, query the group members from LINE, cache it in Firestore, and then return it.
*   **Background Jobs:** Scheduler alarms run in `scheduler.js` under `node-cron`. Ensure you write an entry into `notificationLogs` after sending a message to prevent duplicate automated alerts to the same group.

---

## 6. Language Preference
Keep comments, user interaction text, and logs in **Thai** where appropriate, as this codebase is presented for local academic evaluation.
