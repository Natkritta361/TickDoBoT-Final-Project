/**
 * TickDoBot — Firestore Database Schema & Factory Functions
 *
 * Collections:
 *   users/            {Line_UserID}
 *   groups/           {Group_ID}
 *   groups/{id}/members        (sub-collection)
 *   groups/{id}/tasks          (sub-collection)
 *   groups/{id}/tasks/{id}/assignments  (sub-collection)
 *   notificationLogs/ {Noti_ID}
 *
 * Mirrors the ER diagram from the CS303 report (tables 3.20–3.25).
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────────────
// USER  (mirrors Table 3.20)
// ─────────────────────────────────────────────
/**
 * @typedef {Object} User
 * @property {string} lineUserId   PK – LINE User ID
 * @property {string} displayName  Display name from LINE profile
 * @property {string} pictureUrl   Profile picture URL
 * @property {Date}   createdAt
 */
function createUser({ lineUserId, displayName, pictureUrl = '' }) {
    if (!lineUserId) throw new Error('lineUserId is required');
    return {
        lineUserId,
        displayName,
        pictureUrl,
        createdAt: new Date(),
    };
}

// ─────────────────────────────────────────────
// GROUP  (mirrors Table 3.21)
// ─────────────────────────────────────────────
/**
 * @typedef {Object} Group
 * @property {string} groupId      PK – LINE Group ID
 * @property {string} groupName
 * @property {string} groupPicture URL
 * @property {Date}   createdAt
 */
function createGroup({ groupId, groupName = 'Unnamed Group', groupPicture = '' }) {
    if (!groupId) throw new Error('groupId is required');
    return {
        groupId,
        groupName,
        groupPicture,
        createdAt: new Date(),
    };
}

// ─────────────────────────────────────────────
// USER-GROUP  (mirrors Table 3.22 — stored as sub-collection members/)
// ─────────────────────────────────────────────
/**
 * @typedef {Object} UserGroup
 * @property {string} lineUserId   FK → users
 * @property {string} groupId     FK → groups
 * @property {'admin'|'member'} role
 * @property {Date}   joinedAt
 */
function createUserGroup({ lineUserId, groupId, role = 'member' }) {
    return { lineUserId, groupId, role, joinedAt: new Date() };
}

// ─────────────────────────────────────────────
// TASK  (mirrors Table 3.23)
// ─────────────────────────────────────────────
/**
 * @typedef {Object} Task
 * @property {string}   taskId
 * @property {string}   groupId     FK → groups
 * @property {string}   taskName
 * @property {string}   description
 * @property {string}   createdBy   FK → users (lineUserId)
 * @property {Date}     createdAt
 * @property {Date}     deadline
 * @property {'pending'|'done'|'overdue'} status
 */
function createTask({ groupId, taskName, description = '', createdBy, deadline }) {
    if (!groupId || !taskName || !createdBy || !deadline)
        throw new Error('groupId, taskName, createdBy, deadline are required');
    return {
        taskId: uuidv4(),
        groupId,
        taskName,
        description,
        createdBy,
        createdAt: new Date(),
        deadline: new Date(deadline),
        status: 'pending',
    };
}

// ─────────────────────────────────────────────
// TASK ASSIGNMENT  (mirrors Table 3.24)
// ─────────────────────────────────────────────
/**
 * @typedef {Object} TaskAssignment
 * @property {string}   assignmentId
 * @property {string}   taskId       FK → tasks
 * @property {string}   groupId      FK → groups
 * @property {string}   lineUserId   FK → users  (assignee)
 * @property {'pending'|'submitted'|'late'} status
 * @property {Date|null} submitTime
 * @property {string}   proofUrl     optional proof-of-work file url
 * @property {string}   proofNote
 */
function createAssignment({ taskId, groupId, lineUserId }) {
    if (!taskId || !groupId || !lineUserId)
        throw new Error('taskId, groupId, lineUserId required');
    return {
        assignmentId: uuidv4(),
        taskId,
        groupId,
        lineUserId,
        status: 'pending',
        submitTime: null,
        proofUrl: null,
        proofNote: '',
        createdAt: new Date(),
    };
}

// ─────────────────────────────────────────────
// NOTIFICATION LOG  (mirrors Table 3.25)
// ─────────────────────────────────────────────
/**
 * @typedef {Object} NotificationLog
 * @property {string} notiId
 * @property {string} assignmentId FK
 * @property {string} taskId       FK
 * @property {string} lineUserId   FK  (recipient)
 * @property {string} groupId      FK
 * @property {'reminder_24h'|'reminder_1h'|'overdue'|'submitted'} type
 * @property {Date}   sentTime
 */
function createNotificationLog({ assignmentId, taskId, lineUserId, groupId, type }) {
    return {
        notiId: uuidv4(),
        assignmentId,
        taskId,
        lineUserId,
        groupId,
        type,
        sentTime: new Date(),
    };
}

module.exports = {
    createUser,
    createGroup,
    createUserGroup,
    createTask,
    createAssignment,
    createNotificationLog,
};
