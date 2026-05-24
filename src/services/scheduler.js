'use strict';

/**
 * TickDoBot — Automated Deadline Scheduler
 *
 * Runs via node-cron:
 *  • Every day at 09:00 → 24-hour reminder for tasks due tomorrow
 *  • Every day at 17:00 → 1-hour warning for tasks due within 1 h
 *  • Every hour         → Mark overdue tasks and send overdue nudge
 *
 * Implements UC-15 (Auto Deadline Checking) and UC-16 (Auto Notification & Mention).
 */

const cron = require('node-cron');
const line = require('@line/bot-sdk');
const {
    db,
    col,
    getPendingAssignments,
    getMemberMap,
    logNotification,
    hasNotificationBeenSent,
} = require('../config/firebase');
const { createNotificationLog } = require('../config/schema');
const { buildReminderMessage } = require('./flexMessages');

const lineConfig = require('../config/line');
const client = new line.messagingApi.MessagingApiClient({
    channelAccessToken: lineConfig.channelAccessToken,
});

// ── How many ms before deadline each reminder fires ─────────────────────────
const REMIND_24H = 24 * 60 * 60 * 1000;
const REMIND_1H = 60 * 60 * 1000;

// ────────────────────────────────────────────────────────────────────────────
// CORE: Check one group and push reminders if needed
// ────────────────────────────────────────────────────────────────────────────
/**
 * @param {string} groupId
 * @param {'reminder_24h'|'reminder_1h'|'overdue'} notifType
 * @param {number} windowMs  tasks due within this many milliseconds
 */
async function checkAndNotifyGroup(groupId, notifType, windowMs) {
    const pending = await getPendingAssignments(groupId);
    if (!pending.length) return;

    const memberMap = await getMemberMap(groupId);
    const now = Date.now();

    // Group pending items by task so we send one message per task
    const byTask = {};
    for (const { task, assignment } of pending) {
        const deadline = task.deadline?.toDate
            ? task.deadline.toDate()
            : new Date(task.deadline);
        const timeLeft = deadline - now;

        const inWindow =
            notifType === 'overdue'
                ? timeLeft < 0 // past deadline
                : timeLeft > 0 && timeLeft <= windowMs; // upcoming within window

        if (!inWindow) continue;

        const logType = notifType === 'overdue' ? `overdue_${new Date().getHours()}` : (notifType.startsWith('reminder') ? `${notifType}_${new Date().toISOString().split('T')[0]}` : notifType);
        const alreadySent = await hasNotificationBeenSent(assignment.assignmentId, logType);
        if (alreadySent) continue;

        if (!byTask[task.taskId]) {
            byTask[task.taskId] = { task, pendingAssignees: [] };
        }
        byTask[task.taskId].pendingAssignees.push(assignment);
    }

    // Send one Flex Message + mention per task
    for (const { task, pendingAssignees } of Object.values(byTask)) {
        if (!pendingAssignees.length) continue;

        const pendingNames = pendingAssignees.map(
            (a) => memberMap[a.lineUserId] || a.lineUserId
        );
        const mentionText = pendingAssignees
            .map((a, i) => `{user${i}}`)
            .join(' ');

        // Build messages array: reminder card + mention text
        const messages = [
            buildReminderMessage(task, pendingNames),
            {
                type: 'textV2',
                text: `⚠️ ${mentionText}\nยังไม่ได้ส่งงาน "${task.taskName}" ครับ!`,
                substitution: Object.fromEntries(
                    pendingAssignees.map((a, i) => [
                        `user${i}`,
                        { type: 'mention', mentionee: { type: 'user', userId: a.lineUserId } },
                    ])
                ),
            },
        ];

        try {
            await client.pushMessage({ to: groupId, messages });

            // Log each notification
            await Promise.all(
                pendingAssignees.map((a) =>
                    logNotification(
                        createNotificationLog({
                            assignmentId: a.assignmentId,
                            taskId: task.taskId,
                            lineUserId: a.lineUserId,
                            groupId,
                            type: notifType === 'overdue' ? `overdue_${new Date().getHours()}` : (notifType.startsWith('reminder') ? `${notifType}_${new Date().toISOString().split('T')[0]}` : notifType),
                        })
                    )
                )
            );

            console.log(
                `[Scheduler] Sent ${notifType} for task="${task.taskName}" to group=${groupId} (${pendingAssignees.length} members)`
            );
        } catch (err) {
            console.error(`[Scheduler] pushMessage failed for group=${groupId}`, err);
        }

        // Mark overdue tasks
        if (notifType === 'overdue') {
            await col.tasks(groupId).doc(task.taskId).update({ status: 'overdue' });
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// FETCH ALL ACTIVE GROUPS
// ────────────────────────────────────────────────────────────────────────────
async function getAllGroupIds() {
    const snap = await col.groups().get();
    return snap.docs.map((d) => d.id);
}

// ────────────────────────────────────────────────────────────────────────────
// RUN CHECK ACROSS ALL GROUPS
// ────────────────────────────────────────────────────────────────────────────
async function runCheck(notifType, windowMs) {
    const groupIds = await getAllGroupIds();
    console.log(`[Scheduler] Running ${notifType} check for ${groupIds.length} groups`);
    await Promise.all(groupIds.map((gid) => checkAndNotifyGroup(gid, notifType, windowMs)));
}

// ────────────────────────────────────────────────────────────────────────────
// CRON SCHEDULE REGISTRATION
// ────────────────────────────────────────────────────────────────────────────
function initScheduler() {
    // 09:00 every day — 24-hour advance reminder
    cron.schedule('0 9 * * *', () => {
        runCheck('reminder_24h', REMIND_24H).catch(console.error);
    }, { timezone: 'Asia/Bangkok' });

    // 17:00 every day — 1-hour warning (catches 18:00 deadlines common in Thai schools)
    cron.schedule('0 17 * * *', () => {
        runCheck('reminder_1h', REMIND_1H).catch(console.error);
    }, { timezone: 'Asia/Bangkok' });

    // Every 5 minutes — check for 30-minute advance reminder
    cron.schedule('*/5 * * * *', () => {
        runCheck('reminder_30m', 30 * 60 * 1000).catch(console.error);
    }, { timezone: 'Asia/Bangkok' });

    // Every hour — mark overdue and send overdue nudge
    cron.schedule('0 * * * *', () => {
        runCheck('overdue', 0).catch(console.error);
    }, { timezone: 'Asia/Bangkok' });

    console.log('[Scheduler] TickDoBot scheduler initialized (TZ=Asia/Bangkok)');
}

module.exports = { initScheduler };
