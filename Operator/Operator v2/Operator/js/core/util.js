/* Operator – Hilfsfunktionen (global: OP.util, OP.bus, OP.h) */
(function () {
  'use strict';
  var OP = (window.OP = window.OP || {});

  var nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
  var nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var nf2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  var util = {
    /* ---------- Zahlen ---------- */
    /** 2480732 -> "2.480.732" (gerundet) */
    fmt: function (n) { return nf0.format(Math.round(Number(n) || 0)); },
    /** eine Nachkommastelle: 98.7 -> "98,7" */
    fmt1: function (n) { return nf1.format(Number(n) || 0); },
    fmt2: function (n) { return nf2.format(Number(n) || 0); },
    /** Prozent mit einer Nachkommastelle: 2.37 -> "2,4 %" */
    /* Zwischen Zahl und Einheit steht ein geschuetztes Leerzeichen ( ), damit nichts umbricht */
    pct: function (n) { return nf1.format(Number(n) || 0) + ' %'; },
    /** Sekunden -> "1:05 min" bzw. "14 s" (unter 60 s) */
    secs: function (s) {
      s = Math.max(0, Math.round(Number(s) || 0));
      if (s < 60) return s + ' s';
      return Math.floor(s / 60) + ':' + pad2(s % 60) + ' min';
    },
    /** Deutsche Eingabe "22,5" -> 22.5; ungueltig -> NaN */
    parseNum: function (v) {
      if (typeof v === 'number') return v;
      if (v == null) return NaN;
      var s = String(v).trim().replace(/\s/g, '');
      if (!s) return NaN;
      // "1.234,5" -> "1234.5"; "22,5" -> "22.5"; "1.000" / "154.000" -> Tausender; "22.5" bleibt 22.5
      if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
      else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
      var n = Number(s);
      return isFinite(n) ? n : NaN;
    },
    clamp: function (v, a, b) { return Math.min(b, Math.max(a, v)); },
    round: function (v, step) { step = step || 1; return Math.round(v / step) * step; },

    /* ---------- Datum (immer lokale Zeit) ---------- */
    /** Tages-Schluessel "YYYY-MM-DD" in lokaler Zeit */
    dayKey: function (d) {
      d = d ? new Date(d) : new Date();
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    },
    today: function () { return util.dayKey(new Date()); },
    /** "YYYY-MM-DD" -> Date (lokal, 12:00 Uhr, sicher gegen Zeitumstellung) */
    parseDay: function (key) {
      var p = String(key).split('-');
      return new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0, 0);
    },
    addDays: function (key, n) {
      var d = util.parseDay(key);
      d.setDate(d.getDate() + n);
      return util.dayKey(d);
    },
    /** Anzahl Tage von a nach b (b - a) */
    diffDays: function (a, b) {
      return Math.round((util.parseDay(b) - util.parseDay(a)) / 86400000);
    },
    /** "2026-09-26" -> "26.09.2026" */
    dayLabel: function (key) {
      var p = String(key).split('-');
      return p[2] + '.' + p[1] + '.' + p[0];
    },
    timeLabel: function (ts) {
      var d = new Date(ts);
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    },

    /* ---------- Zufall / IDs ---------- */
    uid: function (prefix) {
      return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    },
    rand: function (a, b) { return a + Math.random() * (b - a); },
    randInt: function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
    pick: function (arr) { return arr[Math.floor(Math.random() * arr.length)]; },
    /** weights: {key: gewicht} -> key */
    weightedPick: function (weights) {
      var keys = Object.keys(weights), sum = 0, i;
      for (i = 0; i < keys.length; i++) sum += Math.max(0, weights[keys[i]]);
      if (sum <= 0) return keys[Math.floor(Math.random() * keys.length)];
      var r = Math.random() * sum;
      for (i = 0; i < keys.length; i++) {
        r -= Math.max(0, weights[keys[i]]);
        if (r < 0) return keys[i];
      }
      return keys[keys.length - 1];
    },

    /* ---------- Sonstiges ---------- */
    esc: function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    clone: function (o) { return JSON.parse(JSON.stringify(o)); },
    debounce: function (fn, ms) {
      var t;
      return function () {
        var args = arguments, self = this;
        clearTimeout(t);
        t = setTimeout(function () { fn.apply(self, args); }, ms);
      };
    }
  };

  /* ---------- Event-Bus ----------
     Events: 'change' (nach jeder Spielstand-Aenderung, payload {reason}),
             'achievement' (payload: Achievement-Definition),
             'route' (payload: {path, parts}) */
  var handlers = {};
  var bus = {
    on: function (evt, fn) {
      (handlers[evt] = handlers[evt] || []).push(fn);
      return function () { bus.off(evt, fn); };
    },
    off: function (evt, fn) {
      var list = handlers[evt];
      if (!list) return;
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    emit: function (evt, payload) {
      var list = (handlers[evt] || []).slice();
      for (var i = 0; i < list.length; i++) {
        try { list[i](payload); } catch (e) { console.error('[bus]', evt, e); }
      }
    }
  };

  /* ---------- DOM-Helfer ----------
     OP.h('div', {class: 'card', onclick: fn, html: '<b>x</b>'}, child, 'text', [kids])
     attrs: class, style (String oder Objekt), html (innerHTML), text, dataset (Objekt),
            on<event> (Funktion), alle anderen als Attribut (false/null = weglassen) */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class' || k === 'className') el.className = v;
        else if (k === 'style' && typeof v === 'object') { for (var s in v) el.style.setProperty(s, v[s]); }
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'dataset') { for (var d in v) el.dataset[d] = v[d]; }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { for (var i = 0; i < c.length; i++) append(el, c[i]); return; }
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }

  OP.util = util;
  OP.bus = bus;
  OP.h = h;
})();
