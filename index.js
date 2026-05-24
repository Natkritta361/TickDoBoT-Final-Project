'use strict';

/**
 * TickDoBot — Main Application Entry Point
 * Node.js + Express + LINE Messaging API + Firebase
 */

require('dotenv').config();

const express  = require('express');
const path     = require('path');
const multer   = require('multer');
const fs       = require('fs');
const { middleware } = require('@line/bot-sdk');
const line     = require('@line/bot-sdk');

const { handleEvent }    = require('./src/handlers/webhook');
const { initScheduler }  = require('./src/services/scheduler');
const { buildTaskCard }  = require('./src/services/flexMessages');
const lineConfig         = require('./src/config/line');

const {
    db, col,
    upsertGroup, upsertMember, saveTask, saveAssignment,
    submitAssignment, getGroupTasks, getTaskAssignments,
    getMemberMap, getGroupMemberProfiles, getLeaderboard,
} = require('./src/config/firebase');

const {
    createTask, createAssignment, createGroup, createUserGroup,
} = require('./src/config/schema');

// ── LINE API client (for group member lookups) ───────────────────────────────
const lineClient = new line.messagingApi.MessagingApiClient({
    channelAccessToken: lineConfig.channelAccessToken,
});

// ── Multer — proof-of-work file uploads ──────────────────────────────────────
const storage = multer.diskStorage({
    destination(req, file, cb) {
        const dir = path.join(__dirname, 'public/uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename(req, file, cb) {
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}-${safe}`);
    },
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter(req, file, cb) {
        const allowed = /jpeg|jpg|png|gif|pdf|zip/;
        cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
    },
});

// ── Express app ──────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3001;

// Request logger
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
});

// ────────────────────────────────────────────────────────────────────────────
// LINE WEBHOOK  (must come BEFORE express.json())
// ────────────────────────────────────────────────────────────────────────────
app.post('/webhook', middleware(lineConfig), async (req, res) => {
    try {
        const results = await Promise.all(req.body.events.map(handleEvent));
        res.json(results);
    } catch (err) {
        console.error('[Webhook]', err);
        res.status(500).end();
    }
});

// ── JSON body parser (after webhook) ────────────────────────────────────────
app.use(express.json());

// ── Static frontend & LIFF pages ─────────────────────────────────────────────
// Force LINE LIFF browser to always load fresh HTML (no cache)
const publicDir = path.join(__dirname, 'public');
const serveHtmlNoCache = (filePath) => (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    res.removeHeader('ETag');
    res.removeHeader('Last-Modified');
    res.sendFile(path.join(publicDir, filePath));
};

// Explicit routes for LIFF pages
app.get('/view-tasks', serveHtmlNoCache('view-tasks.html'));
app.get('/view-tasks.html', serveHtmlNoCache('view-tasks.html'));
app.get('/create-task', serveHtmlNoCache('create-task.html'));
app.get('/create-task.html', serveHtmlNoCache('create-task.html'));
app.get('/confirm', serveHtmlNoCache('confirm.html'));
app.get('/confirm.html', serveHtmlNoCache('confirm.html'));
app.get('/ranking', serveHtmlNoCache('ranking.html'));
app.get('/ranking.html', serveHtmlNoCache('ranking.html'));
app.get('/index.html', serveHtmlNoCache('index.html'));
app.get('/', serveHtmlNoCache('index.html'));

// Other static assets (JS, CSS, images, uploads)
app.use(express.static(publicDir, { etag: false, lastModified: false, maxAge: 0 }));

// ────────────────────────────────────────────────────────────────────────────
// API: GET group members (used by LIFF create-task form)
// ────────────────────────────────────────────────────────────────────────────
app.get('/api/groups/:groupId/members', async (req, res) => {
    try {
        const { groupId } = req.params;
        const members = await getGroupMemberProfiles(groupId);
        res.json({ success: true, members });
    } catch (err) {
        console.error('[GET /members]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// API: GET single task details (includes assignments and member profiles)
// ────────────────────────────────────────────────────────────────────────────
app.get('/api/tasks/:groupId/:taskId', async (req, res) => {
    try {
        const { groupId, taskId } = req.params;
        const taskDoc = await col.tasks(groupId).doc(taskId).get();
        if (!taskDoc.exists) return res.status(404).json({ success: false, error: 'Task not found' });
        
        const [assignments, members] = await Promise.all([
            getTaskAssignments(groupId, taskId),
            getGroupMemberProfiles(groupId),
        ]);

        res.json({ 
            success: true, 
            task: { id: taskDoc.id, ...taskDoc.data() },
            assignments,
            members,
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// API: POST create tasks with per-person assignments (from LIFF)
// ────────────────────────────────────────────────────────────────────────────
app.post('/api/tasks/create', async (req, res) => {
    try {
        const { groupId, projectName, assignments, createdBy } = req.body;

        if (!groupId || !projectName || !Array.isArray(assignments) || !assignments.length)
            return res.status(400).json({ success: false, error: 'Invalid payload' });

        // One task per group project, one assignment per assignee
        const task = createTask({
            groupId,
            taskName: projectName,
            description: assignments[0]?.description || '',
            createdBy: createdBy || 'unknown',
            deadline: assignments[0]?.deadline,
        });
        await saveTask(groupId, task);

        await Promise.all(
            assignments.map(async (a) => {
                const assign = createAssignment({
                    taskId: task.taskId,
                    groupId,
                    lineUserId: a.assignee,
                });
                await saveAssignment(groupId, task.taskId, assign);
            })
        );

        const memberMap = await getMemberMap(groupId);
        const flexAssigns = assignments.map(a => ({ lineUserId: a.assignee, status: 'pending' }));
        const flexCard = buildTaskCard(task, flexAssigns, memberMap);

        const mentionText = assignments.map((a, i) => `{user${i}}`).join(' ');
        const mentionMessage = {
            type: 'textV2',
            text: `🔔 New Task: ${projectName}\nAssigned to: ${mentionText}`,
            substitution: Object.fromEntries(
                assignments.map((a, i) => [
                    `user${i}`,
                    { type: 'mention', mentionee: { type: 'user', userId: a.assignee } },
                ])
            ),
        };

        try {
            await lineClient.pushMessage({
                to: groupId,
                messages: [
                    mentionMessage,
                    {
                        type: 'flex',
                        altText: `📢 New Task Created: ${projectName}`,
                        contents: flexCard
                    }
                ]
            });
        } catch (lineErr) {
            console.warn('[LINE Push Warning - Create]', lineErr.message || lineErr);
        }

        res.json({ success: true, taskId: task.taskId, message: `Created task with ${assignments.length} assignments`, flexCard });
    } catch (err) {
        console.error('[POST /tasks/create]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// API: POST edit a task
// ────────────────────────────────────────────────────────────────────────────
app.post('/api/tasks/:groupId/:taskId/edit', async (req, res) => {
    try {
        const { groupId, taskId } = req.params;
        const { projectName, assignments } = req.body;
        const updates = { updatedAt: new Date() };
        if (projectName) updates.taskName = projectName;
        // Update task-level deadline/description from first assignment as fallback
        if (assignments?.[0]?.deadline) updates.deadline = new Date(assignments[0].deadline);
        if (assignments?.[0]?.description !== undefined) updates.description = assignments[0].description;

        await col.tasks(groupId).doc(taskId).update(updates);

        // Update each individual assignment's deadline and description
        if (Array.isArray(assignments) && assignments.length > 0) {
            // Get existing assignments to match by lineUserId
            const existingSnap = await col.assignments(groupId, taskId).get();
            const existingMap = {};
            existingSnap.docs.forEach(d => {
                const data = d.data();
                existingMap[data.lineUserId] = d.id;
            });

            await Promise.all(assignments.map(async (a) => {
                const assignDocId = existingMap[a.assignee];
                if (!assignDocId) return;
                const assignUpdates = { updatedAt: new Date() };
                if (a.deadline) assignUpdates.deadline = new Date(a.deadline);
                if (a.description !== undefined) assignUpdates.description = a.description;
                await col.assignments(groupId, taskId).doc(assignDocId).update(assignUpdates);
            }));
        }

        const taskDoc = await col.tasks(groupId).doc(taskId).get();
        const task = { id: taskDoc.id, ...taskDoc.data() };
        const assignList = await getTaskAssignments(groupId, taskId);
        const memberMap = await getMemberMap(groupId);
        const flexCard = buildTaskCard(task, assignList, memberMap);

        try {
            await lineClient.pushMessage({
                to: groupId,
                messages: [{
                    type: 'flex',
                    altText: `✏️ Task Updated: ${task.taskName}`,
                    contents: flexCard
                }]
            });
        } catch (lineErr) {
            console.warn('[LINE Push Warning - Edit]', lineErr.message || lineErr);
        }

        res.json({ success: true, flexCard });
    } catch (err) {
        console.error('[POST /tasks/edit]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// API: POST delete a task
// ────────────────────────────────────────────────────────────────────────────
app.post('/api/tasks/:groupId/:taskId/delete', async (req, res) => {
    try {
        const { groupId, taskId } = req.params;
        const taskDoc = await col.tasks(groupId).doc(taskId).get();
        if (!taskDoc.exists) return res.status(404).json({ success: false, error: 'Task not found' });
        const task = taskDoc.data();

        await col.tasks(groupId).doc(taskId).update({ status: 'deleted', updatedAt: new Date() });

        try {
            await lineClient.pushMessage({
                to: groupId,
                messages: [{
                    type: 'text',
                    text: `🗑️ งาน "${task.taskName}" ถูกลบออกจากระบบแล้วครับ`
                }]
            });
        } catch (lineErr) {
            console.warn('[LINE Push Warning - Delete]', lineErr.message || lineErr);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[POST /tasks/delete]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// API: POST confirm (submit) a task with proof file
// ────────────────────────────────────────────────────────────────────────────
app.post('/api/tasks/:groupId/:taskId/confirm', upload.single('proofFile'), async (req, res) => {
    try {
        const { groupId, taskId } = req.params;
        const { note, assignmentId } = req.body;

        if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

        const fileUrl = `/uploads/${req.file.filename}`;

        let flexCard = null;

        if (assignmentId) {
            await submitAssignment(groupId, taskId, assignmentId, {
                proofUrl: fileUrl,
                proofNote: note || '',
            });

            // Check if all assignments for this task are now submitted
            const assignList = await getTaskAssignments(groupId, taskId);
            const allDone = assignList.every(a => a.status === 'submitted');
            if (allDone) {
                await col.tasks(groupId).doc(taskId).update({
                    status: 'done',
                    completedAt: new Date(),
                });
            }

            const taskDoc = await col.tasks(groupId).doc(taskId).get();
            const task = { id: taskDoc.id, ...taskDoc.data() };
            const memberMap = await getMemberMap(groupId);
            flexCard = buildTaskCard(task, assignList, memberMap);

            try {
                await lineClient.pushMessage({
                    to: groupId,
                    messages: [{
                        type: 'flex',
                        altText: `✅ Evidence submitted for ${task.taskName}`,
                        contents: flexCard
                    }]
                });
            } catch (lineErr) {
                console.warn('[LINE Push Warning - Confirm]', lineErr.message || lineErr);
            }
        } else {
            // Fallback: update entire task (legacy)
            await col.tasks(groupId).doc(taskId).update({
                status: 'done',
                proofUrl: fileUrl,
                proofNote: note || '',
                completedAt: new Date(),
            });
        }

        res.json({ success: true, fileUrl, flexCard });
    } catch (err) {
        console.error('[POST /confirm]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// API: GET leaderboard
// ────────────────────────────────────────────────────────────────────────────
app.get('/api/ranking', async (req, res) => {
    try {
        const groupId = req.query.groupId;
        if (!groupId) return res.status(400).json({ success: false, error: 'groupId required' });

        const [board, profiles] = await Promise.all([
            getLeaderboard(groupId),
            getGroupMemberProfiles(groupId),
        ]);

        const profileMap = {};
        profiles.forEach(p => {
            profileMap[p.userId] = p;
        });

        const leaderboard = board.map((e) => {
            const p = profileMap[e.lineUserId] || {};
            return {
                ...e,
                displayName: p.displayName || e.lineUserId,
                pictureUrl: p.pictureUrl || '',
            };
        });

        res.json({ success: true, leaderboard });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// API: GET task list for a group
// ────────────────────────────────────────────────────────────────────────────
app.get('/api/tasks/:groupId', async (req, res) => {
    try {
        const { groupId } = req.params;
        const tasks = await getGroupTasks(groupId);

        // Collect all tasks with assignments
        const tasksWithAssigns = await Promise.all(
            tasks.filter((t) => t.status !== 'deleted').map(async (t) => {
                const assignments = await getTaskAssignments(groupId, t.taskId);
                return { ...t, assignments };
            })
        );

        // Collect ALL unique user IDs from assignments
        const allUserIds = new Set();
        tasksWithAssigns.forEach(t => {
            (t.assignments || []).forEach(a => {
                if (a.lineUserId) allUserIds.add(a.lineUserId);
            });
        });

        // Build memberMap by looking up each user directly
        const memberMap = {};
        await Promise.all(Array.from(allUserIds).map(async (uid) => {
            // 1. Check Firestore users collection
            try {
                const userDoc = await col.users().doc(uid).get();
                if (userDoc.exists && userDoc.data().displayName) {
                    memberMap[uid] = userDoc.data().displayName;
                    return;
                }
            } catch (e) {}

            // 2. Try LINE Group Member Profile API
            try {
                const profile = await lineClient.getGroupMemberProfile(groupId, uid);
                if (profile?.displayName) {
                    memberMap[uid] = profile.displayName;
                    // Cache for next time
                    await col.users().doc(uid).set(
                        { lineUserId: uid, displayName: profile.displayName, pictureUrl: profile.pictureUrl || '' },
                        { merge: true }
                    );
                    return;
                }
            } catch (e) {
                console.warn(`[Task List memberMap] getGroupMemberProfile failed for ${uid}:`, e.message);
            }

            // 3. Try LINE Profile API (1-on-1)
            try {
                const profile = await lineClient.getProfile(uid);
                if (profile?.displayName) {
                    memberMap[uid] = profile.displayName;
                    await col.users().doc(uid).set(
                        { lineUserId: uid, displayName: profile.displayName, pictureUrl: profile.pictureUrl || '' },
                        { merge: true }
                    );
                    return;
                }
            } catch (e) {
                console.warn(`[Task List memberMap] getProfile also failed for ${uid}:`, e.message);
            }

            // 4. Fallback
            memberMap[uid] = uid;
            console.warn(`[getTaskAssignments memberMap] Could not fetch profile for user ${uid}`);
        }));

        console.log('[Task List] memberMap:', JSON.stringify(memberMap));

        const result = tasksWithAssigns.map(t => ({ ...t, memberMap }));
        res.json({ success: true, tasks: result });
    } catch (err) {
        console.error('[GET /tasks/:groupId]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// GLOBAL ERROR HANDLER
// ────────────────────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('[SERVER ERROR]', err.stack);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
});

// ────────────────────────────────────────────────────────────────────────────
// STARTUP
// ────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅ TickDoBot server running on port ${PORT}`);
    console.log(`🔑 LINE Channel Secret: ${lineConfig.channelSecret ? lineConfig.channelSecret.substring(0, 6) + '...' + lineConfig.channelSecret.slice(-4) : 'MISSING'}`);
    console.log(`🔑 LINE Access Token: ${lineConfig.channelAccessToken ? lineConfig.channelAccessToken.substring(0, 10) + '...' : 'MISSING'}`);
    initScheduler();
});

module.exports = app;
