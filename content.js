/**
 * mail-unmess — Content Script
 *
 * Injects a ticket panel into Gmail's thread view, allowing the user to
 * assign a status (TODO / DOING / DONE) and write a short note per thread.
 * Data is persisted in chrome.storage.local, keyed by thread ID.
 */

(function () {
  'use strict';

  const PANEL_ID = 'mail-unmess-panel';
  const STATUSES = ['TODO', 'DOING', 'DONE'];

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

  // ─── Panel lifecycle ──────────────────────────────────────────────────────

  /** Create and return the panel DOM element. */
  function createPanel() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <h3>📌 Thread Ticket</h3>
      <div class="mu-status-bar status-none"></div>
      <label for="mu-status">Status</label>
      <select id="mu-status">
        <option value="">— none —</option>
        ${STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>
      <label for="mu-notes">Notes</label>
      <textarea id="mu-notes" placeholder="Add a note…"></textarea>
      <button id="mu-save">Save</button>
      <div class="mu-saved-msg">✓ Saved</div>
    `;
    return panel;
  }

  /** Remove the panel from the DOM if it exists. */
  function removePanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) existing.remove();
  }

  /**
   * Inject the panel into the page and wire up its event handlers for the
   * given thread ID.
   */
  function injectPanel(threadId) {
    removePanel();

    const panel = createPanel();
    document.body.appendChild(panel);

    const statusSelect = panel.querySelector('#mu-status');
    const notesArea = panel.querySelector('#mu-notes');
    const saveBtn = panel.querySelector('#mu-save');
    const savedMsg = panel.querySelector('.mu-saved-msg');
    const statusBar = panel.querySelector('.mu-status-bar');

    /** Update the colour indicator bar to match the selected status. */
    function updateStatusBar(value) {
      statusBar.className = 'mu-status-bar ' + (value ? 'status-' + value : 'status-none');
    }

    // Load persisted data for this thread.
    chrome.storage.local.get(threadId, function (result) {
      const data = result[threadId] || {};
      statusSelect.value = data.status || '';
      notesArea.value = data.notes || '';
      updateStatusBar(statusSelect.value);
    });

    // Live colour update when status changes.
    statusSelect.addEventListener('change', function () {
      updateStatusBar(this.value);
    });

    // Save button handler.
    saveBtn.addEventListener('click', function () {
      const payload = {
        [threadId]: {
          status: statusSelect.value,
          notes: notesArea.value,
          updatedAt: Date.now(),
        },
      };
      chrome.storage.local.set(payload, function () {
        savedMsg.style.display = 'block';
        setTimeout(function () {
          savedMsg.style.display = 'none';
        }, 1800);
      });
    });
  }

  // ─── Observer: detect thread navigation ──────────────────────────────────

  let currentThreadId = null;

  /**
   * Check whether the user has navigated to a new thread and, if so,
   * inject / refresh the panel.
   */
  function checkAndUpdate() {
    const threadId = getThreadIdFromURL();

    if (threadId && threadId !== currentThreadId) {
      currentThreadId = threadId;
      injectPanel(threadId);
    } else if (!threadId && currentThreadId) {
      // User navigated away from a thread view (e.g. back to inbox list).
      currentThreadId = null;
      removePanel();
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
    if (titleEl) {
      titleObserver.observe(titleEl, { childList: true });
    }

    // Also handle browser back/forward and hash changes.
    window.addEventListener('hashchange', checkAndUpdate);
    window.addEventListener('popstate', checkAndUpdate);
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
