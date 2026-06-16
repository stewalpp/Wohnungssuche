/* ============================================================
   Wohnungssuche — js/core.js
   window.App: formatting helpers, element factory, inline icon set,
   bottom sheet, confirm alert, toast, theme.
   Classic script, loaded first. No modules, no external libs.
   Sheet / confirm / toast / theme are ported from the "Unsere Finanzen"
   app so the look & feel matches exactly.
   ============================================================ */
(function () {
  'use strict';

  var App = window.App = window.App || {};

  /* ---------------- formatting ---------------- */

  var EUR_INT = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  var EUR_DEC = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var NUM = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
  var DATETIME = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // float EUR -> "715 €" (integers) or "559,47 €"
  App.fmtEUR = function (eur) {
    if (eur === null || eur === undefined || !isFinite(Number(eur))) return 'Miete offen';
    var n = Number(eur);
    return Math.round(n) === n ? EUR_INT.format(n) : EUR_DEC.format(n);
  };

  App.fmtArea = function (sqm) {
    if (sqm === null || sqm === undefined || !isFinite(Number(sqm))) return null;
    return NUM.format(Number(sqm)) + ' m²';
  };

  App.fmtRooms = function (rooms) {
    if (rooms === null || rooms === undefined || !isFinite(Number(rooms))) return null;
    var n = Number(rooms);
    return NUM.format(n) + (n === 1 ? ' Zimmer' : ' Zimmer');
  };

  App.fmtDateTime = function (iso) {
    var d = parseDate(iso);
    return d ? DATETIME.format(d) : '';
  };

  function parseDate(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  // ISO -> "gerade eben" / "vor 3 Std." / "vor 2 Tagen" / "16.06."
  App.fmtRelTime = function (iso) {
    var d = parseDate(iso);
    if (!d) return '';
    var secs = Math.floor((Date.now() - d.getTime()) / 1000);
    if (secs < 60) return 'gerade eben';
    var mins = Math.floor(secs / 60);
    if (mins < 60) return 'vor ' + mins + ' Min.';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return 'vor ' + hrs + ' Std.';
    var days = Math.floor(hrs / 24);
    if (days === 1) return 'gestern';
    if (days < 7) return 'vor ' + days + ' Tagen';
    return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' }).format(d);
  };

  App.escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      switch (c) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        default: return '&#39;';
      }
    });
  };

  // tiny element factory; className/text optional
  App.el = function (tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };

  App.uid = function () {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxxxxxx4xxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); });
  };

  /* ---------------- inline icon set (lucide-style strokes) ---------------- */

  var ICONS = {
    home: '<path d="M3.8 10.6 12 3.8l8.2 6.8"/><path d="M5.8 9.3v10.3a1 1 0 0 0 1 1h10.4a1 1 0 0 0 1-1V9.3"/>',
    heart: '<path d="M19 14c1.5-1.5 3-3.3 3-5.5A4.5 4.5 0 0 0 12 5 4.5 4.5 0 0 0 2 8.5C2 13 12 21 12 21s4-3.2 7-7z"/>',
    star: '<path d="m12 3 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8 6.8 19l1-5.8L3.6 9.1l5.8-.8z"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    ruler: '<path d="M3.3 14.7 14.7 3.3a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4L9.3 20.7a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4z"/><path d="m7 11 2 2M11 7l2 2M14.5 9.5l1.5 1.5"/>',
    door: '<path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17"/><path d="M3 21h18"/><circle cx="15" cy="12" r="1"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    eyeOff: '<path d="M10.7 5.1A9.5 9.5 0 0 1 12 5c7 0 10 7 10 7a13 13 0 0 1-2.2 3.2M6.6 6.6A13 13 0 0 0 2 12s3 7 10 7a9.3 9.3 0 0 0 5.4-1.6"/><path d="M3 3l18 18"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    sparkles: '<path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M19 14v4M21 16h-4M5 4v3M6.5 5.5h-3"/>',
    thumbsUp: '<path d="M7 10v11"/><path d="M3 11h4v10H3z"/><path d="M7 10l4-7a2 2 0 0 1 2.7-.7c.5.3.8.9.8 1.5V8h5a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 18.2 19H7"/>',
    thumbsDown: '<path d="M17 14V3"/><path d="M21 13h-4V3h4z"/><path d="M17 14l-4 7a2 2 0 0 1-2.7.7 1.8 1.8 0 0 1-.8-1.5V16H4.5a2 2 0 0 1-2-2.3l1.3-7A2 2 0 0 1 5.8 5H17"/>',
    meh: '<circle cx="12" cy="12" r="9"/><path d="M8 15h8"/><path d="M9 9h.01M15 9h.01"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    building: '<path d="M6 22V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v18"/><path d="M3 22h18"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01"/>',
    cloud: '<path d="M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6-1.4A4 4 0 0 0 6.5 19z"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>'
  };

  // App.icon(name, size?) -> <svg> element (stroke uses currentColor)
  App.icon = function (name, size) {
    var s = size || 24;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', s);
    svg.setAttribute('height', s);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', name === 'star' || name === 'heart' ? 'currentColor' : 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon');
    svg.innerHTML = ICONS[name] || '';
    return svg;
  };

  /* ---------------- appearance (per device, not synced) ---------------- */

  App.getTheme = function () {
    try {
      var t = localStorage.getItem('ws.theme');
      return t === 'dark' || t === 'light' ? t : 'system';
    } catch (e) { return 'system'; }
  };

  App.setTheme = function (theme) {
    var html = document.documentElement;
    html.classList.remove('theme-light', 'theme-dark');
    try {
      if (theme === 'light' || theme === 'dark') {
        localStorage.setItem('ws.theme', theme);
        html.classList.add('theme-' + theme);
      } else {
        localStorage.removeItem('ws.theme');
      }
    } catch (e) { /* storage unavailable */ }
  };

  /* ---------------- bottom sheet (ported, drag-to-dismiss) ---------------- */

  var sheetState = { open: false, onClose: null, sheet: null, backdrop: null, gen: 0 };

  function teardownSheet() {
    var root = document.getElementById('sheet-root');
    if (root) root.innerHTML = '';
    document.body.style.overflow = '';
    var wasOpen = sheetState.open;
    var cb = sheetState.onClose;
    sheetState.open = false;
    sheetState.onClose = null;
    sheetState.sheet = null;
    sheetState.backdrop = null;
    if (wasOpen && cb) { try { cb(); } catch (err) { console.error(err); } }
  }

  function enableSheetDrag(sheet, grab) {
    var startY = 0, dy = 0, active = false;
    grab.style.touchAction = 'none';
    grab.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (sheet.scrollTop > 0) return;
      startY = e.clientY; dy = 0; active = true;
      sheet.style.animation = 'none';
      sheet.style.transition = 'none';
      try { grab.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
      grab.addEventListener('pointermove', onMove);
      grab.addEventListener('pointerup', onUp);
      grab.addEventListener('pointercancel', onUp);
    });
    function onMove(e) {
      if (!active) return;
      dy = e.clientY - startY;
      if (dy < 0) dy = dy * 0.18;
      sheet.style.transform = 'translateY(' + dy + 'px)';
      if (sheetState.backdrop) sheetState.backdrop.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / 420));
      if (e.cancelable) e.preventDefault();
    }
    function onUp() {
      grab.removeEventListener('pointermove', onMove);
      grab.removeEventListener('pointerup', onUp);
      grab.removeEventListener('pointercancel', onUp);
      if (!active) return;
      active = false;
      if (dy > 110) {
        App.closeSheet();
      } else {
        sheet.style.transition = 'transform 0.5s var(--spring)';
        sheet.style.transform = 'translateY(0)';
        if (sheetState.backdrop) {
          sheetState.backdrop.style.transition = 'opacity 0.2s var(--ease-linear)';
          sheetState.backdrop.style.opacity = '';
        }
      }
    }
  }

  App.showSheet = function (opts) {
    opts = opts || {};
    var root = document.getElementById('sheet-root');
    if (!root) return;
    sheetState.gen++;
    teardownSheet();

    var backdrop = App.el('div', 'sheet-backdrop');
    var sheet = App.el('div', 'sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');

    var grab = App.el('div', 'sheet-grab');
    grab.appendChild(App.el('div', 'sheet-handle'));

    var header = App.el('div', 'sheet-header');
    var title = App.el('h2', 'sheet-title', opts.title || '');
    var close = App.el('button', 'sheet-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Schließen');
    close.addEventListener('click', function () { App.closeSheet(); });
    header.appendChild(title);
    header.appendChild(close);
    grab.appendChild(header);
    sheet.appendChild(grab);

    if (opts.content) sheet.appendChild(opts.content);

    backdrop.addEventListener('click', function () { App.closeSheet(); });
    root.appendChild(backdrop);
    root.appendChild(sheet);
    document.body.style.overflow = 'hidden';

    sheetState.open = true;
    sheetState.onClose = typeof opts.onClose === 'function' ? opts.onClose : null;
    sheetState.sheet = sheet;
    sheetState.backdrop = backdrop;
    enableSheetDrag(sheet, grab);
  };

  App.closeSheet = function () {
    var sheet = sheetState.sheet;
    var backdrop = sheetState.backdrop;
    if (!sheetState.open || !sheet) { teardownSheet(); return; }
    var gen = ++sheetState.gen;
    sheet.style.transition = 'transform 0.3s var(--ease-in)';
    sheet.style.transform = 'translateY(100%)';
    if (backdrop) {
      backdrop.style.transition = 'opacity 0.3s var(--ease-linear)';
      backdrop.style.opacity = '0';
    }
    setTimeout(function () { if (sheetState.gen === gen) teardownSheet(); }, 320);
  };

  /* ---------------- confirm alert (iOS style, ported) ---------------- */

  var alertCancelStack = [];

  function dismissAlert(backdrop) {
    if (!backdrop.parentNode || backdrop.classList.contains('closing')) return;
    backdrop.classList.add('closing');
    setTimeout(function () { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }, 220);
  }

  App.confirm = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var backdrop = App.el('div', 'alert-backdrop');
      var box = App.el('div', 'alert');
      box.setAttribute('role', 'alertdialog');
      box.setAttribute('aria-modal', 'true');
      box.appendChild(App.el('h3', 'alert-title', opts.title || ''));
      if (opts.message) box.appendChild(App.el('p', 'alert-message', opts.message));
      var actions = App.el('div', 'alert-actions');
      var cancelBtn = App.el('button', null, opts.cancelText || 'Abbrechen');
      cancelBtn.type = 'button';
      var confirmBtn = App.el('button', opts.destructive ? 'destructive' : null, opts.confirmText || 'OK');
      confirmBtn.type = 'button';
      function settle(value) {
        var idx = alertCancelStack.indexOf(cancel);
        if (idx !== -1) alertCancelStack.splice(idx, 1);
        dismissAlert(backdrop);
        resolve(value);
      }
      function cancel() { settle(false); }
      cancelBtn.addEventListener('click', cancel);
      confirmBtn.addEventListener('click', function () { settle(true); });
      backdrop.addEventListener('click', function (e) { if (e.target === backdrop) cancel(); });
      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);
      box.appendChild(actions);
      backdrop.appendChild(box);
      document.body.appendChild(backdrop);
      alertCancelStack.push(cancel);
    });
  };

  /* ---------------- on-screen keyboard chrome hiding ---------------- */

  function opensKeyboard(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    var t = (el.type || 'text').toLowerCase();
    return t !== 'checkbox' && t !== 'radio' && t !== 'button' && t !== 'submit' && t !== 'range' && t !== 'file' && t !== 'color';
  }

  document.addEventListener('focusin', function (e) {
    if (opensKeyboard(e.target)) document.documentElement.classList.add('kb-open');
  });
  document.addEventListener('focusout', function () {
    setTimeout(function () {
      if (!opensKeyboard(document.activeElement)) document.documentElement.classList.remove('kb-open');
    }, 60);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (alertCancelStack.length) alertCancelStack[alertCancelStack.length - 1]();
    else if (sheetState.open) App.closeSheet();
  });

  /* ---------------- toast (ported) ---------------- */

  var toastTimer = null;
  var toastNode = null;

  App.toast = function (message, opts) {
    opts = opts || {};
    var root = document.getElementById('toast-root');
    if (!root) return;
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (toastNode && toastNode.parentNode) toastNode.parentNode.removeChild(toastNode);

    var node = App.el('div', 'toast');
    node.setAttribute('role', 'status');
    node.appendChild(App.el('span', 'toast-text', String(message == null ? '' : message)));

    var hasAction = opts.actionText && typeof opts.onAction === 'function';
    if (hasAction) {
      node.classList.add('has-action');
      var btn = App.el('button', 'toast-action', opts.actionText);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
        if (node.parentNode) node.parentNode.removeChild(node);
        if (toastNode === node) toastNode = null;
        try { opts.onAction(); } catch (err) { console.error(err); }
      });
      node.appendChild(btn);
    }

    root.appendChild(node);
    toastNode = node;
    toastTimer = setTimeout(function () {
      node.style.transition = 'opacity 0.25s var(--ease-in)';
      node.style.opacity = '0';
      toastTimer = setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
        if (toastNode === node) toastNode = null;
        toastTimer = null;
      }, 260);
    }, opts.duration || (hasAction ? 6000 : 2200));
  };

})();
