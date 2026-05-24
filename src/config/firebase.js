'use strict';

const admin = require('firebase-admin');
const path  = require('path');
const fs    = require('fs');
const line  = require('@line/bot-sdk');
const lineConfig = require('./line');

const lineClient = new line.messagingApi.MessagingApiClient({
    channelAccessToken: lineConfig.channelAccessToken,
});

// Initialize once — supports two modes:
//  • Local dev : place serviceAccountKey.json in the project root
//  • Production: set FIREBASE_SERVICE_ACCOUNT env var (JSON string)
if (!admin.apps.length) {
    let credential;

    const keyFilePath = path.join(__dirname, '../../serviceAccountKey.json');

    if (fs.existsSync(keyFilePath)) {
        // ── Local dev: load JSON file directly ──────────────────────────────
        const serviceAccount = require(keyFilePath);
        credential = admin.credential.cert(serviceAccount);
        console.log('[Firebase] Using local serviceAccountKey.json');
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        // ── Production: load from env var (Railway, Render, etc.) ───────────
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        credential = admin.credential.cert(serviceAccount);
        console.log('[Firebase] Using FIREBASE_SERVICE_ACCOUNT env var');
    } else {
        // ── Fallback: Application Default Credentials (Cloud Run / GCE) ─────
        credential = admin.credential.applicationDefault();
        console.log('[Firebase] Using Application Default Credentials');
    }

    admin.initializeApp({
        credential,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'tickdo-d52fb.appspot.com',
    });
}

const db = admin.firestore();
const storage = admin.storage();

// ── Collection path helpers ──────────────────────────────────────────────────
const col = {
    users: () => db.collection('users'),
    groups: () => db.collection('groups'),
    members: (groupId) => db.collection('groups').doc(groupId).collection('members'),
    tasks: (groupId) => db.collection('groups').doc(groupId).collection('tasks'),
    assignments: (groupId, taskId) =>
        db
            .collection('groups')
            .doc(groupId)
            .collection('tasks')
            .doc(taskId)
            .collection('assignments'),
    notificationLogs: () => db.collection('notificationLogs'),
};

// ── Generic helpers ──────────────────────────────────────────────────────────

/** Upsert a user record (idempotent on first join). */
async function upsertUser(userObj) {
    await col.users().doc(userObj.lineUserId).set(userObj, { merge: true });
}

/** Upsert a group record. */
async function upsertGroup(groupObj) {
    await col.groups().doc(groupObj.groupId).set(groupObj, { merge: true });
}

/** Add a member to a group (idempotent). */
async function upsertMember(groupId, userGroupObj) {
    await col.members(groupId).doc(userGroupObj.lineUserId).set(userGroupObj, { merge: true });
}

/** Save a new task, returning the written document reference. */
async function saveTask(groupId, taskObj) {
    const ref = col.tasks(groupId).doc(taskObj.taskId);
    await ref.set(taskObj);
    return ref;
}

/** Save one assignment. */
async function saveAssignment(groupId, taskId, assignmentObj) {
    const ref = col.assignments(groupId, taskId).doc(assignmentObj.assignmentId);
    await ref.set(assignmentObj);
    return ref;
}

/**
 * Mark an assignment as submitted.
 * @param {string} groupId
 * @param {string} taskId
 * @param {string} assignmentId
 * @param {{ proofUrl?: string, proofNote?: string }} extra
 */
async function submitAssignment(groupId, taskId, assignmentId, extra = {}) {
    const now = new Date();
    await col.assignments(groupId, taskId).doc(assignmentId).update({
        status: 'submitted',
        submitTime: now,
        submittedAt: now,
        ...extra,
    });
}

/**
 * Fetch all pending assignments across all tasks in a group.
 * Used by the scheduler to decide who to nudge.
 */
async function getPendingAssignments(groupId) {
    const tasksSnap = await col.tasks(groupId).where('status', '==', 'pending').get();
    const results = [];

    await Promise.all(
        tasksSnap.docs.map(async (taskDoc) => {
            const task = taskDoc.data();
            const assignSnap = await col
                .assignments(groupId, task.taskId)
                .where('status', '==', 'pending')
                .get();
            assignSnap.docs.forEach((a) => results.push({ task, assignment: a.data() }));
        })
    );

    return results;
}

/** Fetch all tasks for a group (for View Task List). */
async function getGroupTasks(groupId) {
    const snap = await col.tasks(groupId).orderBy('deadline', 'asc').get();
    return snap.docs.map((d) => d.data());
}

/** Fetch all assignments for a single task. */
async function getTaskAssignments(groupId, taskId) {
    const snap = await col.assignments(groupId, taskId).get();
    return snap.docs.map((d) => d.data());
}

/** Fetch member display names for a group (Map<lineUserId, displayName>). */
async function getMemberMap(groupId) {
    const map = {};
    try {
        const membersSnap = await col.members(groupId).get();
        await Promise.all(membersSnap.docs.map(async (d) => {
            const m = d.data();
            const uid = m.lineUserId;
            if (!uid) return;

            // 1. Check users collection (most up-to-date)
            try {
                const userDoc = await col.users().doc(uid).get();
                if (userDoc.exists && userDoc.data().displayName) {
                    map[uid] = userDoc.data().displayName;
                    return;
                }
            } catch (e) {}

            // 2. Check members subcollection
            if (m.displayName) {
                map[uid] = m.displayName;
                return;
            }

            // 3. Try LINE API and cache the result
            try {
                const profile = await lineClient.getGroupMemberProfile(groupId, uid);
                if (profile?.displayName) {
                    map[uid] = profile.displayName;
                    await col.users().doc(uid).set(
                        { lineUserId: uid, displayName: profile.displayName, pictureUrl: profile.pictureUrl || '' },
                        { merge: true }
                    );
                    return;
                }
            } catch (e) {
                console.warn(`[getMemberMap] getGroupMemberProfile failed for ${uid}:`, e.message);
            }

            // 4. Fallback: keep full uid if all lookups fail
            map[uid] = uid;
            console.warn(`[getMemberMap] Could not fetch profile for user ${uid} - using ID as fallback`);
        }));
    } catch (e) {
        console.error('[getMemberMap]', e);
    }
    return map;
}

/** Fetch full member profiles including displayName and pictureUrl from users collection. */
async function getGroupMemberProfiles(groupId) {
    const snap = await col.members(groupId).get();
    const results = [];
    await Promise.all(
        snap.docs.map(async (d) => {
            const m = d.data();
            const userDoc = await col.users().doc(m.lineUserId).get();
            if (userDoc.exists && userDoc.data().displayName) {
                const u = userDoc.data();
                results.push({
                    userId: u.lineUserId,
                    displayName: u.displayName || m.lineUserId,
                    pictureUrl: u.pictureUrl || '',
                });
            } else {
                try {
                    const profile = await lineClient.getGroupMemberProfile(groupId, m.lineUserId);
                    if (profile) {
                        await col.users().doc(m.lineUserId).set({ lineUserId: m.lineUserId, displayName: profile.displayName, pictureUrl: profile.pictureUrl || '' }, { merge: true });
                        results.push({
                            userId: m.lineUserId,
                            displayName: profile.displayName,
                            pictureUrl: profile.pictureUrl || '',
                        });
                        return;
                    }
                } catch (e) {
                    console.warn(`[getGroupMemberProfiles] getGroupMemberProfile failed for ${m.lineUserId}:`, e.message);
                    try {
                        const profile = await lineClient.getProfile(m.lineUserId);
                        if (profile) {
                            await col.users().doc(m.lineUserId).set({ lineUserId: m.lineUserId, displayName: profile.displayName, pictureUrl: profile.pictureUrl || '' }, { merge: true });
                            results.push({
                                userId: m.lineUserId,
                                displayName: profile.displayName,
                                pictureUrl: profile.pictureUrl || '',
                            });
                            return;
                        }
                    } catch (err) {
                        console.warn(`[getGroupMemberProfiles] getProfile also failed for ${m.lineUserId}:`, err.message);
                    }
                }

                results.push({
                    userId: m.lineUserId,
                    displayName: m.displayName || m.lineUserId,
                    pictureUrl: m.pictureUrl || '',
                });
            }
        })
    );
    return results;
}

/** Compute on-time submission leaderboard for a group. */
async function getLeaderboard(groupId) {
    const tasksSnap = await col.tasks(groupId).get();
    const stats = {}; // lineUserId → { doneCount, onTimeCount, score }

    await Promise.all(
        tasksSnap.docs.map(async (taskDoc) => {
            const task = taskDoc.data();
            const assignSnap = await col
                .assignments(groupId, task.taskId)
                .where('status', '==', 'submitted')
                .get();
            assignSnap.docs.forEach((a) => {
                const assign = a.data();
                const uid = assign.lineUserId;
                if (!stats[uid]) stats[uid] = { doneCount: 0, onTimeCount: 0, score: 0 };

                stats[uid].doneCount += 1;

                if (assign.submitTime && task.deadline) {
                    const submitted = assign.submitTime.toDate
                        ? assign.submitTime.toDate()
                        : new Date(assign.submitTime);
                    const deadline = task.deadline.toDate
                        ? task.deadline.toDate()
                        : new Date(task.deadline);

                    if (submitted <= deadline) {
                        stats[uid].onTimeCount += 1;
                        stats[uid].score += 10; // on-time = 10 pts
                    } else {
                        stats[uid].score += 5; // late = 5 pts
                    }
                }
            });
        })
    );

    return Object.entries(stats)
        .map(([lineUserId, s]) => ({ lineUserId, ...s }))
        .sort((a, b) => b.score - a.score);
}

/** Log a sent notification. */
async function logNotification(notiObj) {
    await col.notificationLogs().doc(notiObj.notiId).set(notiObj);
}

/** Check if a notification of a specific type has already been sent for an assignment. */
async function hasNotificationBeenSent(assignmentId, type) {
    const snap = await col.notificationLogs()
        .where('assignmentId', '==', assignmentId)
        .where('type', '==', type)
        .limit(1)
        .get();
    return !snap.empty;
}

module.exports = {
    db,
    storage,
    col,
    upsertUser,
    upsertGroup,
    upsertMember,
    saveTask,
    saveAssignment,
    submitAssignment,
    getPendingAssignments,
    getGroupTasks,
    getTaskAssignments,
    getMemberMap,
    getGroupMemberProfiles,
    getLeaderboard,
    logNotification,
    hasNotificationBeenSent,
};
