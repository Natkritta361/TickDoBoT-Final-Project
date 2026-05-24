'use strict';

/**
 * TickDoBot — Flex Message JSON Builders
 *
 * All functions return objects ready to be placed inside a LINE
 * `messages` array as `{ type: 'flex', altText, contents }`.
 *
 * LINE Flex Message playground: https://developers.line.biz/flex-simulator/
 */

const COLORS = {
    green: '#06C755',   // LINE brand green
    red: '#FF334B',
    orange: '#FF8C00',
    gray: '#888888',
    darkBg: '#1A1A2E',
    cardBg: '#FFFFFF',
    textPrimary: '#1A1A2E',
    textSecondary: '#666666',
    badge_pending: '#FF8C00',
    badge_submitted: '#06C755',
    badge_overdue: '#FF334B',
};

// ── Status badge helper ──────────────────────────────────────────────────────
function statusBadge(status) {
    const map = {
        pending: { text: '⏳ Pending', color: COLORS.badge_pending },
        submitted: { text: '✅ Done', color: COLORS.badge_submitted },
        overdue: { text: '🚨 Overdue', color: COLORS.badge_overdue },
        late: { text: '⚠️ Late', color: COLORS.badge_overdue },
    };
    return map[status] || { text: status, color: COLORS.gray };
}

// ── Date format helper ───────────────────────────────────────────────────────
function fmt(date) {
    if (!date) return 'No deadline';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString('th-TH', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function isUrgent(deadline) {
    if (!deadline) return false;
    const d = deadline instanceof Date ? deadline : new Date(deadline);
    const diff = d - Date.now();
    return diff > 0 && diff < 24 * 60 * 60 * 1000; // within 24 h
}

// ────────────────────────────────────────────────────────────────────────────
// 1. TASK CARD — single task with member assignment list
// ────────────────────────────────────────────────────────────────────────────
/**
 * @param {Object} task          Task document
 * @param {Array}  assignments   Array of assignment docs
 * @param {Object} memberMap     { lineUserId: displayName }
 */
function buildTaskCard(task, assignments = [], memberMap = {}) {
    const urgent = isUrgent(task.deadline);
    const deadlineColor = urgent ? COLORS.red : COLORS.textSecondary;
    const badge = statusBadge(task.status || 'pending');

    // Determine if task is fully done
    const taskDone = task.status === 'done' || task.status === 'completed' ||
        (assignments.length > 0 && assignments.every(a => a.status === 'submitted'));

    // Member rows with submission time
    const memberRows2 = assignments.map((a) => {
        const b = statusBadge(a.status);
        let submittedTime = '';
        if (a.status === 'submitted' && a.submittedAt) {
            const d = a.submittedAt.toDate ? a.submittedAt.toDate() : new Date(a.submittedAt);
            submittedTime = ` · ${d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })}`;
        }
        return {
            type: 'box',
            layout: 'horizontal',
            margin: 'sm',
            contents: [
                {
                    type: 'text',
                    text: memberMap[a.lineUserId] || a.lineUserId,
                    size: 'sm',
                    color: COLORS.textPrimary,
                    flex: 3,
                    wrap: true,
                },
                {
                    type: 'text',
                    text: b.text + submittedTime,
                    size: 'xs',
                    color: b.color,
                    flex: 2,
                    align: 'end',
                    weight: 'bold',
                    wrap: true,
                },
            ],
        };
    });

    const footerButtons = [];
    if (!taskDone) {
        footerButtons.push({
            type: 'button',
            style: 'primary',
            color: COLORS.green,
            height: 'sm',
            action: {
                type: 'uri',
                label: '✅ Submit My Work',
                uri: `${process.env.LIFF_BASE_URL}/confirm?groupId=${task.groupId}&taskId=${task.taskId}`
            },
        });
        footerButtons.push({
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: {
                type: 'uri',
                label: '✏️ Edit Task',
                uri: `${process.env.LIFF_BASE_URL}/create-task?groupId=${task.groupId}&taskId=${task.taskId}&mode=edit`
            },
        });
    }

    return {
        type: 'bubble',
        size: 'kilo',
        header: {
            type: 'box',
            layout: 'vertical',
            backgroundColor: COLORS.darkBg,
            paddingAll: 'lg',
            contents: [
                {
                    type: 'text',
                    text: 'TASK',
                    size: 'xxs',
                    color: '#AAAAAA',
                },
                {
                    type: 'text',
                    text: task.taskName,
                    size: 'xl',
                    color: '#FFFFFF',
                    weight: 'bold',
                    wrap: true,
                    margin: 'xs',
                },
                {
                    type: 'box',
                    layout: 'horizontal',
                    margin: 'md',
                    contents: [
                        {
                            type: 'text',
                            text: badge.text,
                            size: 'xs',
                            color: badge.color,
                            weight: 'bold',
                        },
                    ],
                },
            ],
        },
        body: {
            type: 'box',
            layout: 'vertical',
            paddingAll: 'lg',
            spacing: 'sm',
            contents: [
                // Description
                task.description
                    ? {
                        type: 'text',
                        text: task.description,
                        size: 'sm',
                        color: COLORS.textSecondary,
                        wrap: true,
                        margin: 'none',
                    }
                    : null,
                // Deadline
                {
                    type: 'box',
                    layout: 'horizontal',
                    margin: 'md',
                    contents: [
                        { type: 'text', text: '📅 Deadline', size: 'sm', color: COLORS.textSecondary, flex: 2 },
                        {
                            type: 'text',
                            text: fmt(task.deadline),
                            size: 'sm',
                            color: deadlineColor,
                            weight: urgent ? 'bold' : 'regular',
                            flex: 3,
                            align: 'end',
                            wrap: true,
                        },
                    ],
                },
                // Divider
                { type: 'separator', margin: 'md', color: '#EEEEEE' },
                // Members header
                {
                    type: 'text',
                    text: 'MEMBERS',
                    size: 'xxs',
                    color: '#AAAAAA',
                    margin: 'md',
                },
                ...memberRows2,
            ].filter(Boolean),
        },
        ...(footerButtons.length > 0 ? {
            footer: {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                paddingAll: 'lg',
                contents: footerButtons,
            },
        } : {}),
    };
}

// ────────────────────────────────────────────────────────────────────────────
// 2. TASK LIST CAROUSEL — multiple tasks as a scrollable carousel
// ────────────────────────────────────────────────────────────────────────────
/**
 * @param {Array}  tasks       Array of task docs
 * @param {Object} assignMap   { taskId: [assignments] }
 * @param {Object} memberMap   { lineUserId: displayName }
 */
function buildTaskListCarousel(tasks, assignMap = {}, memberMap = {}) {
    if (!tasks.length) {
        return buildEmptyState('No tasks yet!', 'Use the menu below to create your first task.');
    }

    const bubbles = tasks.map((t) =>
        buildTaskCard(t, assignMap[t.taskId] || [], memberMap)
    );

    return {
        type: 'flex',
        altText: `📋 Task List (${tasks.length} tasks)`,
        contents: {
            type: 'carousel',
            contents: bubbles,
        },
    };
}

// ────────────────────────────────────────────────────────────────────────────
// 3. LEADERBOARD MESSAGE
// ────────────────────────────────────────────────────────────────────────────
/**
 * @param {Array}  leaderboard  [{ lineUserId, points }] sorted desc
 * @param {Object} memberMap    { lineUserId: displayName }
 */
function buildLeaderboard(leaderboard, memberMap = {}) {
    const medals = ['🥇', '🥈', '🥉'];

    const rows = leaderboard.slice(0, 10).map((entry, i) => ({
        type: 'box',
        layout: 'horizontal',
        paddingAll: 'sm',
        backgroundColor: i === 0 ? '#FFF8E1' : '#FFFFFF',
        cornerRadius: 'md',
        margin: 'xs',
        contents: [
            {
                type: 'text',
                text: medals[i] || `${i + 1}.`,
                size: 'lg',
                flex: 1,
                gravity: 'center',
            },
            {
                type: 'text',
                text: memberMap[entry.lineUserId] || entry.lineUserId,
                size: 'md',
                flex: 5,
                gravity: 'center',
                color: COLORS.textPrimary,
                weight: i === 0 ? 'bold' : 'regular',
            },
            {
                type: 'text',
                text: `${entry.points} pts`,
                size: 'md',
                flex: 2,
                align: 'end',
                gravity: 'center',
                color: i === 0 ? COLORS.green : COLORS.textSecondary,
                weight: 'bold',
            },
        ],
    }));

    return {
        type: 'flex',
        altText: '🏆 Task Submission Ranking',
        contents: {
            type: 'bubble',
            size: 'kilo',
            header: {
                type: 'box',
                layout: 'vertical',
                backgroundColor: COLORS.darkBg,
                paddingAll: 'xl',
                contents: [
                    { type: 'text', text: '🏆', size: 'xxl', align: 'center' },
                    {
                        type: 'text',
                        text: 'LEADERBOARD',
                        size: 'lg',
                        color: '#FFFFFF',
                        weight: 'bold',
                        align: 'center',
                        margin: 'sm',
                    },
                    {
                        type: 'text',
                        text: 'On-time submissions ranking',
                        size: 'xs',
                        color: '#AAAAAA',
                        align: 'center',
                    },
                ],
            },
            body: {
                type: 'box',
                layout: 'vertical',
                paddingAll: 'lg',
                spacing: 'xs',
                contents: rows.length > 0
                    ? rows
                    : [{ type: 'text', text: 'No submissions yet.', color: COLORS.gray, align: 'center' }],
            },
        },
    };
}

// ────────────────────────────────────────────────────────────────────────────
// 4. DEADLINE REMINDER — nudge card sent by the scheduler
// ────────────────────────────────────────────────────────────────────────────
/**
 * @param {Object} task
 * @param {string[]} pendingNames  Display names of members who haven't submitted
 */
function buildReminderMessage(task, pendingNames = []) {
    const urgent = isUrgent(task.deadline);

    return {
        type: 'flex',
        altText: `⏰ Reminder: ${task.taskName} deadline approaching!`,
        contents: {
            type: 'bubble',
            size: 'kilo',
            body: {
                type: 'box',
                layout: 'vertical',
                backgroundColor: urgent ? '#FFF3F3' : '#FFFDE7',
                paddingAll: 'xl',
                contents: [
                    {
                        type: 'text',
                        text: urgent ? '🚨 URGENT REMINDER' : '⏰ DEADLINE REMINDER',
                        size: 'sm',
                        color: urgent ? COLORS.red : COLORS.orange,
                        weight: 'bold',
                    },
                    {
                        type: 'text',
                        text: task.taskName,
                        size: 'xl',
                        weight: 'bold',
                        color: COLORS.textPrimary,
                        wrap: true,
                        margin: 'sm',
                    },
                    {
                        type: 'text',
                        text: `📅 Due: ${fmt(task.deadline)}`,
                        size: 'sm',
                        color: urgent ? COLORS.red : COLORS.textSecondary,
                        margin: 'md',
                        weight: urgent ? 'bold' : 'regular',
                    },
                    { type: 'separator', margin: 'lg', color: '#DDDDDD' },
                    {
                        type: 'text',
                        text: 'Still pending:',
                        size: 'xs',
                        color: COLORS.textSecondary,
                        margin: 'lg',
                    },
                    {
                        type: 'text',
                        text: pendingNames.map((n) => `• ${n}`).join('\n') || 'Everyone submitted! 🎉',
                        size: 'sm',
                        color: COLORS.textPrimary,
                        wrap: true,
                        margin: 'xs',
                    },
                ],
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                paddingAll: 'lg',
                contents: [
                    {
                        type: 'button',
                        style: 'primary',
                        color: COLORS.green,
                        action: {
                            type: 'postback',
                            label: '✅ Submit Now',
                            data: `action=submit&taskId=${task.taskId}&groupId=${task.groupId}`,
                        },
                    },
                ],
            },
        },
    };
}

// ────────────────────────────────────────────────────────────────────────────
// 5. EMPTY STATE
// ────────────────────────────────────────────────────────────────────────────
function buildEmptyState(title, subtitle) {
    return {
        type: 'flex',
        altText: title,
        contents: {
            type: 'bubble',
            body: {
                type: 'box',
                layout: 'vertical',
                paddingAll: 'xxl',
                alignItems: 'center',
                contents: [
                    { type: 'text', text: '📭', size: 'xxl', align: 'center' },
                    { type: 'text', text: title, size: 'lg', weight: 'bold', align: 'center', margin: 'md', color: COLORS.textPrimary },
                    { type: 'text', text: subtitle, size: 'sm', color: COLORS.textSecondary, align: 'center', wrap: true, margin: 'sm' },
                ],
            },
        },
    };
}

// ────────────────────────────────────────────────────────────────────────────
// 6. CONFIRMATION DIALOG — for delete / submit confirmations
// ────────────────────────────────────────────────────────────────────────────
function buildConfirmDialog({ title, body, confirmData, cancelData }) {
    return {
        type: 'flex',
        altText: title,
        contents: {
            type: 'bubble',
            body: {
                type: 'box',
                layout: 'vertical',
                paddingAll: 'xl',
                contents: [
                    { type: 'text', text: '⚠️', size: 'xxl', align: 'center' },
                    { type: 'text', text: title, size: 'lg', weight: 'bold', align: 'center', margin: 'md', color: COLORS.textPrimary },
                    { type: 'text', text: body, size: 'sm', color: COLORS.textSecondary, align: 'center', wrap: true, margin: 'sm' },
                ],
            },
            footer: {
                type: 'box',
                layout: 'horizontal',
                spacing: 'sm',
                paddingAll: 'lg',
                contents: [
                    {
                        type: 'button',
                        style: 'secondary',
                        flex: 1,
                        action: { type: 'postback', label: 'Cancel', data: cancelData },
                    },
                    {
                        type: 'button',
                        style: 'primary',
                        color: COLORS.red,
                        flex: 1,
                        action: { type: 'postback', label: 'Confirm', data: confirmData },
                    },
                ],
            },
        },
    };
}

// ────────────────────────────────────────────────────────────────────────────
// 7. HELP MESSAGE
// ────────────────────────────────────────────────────────────────────────────
function buildHelpMessage() {
    return {
        type: 'flex',
        altText: 'คู่มือการใช้งาน TickDoBot',
        contents: {
            type: 'bubble',
            size: 'mega',
            header: {
                type: 'box',
                layout: 'vertical',
                backgroundColor: '#1E293B',
                paddingAll: 'xl',
                contents: [
                    {
                        type: 'text',
                        text: 'คู่มือการใช้งาน',
                        size: 'xs',
                        color: '#94A3B8',
                        weight: 'bold'
                    },
                    {
                        type: 'text',
                        text: 'TickDoBot',
                        size: 'xxl',
                        color: '#FFFFFF',
                        weight: 'bold',
                        margin: 'xs'
                    }
                ]
            },
            body: {
                type: 'box',
                layout: 'vertical',
                paddingAll: 'xl',
                contents: [
                    {
                        type: 'text',
                        text: 'คำสั่งที่รองรับ',
                        size: 'md',
                        color: '#10B981',
                        weight: 'bold'
                    },
                    { type: 'separator', margin: 'md', color: '#E2E8F0' },
                    {
                        type: 'box',
                        layout: 'horizontal',
                        margin: 'md',
                        alignItems: 'flex-start',
                        contents: [
                            { type: 'text', text: '📝', size: 'md', flex: 1 },
                            {
                                type: 'box',
                                layout: 'vertical',
                                flex: 7,
                                contents: [
                                    { type: 'text', text: '"สร้างงาน" / "create"', size: 'sm', weight: 'bold', color: '#0F172A' },
                                    { type: 'text', text: 'เริ่มต้นโปรเจกต์ใหม่และมอบหมายงานให้เพื่อน', size: 'xs', color: '#64748B', wrap: true, margin: 'xs' }
                                ]
                            }
                        ]
                    },
                    {
                        type: 'box',
                        layout: 'horizontal',
                        margin: 'md',
                        alignItems: 'flex-start',
                        contents: [
                            { type: 'text', text: '📋', size: 'md', flex: 1 },
                            {
                                type: 'box',
                                layout: 'vertical',
                                flex: 7,
                                contents: [
                                    { type: 'text', text: '"ดูงาน" / "tasks"', size: 'sm', weight: 'bold', color: '#0F172A' },
                                    { type: 'text', text: 'ดูรายการงานทั้งหมด สถานะ และความคืบหน้า', size: 'xs', color: '#64748B', wrap: true, margin: 'xs' }
                                ]
                            }
                        ]
                    },
                    {
                        type: 'box',
                        layout: 'horizontal',
                        margin: 'md',
                        alignItems: 'flex-start',
                        contents: [
                            { type: 'text', text: '🏆', size: 'md', flex: 1 },
                            {
                                type: 'box',
                                layout: 'vertical',
                                flex: 7,
                                contents: [
                                    { type: 'text', text: '"อันดับ" / "ranking"', size: 'sm', weight: 'bold', color: '#0F172A' },
                                    { type: 'text', text: 'ตรวจสอบคะแนนสะสมและอันดับในทีม', size: 'xs', color: '#64748B', wrap: true, margin: 'xs' }
                                ]
                            }
                        ]
                    },
                    {
                        type: 'box',
                        layout: 'horizontal',
                        margin: 'md',
                        alignItems: 'flex-start',
                        contents: [
                            { type: 'text', text: '🌐', size: 'md', flex: 1 },
                            {
                                type: 'box',
                                layout: 'vertical',
                                flex: 7,
                                contents: [
                                    { type: 'text', text: '"เปลี่ยนภาษา" / "/lang"', size: 'sm', weight: 'bold', color: '#0F172A' },
                                    { type: 'text', text: 'ตั้งค่าภาษาของบอท (รองรับ ไทย/English)', size: 'xs', color: '#64748B', wrap: true, margin: 'xs' }
                                ]
                            }
                        ]
                    },
                    { type: 'separator', margin: 'lg', color: '#E2E8F0' },
                    {
                        type: 'box',
                        layout: 'horizontal',
                        margin: 'md',
                        contents: [
                            { type: 'text', text: '💡', size: 'xs', flex: 1, align: 'center' },
                            { type: 'text', text: 'พิมพ์คำสั่งเหล่านี้ในแชทเพื่อเรียกใช้งานได้ทันที!', size: 'xs', color: '#94A3B8', flex: 8, wrap: true }
                        ]
                    }
                ]
            }
        }
    };
}

// ────────────────────────────────────────────────────────────────────────────
// 8. CREATE TASK PROMPT (Screenshot 1)
// ────────────────────────────────────────────────────────────────────────────
function buildCreateTaskPrompt(groupId) {
    const liffUrl = `${process.env.LIFF_BASE_URL}/create-task?groupId=${groupId}`;
    return {
        type: 'flex',
        altText: 'สร้างงานใหม่',
        contents: {
            type: 'bubble',
            size: 'mega',
            body: {
                type: 'box',
                layout: 'vertical',
                paddingAll: 'xl',
                contents: [
                    { type: 'text', text: 'CREATE TASK', size: 'xs', color: '#10B981', weight: 'bold' },
                    { type: 'text', text: 'สร้างงานและโปรเจกต์ใหม่', size: 'xl', weight: 'bold', color: '#0F172A', margin: 'xs' },
                    { type: 'text', text: 'คลิกด้านล่างเพื่อเริ่มต้นวางแผนและมอบหมายงานให้สมาชิกในทีม', size: 'sm', color: '#64748B', wrap: true, margin: 'md' },
                    {
                        type: 'button',
                        style: 'primary',
                        color: '#1E293B',
                        margin: 'lg',
                        action: { type: 'uri', label: '📝 เปิดหน้าวางแผนงาน (LIFF)', uri: liffUrl }
                    }
                ]
            }
        }
    };
}

// ────────────────────────────────────────────────────────────────────────────
// 9. VIEW TASKS PROMPT (Screenshot 2)
// ────────────────────────────────────────────────────────────────────────────
function buildViewTasksPrompt(groupId) {
    const liffUrl = `${process.env.LIFF_BASE_URL}/?groupId=${groupId}`;
    return {
        type: 'flex',
        altText: 'รายการงานทั้งหมด',
        contents: {
            type: 'bubble',
            size: 'mega',
            body: {
                type: 'box',
                layout: 'vertical',
                paddingAll: 'xl',
                alignItems: 'center',
                contents: [
                    { type: 'text', text: '📋', size: 'xxl', margin: 'md' },
                    { type: 'text', text: 'รายการงานทั้งหมด', size: 'lg', weight: 'bold', color: '#0F172A', margin: 'md' },
                    { type: 'text', text: 'ดูรายการงาน สถานะ และตรวจสอบหลักฐานการส่งงานทั้งหมดของทีม', size: 'xs', color: '#64748B', align: 'center', wrap: true, margin: 'sm' },
                    {
                        type: 'button',
                        style: 'primary',
                        color: '#10B981',
                        margin: 'lg',
                        action: { type: 'uri', label: '📋 เปิดแดชบอร์ด (LIFF)', uri: liffUrl }
                    }
                ]
            }
        }
    };
}

// ────────────────────────────────────────────────────────────────────────────
// 10. RANKING PROMPT (Screenshot 2)
// ────────────────────────────────────────────────────────────────────────────
function buildRankingPrompt(groupId) {
    const liffUrl = `${process.env.LIFF_BASE_URL}/ranking?groupId=${groupId}`;
    return {
        type: 'flex',
        altText: 'อันดับผลการทำงาน',
        contents: {
            type: 'bubble',
            size: 'mega',
            body: {
                type: 'box',
                layout: 'vertical',
                paddingAll: 'xl',
                alignItems: 'center',
                contents: [
                    { type: 'text', text: '🏆', size: 'xxl', margin: 'md' },
                    { type: 'text', text: 'อันดับผลการทำงาน', size: 'lg', weight: 'bold', color: '#0F172A', margin: 'md' },
                    { type: 'text', text: 'ตรวจสอบคะแนนความขยัน สถิติการส่งงาน และอันดับของทุกคนในทีม', size: 'xs', color: '#64748B', align: 'center', wrap: true, margin: 'sm' },
                    {
                        type: 'button',
                        style: 'primary',
                        color: '#F59E0B',
                        margin: 'lg',
                        action: { type: 'uri', label: '🏆 ดูอันดับ (LIFF)', uri: liffUrl }
                    }
                ]
            }
        }
    };
}

// ────────────────────────────────────────────────────────────────────────────
// 11. JOIN PROMPT (Screenshot 3)
// ────────────────────────────────────────────────────────────────────────────
function buildJoinPrompt(groupId) {
    return {
        type: 'flex',
        altText: 'เข้าร่วมทีม TickDoBot',
        contents: {
            type: 'bubble',
            size: 'mega',
            body: {
                type: 'box',
                layout: 'vertical',
                paddingAll: 'xl',
                contents: [
                    { type: 'text', text: 'WELCOME TO TICKDOBOT', size: 'xs', color: '#10B981', weight: 'bold' },
                    { type: 'text', text: 'เข้าร่วมทีม TickDoBot', size: 'xl', weight: 'bold', color: '#0F172A', margin: 'xs' },
                    { type: 'text', text: 'คลิกปุ่มด้านล่างเพื่อเปิดใช้งานระบบแจ้งเตือนและติดตามงานของทีม', size: 'sm', color: '#64748B', wrap: true, margin: 'md' },
                    {
                        type: 'button',
                        style: 'primary',
                        color: '#1E293B',
                        margin: 'lg',
                        action: { type: 'postback', label: '✅ กดเข้าร่วมทีม (JOIN)', data: `action=join&groupId=${groupId}` }
                    }
                ]
            }
        }
    };
}

module.exports = {
    buildTaskCard,
    buildTaskListCarousel,
    buildLeaderboard,
    buildReminderMessage,
    buildEmptyState,
    buildConfirmDialog,
    buildHelpMessage,
    buildCreateTaskPrompt,
    buildViewTasksPrompt,
    buildRankingPrompt,
    buildJoinPrompt,
};
