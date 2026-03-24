/**
 * mail-unmess — Content Script
 *
 * Injects a Chat View button into Gmail's thread toolbar, allowing the user to:
 *   - View the conversation as a chat / ticket-system-style overlay.
 *   - Reply quickly without leaving the chat view.
 */

(function () {
  'use strict';

  const OVERLAY_ID        = 'mail-unmess-overlay';
  const CHAT_BTN_ID       = 'mu-chat-btn';
  const EXPAND_DELAY_MS   = 500;  // time to let Gmail finish expanding messages
  const OBSERVER_TIMEOUT_MS = 15000; // give up injecting the chat button after this

  let currentThreadId = null;
  let chatActive      = false;
  let chatBtnObserver = null;

  // ─── Utility ──────────────────────────────────────────────────────────────

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Thread ID helpers ────────────────────────────────────────────────────

  /**
   * Extract a thread ID from the current Gmail URL.
   * Gmail URLs look like: https://mail.google.com/mail/u/0/#inbox/FMfcgzGxxx
   * The hash fragment after the last '/' is the thread ID.
   */
  function getThreadIdFromURL() {
    const hash = window.location.hash; // e.g. "#inbox/FMfcgzGxxx"
    const parts = hash.split('/');
    const candidate = parts[parts.length - 1];
    // Thread IDs are long hex-like strings; filter out short/generic segments.
    if (candidate && candidate.length > 6 && !/^(inbox|sent|drafts|spam|trash|starred|all|search)$/i.test(candidate)) {
      return candidate;
    }
    return null;
  }

  // ─── Gmail DOM parsing ────────────────────────────────────────────────────

  /**
   * Extract email messages from Gmail's thread DOM.
   * Each `.adn` wrapper is one email; `.a3s` holds the visible body.
   * Returns an array of { senderName, senderEmail, timestamp, bodyText }.
   */
  function parseGmailMessages() {
    const messages = [];

    document.querySelectorAll('.adn').forEach(function (el) {
      // Only process emails that have an expanded body.
      const bodyEl = el.querySelector('.a3s.aiL') || el.querySelector('.a3s') || el.querySelector('.ii.gt');
      if (!bodyEl) return;

      // Clone the body and strip quoted / forwarded content.
      const clone = bodyEl.cloneNode(true);
      clone.querySelectorAll('.gmail_quote, .gmail_extra, blockquote').forEach(function (q) { q.remove(); });
      const bodyText = (clone.innerText || clone.textContent || '').trim();
      if (!bodyText) return;

      // Sender name and e-mail address (the `.gD` span carries an `email` attribute).
      const senderEl    = el.querySelector('.gD');
      const senderName  = senderEl ? (senderEl.getAttribute('name') || senderEl.textContent.trim() || 'Unknown') : 'Unknown';
      const senderEmail = senderEl ? (senderEl.getAttribute('email') || '') : '';

      // Timestamp (full date in the `title` attribute, short display in text).
      const timeEl   = el.querySelector('.g3');
      const timestamp = timeEl ? (timeEl.getAttribute('title') || timeEl.textContent.trim()) : '';

      messages.push({ senderName, senderEmail, timestamp, bodyText });
    });

    return messages;
  }

  /**
   * Attempt to read the currently signed-in user's e-mail address so "self"
   * messages can be right-aligned like in a chat.
   */
  function getSelfEmail() {
    const el =
      document.querySelector('a[data-email]') ||
      document.querySelector('[data-hovercard-id]');
    if (el) {
      return el.getAttribute('data-email') || el.getAttribute('data-hovercard-id') || '';
    }
    return '';
  }

  // ─── Chat overlay ─────────────────────────────────────────────────────────

  function removeOverlay() {
    const old = document.getElementById(OVERLAY_ID);
    if (old) old.remove();
  }

  /** Render (or re-render) the bubble list inside `msgList`. */
  function renderBubbles(msgList, messages, selfEmail) {
    msgList.innerHTML = '';

    if (!messages.length) {
      msgList.innerHTML =
        '<div class="mu-no-msg">No messages found. Click ⟳ Refresh once all emails have expanded.</div>';
      return;
    }

    messages.forEach(function (msg) {
      const isSelf  = selfEmail && msg.senderEmail === selfEmail;
      const bubble  = document.createElement('div');
      bubble.className = 'mu-bubble ' + (isSelf ? 'mu-bubble-self' : 'mu-bubble-other');
      bubble.innerHTML =
        '<div class="mu-bubble-meta">' +
          '<span class="mu-bubble-sender">' + escHtml(msg.senderName) + '</span>' +
          '<span class="mu-bubble-time">'   + escHtml(msg.timestamp)  + '</span>' +
        '</div>' +
        '<div class="mu-bubble-body">' + escHtml(msg.bodyText).replace(/\n/g, '<br>') + '</div>';
      msgList.appendChild(bubble);
    });

    // Scroll to the latest message.
    msgList.scrollTop = msgList.scrollHeight;
  }

  /** Build and append the full-screen chat overlay. */
  function createOverlay(threadId) {
    removeOverlay();

    const selfEmail = getSelfEmail();
    const overlay   = document.createElement('div');
    overlay.id = OVERLAY_ID;

    // ── Header ──
    const header = document.createElement('div');
    header.className = 'mu-ov-header';
    header.innerHTML =
      '<span class="mu-ov-title">💬 Conversation</span>' +
      '<div class="mu-ov-actions">' +
        '<button class="mu-ov-refresh" title="Re-read emails">⟳ Refresh</button>' +
        '<button class="mu-ov-back"    title="Return to Gmail view">✕ Gmail View</button>' +
      '</div>';
    overlay.appendChild(header);

    // ── Message list ──
    const msgList = document.createElement('div');
    msgList.className = 'mu-msg-list';
    overlay.appendChild(msgList);
    renderBubbles(msgList, parseGmailMessages(), selfEmail);

    // ── Reply area ──
    const replyArea = document.createElement('div');
    replyArea.className = 'mu-reply-area';
    replyArea.innerHTML =
      '<textarea class="mu-reply-input" placeholder="Type your reply… (Ctrl+Enter to send)" rows="3"></textarea>' +
      '<div class="mu-reply-footer">' +
        '<span class="mu-reply-hint">Ctrl+Enter to send</span>' +
        '<button class="mu-reply-btn">Send ↩</button>' +
      '</div>';
    overlay.appendChild(replyArea);

    document.body.appendChild(overlay);

    // ── Event wiring ──

    header.querySelector('.mu-ov-back').addEventListener('click', function () {
      hideChatView();
    });

    header.querySelector('.mu-ov-refresh').addEventListener('click', function () {
      renderBubbles(msgList, parseGmailMessages(), selfEmail);
    });

    const replyInput = replyArea.querySelector('.mu-reply-input');
    const replyBtn   = replyArea.querySelector('.mu-reply-btn');

    function doSend() {
      const text = replyInput.value.trim();
      if (!text) return;
      triggerGmailReply(text, overlay, msgList, selfEmail, function (ok) {
        if (ok) replyInput.value = '';
      });
    }

    replyBtn.addEventListener('click', doSend);
    replyInput.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        doSend();
      }
    });
  }

  // ─── Reply via Gmail's native compose ────────────────────────────────────

  /**
   * Open Gmail's reply compose for the current thread, fill in `text`, and
   * attempt to click Send automatically.
   *
   * Strategy:
   *  1. Copy text to clipboard (fallback if automation fails).
   *  2. Temporarily hide the overlay so Gmail's compose is reachable.
   *  3. Click the most-recent "Reply" button in the thread.
   *  4. Poll for the contenteditable compose box, insert text, trigger send.
   *  5. Restore the overlay; refresh the bubble list.
   */
  function triggerGmailReply(text, overlay, msgList, selfEmail, callback) {
    // Copy to clipboard so the user can paste manually if automation fails.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
    }

    // Locate the last "Reply" button in the thread (most recent email).
    const replyBtns = Array.from(
      document.querySelectorAll('[data-tooltip="Reply"], [aria-label="Reply"], [act="20"]')
    );
    const replyBtn = replyBtns.pop();

    if (!replyBtn) {
      alert('Could not find Gmail\'s Reply button.\n\nYour reply has been copied to the clipboard — paste it into Gmail\'s reply box and click Send.');
      callback(false);
      return;
    }

    // Hide the overlay so the user (and Gmail) can interact with the compose area.
    overlay.style.display = 'none';
    replyBtn.click();

    /** Selectors for Gmail's contenteditable compose box. */
    function findComposeBox() {
      return (
        document.querySelector('[contenteditable="true"].editable') ||
        document.querySelector('[contenteditable="true"][g_editable="true"]') ||
        document.querySelector('.Am.Al.editable')
      );
    }

    function fillAndSend(box) {
      box.focus();
      // execCommand gives best compatibility inside contenteditable fields.
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      box.dispatchEvent(new InputEvent('input', { bubbles: true }));

      // Give Gmail a moment to enable its Send button, then click it.
      setTimeout(function () {
        const sendBtn =
          document.querySelector('[data-tooltip="Send"][role="button"]') ||
          document.querySelector('[data-tooltip="Send"]') ||
          document.querySelector('[aria-label^="Send"]') ||
          document.querySelector('.T-I.J-J5-Ji.aoO');

        if (sendBtn) {
          sendBtn.click();
          // Restore overlay after Gmail processes the send.
          setTimeout(function () {
            overlay.style.display = '';
            renderBubbles(msgList, parseGmailMessages(), selfEmail);
            callback(true);
          }, 1200);
        } else {
          // Send button not found — leave compose open for the user.
          _showFlash(overlay, 'Compose is open. Review and click Send in Gmail.');
          overlay.style.display = '';
          callback(false);
        }
      }, 600);
    }

    // If the compose box is already present (e.g. reply was already open), act immediately.
    const existingBox = findComposeBox();
    if (existingBox) {
      fillAndSend(existingBox);
      return;
    }

    // Use a MutationObserver to react as soon as Gmail adds the compose box to the DOM.
    const TIMEOUT_MS = 6000;
    let settled = false;

    const timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      observer.disconnect();
      alert('Could not open Gmail\'s compose window.\n\nYour reply is in the clipboard — paste it and send manually.');
      overlay.style.display = '';
      callback(false);
    }, TIMEOUT_MS);

    const observer = new MutationObserver(function () {
      if (settled) return;
      const box = findComposeBox();
      if (box) {
        settled = true;
        clearTimeout(timer);
        observer.disconnect();
        fillAndSend(box);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  /** Show a transient notification banner inside the overlay. */
  function _showFlash(overlay, msg) {
    const flash = document.createElement('div');
    flash.className = 'mu-flash';
    flash.textContent = msg;
    overlay.appendChild(flash);
    setTimeout(function () { flash.remove(); }, 4000);
  }

  // ─── View management ──────────────────────────────────────────────────────

  /** Click Gmail's native "Expand all" button if it is present in the DOM. */
  function triggerExpandAll() {
    const btn =
      document.querySelector('[data-tooltip="Expand all"]') ||
      document.querySelector('[aria-label="Expand all"]');
    if (btn) { btn.click(); return true; }
    return false;
  }

  function showChatView(threadId) {
    chatActive = true;
    _syncChatBtn();

    const expanded = triggerExpandAll();

    function doCreate() { createOverlay(threadId); }
    if (expanded) {
      setTimeout(doCreate, EXPAND_DELAY_MS);
    } else {
      doCreate();
    }
  }

  function hideChatView() {
    chatActive = false;
    removeOverlay();
    _syncChatBtn();
  }

  function _syncChatBtn() {
    const btn = document.getElementById(CHAT_BTN_ID);
    if (!btn) return;
    btn.title       = chatActive ? 'Return to Gmail view' : 'Chat View';
    btn.textContent = chatActive ? '📋' : '💬';
  }

  // ─── Chat button lifecycle ────────────────────────────────────────────────

  /** Remove the injected chat button and any pending observer. */
  function removeChatButton() {
    const existing = document.getElementById(CHAT_BTN_ID);
    if (existing) existing.remove();
    if (chatBtnObserver) {
      chatBtnObserver.disconnect();
      chatBtnObserver = null;
    }
  }

  /**
   * Inject the Chat View button into Gmail's thread toolbar (the area that
   * contains the Expand All / Print / etc. icons).  Because Gmail renders
   * that toolbar asynchronously after the URL changes, we use a
   * MutationObserver as a fallback when the target element is not yet present.
   */
  function injectChatButton(threadId) {
    removeChatButton();

    function tryInject() {
      if (document.getElementById(CHAT_BTN_ID)) return true;

      // Locate Gmail's Expand All / Collapse All button as an anchor point.
      const anchor =
        document.querySelector('[data-tooltip="Expand all"]') ||
        document.querySelector('[data-tooltip="Collapse all"]') ||
        document.querySelector('[aria-label="Expand all"]') ||
        document.querySelector('[aria-label="Collapse all"]');

      if (!anchor) return false;

      const btn = document.createElement('div');
      btn.id        = CHAT_BTN_ID;
      btn.className = 'mu-chat-btn';
      btn.setAttribute('role', 'button');
      btn.setAttribute('tabindex', '0');
      btn.title       = 'Chat View';
      btn.textContent = '💬';

      btn.addEventListener('click', function () {
        if (chatActive) {
          hideChatView();
        } else {
          showChatView(threadId);
        }
      });

      // Insert the button immediately before the Expand All button.
      anchor.parentNode.insertBefore(btn, anchor);
      return true;
    }

    if (!tryInject()) {
      chatBtnObserver = new MutationObserver(function () {
        if (tryInject()) {
          chatBtnObserver.disconnect();
          chatBtnObserver = null;
        }
      });
      chatBtnObserver.observe(document.body, { childList: true, subtree: true });
      // Safety net: stop observing after the timeout.
      setTimeout(function () {
        if (chatBtnObserver) {
          chatBtnObserver.disconnect();
          chatBtnObserver = null;
        }
      }, OBSERVER_TIMEOUT_MS);
    }
  }

  // ─── Observer: detect thread navigation ──────────────────────────────────

  /**
   * Check whether the user has navigated to a new thread and, if so,
   * inject / refresh the panel.
   */
  function checkAndUpdate() {
    const threadId = getThreadIdFromURL();

    if (threadId && threadId !== currentThreadId) {
      currentThreadId = threadId;
      if (chatActive) {
        chatActive = false;
        removeOverlay();
      }
      injectChatButton(threadId);
    } else if (!threadId && currentThreadId) {
      // User navigated away from a thread view (e.g. back to inbox list).
      currentThreadId = null;
      if (chatActive) { chatActive = false; removeOverlay(); }
      removeChatButton();
    }
  }

  // Gmail is a single-page app: watch URL changes via a MutationObserver on
  // the document title (which Gmail updates on every navigation) and also
  // listen for popstate / hashchange events.
  function watchNavigation() {
    let lastUrl = window.location.href;

    // Poll via title mutations — reliable for Gmail SPA navigation.
    const titleObserver = new MutationObserver(function () {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        checkAndUpdate();
      }
    });

    const titleEl = document.querySelector('title');
    if (titleEl) titleObserver.observe(titleEl, { childList: true });

    // Also handle browser back/forward and hash changes.
    window.addEventListener('hashchange', checkAndUpdate);
    window.addEventListener('popstate',   checkAndUpdate);
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────

  function init() {
    watchNavigation();
    // Run once immediately in case the page is loaded directly on a thread.
    checkAndUpdate();
  }

  // Wait for the Gmail UI to be ready before initialising.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
