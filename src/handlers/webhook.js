'use strict';

/**
 * TickDoBot — Webhook Event Handler
 *
 * Handles:
 *  • JoinEvent         — bot added to group
 *  • MessageEvent      — text commands from chat
 *  • PostbackEvent     — button taps from Flex Messages / Quick Replies
 *  • FollowEvent       — user added bot as friend (1-1 chat)
 */

const line = require('@line/bot-sdk');
const {
    upsertUser,
    upsertGroup,
    upsertMember,
    saveTask,
    saveAssignment,
    submitAssignment,
    getGroupTasks,
    getTaskAssignments,
    getMemberMap,
    getLeaderboard,
    logNotification,
} = require('../config/firebase');

const {
    createUser,
    createGroup,
    createUserGroup,
    createTask,
    createAssignment,
    createNotificationLog,
} = require('../config/schema');

const {
    buildTaskCard,
    buildTaskListCarousel,
    buildLeaderboard,
    buildConfirmDialog,
    buildEmptyState,
    buildHelpMessage,
    buildCreateTaskPrompt,
    buildViewTasksPrompt,
    buildRankingPrompt,
    buildJoinPrompt,
} = require('../services/flexMessages');

const lineConfig = require('../config/line');
const client = new line.messagingApi.MessagingApiClient({
    channelAccessToken: lineConfig.channelAccessToken,
});

// ── In-memory conversation state (replace with Redis/Firestore in production) ──
const sessionStore = new Map(); // key: userId → { step, data }

function getSession(userId) {
    return sessionStore.get(userId) || {};
}
function setSession(userId, session) {
    sessionStore.set(userId, session);
}
function clearSession(userId) {
    sessionStore.delete(userId);
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN DISPATCHER
// ────────────────────────────────────────────────────────────────────────────
async function handleEvent(event) {
    const { type, source, replyToken } = event;
    const userId = source?.userId;
    const groupId = source?.groupId || source?.roomId || userId; // fallback for 1-1

    console.log(`[Webhook Event] type=${type} userId=${userId} groupId=${groupId}`);

    try {
        if (type === 'join') return handleJoin(event, groupId);
        if (type === 'follow') return handleFollow(event, userId);
        if (type === 'message' && event.message.type === 'text')
            return handleText(event, userId, groupId);
        if (type === 'postback') return handlePostback(event, userId, groupId);
    } catch (err) {
        console.error(`[handleEvent] type=${type} userId=${userId}`, err);
    }
}

// ────────────────────────────────────────────────────────────────────────────
// JOIN EVENT — bot invited to a group
// ────────────────────────────────────────────────────────────────────────────
async function handleJoin(event, groupId) {
    // Persist group record
    const groupProfile = await client.getGroupSummary(groupId).catch(() => null);
    await upsertGroup(
        createGroup({
            groupId,
            groupName: groupProfile?.groupName || 'LINE Group',
            groupPicture: groupProfile?.pictureUrl || '',
        })
    );

    await client.replyMessage({
        replyToken: event.replyToken,
        messages: [
            {
                type: 'text',
                text:
                    '👋 สวัสดีครับ! ผม TickDoBot 🤖\n\n' +
                    'ผมจะช่วยจัดการงานในทีมของคุณ:\n' +
                    '📌 สร้างและมอบหมายงานให้เพื่อน\n' +
                    '⏰ แจ้งเตือนอัตโนมัติก่อนถึงกำหนด\n' +
                    '📊 จัดอันดับคะแนนความขยันของทีม\n\n' +
                    'กดปุ่ม "เข้าร่วมทีม" ด้านล่างเพื่อเริ่มต้นได้เลยครับ!',
            },
            buildJoinPrompt(groupId),
        ],
    });
}

// ────────────────────────────────────────────────────────────────────────────
// FOLLOW EVENT — user adds bot as friend
// ────────────────────────────────────────────────────────────────────────────
async function handleFollow(event, userId) {
    const profile = await client.getProfile(userId).catch(() => null);
    if (profile) {
        await upsertUser(
            createUser({
                lineUserId: userId,
                displayName: profile.displayName,
                pictureUrl: profile.pictureUrl || '',
            })
        );
    }

    await client.replyMessage({
        replyToken: event.replyToken,
        messages: [
            {
                type: 'text',
                text: `สวัสดีครับ ${profile?.displayName || ''}! 🎉\nเพิ่มผมเข้ากลุ่ม LINE ของคุณเพื่อเริ่มติดตามงานได้เลยครับ!`,
            },
        ],
    });
}

// ────────────────────────────────────────────────────────────────────────────
// TEXT MESSAGE HANDLER — stateful conversation flow
// ────────────────────────────────────────────────────────────────────────────
async function handleText(event, userId, groupId) {
    const text = event.message.text.trim();
    const session = getSession(userId);
    const lower = text.toLowerCase();

    // ── Auto-save user profile so we always have displayName ──
    try {
        let profile = null;
        if (groupId && groupId !== userId) {
            profile = await client.getGroupMemberProfile(groupId, userId).catch(() => null);
        }
        if (!profile) {
            profile = await client.getProfile(userId).catch(() => null);
        }
        if (profile?.displayName) {
            await upsertUser(createUser({
                lineUserId: userId,
                displayName: profile.displayName,
                pictureUrl: profile.pictureUrl || '',
            }));
        }
    } catch (e) { /* ignore */ }

    // ── Global cancel ──
    if (['ยกเลิก', 'cancel', 'ออก'].includes(lower)) {
        clearSession(userId);
        return reply(event.replyToken, [{ type: 'text', text: '❌ ยกเลิกแล้วครับ' }]);
    }

    // ── Stateful conversation steps ──
    if (session.step) {
        return handleConversationStep(event, userId, groupId, text, session);
    }

    // ── Command routing ──
    if (['สร้างงาน', 'create task', 'create'].includes(lower)) {
        clearSession(userId);
        return reply(event.replyToken, [buildCreateTaskPrompt(groupId)]);
    }

    if (['ดูงาน', 'ดูงานทั้งหมด', 'view tasks', 'tasks'].includes(lower)) {
        clearSession(userId);
        return reply(event.replyToken, [buildViewTasksPrompt(groupId)]);
    }

    if (['ranking', 'อันดับ', 'คะแนน'].includes(lower)) {
        clearSession(userId);
        return reply(event.replyToken, [buildRankingPrompt(groupId)]);
    }

    if (['เช็คงาน', 'เช็ค', 'check tasks', 'check'].includes(lower)) {
        clearSession(userId);
        return handleCheckTasks(event, groupId);
    }

    if (['ช่วยเหลือ', 'help', 'คำสั่ง'].includes(lower)) {
        return handleHelp(event);
    }

    // Unknown command — show hint
    return reply(event.replyToken, [
        {
            type: 'text',
            text: '🤔 ไม่เข้าใจคำสั่งครับ\nลองพิมพ์ "ช่วยเหลือ" หรือกดเมนูด้านล่างครับ',
            quickReply: {
                items: [
                    quickReplyItem('📝 สร้างงาน', 'สร้างงาน'),
                    quickReplyItem('📋 ดูงาน', 'ดูงาน'),
                    quickReplyItem('🏆 อันดับ', 'ranking'),
                ],
            },
        },
    ]);
}

// ── Stateful conversation steps ──────────────────────────────────────────────
async function handleConversationStep(event, userId, groupId, text, session) {
    const { step, data } = session;

    switch (step) {
        case 'AWAIT_TASK_NAME': {
            setSession(userId, { step: 'AWAIT_DESCRIPTION', data: { ...data, taskName: text } });
            return reply(event.replyToken, [
                { type: 'text', text: `✅ ชื่องาน: "${text}"\n\nกรอกรายละเอียดงาน (หรือพิมพ์ "-" เพื่อข้าม):` },
            ]);
        }

        case 'AWAIT_DESCRIPTION': {
            const description = text === '-' ? '' : text;
            setSession(userId, { step: 'AWAIT_DEADLINE', data: { ...data, description } });
            return reply(event.replyToken, [
                {
                    type: 'text',
                    text: '📅 กำหนดวันส่งงานครับ\nรูปแบบ: DD/MM/YYYY HH:MM\nเช่น: 30/04/2568 18:00',
                },
            ]);
        }

        case 'AWAIT_DEADLINE': {
            const deadline = parseThaiDate(text);
            if (!deadline) {
                return reply(event.replyToken, [
                    { type: 'text', text: '❗ รูปแบบวันที่ไม่ถูกต้องครับ\nกรุณาใส่: DD/MM/YYYY HH:MM\n(หรือพิมพ์ "ยกเลิก" เพื่อออกจากโหมดสร้างงาน)' },
                ]);
            }
            if (deadline < new Date()) {
                return reply(event.replyToken, [
                    { type: 'text', text: '❗ กรุณาเลือกวันที่ในอนาคตครับ\n(หรือพิมพ์ "ยกเลิก" เพื่อออกจากโหมดสร้างงาน)' },
                ]);
            }
            setSession(userId, { step: 'AWAIT_ASSIGNEES', data: { ...data, deadline } });
            return reply(event.replyToken, [
                {
                    type: 'text',
                    text:
                        `📅 Deadline: ${fmt(deadline)}\n\n` +
                        'ระบุผู้รับผิดชอบงาน (ชื่อหรือ @mention, คั่นด้วยเครื่องหมาย ,)\n' +
                        'หรือพิมพ์ "ทั้งกลุ่ม" เพื่อมอบหมายให้ทุกคน:',
                },
            ]);
        }

        case 'AWAIT_ASSIGNEES': {
            // Parse mentions from the event message (mentionees field)
            const mentionees =
                event.message.mention?.mentionees?.map((m) => m.userId) || [];
            const manualNames = text
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s && s !== 'ทั้งกลุ่ม');

            // Build task
            const task = createTask({
                groupId: data.groupId,
                taskName: data.taskName,
                description: data.description,
                createdBy: userId,
                deadline: data.deadline,
            });
            await saveTask(data.groupId, task);

            // Assign mentioned users (or just the creator if no mentions)
            const assignees = mentionees.length > 0 ? mentionees : [userId];
            await Promise.all(
                assignees.map(async (uid) => {
                    const a = createAssignment({ taskId: task.taskId, groupId: data.groupId, lineUserId: uid });
                    await saveAssignment(data.groupId, task.taskId, a);
                    // Ensure user record exists
                    const profile = await client.getProfile(uid).catch(() => null);
                    if (profile) {
                        await upsertUser(createUser({ lineUserId: uid, displayName: profile.displayName, pictureUrl: profile.pictureUrl || '' }));
                        await upsertMember(data.groupId, createUserGroup({ lineUserId: uid, groupId: data.groupId }));
                    }
                })
            );

            // Fetch member map to display names properly
            const memberMap = await getMemberMap(data.groupId);
            // Create a pending assignment map for the flex card
            const flexAssigns = assignees.map(uid => ({ lineUserId: uid, status: 'pending' }));
            const flexCard = buildTaskCard(task, flexAssigns, memberMap);

            clearSession(userId);

            return reply(event.replyToken, [
                {
                    type: 'text',
                    text:
                        `✅ สร้างงาน "${task.taskName}" สำเร็จแล้วครับ!\n` +
                        `📅 Deadline: ${fmt(task.deadline)}\n` +
                        `👥 มอบหมายให้ ${assignees.length} คน\n\n` +
                        'ระบบจะแจ้งเตือนอัตโนมัติก่อนครบกำหนดครับ 🔔',
                },
                {
                    type: 'flex',
                    altText: `📢 New Task Created: ${task.taskName}`,
                    contents: flexCard
                }
            ]);
        }

        default:
            clearSession(userId);
            return reply(event.replyToken, [{ type: 'text', text: 'เกิดข้อผิดพลาด กรุณาลองใหม่ครับ' }]);
    }
}

// ────────────────────────────────────────────────────────────────────────────
// POSTBACK HANDLER — button taps from Flex Messages
// ────────────────────────────────────────────────────────────────────────────
async function handlePostback(event, userId, groupId) {
    const params = new URLSearchParams(event.postback.data);
    const action = params.get('action');
    const taskId = params.get('taskId');
    const pGroupId = params.get('groupId') || groupId;
    const assignmentId = params.get('assignmentId');

    switch (action) {
        // ── User tapped "JOIN" ──
        case 'join': {
            const profile = await client.getProfile(userId).catch(() => null);
            if (profile) {
                await upsertUser(createUser({ lineUserId: userId, displayName: profile.displayName, pictureUrl: profile.pictureUrl || '' }));
                await upsertMember(pGroupId, createUserGroup({ lineUserId: userId, groupId: pGroupId }));
            }
            return reply(event.replyToken, [
                { type: 'text', text: `✅ จดจำคุณ ${profile?.displayName || userId} เรียบร้อยแล้ว!` },
            ]);
        }

        // ── User tapped "Submit My Work" ──
        case 'submit': {
            // Find the user's assignment for this task
            const assignments = await getTaskAssignments(pGroupId, taskId);
            const mine = assignments.find((a) => a.lineUserId === userId);

            if (!mine) {
                return reply(event.replyToken, [
                    { type: 'text', text: '❗ ไม่พบงานที่มอบหมายให้คุณในรายการนี้ครับ' },
                ]);
            }
            if (mine.status === 'submitted') {
                return reply(event.replyToken, [
                    { type: 'text', text: '✅ คุณส่งงานนี้ไปแล้วครับ!' },
                ]);
            }

            // Ask for proof — open LIFF
            const liffUrl = `${process.env.LIFF_BASE_URL}/confirm?groupId=${pGroupId}&taskId=${taskId}&assignmentId=${mine.assignmentId}`;
            return reply(event.replyToken, [
                {
                    type: 'flex',
                    altText: 'ยืนยันการส่งงาน',
                    contents: {
                        type: 'bubble',
                        body: {
                            type: 'box', layout: 'vertical', paddingAll: 'xl',
                            contents: [
                                { type: 'text', text: '📤 ส่งงาน', size: 'xl', weight: 'bold', color: '#1A1A2E' },
                                { type: 'text', text: 'แนบหลักฐานการส่งงาน (ไฟล์ / รูปภาพ)', size: 'sm', color: '#666', margin: 'md', wrap: true },
                            ],
                        },
                        footer: {
                            type: 'box', layout: 'vertical', paddingAll: 'lg',
                            contents: [{
                                type: 'button', style: 'primary', color: '#06C755',
                                action: { type: 'uri', label: '📎 แนบหลักฐาน & ยืนยัน', uri: liffUrl },
                            }],
                        },
                    },
                },
            ]);
        }

        // ── Delete task confirmation ──
        case 'confirm_delete': {
            return reply(event.replyToken, [
                buildConfirmDialog({
                    title: 'ลบงานนี้ใช่ไหม?',
                    body: 'งานที่ลบแล้วไม่สามารถกู้คืนได้',
                    confirmData: `action=do_delete&taskId=${taskId}&groupId=${pGroupId}`,
                    cancelData: `action=cancel`,
                }),
            ]);
        }

        // ── Actually delete ──
        case 'do_delete': {
            const { db, col } = require('../config/firebase');
            await col.tasks(pGroupId).doc(taskId).update({ status: 'deleted' });
            return reply(event.replyToken, [{ type: 'text', text: '🗑️ ลบงานสำเร็จแล้วครับ' }]);
        }

        // ── Edit task — open LIFF ──
        case 'edit_task': {
            const liffUrl = `${process.env.LIFF_BASE_URL}/create-task?groupId=${pGroupId}&taskId=${taskId}&mode=edit`;
            return reply(event.replyToken, [
                {
                    type: 'text', text: `✏️ แก้ไขงานผ่านแบบฟอร์มครับ`, quickReply: {
                        items: [{ type: 'action', action: { type: 'uri', label: 'เปิดแบบฟอร์ม', uri: liffUrl } }],
                    }
                },
            ]);
        }

        case 'cancel':
            clearSession(userId);
            return reply(event.replyToken, [{ type: 'text', text: '❌ ยกเลิกแล้วครับ' }]);

        default:
            console.warn('[handlePostback] unknown action', action);
    }
}

// ────────────────────────────────────────────────────────────────────────────
// VIEW TASKS
// ────────────────────────────────────────────────────────────────────────────
async function handleViewTasks(event, groupId, userId) {
    const tasks = await getGroupTasks(groupId);
    const active = tasks.filter((t) => t.status !== 'deleted');

    if (!active.length) {
        return reply(event.replyToken, [
            buildEmptyState('ยังไม่มีงานครับ', 'กดปุ่ม "สร้างงาน" เพื่อเริ่มต้น'),
        ]);
    }

    const memberMap = await getMemberMap(groupId);
    const assignMap = {};
    await Promise.all(
        active.map(async (t) => {
            assignMap[t.taskId] = await getTaskAssignments(groupId, t.taskId);
        })
    );

    return reply(event.replyToken, [buildTaskListCarousel(active, assignMap, memberMap)]);
}

// ────────────────────────────────────────────────────────────────────────────
// RANKING
// ────────────────────────────────────────────────────────────────────────────
async function handleViewRanking(event, groupId) {
    const [board, memberMap] = await Promise.all([
        getLeaderboard(groupId),
        getMemberMap(groupId),
    ]);
    return reply(event.replyToken, [buildLeaderboard(board, memberMap)]);
}

// ────────────────────────────────────────────────────────────────────────────
// HELP
// ────────────────────────────────────────────────────────────────────────────
async function handleHelp(event) {
    return reply(event.replyToken, [buildHelpMessage()]);
}

// ────────────────────────────────────────────────────────────────────────────
// CHECK TASKS (REPLY WITH MENTIONS - 100% FREE QUOTA)
// ────────────────────────────────────────────────────────────────────────────
async function handleCheckTasks(event, groupId) {
    const tasks = await getGroupTasks(groupId);
    const rawActive = tasks.filter(t => t.status !== 'done' && t.status !== 'deleted');

    const pendingTasks = [];
    for (const task of rawActive) {
        const assignList = await getTaskAssignments(groupId, task.taskId);
        const pendingAssignees = assignList.filter(a => a.status !== 'submitted');
        if (pendingAssignees.length > 0) {
            pendingTasks.push({ task, pendingAssignees });
        }
    }

    if (!pendingTasks.length) {
        return reply(event.replyToken, [{ type: 'text', text: '🎉 ไม่มีงานค้างในระบบแล้วครับ ยอดเยี่ยมมากทุกคน!' }]);
    }

    const memberMap = await getMemberMap(groupId);
    const substitution = {};
    const lines = ['📋 สรุปรายการงานที่ยังค้างอยู่:'];

    for (const { task, pendingAssignees } of pendingTasks) {
        const mentionText = pendingAssignees.map(a => {
            const tag = `@${a.lineUserId}`;
            substitution[tag] = { type: 'mention', mentionee: { type: 'user', userId: a.lineUserId } };
            return `{${tag}}`;
        }).join(' ');

        lines.push(`\n🔸 งาน: "${task.taskName}"`);
        lines.push(`⏰ กำหนดส่ง: ${fmt(task.deadline)}`);
        lines.push(`ผู้รับผิดชอบ: ${mentionText}`);
    }

    return client.replyMessage({
        replyToken: event.replyToken,
        messages: [{
            type: 'textV2',
            text: lines.join('\n'),
            substitution
        }]
    }).then(() => console.log('[Webhook Reply] CheckTasks sent successfully'))
        .catch(err => console.error('[Webhook Reply CheckTasks Error]', err.originalError?.response?.data || err.message));
}

// ────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ────────────────────────────────────────────────────────────────────────────
function reply(replyToken, messages) {
    return client.replyMessage({ replyToken, messages })
        .then(() => console.log('[Webhook Reply] Sent successfully'))
        .catch(err => console.error('[Webhook Reply Error]', err.originalError?.response?.data || err.message));
}

function quickReplyItem(label, text) {
    return { type: 'action', action: { type: 'message', label, text } };
}

/**
 * Parse Thai date string DD/MM/YYYY HH:MM
 * Accepts Buddhist Era (พ.ศ.) automatically (year > 2500 → subtract 543).
 */
function parseThaiDate(str) {
    const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    let [, d, mo, y, h, mi] = m.map(Number);
    if (y > 2500) y -= 543; // Buddhist → Gregorian
    const date = new Date(y, mo - 1, d, h, mi);
    return isNaN(date.getTime()) ? null : date;
}

function fmt(date) {
    if (!date) return 'ไม่ระบุ';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString('th-TH', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

module.exports = { handleEvent };
