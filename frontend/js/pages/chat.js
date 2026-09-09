/**
 * Global Chat Script (community.html)
 * Real-time global chat with polling, message rendering (DM-style bubbles —
 * see renderMessage()), and cooldown-based rate limiting.
 */
import { AuthModule } from '../modules/auth.js';
import { API_BASE_URL } from '../config.js';
import { I18nModule } from '../modules/i18n.js?v=20260909c';
import { alertModal } from '../utils/confirm-modal.js';

const POLL_INTERVAL = 5000;
const COOLDOWN_MS = 3000;
const AVATAR_COLORS = ['#5B8CFF', '#43B581', '#9B59B6', '#FF6B6B', '#F0A830'];

const messagesEl = document.getElementById('chat-messages');
const loadingEl = document.getElementById('chat-loading');
const formEl = document.getElementById('chat-form');
const inputEl = document.getElementById('chat-input');
const sendBtn = document.getElementById('chat-send-btn');
const loginNotice = document.getElementById('chat-login-notice');
const mutedNotice = document.getElementById('chat-muted-notice');
const mutedText = document.getElementById('chat-muted-text');
const backBtn = document.getElementById('chat-back');

// (2026-09-01) community.js's showView('chat') fullscreens Chat on mobile the same way it
// already does for a forum thread/listing/DM (site navbar + bottom tab bar hidden) — see its
// setMobileFullscreen(). Chat is now reached from the merged chat list (general chat pinned
// atop the DM list, see community.js's loadConversations()) rather than being its own bottom-nav
// destination, so this button returns there — window.cnCommunityBackToChatList is exposed by
// community.js for exactly this (chat.js is a wholly separate script/module scope, can't import
// it directly). The manual un-hide is kept as a fallback for the unlikely case view-chat is ever
// reached some other way.
backBtn?.addEventListener('click', () => {
    if (typeof window.cnCommunityBackToChatList === 'function') {
        window.cnCommunityBackToChatList();
        return;
    }
    document.querySelector('.navbar')?.classList.remove('navbar--hidden');
    document.getElementById('mobile-bottom-nav')?.classList.remove('mbn--hidden');
    document.body.classList.remove('hub-mobile-fullscreen');
});

const user = AuthModule.getCurrentUser();
let lastMessageId = 0;
let cooldownActive = false;
let lastMsgUser = '';
let lastMsgDate = '';
// (2026-09-01) Own mute state — same rationale as community.js's identical block: the
// cached user object never carries a live muted_until, so this is refreshed from the
// server periodically instead. Kept local to this page (chat.js and community.js load on
// different views and don't share module scope).
let myMutedUntil = null;

// Show form or login notice
if (user) {
    formEl.hidden = false;
} else {
    loginNotice.hidden = false;
}

/** Hours left on a mute (rounded up, min 1 while active), or null if not muted / expired. */
function mutedHoursRemaining() {
    if (!myMutedUntil) return null;
    const until = new Date(myMutedUntil).getTime();
    if (isNaN(until) || until <= Date.now()) return null;
    return Math.max(1, Math.ceil((until - Date.now()) / 3600000));
}

async function refreshMuteStatus() {
    if (!user) return;
    try {
        const token = localStorage.getItem('cn_token');
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const res = await fetch(API_BASE_URL + '/me', { headers, credentials: 'include' });
        const data = await res.json();
        if (data.success && data.user) myMutedUntil = data.user.muted_until || null;
    } catch { /* keep previous value on a transient failure */ }

    const hours = mutedHoursRemaining();
    if (mutedNotice) {
        formEl.hidden = hours !== null;
        mutedNotice.hidden = hours === null;
        if (hours !== null) {
            mutedText.textContent = I18nModule.t('chat_muted_notice').replace('{hours}', hours);
        }
    }
}
if (user) {
    refreshMuteStatus();
    setInterval(refreshMuteStatus, 15000);
}

// Auto-resize textarea (matches the DM composer's own input, which has no character counter
// either — general chat dropped its counter when its bubble design was unified with DM's)
inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
});

// Enter to send, Shift+Enter for new line
inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        formEl.requestSubmit();
    }
});

/** Escape HTML special characters */
function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Get deterministic color for a username */
function getUserColor(username) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** Format timestamp as HH:MM */
function formatTimeShort(dateStr) {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

/** Get date label for dividers */
function getDateLabel(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (msgDate.getTime() === today.getTime()) return 'Today';
    if (msgDate.getTime() === yesterday.getTime()) return 'Yesterday';
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Render a single chat message DOM element — same bubble markup/classes as a DM message
 * (.hub-dm-msg-row/.hub-dm-msg, see community.js's renderMessageHtml()), since general chat is
 * now just another conversation reached from the merged chat list rather than a differently-
 * styled destination. Unlike DM there can be more than one "theirs" sender, so a small name
 * label is shown above the first bubble of a run from someone else — mirrors the app's own
 * `showAuthor = newGroup && isGroup` in ChatScreen.kt's buildRows(). No avatar-per-message
 * either way, matching DM's own bubble-only look (avatars only ever show in a conversation list). */
function renderMessage(msg, grouped) {
    const mine = !!(user && msg.user.id === user.id);
    const isSticker = msg.attachment?.type === 'sticker';
    const time = formatTimeShort(msg.created_at);

    const row = document.createElement('div');
    row.className = `hub-dm-msg-row hub-dm-msg-row--${mine ? 'mine' : 'theirs'}${grouped ? ' hub-dm-msg-row--stacked' : ''}`;
    row.dataset.id = msg.id;
    row.dataset.user = msg.user.username;

    const senderHtml = (!mine && !grouped)
        ? `<a href="/user/${encodeURIComponent(msg.user.username)}" class="hub-dm-msg__sender" style="color:${getUserColor(msg.user.username)}">${escapeHtml(msg.user.username)}</a>`
        : '';
    const attachmentHtml = (isSticker && msg.attachment?.url)
        ? `<img class="hub-dm-msg__sticker-img" src="${escapeHtml(msg.attachment.url)}" alt="">`
        : '';

    row.innerHTML = `
        ${senderHtml}
        <div class="hub-dm-msg hub-dm-msg--${mine ? 'mine' : 'theirs'}${isSticker ? ' hub-dm-msg--sticker' : ''}">
            ${attachmentHtml}
            ${msg.message ? `<div class="hub-dm-msg__text">${escapeHtml(msg.message)}</div>` : ''}
        </div>
        <div class="hub-dm-msg__time">${time}</div>`;
    return row;
}

/** Append a message with date divider + grouping logic */
function appendMessage(msg) {
    const dateLabel = getDateLabel(msg.created_at);
    if (dateLabel !== lastMsgDate) {
        const divider = document.createElement('div');
        divider.className = 'chat-date-divider';
        divider.innerHTML = `<span>${dateLabel}</span>`;
        messagesEl.appendChild(divider);
        lastMsgDate = dateLabel;
        lastMsgUser = '';
    }
    const grouped = msg.user.username === lastMsgUser;
    messagesEl.appendChild(renderMessage(msg, grouped));
    lastMsgUser = msg.user.username;
}

/** Show the empty state — reuses the DM thread's own plain "send the first message" text
 * (dm_first_message) instead of the old chat-specific empty-state card, and #chat-loading's
 * class already switched to .hub-dm-empty in the HTML to match. Clicking it focuses the
 * composer, same intent as the old dedicated button. */
function showEmptyState() {
    loadingEl.textContent = I18nModule.t('dm_first_message');
    loadingEl.hidden = false;
}
loadingEl.addEventListener('click', () => inputEl.focus());

function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

/** Fetch new messages from API and append to chat */
async function fetchMessages() {
    try {
        const token = localStorage.getItem('cn_token');
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const res = await fetch(API_BASE_URL + '/chat/messages', {
            headers,
            credentials: 'include'
        });
        const data = await res.json();

        if (data.success && data.messages) {
            loadingEl.hidden = true;

            if (data.messages.length === 0 && messagesEl.children.length <= 1) {
                showEmptyState();
                return;
            }

            // Only append new messages (after lastMessageId)
            const newMessages = data.messages.filter(m => m.id > lastMessageId);
            if (newMessages.length > 0) {
                newMessages.forEach(appendMessage);
                lastMessageId = newMessages[newMessages.length - 1].id;
                scrollToBottom();
            }
        }
    } catch {
        // On error, show empty state instead of stuck spinner
        if (loadingEl && !loadingEl.hidden) {
            showEmptyState();
        }
    }
}

// Send message
formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text || cooldownActive) return;

    sendBtn.disabled = true;
    cooldownActive = true;

    try {
        const token = localStorage.getItem('cn_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const res = await fetch(API_BASE_URL + '/chat/messages', {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({ message: text })
        });
        const data = await res.json();

        if (data.success && data.message) {
            // Hide the "no messages" text
            loadingEl.hidden = true;
            appendMessage(data.message);
            lastMessageId = Math.max(lastMessageId, data.message.id);
            inputEl.value = '';
            inputEl.style.height = 'auto';
            scrollToBottom();
            window.dispatchEvent(new CustomEvent('cn:message-sent'));
        } else {
            alertModal(data.error || 'Could not send the message.');
        }
    } catch {
        alertModal('Could not reach the server.');
    }

    // Cooldown
    setTimeout(() => {
        cooldownActive = false;
        sendBtn.disabled = false;
    }, COOLDOWN_MS);
});

// Initial load + auto-refresh polling
fetchMessages();
setInterval(fetchMessages, POLL_INTERVAL);

// Timeout fallback — if first load fails or hangs, show empty state after 5s
setTimeout(() => {
    if (loadingEl && !loadingEl.hidden) {
        showEmptyState();
    }
}, 5000);
