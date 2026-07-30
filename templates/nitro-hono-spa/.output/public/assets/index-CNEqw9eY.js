var e = Object.create,
  t = Object.defineProperty,
  n = Object.getOwnPropertyDescriptor,
  r = Object.getOwnPropertyNames,
  i = Object.getPrototypeOf,
  a = Object.prototype.hasOwnProperty,
  o = (e, t) => () => (t || (e((t = { exports: {} }).exports, t), (e = null)), t.exports),
  s = (e, i, o, s) => {
    if ((i && typeof i == `object`) || typeof i == `function`)
      for (var c = r(i), l = 0, u = c.length, d; l < u; l++)
        ((d = c[l]),
          !a.call(e, d) &&
            d !== o &&
            t(e, d, {
              get: ((e) => i[e]).bind(null, d),
              enumerable: !(s = n(i, d)) || s.enumerable,
            }));
    return e;
  },
  c = (n, r, a) => (
    (a = n == null ? {} : e(i(n))),
    s(r || !n || !n.__esModule ? t(a, `default`, { value: n, enumerable: !0 }) : a, n)
  );
(function () {
  let e = document.createElement(`link`).relList;
  if (e && e.supports && e.supports(`modulepreload`)) return;
  for (let e of document.querySelectorAll(`link[rel="modulepreload"]`)) n(e);
  new MutationObserver((e) => {
    for (let t of e)
      if (t.type === `childList`)
        for (let e of t.addedNodes) e.tagName === `LINK` && e.rel === `modulepreload` && n(e);
  }).observe(document, { childList: !0, subtree: !0 });
  function t(e) {
    let t = {};
    return (
      e.integrity && (t.integrity = e.integrity),
      e.referrerPolicy && (t.referrerPolicy = e.referrerPolicy),
      e.crossOrigin === `use-credentials`
        ? (t.credentials = `include`)
        : e.crossOrigin === `anonymous`
          ? (t.credentials = `omit`)
          : (t.credentials = `same-origin`),
      t
    );
  }
  function n(e) {
    if (e.ep) return;
    e.ep = !0;
    let n = t(e);
    fetch(e.href, n);
  }
})();
function l({ update: e, notify: t, unwatched: n }) {
  return { link: r, unlink: i, propagate: a, checkDirty: o, shallowPropagate: s };
  function r(e, t, n) {
    let r = t.depsTail;
    if (r !== void 0 && r.dep === e) return;
    let i = r === void 0 ? t.deps : r.nextDep;
    if (i !== void 0 && i.dep === e) {
      ((i.version = n), (t.depsTail = i));
      return;
    }
    let a = e.subsTail;
    if (a !== void 0 && a.version === n && a.sub === t) return;
    let o =
      (t.depsTail =
      e.subsTail =
        { version: n, dep: e, sub: t, prevDep: r, nextDep: i, prevSub: a, nextSub: void 0 });
    (i !== void 0 && (i.prevDep = o),
      r === void 0 ? (t.deps = o) : (r.nextDep = o),
      a === void 0 ? (e.subs = o) : (a.nextSub = o));
  }
  function i(e, t = e.sub) {
    let { dep: r, prevDep: i, nextDep: a, nextSub: o, prevSub: s } = e;
    return (
      a === void 0 ? (t.depsTail = i) : (a.prevDep = i),
      i === void 0 ? (t.deps = a) : (i.nextDep = a),
      o === void 0 ? (r.subsTail = s) : (o.prevSub = s),
      s === void 0 ? (r.subs = o) === void 0 && n(r) : (s.nextSub = o),
      a
    );
  }
  function a(e, n) {
    let r = e.nextSub,
      i;
    top: do {
      let a = e.sub,
        o = a.flags;
      if (
        (o & 60
          ? o & 12
            ? o & 4
              ? !(o & 48) && c(e, a)
                ? ((a.flags = o | 40), (o &= 1))
                : (o = 0)
              : (a.flags = (o & -9) | 32)
            : (o = 0)
          : ((a.flags = o | 32), n && (a.flags |= 8)),
        o & 2 && t(a),
        o & 1)
      ) {
        let t = a.subs;
        if (t !== void 0) {
          let n = (e = t).nextSub;
          n !== void 0 && ((i = { value: r, prev: i }), (r = n));
          continue;
        }
      }
      if ((e = r) !== void 0) {
        r = e.nextSub;
        continue;
      }
      for (; i !== void 0; )
        if (((e = i.value), (i = i.prev), e !== void 0)) {
          r = e.nextSub;
          continue top;
        }
      break;
    } while (!0);
  }
  function o(t, n) {
    let r,
      i = 0,
      a = !1;
    top: do {
      let o = t.dep,
        c = o.flags;
      if (n.flags & 16) a = !0;
      else if ((c & 17) == 17) {
        let t = o.subs;
        e(o) && (t.nextSub !== void 0 && s(t), (a = !0));
      } else if ((c & 33) == 33) {
        ((r = { value: t, prev: r }), (t = o.deps), (n = o), ++i);
        continue;
      }
      if (!a) {
        let e = t.nextDep;
        if (e !== void 0) {
          t = e;
          continue;
        }
      }
      for (; i--; ) {
        if (((t = r.value), (r = r.prev), a)) {
          let r = n.subs;
          if (e(n)) {
            (r.nextSub !== void 0 && s(r), (n = t.sub));
            continue;
          }
          a = !1;
        } else n.flags &= -33;
        n = t.sub;
        let i = t.nextDep;
        if (i !== void 0) {
          t = i;
          continue top;
        }
      }
      return a && !!n.flags;
    } while (!0);
  }
  function s(e) {
    do {
      let n = e.sub,
        r = n.flags;
      (r & 48) == 32 && ((n.flags = r | 16), (r & 6) == 2 && t(n));
    } while ((e = e.nextSub) !== void 0);
  }
  function c(e, t) {
    let n = t.depsTail;
    for (; n !== void 0; ) {
      if (n === e) return !0;
      n = n.prevDep;
    }
    return !1;
  }
}
var u = 64,
  d = 0,
  f = 0,
  p = 0,
  m = 0,
  h = 0,
  g,
  _ = [],
  {
    link: v,
    unlink: y,
    propagate: b,
    checkDirty: x,
    shallowPropagate: S,
  } = l({
    update(e) {
      return `getter` in e ? k(e) : `currentValue` in e ? A(e) : ((e.flags = 1), !0);
    },
    notify(e) {
      let t = h,
        n = t;
      do
        if (((_[t++] = e), (e.flags &= -3), (e = e.subs?.sub), e === void 0 || !(e.flags & 2)))
          break;
      while (!0);
      for (h = t; n < --t; ) {
        let e = _[n];
        ((_[n++] = _[t]), (_[t] = e));
      }
    },
    unwatched(e) {
      `getter` in e
        ? e.depsTail !== void 0 && ((e.flags = 17), L(e))
        : `currentValue` in e || (`fn` in e ? F.call(e) : I.call(e));
    },
  });
function C(e) {
  let t = g;
  return ((g = e), t);
}
function w() {
  ++p;
}
function T() {
  --p || M();
}
function E(e) {
  return ee.bind({ currentValue: e, pendingValue: e, subs: void 0, subsTail: void 0, flags: 1 });
}
function D(e) {
  return N.bind({
    value: void 0,
    subs: void 0,
    subsTail: void 0,
    deps: void 0,
    depsTail: void 0,
    flags: 0,
    getter: e,
  });
}
function O(e) {
  let t = {
      fn: e,
      cleanup: void 0,
      subs: void 0,
      subsTail: void 0,
      deps: void 0,
      depsTail: void 0,
      flags: 6,
    },
    n = C(t);
  n !== void 0 && (v(t, n, 0), (n.flags |= u));
  try {
    (++f, (t.cleanup = t.fn()));
  } finally {
    (--f, (g = n), (t.flags &= -5));
  }
  return F.bind(t);
}
function k(e) {
  if (e.flags & u) {
    let t = e.depsTail;
    for (; t !== void 0; ) {
      let n = t.prevDep,
        r = t.dep;
      (!(`getter` in r) && !(`currentValue` in r) && y(t, e), (t = n));
    }
  }
  ((e.depsTail = void 0), (e.flags = 5));
  let t = C(e);
  try {
    ++d;
    let t = e.value;
    return t !== (e.value = e.getter(t));
  } finally {
    ((g = t), (e.flags &= -5), te(e));
  }
}
function A(e) {
  return ((e.flags = 1), e.currentValue !== (e.currentValue = e.pendingValue));
}
function j(e) {
  let t = e.flags;
  if (t & 16 || (t & 32 && x(e.deps, e))) {
    if (t & u) {
      let t = e.depsTail;
      for (; t !== void 0; ) {
        let n = t.prevDep,
          r = t.dep;
        (!(`getter` in r) && !(`currentValue` in r) && y(t, e), (t = n));
      }
    }
    if (e.cleanup && (P(e), !e.flags)) return;
    ((e.depsTail = void 0), (e.flags = 6));
    let n = C(e);
    try {
      (++d, ++f, (e.cleanup = e.fn()));
    } finally {
      (--f, (g = n), (e.flags &= -5), te(e));
    }
  } else e.deps !== void 0 && (e.flags = 2 | (t & u));
}
function M() {
  try {
    for (; m < h; ) {
      let e = _[m];
      ((_[m++] = void 0), j(e));
    }
  } finally {
    for (; m < h; ) {
      let e = _[m];
      ((_[m++] = void 0), (e.flags |= 10));
    }
    ((m = 0), (h = 0));
  }
}
function N() {
  let e = this.flags;
  if (e & 16 || (e & 32 && (x(this.deps, this) || ((this.flags = e & -33), !1)))) {
    if (k(this)) {
      let e = this.subs;
      e !== void 0 && S(e);
    }
  } else if (!e) {
    this.flags = 5;
    let e = C(this);
    try {
      this.value = this.getter();
    } finally {
      ((g = e), (this.flags &= -5));
    }
  }
  let t = g;
  return (t !== void 0 && v(this, t, d), this.value);
}
function ee(...e) {
  if (e.length) {
    if (this.pendingValue !== (this.pendingValue = e[0])) {
      this.flags = 17;
      let e = this.subs;
      e !== void 0 && (b(e, !!f), p || M());
    }
  } else {
    if (this.flags & 16 && A(this)) {
      let e = this.subs;
      e !== void 0 && S(e);
    }
    let e = g;
    return (e !== void 0 && v(this, e, d), this.currentValue);
  }
}
function P(e) {
  let t = e.cleanup;
  e.cleanup = void 0;
  let n = g;
  g = void 0;
  try {
    t();
  } finally {
    g = n;
  }
}
function F() {
  (I.call(this), this.cleanup && P(this));
}
function I() {
  ((this.flags = 0), L(this));
  let e = this.subs;
  e !== void 0 && y(e);
}
function L(e) {
  let t = e.depsTail;
  for (; t !== void 0; ) {
    let n = t.prevDep;
    (y(t, e), (t = n));
  }
}
function te(e) {
  let t = e.depsTail,
    n = t === void 0 ? e.deps : t.nextDep;
  for (; n !== void 0; ) n = y(n, e);
}
var R = 256 * 1024,
  z = 32;
function B(e, t) {
  if (t > z) return !0;
  if (typeof e != `object` || !e) return !1;
  if (Array.isArray(e)) {
    for (let n of e) if (B(n, t + 1)) return !0;
    return !1;
  }
  for (let n in e) if (Object.hasOwn(e, n) && B(e[n], t + 1)) return !0;
  return !1;
}
var V = new Set([`__proto__`, `constructor`, `prototype`]);
function ne(e) {
  if (!(typeof e != `object` || !e)) {
    if (Array.isArray(e)) {
      for (let t of e) ne(t);
      return;
    }
    for (let t of Object.getOwnPropertyNames(e)) V.has(t) ? delete e[t] : ne(e[t]);
  }
}
function H(e, t) {
  if (e.length > R) {
    `${t}`;
    return;
  }
  let n;
  try {
    n = JSON.parse(e);
  } catch {
    `${t}`;
    return;
  }
  if (B(n, 1)) {
    `${t}`;
    return;
  }
  if (typeof n != `object` || !n || Array.isArray(n)) {
    `${t}`;
    return;
  }
  return (ne(n), n);
}
function re(e, t) {
  if (Object.is(e, t)) return !0;
  if (typeof e != `object` || !e || typeof t != `object` || !t) return !1;
  let n = Object.keys(e),
    r = Object.keys(t);
  if (n.length !== r.length) return !1;
  for (let r of n) if (!Object.hasOwn(t, r) || !Object.is(e[r], t[r])) return !1;
  return !0;
}
function ie(e) {
  let t = document.createElement(`template`);
  return ((t.innerHTML = e), t.content);
}
function ae(e) {
  let t = [];
  for (let n of e.querySelectorAll(`[data-ilha-slot]`)) {
    if (!(n instanceof Element)) continue;
    let r = n.parentElement ?? n.parentNode,
      i = !1;
    for (; r && r !== e; ) {
      if (r instanceof Element && r.hasAttribute(`data-ilha-slot`)) {
        i = !0;
        break;
      }
      r = r instanceof Element ? (r.parentElement ?? r.parentNode) : r.parentNode;
    }
    i || t.push(n.getAttribute(`data-ilha-slot`));
  }
  return t;
}
function oe(e, t) {
  for (let n of e.querySelectorAll(`[${We}]`))
    if (n.getAttribute(We) === t) return n.getAttribute(Ke) ?? ``;
  return null;
}
var se = /^[a-z][a-z0-9-]*$/i;
function ce(e) {
  let t = e.trim();
  if (t.length === 0) throw Error(`island.as() requires a non-empty HTML tag name.`);
  if (!se.test(t))
    throw Error(
      `island.as() tag must be a valid HTML element name (got "${e}"). Use names like "span", "div", or "li".`,
    );
  return t.toLowerCase();
}
function le(e) {
  let t = e[He];
  return typeof t == `string` && t.length > 0 ? t : `div`;
}
function ue({ tag: e, id: t, propsAttr: n, inner: r }) {
  return `<${e} ${We}="${Fe(t)}"${n}>${r}</${e}>`;
}
function de({ initialHtml: e, renderedHtml: t, slotIds: n }) {
  if (typeof document > `u`) return !1;
  let r = ie(e),
    i = ie(t),
    a = ae(r),
    o = ae(i);
  if (a.length !== o.length || a.some((e, t) => e !== o[t])) return !1;
  for (let e of n) {
    let t = oe(r, e),
      n = oe(i, e);
    if (t === null || n === null || t !== n) return !1;
  }
  return !0;
}
function fe(e) {
  if (e === void 0) return;
  let t;
  for (let n of Object.keys(e)) {
    if (n === `children`) continue;
    let r = e[n];
    if (typeof r == `function` || typeof r == `symbol`) continue;
    let i = he(r);
    (i !== void 0 || r == null) && ((t ??= {})[n] = i);
  }
  return t;
}
var pe = Symbol.for(`ilha.raw`);
function me(e) {
  return !!(e && typeof e == `object` && pe in e);
}
function he(e, t) {
  if (e == null) return e;
  if (typeof e == `function` || typeof e == `symbol`) return;
  if (typeof e != `object`) return e;
  if (me(e)) return { __ilha: `raw`, value: e.value };
  let n = t ?? new WeakSet();
  if (n.has(e)) throw TypeError(`encodeSlotPropValue: circular reference in slot props`);
  if ((n.add(e), Array.isArray(e))) return e.map((e) => he(e, n)).filter((e) => e !== void 0);
  if (Object.getPrototypeOf(e) !== Object.prototype) return;
  let r = e,
    i = {};
  for (let e of Object.keys(r)) {
    let t = he(r[e], n);
    (t !== void 0 || r[e] === null) && (i[e] = t);
  }
  return i;
}
function ge(e) {
  return { [pe]: !0, value: e };
}
function _e(e) {
  if (typeof e != `object` || !e) return e;
  if (Array.isArray(e)) return e.map(_e);
  let t = e;
  if (t.__ilha === `raw` && typeof t.value == `string`) return ge(t.value);
  let n = {};
  for (let e of Object.keys(t)) n[e] = _e(t[e]);
  return n;
}
function ve(e) {
  if (!e || typeof e != `object` || me(e) || Object.getPrototypeOf(e) !== Object.prototype)
    return !1;
  let t = Object.keys(e);
  return t.length === 1 && t[0] === `value` && typeof e.value == `string`;
}
function ye(e) {
  if (typeof e != `object` || !e || Array.isArray(e)) return {};
  let t = _e(e);
  return (`children` in t && (t.children = be(t.children)), t);
}
function be(e) {
  return Array.isArray(e)
    ? e.map((e) => (ve(e) ? ge(e.value) : _e(e)))
    : ve(e)
      ? ge(e.value)
      : _e(e);
}
function xe(e) {
  let t = fe(e);
  return t === void 0 ? `` : JSON.stringify(t);
}
var Se = `[data-slot]`,
  Ce = new Set([
    `data-checked`,
    `data-unchecked`,
    `data-indeterminate`,
    `aria-checked`,
    `data-open`,
    `data-closed`,
    `data-state`,
    `aria-expanded`,
    `aria-hidden`,
    `data-selected`,
    `data-panel-open`,
  ]),
  we = `data-morph-preserve`;
function Te(e, t) {
  if (t === we) return e.hasAttribute(we);
  let n = e.getAttribute(we);
  if (n !== null) {
    for (let e of n.split(/\s+/)) if (e === t) return !0;
  }
  return e.matches(Se) && Ce.has(t);
}
function Ee(e, t) {
  for (let { name: n, value: r } of t.attributes)
    Te(e, n) || (e.getAttribute(n) !== r && e.setAttribute(n, r));
  for (let { name: n } of Array.from(e.attributes))
    Te(e, n) || t.hasAttribute(n) || e.removeAttribute(n);
}
function De(e) {
  let t = e.getAttribute(`data-key`);
  if (t !== null) return `k:${t}`;
  let n = e.getAttribute(We);
  return n === null ? null : `s:${n}`;
}
function Oe(e, t) {
  let n = Array.from(t.childNodes),
    r = null;
  for (let t of e.children) {
    let e = De(t);
    e !== null && !(r ??= new Map()).has(e) && r.set(e, t);
  }
  let i = null;
  if (r !== null) {
    i = new Set();
    for (let e of t.children) {
      let t = De(e);
      t !== null && i.add(t);
    }
  }
  for (let t = 0; t < n.length; t++) {
    let a = n[t],
      o = e.childNodes[t];
    if (r !== null) {
      let t = a.nodeType === 1 ? De(a) : null;
      if (t !== null) {
        let n = r.get(t);
        n && (r.delete(t), n !== o && (e.insertBefore(n, o ?? null), (o = n)));
      }
      if (o instanceof Element) {
        let n = De(o);
        if (n !== null && n !== t && i.has(n)) {
          e.insertBefore(a.cloneNode(!0), o);
          continue;
        }
      }
    }
    if (!o) {
      e.appendChild(a.cloneNode(!0));
      continue;
    }
    if (o.nodeType !== a.nodeType) {
      e.replaceChild(a.cloneNode(!0), o);
      continue;
    }
    if (o.nodeType === 3 || o.nodeType === 8) {
      o.nodeValue !== a.nodeValue && (o.nodeValue = a.nodeValue);
      continue;
    }
    if (o.nodeType === 1) {
      let t = o,
        n = a;
      if (t.localName !== n.localName || t.namespaceURI !== n.namespaceURI) {
        e.replaceChild(n.cloneNode(!0), t);
        continue;
      }
      if (t.hasAttribute(Ge)) {
        e.replaceChild(n.cloneNode(!0), t);
        continue;
      }
      {
        let e = n.getAttribute(We);
        if (e !== null && t.getAttribute(We) === e) {
          let e = n.getAttribute(Ke);
          e !== null && t.getAttribute(Ke) !== e && t.setAttribute(Ke, e);
          continue;
        }
      }
      if (t.localName === `input` && t.type !== n.type) {
        e.replaceChild(n.cloneNode(!0), t);
        continue;
      }
      if (t.localName === `input`) {
        let e = t.hasAttribute(`checked`),
          r = t.getAttribute(`value`);
        Ee(t, n);
        let i = n.hasAttribute(`checked`);
        i !== e && (t.checked = i);
        let a = n.getAttribute(`value`);
        a !== r && (t.value = a ?? ``);
        continue;
      }
      if (t.localName === `select`) {
        let e = new Map();
        for (let n of t.options) e.set(n, { attr: n.hasAttribute(`selected`), live: n.selected });
        (Ee(t, n), Oe(t, n));
        let r = Array.from(t.options);
        if (r.some((t) => t.hasAttribute(`selected`) !== (e.get(t)?.attr ?? !1)))
          for (let e of r) e.selected = e.hasAttribute(`selected`);
        else
          for (let t of r) {
            let n = e.get(t);
            n && t.selected !== n.live && (t.selected = n.live);
          }
        continue;
      }
      if ((Ee(t, n), t.localName === `textarea`)) {
        let e = n.textContent ?? ``;
        t.textContent !== e && ((t.textContent = e), (t.value = e));
      } else Oe(t, n);
    }
  }
  for (; e.childNodes.length > n.length; ) e.lastChild.remove();
}
function ke() {
  if (typeof document > `u`) return null;
  let e = document.activeElement;
  if (!(e instanceof HTMLElement) || e === document.body) return null;
  let t = null,
    n = null;
  try {
    if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement)
      t = { start: e.selectionStart, end: e.selectionEnd, dir: e.selectionDirection };
    else if (e.isContentEditable) {
      let e = window.getSelection();
      e && e.rangeCount > 0 && (n = e.getRangeAt(0).cloneRange());
    }
  } catch {}
  return { active: e, selection: t, range: n };
}
function Ae(e) {
  if (!e) return;
  let { active: t, selection: n, range: r } = e;
  if (t.isConnected)
    try {
      if ((document.activeElement !== t && t.focus({ preventScroll: !0 }), n && n.start !== null)) {
        let e = t;
        (e.selectionStart !== n.start || e.selectionEnd !== n.end) &&
          e.setSelectionRange(n.start, n.end, n.dir ?? `none`);
      }
      if (r && r.startContainer.isConnected) {
        let e = window.getSelection();
        if (e) {
          let t = e.rangeCount > 0 ? e.getRangeAt(0) : null;
          (t === null ||
            t.startContainer !== r.startContainer ||
            t.startOffset !== r.startOffset ||
            t.endContainer !== r.endContainer ||
            t.endOffset !== r.endOffset) &&
            (e.removeAllRanges(), e.addRange(r));
        }
      }
    } catch {}
}
function je(e, t) {
  if (e.localName !== t.localName || e.namespaceURI !== t.namespaceURI)
    throw Error(`[ilha] morph: elements must match`);
  let n = ke();
  (Oe(e, t), Ae(n));
}
function Me(e) {
  if (typeof e != `object` || !e) return !1;
  let t = e[`~standard`];
  return t != null && typeof t.validate == `function` && t.version === 1;
}
function Ne(e, t) {
  let n = e[`~standard`].validate(t);
  if (n instanceof Promise) throw Error(`[ilha] Async schemas are not supported.`);
  if (n.issues)
    throw Error(
      `[ilha] Validation failed:\n${n.issues.map((e) => `  - ${e.message}`).join(`
`)}`,
    );
  return n.value;
}
var Pe = { "&": `&amp;`, "<": `&lt;`, ">": `&gt;`, '"': `&quot;`, "'": `&#39;` };
function Fe(e) {
  return String(e).replace(/[&<>"']/g, (e) => Pe[e]);
}
function Ie(e) {
  if (
    e.length === 0 ||
    e[0] !==
      `
`
  )
    return e;
  let t = e.split(`
`);
  for (; t.length && t[0].trim() === ``; ) t.shift();
  for (; t.length && t[t.length - 1].trim() === ``; ) t.pop();
  if (!t.length) return ``;
  let n = Math.min(...t.filter((e) => e.trim() !== ``).map((e) => e.match(/^(\s*)/)[1].length));
  return t.map((e) => e.slice(n)).join(`
`);
}
var Le = Symbol.for(`ilha.raw`),
  Re = Symbol.for(`ilha.signalAccessor`),
  ze = Symbol.for(`ilha.island`),
  Be = Symbol.for(`ilha.islandCall`),
  Ve = Symbol.for(`ilha.islandMountInternal`),
  He = Symbol.for(`ilha.islandSlotTag`),
  Ue = new WeakMap(),
  We = `data-ilha-slot`,
  Ge = `data-ilha-leaving`,
  Ke = `data-ilha-props`,
  qe = `data-ilha-state`,
  Je = `data-ilha-css`;
function Ye(e) {
  return `<style ${Je}>@scope (:scope) to ([data-ilha]){${e.replace(/<\/style/gi, `<\\/style`)}}</style>`;
}
var Xe = Symbol.for(`ilha.renderCtxStack`);
function Ze() {
  let e = globalThis;
  return (e[Xe] ??= []);
}
function Qe(e, t) {
  let n = {
    slots: new Map(),
    positional: 0,
    liveHost: e,
    pending: t ? new Map() : void 0,
    binds: [],
    events: [],
  };
  return (Ze().push(n), n);
}
function $e() {
  Ze().pop();
}
function et() {
  let e = Ze();
  return e[e.length - 1];
}
function tt(e) {
  return typeof e == `function` && ze in e;
}
function nt(e) {
  return e == null || (typeof e != `object` && typeof e != `function`)
    ? !1
    : Be in e || (typeof e == `object` && `island` in e && tt(e.island));
}
function rt({ island: e, props: t, key: n }) {
  let r = et(),
    i;
  ((i = n === void 0 ? (r ? `p:${r.positional++}` : `p:0`) : `k:${n}`),
    r && r.slots.set(i, { island: e, props: t }));
  let a = le(e),
    o = fe(t),
    s = o ? ` ${Ke}='${Fe(JSON.stringify(o))}'` : ``;
  if (r?.liveHost) return ue({ tag: a, id: i, propsAttr: s, inner: `` });
  if (r?.pending) {
    $e();
    try {
      let n = e(t);
      return n instanceof Promise
        ? (r.pending.set(i, n.then(String)), ue({ tag: a, id: i, propsAttr: s, inner: it(i) }))
        : ue({ tag: a, id: i, propsAttr: s, inner: String(n) });
    } finally {
      Ze().push(r);
    }
  }
  let c = e.toString(t);
  return ue({ tag: a, id: i, propsAttr: s, inner: c });
}
function it(e) {
  return `<!--ilha-async:${Fe(e)}-->`;
}
async function at(e, t) {
  for (let [n, r] of t) {
    let t = await r;
    e = e.split(it(n)).join(t);
  }
  return e;
}
function ot(e, t) {
  if (typeof t != `function`) return t;
  let n = C(void 0);
  try {
    return t(e());
  } finally {
    C(n);
  }
}
function st(e) {
  e[Re] = !0;
  let t = e;
  return ((t.select = (e) => pt(t, e)), t);
}
function ct(e) {
  return typeof e == `function` && Re in e;
}
function lt(e, t) {
  let n = e;
  for (let e of t) {
    if (n == null) return;
    n = n[e];
  }
  return n;
}
function ut({ object: e, path: t, value: n }) {
  let r = e;
  if (t.length === 0) return n;
  let [i, ...a] = t;
  if (Array.isArray(r)) {
    let e = i;
    if (e < 0 || e >= r.length) return r;
    let t = r[e],
      o = a.length === 0 ? n : ut({ object: t, path: a, value: n });
    if (Object.is(t, o)) return r;
    let s = r.slice();
    return ((s[e] = o), s);
  }
  if (typeof r == `object` && r) {
    let e = r,
      t = String(i),
      o = e[t],
      s = a.length === 0 ? n : ut({ object: o, path: a, value: n });
    if (a.length === 0) {
      if (Object.is(o, n)) return r;
    } else if (Object.is(o, s)) return r;
    return { ...e, [t]: s };
  }
  return a.length === 0 ? n : ut({ object: void 0, path: a, value: n });
}
function dt(e) {
  return typeof e == `symbol` || e === `length` ? null : /^\d+$/.test(e) ? Number(e) : e;
}
function ft(e, t) {
  let n = [],
    r = (e) =>
      e === null || (typeof e != `object` && typeof e != `function`)
        ? e
        : new Proxy(e, {
            get(e, t, i) {
              let a = dt(t);
              a != null && n.push(a);
              let o = Reflect.get(e, t, i);
              return a != null && typeof o == `object` && o ? r(o) : o;
            },
          });
  return (t(r(e)), n);
}
function pt(e, t) {
  let n = ft(e(), t),
    r = t(e()),
    i = n.length === 0 ? e() : lt(e(), n);
  if (!Object.is(r, i))
    throw Error(
      `select(): selector must only traverse nested properties or array indexes — derived or transformed values are not supported.`,
    );
  return st((...r) => {
    if (r.length === 0) return n.length === 0 ? t(e()) : lt(e(), n);
    let i = e(),
      a = n.length === 0 ? t(i) : lt(i, n),
      o = ot(() => a, r[0]),
      s = n.length === 0 ? o : ut({ object: i, path: n, value: o });
    Object.is(i, s) || e(() => s);
  });
}
function mt(e) {
  return { [Le]: !0, value: e };
}
function ht(e) {
  if (e == null || e === !0 || e === !1) return ``;
  if (Array.isArray(e)) return e.map(ht).join(``);
  if (Et(e)) return e.value;
  if (nt(e)) {
    let t = typeof e == `function` ? e() : e;
    return rt({ island: t.island, props: t.props, key: t.key });
  }
  return tt(e)
    ? rt({ island: e, props: void 0, key: void 0 })
    : ct(e) || typeof e == `function`
      ? Fe(e())
      : Fe(e);
}
var gt = new Set([
    `value`,
    `checked`,
    `valueAsNumber`,
    `valueAsDate`,
    `files`,
    `open`,
    `group`,
    `this`,
  ]),
  _t = /\bbind:([a-zA-Z]+)\s*=\s*("|')?$/,
  vt = /(?:^|\s)on([a-z][a-z0-9-]*)(?::([a-z][a-z0-9-]*))?\s*=\s*("|')?$/,
  yt = new Set([`abortable`, `once`, `capture`, `passive`]);
function bt(e, t) {
  let n = -1,
    r = null;
  for (let i = 0; i < t; i++) {
    let t = e[i];
    if (n === -1) {
      t === `<` && (n = i);
      continue;
    }
    r ? t === r && (r = null) : t === `"` || t === `'` ? (r = t) : t === `>` && (n = -1);
  }
  return n === -1 || r !== null ? !1 : !/^\s*[!/?]/.test(e.slice(n + 1, t));
}
function xt(e, t) {
  let n = t;
  for (let t = 0; t < e.length; t++) {
    let r = e[t];
    if (n !== null) r === n && (n = null);
    else if (r === `"` || r === `'`) n = r;
    else if (r === `>`) return { index: t, quote: n };
  }
  return { index: -1, quote: n };
}
function St(e) {
  if (e instanceof Date) {
    if (isNaN(e.getTime())) return ``;
    let t = (e) => String(e).padStart(2, `0`);
    return `${e.getFullYear()}-${t(e.getMonth() + 1)}-${t(e.getDate())}`;
  }
  return ``;
}
function Ct(e) {
  let t = e.lastIndexOf(`<`);
  if (t === -1) return null;
  let n = e.slice(t);
  if (n.includes(`>`)) return null;
  let r = n.match(/\bvalue\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/);
  return r ? (r[2] ?? r[3] ?? r[4] ?? null) : null;
}
function wt({ kind: e, index: t, accessor: n, prefixForStaticPeek: r }) {
  let i = `${e}:${t}`,
    a;
  try {
    a = n();
  } catch {
    a = void 0;
  }
  switch (e) {
    case `value`:
      return [` value="${Fe(a ?? ``)}"`, i];
    case `valueAsNumber`:
      return [` value="${Fe(a == null ? `` : String(a))}"`, i];
    case `valueAsDate`:
      return [` value="${Fe(St(a))}"`, i];
    case `checked`:
      return [a ? ` checked` : ``, i];
    case `open`:
      return [a ? ` open` : ``, i];
    case `files`:
      return [``, i];
    case `this`:
      return [``, i];
    case `group`: {
      let e = Ct(r);
      return e == null
        ? [``, i]
        : [
            (Array.isArray(a) ? a.map(String).includes(e) : a != null && String(a) === e)
              ? ` checked`
              : ``,
            i,
          ];
    }
  }
}
function Tt(e, ...t) {
  let n = ``,
    r = null,
    i = ``,
    a = ``,
    o = null,
    s = et();
  for (let c = 0; c < e.length; c++) {
    let l = e[c];
    if ((r !== null && (l.startsWith(r) && (l = l.slice(1)), (r = null)), i !== `` || a !== ``)) {
      let { index: e, quote: t } = xt(l, o);
      if (e !== -1) {
        let t = l.slice(0, e).replace(/\s*\/\s*$/, ``),
          n = i ? ` data-ilha-bind="${i}"` : ``,
          r = a ? ` data-ilha-on="${a}"` : ``;
        ((l = t + n + r + `>` + l.slice(e + 1)), (i = ``), (a = ``), (o = null));
      } else o = t;
    }
    if (c >= t.length) {
      n += l;
      continue;
    }
    let u = t[c],
      d = l.match(vt);
    if (d && bt(n + l, n.length + l.length - d[0].length)) {
      let e = d[1],
        t = d[2],
        i = yt.has(t) ? t : void 0,
        o = d[3] ?? null,
        c = l.length - d[0].length,
        f = l.slice(0, c).replace(/\s+$/, ``);
      if (((n += f), s && typeof u == `function`)) {
        let n = s.events.length;
        (t && !i) ||
          (s.events.push({ type: e, handler: u, modifier: i }),
          (a += (a ? `,` : ``) + `${e}:${n}`));
      }
      o && (r = o);
      continue;
    }
    let f = l.match(_t);
    if (f && ct(u)) {
      let e = f[1],
        t = f[2] ?? null;
      if (!gt.has(e)) {
        n += l + ht(u);
        continue;
      }
      if (!s) {
        let i = l.slice(0, l.length - f[0].length),
          a = t ?? `"`;
        ((n += i + e + `=` + a + ht(u) + a), t && (r = t));
        continue;
      }
      let a = l.length - f[0].length,
        o = l.slice(0, a).replace(/\s+$/, ``),
        c = s.binds.length;
      s.binds.push({ kind: e, accessor: u });
      let [d, p] = wt({ kind: e, index: c, accessor: u, prefixForStaticPeek: o });
      ((n += o + d), (i += (i ? `,` : ``) + p), t && (r = t));
      continue;
    }
    n += l + ht(u);
  }
  return (
    i !== `` && (n += ` data-ilha-bind="${i}"`),
    a !== `` && (n += ` data-ilha-on="${a}"`),
    { [Le]: !0, value: Ie(n) }
  );
}
function Et(e) {
  return typeof e != `object` || !e ? !1 : Le in e && typeof e.value == `string`;
}
function Dt(e) {
  return Et(e) ? e.value : e;
}
var Ot = new Map();
function kt(e, t) {
  if (Ot.has(e)) return Ot.get(e);
  let n = E(t),
    r = (...e) => {
      if (e.length === 0) return n();
      n(ot(() => n(), e[0]));
    };
  return (Ot.set(e, r), r);
}
var At = Object.assign(kt, {
  delete(e) {
    return Ot.delete(e);
  },
  clear() {
    Ot.clear();
  },
});
function jt(e) {
  let t = E(e);
  return st((...e) => {
    if (e.length === 0) return t();
    t(ot(() => t(), e[0]));
  });
}
function Mt(e) {
  let t = D(e);
  return st((...e) => {
    if (!(e.length > 0)) return t();
  });
}
function Nt(e) {
  let t = C(void 0);
  try {
    return e();
  } finally {
    C(t);
  }
}
function Pt(e) {
  w();
  try {
    return e();
  } finally {
    T();
  }
}
function Ft(e, t) {
  let n = st((...n) => {
    if (n.length > 0) {
      t && t(n[0]);
      return;
    }
    return e().value;
  });
  return new Proxy(n, {
    get(t, n, r) {
      return n === `loading` || n === `value` || n === `error` ? e()[n] : Reflect.get(t, n, r);
    },
  });
}
function It() {
  return Ft(() => ({ loading: !1, value: void 0, error: void 0 }));
}
function Lt(e) {
  let t = new Map();
  for (let [n, r] of Object.entries(e))
    t.set(
      n,
      Ft(
        () => r,
        (e) => {
          ((r.loading = !1), (r.value = e), (r.error = void 0));
        },
      ),
    );
  return new Proxy(
    {},
    {
      get(e, n) {
        if (typeof n == `string`) return t.get(n) ?? It();
      },
    },
  );
}
function Rt({ entries: e, state: t, input: n, derivedSnapshot: r }) {
  let i = new Map();
  for (let a of e) {
    let e;
    if (r != null && a.key in r) e = { ...r[a.key] };
    else if (
      a.fn.constructor.name !== `AsyncFunction` &&
      a.fn.constructor.name !== `AsyncGeneratorFunction`
    ) {
      let r = new AbortController();
      try {
        let i = a.fn({ state: t, input: n, signal: r.signal });
        i instanceof Promise
          ? ((e = { loading: !0, value: void 0, error: void 0 }), i.catch(() => {}))
          : (e = { loading: !1, value: i, error: void 0 });
      } catch (t) {
        e = { loading: !1, value: void 0, error: t instanceof Error ? t : Error(String(t)) };
      } finally {
        r.abort();
      }
    } else e = { loading: !0, value: void 0, error: void 0 };
    let o = E(e);
    i.set(a.key, o);
  }
  let a = new Map();
  for (let t of e) {
    let e = i.get(t.key);
    a.set(
      t.key,
      Ft(
        () => e(),
        (t) => {
          let n = C(void 0);
          (e({ loading: !1, value: t, error: void 0 }), C(n));
        },
      ),
    );
  }
  return {
    proxy: new Proxy(
      {},
      {
        get(e, t) {
          if (typeof t == `string`) return a.get(t) ?? It();
        },
      },
    ),
    setup: () => {
      let a = [];
      for (let o of e) {
        let e = i.get(o.key),
          s = new AbortController(),
          c = r != null && o.key in r,
          l = O(() => {
            (s.abort(), (s = new AbortController()));
            let r = s,
              i;
            try {
              i = o.fn({ state: t, input: n, signal: r.signal });
            } catch (t) {
              if (c) {
                c = !1;
                return;
              }
              let n = C(void 0);
              (e({ loading: !1, value: void 0, error: t instanceof Error ? t : Error(String(t)) }),
                C(n));
              return;
            }
            if (c) {
              ((c = !1), i instanceof Promise && i.catch(() => {}));
              return;
            }
            if (!(i instanceof Promise)) {
              let t = C(void 0);
              (e({ loading: !1, value: i, error: void 0 }), C(t));
              return;
            }
            let a = C(void 0),
              l = e();
            (e({ loading: !0, value: l.value, error: void 0 }),
              C(a),
              i
                .then((t) => {
                  r.signal.aborted || e({ loading: !1, value: t, error: void 0 });
                })
                .catch((t) => {
                  r.signal.aborted ||
                    e({
                      loading: !1,
                      value: void 0,
                      error: t instanceof Error ? t : Error(String(t)),
                    });
                }));
          });
        a.push(() => {
          (l(), s.abort());
        });
      }
      return () => a.forEach((e) => e());
    },
  };
}
var zt = `data-ilha-bind`,
  Bt = `data-ilha-on`;
function Vt(e) {
  let t = [];
  for (let n of e.split(`,`)) {
    let [e, r] = n.split(`:`);
    if (!e || !r) continue;
    let i = Number(r);
    !Number.isInteger(i) || i < 0 || t.push({ kind: e, index: i });
  }
  return t;
}
function Ht(e, t) {
  let n = e;
  switch (t) {
    case `value`:
      return {
        event: e.tagName === `SELECT` ? `change` : `input`,
        read: (e) => e.value,
        write: (e, t) => (e.value = t == null ? `` : String(t)),
      };
    case `valueAsNumber`:
      return {
        event: `input`,
        read: (e) => {
          let t = e.valueAsNumber;
          return Number.isNaN(t) ? null : t;
        },
        write: (e, t) => (e.value = t == null || Number.isNaN(t) ? `` : String(t)),
      };
    case `valueAsDate`:
      return {
        event: `input`,
        read: (e) => e.valueAsDate,
        write: (e, t) => {
          e.value = St(t);
        },
      };
    case `checked`:
      return { event: `change`, read: (e) => e.checked, write: (e, t) => (e.checked = !!t) };
    case `files`:
      return { event: `change`, read: (e) => e.files, write: () => {} };
    case `open`:
      return { event: `toggle`, read: (e) => e.open, write: (e, t) => (e.open = !!t) };
    case `this`:
      return { event: null, read: () => void 0, write: () => {} };
    case `group`: {
      let e = n.type === `checkbox`;
      return {
        event: `change`,
        read: (t) => {
          let n = t;
          return e
            ? { __ilhaGroup: !0, value: n.value, checked: n.checked }
            : n.checked
              ? n.value
              : void 0;
        },
        write: (t, n) => {
          let r = t;
          e
            ? (r.checked = (Array.isArray(n) ? n.map(String) : []).includes(r.value))
            : (r.checked = n != null && String(n) === r.value);
        },
      };
    }
  }
}
function Ut(e, t) {
  if (t === e) return !0;
  let n = t;
  for (; n && n !== e; ) {
    if (n.hasAttribute(We) || n.hasAttribute(`data-ilha`)) return !1;
    n = n.parentElement;
  }
  return n === e;
}
function Wt({ host: e, records: t, reportError: n, unmountSignal: r, onceFired: i }) {
  if (t.length === 0) return () => {};
  let a = [],
    o = [];
  (e.hasAttribute(Bt) && o.push(e),
    o.push(...Array.from(e.querySelectorAll(`[${Bt}]`)).filter((t) => Ut(e, t))));
  for (let e of o) {
    let o = e.getAttribute(Bt) ?? ``;
    for (let s of o.split(`,`)) {
      let o = s.lastIndexOf(`:`);
      if (o < 1) continue;
      let c = s.slice(0, o),
        l = Number(s.slice(o + 1));
      if (!Number.isInteger(l) || l < 0) continue;
      let u = t[l];
      if (!u || u.type !== c || (u.modifier === `once` && i.get(e)?.has(c))) continue;
      let d = new AbortController(),
        f,
        p = {
          once: u.modifier === `once`,
          capture: u.modifier === `capture`,
          passive: u.modifier === `passive`,
        },
        m = (e) => {
          e?.name !== `AbortError` && n(e);
        },
        h = (t) => {
          if (u.modifier === `once`) {
            let t = i.get(e);
            (t || i.set(e, (t = new Set())), t.add(c));
          }
          u.modifier === `abortable` && (f?.abort(), (f = new AbortController()));
          let n = f ? qt([d.signal, f.signal]) : d.signal,
            r;
          w();
          try {
            r = u.handler(t, { signal: n });
          } catch (e) {
            m(e);
            return;
          } finally {
            T();
          }
          r != null && typeof r.then == `function` && Promise.resolve(r).catch(m);
        },
        g = () => {
          (d.abort(), f?.abort(), e.removeEventListener(c, h, p));
        };
      (e.addEventListener(c, h, p),
        r.addEventListener(`abort`, g, { once: !0 }),
        a.push(() => {
          (r.removeEventListener(`abort`, g), g());
        }));
    }
  }
  return () => a.forEach((e) => e());
}
function Gt(e, t) {
  if (t.length === 0) return () => {};
  let n = [],
    r = [];
  e.hasAttribute(zt) && r.push(e);
  for (let t of e.querySelectorAll(`[${zt}]`)) Ut(e, t) && r.push(t);
  for (let e of r) {
    let r = Vt(e.getAttribute(zt));
    for (let i of r) {
      let r = t[i.index];
      if (!r || r.kind !== i.kind) continue;
      let { event: a, read: o, write: s } = Ht(e, i.kind),
        c = r.accessor;
      if (i.kind === `this`) {
        (c(e), n.push(() => c(null)));
        continue;
      }
      try {
        s(e, c());
      } catch {}
      if (a === null) continue;
      let l = () => {
        let t = o(e);
        if (i.kind === `group`) {
          let e = t;
          if (e === void 0) return;
          if (typeof e == `object` && e.__ilhaGroup) {
            let t = c(),
              n = Array.isArray(t) ? [...t] : [],
              r = n.findIndex((t) => String(t) === e.value);
            if (e.checked && r === -1) {
              let r = e.value,
                i = Array.isArray(t) && t.length > 0 ? t[0] : void 0;
              if (i !== void 0)
                if (typeof i == `number`) {
                  let e = Number(r);
                  r = Number.isNaN(e) ? r : e;
                } else typeof i == `boolean` && (r = !!r);
              n.push(r);
            } else !e.checked && r !== -1 && n.splice(r, 1);
            c(n);
            return;
          }
          let n = c(),
            r = e;
          if (typeof n == `number` && typeof e == `string`) {
            let t = Number(e);
            r = Number.isNaN(t) ? 0 : t;
          } else typeof n == `boolean` && (r = !!e);
          c(r);
          return;
        }
        let n = c(),
          r = t;
        if (typeof n == `number` && typeof t == `string`) {
          let e = Number(t);
          r = Number.isNaN(e) ? 0 : e;
        } else typeof n == `boolean` && (r = !!t);
        c(r);
      };
      (e.addEventListener(a, l), n.push(() => e.removeEventListener(a, l)));
    }
  }
  return () => n.forEach((e) => e());
}
function Kt(e) {
  let t = e.lastIndexOf(`@`),
    n = t === -1 ? `` : e.slice(0, t),
    r = (t === -1 ? e : e.slice(t + 1)).split(`:`),
    i = r[0],
    a = new Set(r.slice(1));
  return {
    selector: n,
    eventType: i,
    options: { once: a.has(`once`), capture: a.has(`capture`), passive: a.has(`passive`) },
    abortable: a.has(`abortable`),
  };
}
function qt(e) {
  if (typeof AbortSignal.any == `function`) return AbortSignal.any(e);
  let t = new AbortController(),
    n = [];
  for (let r of e) {
    if (r.aborted) return (t.abort(r.reason), n.forEach((e) => e()), t.signal);
    let e = () => t.abort(r.reason);
    (r.addEventListener(`abort`, e, { once: !0 }), n.push(() => r.removeEventListener(`abort`, e)));
  }
  return (
    t.signal.aborted ||
      t.signal.addEventListener(`abort`, () => {
        n.forEach((e) => e());
      }),
    t.signal
  );
}
var Jt = new Set();
function Yt(e, t) {
  if (Jt.size === 0) return !1;
  for (let n of Jt)
    try {
      n(e, t);
    } catch (e) {
      console.error(e);
    }
  return !0;
}
function Xt(e) {
  return (
    Jt.add(e),
    () => {
      Jt.delete(e);
    }
  );
}
var Zt = class e {
  _cfg;
  constructor(e) {
    this._cfg = e;
  }
  input(t) {
    let n = null,
      r = null;
    return (
      t !== void 0 && (Me(t) ? (n = t) : (r = t)),
      new e({
        schema: n,
        defaultInput: r,
        states: [],
        deriveds: [],
        actions: [],
        ons: [],
        effects: [],
        onMounts: [],
        onErrors: [],
        transition: null,
        css: null,
        as: null,
      })
    );
  }
  as(t) {
    return new e({ ...this._cfg, as: ce(t) });
  }
  state(t, n) {
    let r = this._cfg;
    return new e({ ...r, states: [...r.states, { key: t, init: n }] });
  }
  derived(t, n) {
    let r = this._cfg;
    return new e({ ...r, deriveds: [...r.deriveds, { key: t, fn: n }] });
  }
  action(t, n) {
    return new e({ ...this._cfg, actions: [...this._cfg.actions, { key: t, fn: n }] });
  }
  on(t, n) {
    let r = Kt(t);
    return new e({
      ...this._cfg,
      ons: [
        ...this._cfg.ons,
        {
          selector: r.selector,
          event: r.eventType,
          options: r.options,
          abortable: r.abortable,
          handler: n,
        },
      ],
    });
  }
  effect(t) {
    return new e({ ...this._cfg, effects: [...this._cfg.effects, { fn: t }] });
  }
  onMount(t) {
    return new e({ ...this._cfg, onMounts: [...this._cfg.onMounts, { fn: t }] });
  }
  onError(t) {
    return new e({ ...this._cfg, onErrors: [...this._cfg.onErrors, { fn: t }] });
  }
  transition(t) {
    return new e({ ...this._cfg, transition: t });
  }
  css(t, ...n) {
    let r;
    if (typeof t == `string`) r = t;
    else {
      let e = ``;
      for (let r = 0; r < t.length; r++) ((e += t[r]), r < n.length && (e += String(n[r])));
      r = e;
    }
    return new e({ ...this._cfg, css: r });
  }
  render(e) {
    let {
        schema: t,
        defaultInput: n,
        states: r,
        deriveds: i,
        actions: a,
        ons: o,
        effects: s,
        onMounts: c,
        onErrors: l,
        transition: u,
        css: d,
        as: f,
      } = this._cfg,
      p = d == null ? `` : Ye(d),
      m = f ?? `div`;
    function h(e) {
      let r = { ...(n ?? {}), ...(e ?? {}) };
      return t ? Ne(t, r) : r;
    }
    function g({ render: e, liveHost: t, asyncChildren: n }) {
      let r = Qe(t, n);
      try {
        let t = Dt(e()),
          n = r.slots,
          i = r.binds,
          a = r.events;
        if (r.pending && r.pending.size > 0) {
          let e = r.pending;
          return (async () => ({ html: await at(t, e), slots: n, binds: i, events: a }))();
        }
        return { html: t, slots: n, binds: i, events: a };
      } finally {
        $e();
      }
    }
    function _(e) {
      let t = {};
      for (let n of r) {
        let r = typeof n.init == `function` ? n.init(e) : n.init,
          i = st((...e) => {
            if (e.length === 0) return r;
          });
        t[n.key] = i;
      }
      return t;
    }
    function v(e, t) {
      let n = {};
      for (let i of r) {
        let r = E(t && i.key in t ? t[i.key] : typeof i.init == `function` ? i.init(e) : i.init),
          a = st((...e) => {
            if (e.length === 0) return r();
            r(ot(() => r(), e[0]));
          });
        n[i.key] = a;
      }
      return n;
    }
    function y() {
      let e = {};
      for (let t of a) {
        let n = () => {};
        (Object.defineProperties(n, {
          pending: { get: () => !1, enumerable: !0 },
          data: { get: () => void 0, enumerable: !0 },
          error: { get: () => void 0, enumerable: !0 },
        }),
          (e[t.key] = n));
      }
      return e;
    }
    function b() {
      if (typeof document < `u`) return document.createElement(`div`);
      let e = {
        matches: () => !1,
        querySelector: () => null,
        querySelectorAll: () => [],
        setAttribute: () => {},
        getAttribute: () => null,
        removeAttribute: () => {},
        appendChild: () => e,
      };
      return e;
    }
    function x({ input: e, state: t, derived: n, action: r }) {
      if (c.length === 0 || et()) return;
      let i = b(),
        a = [];
      for (let o of c) {
        let s = C(void 0),
          c;
        try {
          c = o.fn({ state: t, derived: n, action: r, input: e, host: i, hydrated: !1 });
        } catch (a) {
          let o = a instanceof Error ? a : Error(String(a));
          if (l.length === 0) Yt(o, `mount`) || console.error(o);
          else
            for (let a of l)
              try {
                a.fn({
                  error: o,
                  source: `mount`,
                  state: t,
                  derived: n,
                  action: r,
                  input: e,
                  host: i,
                });
              } catch (e) {
                console.error(e);
              }
        } finally {
          C(s);
        }
        typeof c == `function` && a.push(c);
      }
      for (let e of a.reverse())
        try {
          e();
        } catch (e) {
          let t = e instanceof Error ? e : Error(String(e));
          l.length === 0 && (Yt(t, `mount`) || console.error(t));
        }
    }
    function S(t, n = !1) {
      let r = h(t),
        a = v(r),
        o = y(),
        s = i.map((e) => {
          let t = C(void 0);
          try {
            return {
              key: e.key,
              result: e.fn({ state: a, input: r, signal: new AbortController().signal }),
            };
          } catch (t) {
            return { key: e.key, result: Promise.reject(t) };
          } finally {
            C(t);
          }
        });
      if (!s.some((e) => e.result instanceof Promise) || n) {
        let t = {};
        for (let e of s)
          e.result instanceof Promise
            ? (t[e.key] = { loading: !0, value: void 0, error: void 0 })
            : (t[e.key] = { loading: !1, value: e.result, error: void 0 });
        let n = Lt(t);
        et() || x({ input: r, state: a, derived: n, action: o });
        let i = C(void 0);
        try {
          let { html: t } = g({ render: () => e({ state: a, derived: n, action: o, input: r }) });
          return p + t;
        } finally {
          C(i);
        }
      }
      return Promise.all(
        s.map(async (e) => {
          try {
            return {
              key: e.key,
              envelope: { loading: !1, value: await Promise.resolve(e.result), error: void 0 },
            };
          } catch (t) {
            return {
              key: e.key,
              envelope: {
                loading: !1,
                value: void 0,
                error: t instanceof Error ? t : Error(String(t)),
              },
            };
          }
        }),
      ).then(async (t) => {
        let n = {};
        for (let e of t) n[e.key] = e.envelope;
        let i = Lt(n);
        et() || x({ input: r, state: a, derived: i, action: o });
        let s = C(void 0);
        try {
          let { html: t } = await g({
            render: () => e({ state: a, derived: i, action: o, input: r }),
            asyncChildren: !0,
          });
          return p + t;
        } finally {
          C(s);
        }
      });
    }
    function D(e, t) {
      return k(e, t).unmount;
    }
    function k(t, n) {
      if (n === void 0) {
        let e = t.getAttribute(Ke);
        if (e) {
          let t = H(e, Ke);
          t !== void 0 && (n = ye(t));
        }
      }
      let r = E(h(n)),
        d = new Proxy(
          {},
          {
            get(e, t) {
              return r()[t];
            },
            has(e, t) {
              return t in r();
            },
            ownKeys() {
              let e = C(void 0);
              try {
                return Reflect.ownKeys(r());
              } finally {
                C(e);
              }
            },
            getOwnPropertyDescriptor(e, t) {
              let n = C(void 0);
              try {
                return Reflect.getOwnPropertyDescriptor(r(), t);
              } finally {
                C(n);
              }
            },
          },
        ),
        f,
        m = t.getAttribute(qe);
      if (m) {
        let e = H(m, qe);
        e !== void 0 && (f = e);
      }
      let _ = f
          ? Object.fromEntries(
              Object.entries(f).filter(([e]) => e !== `_derived` && e !== `_skipOnMount`),
            )
          : void 0,
        y = f?._derived,
        b;
      if (y) {
        b = {};
        for (let [e, t] of Object.entries(y))
          t.error && !(t.error instanceof Error)
            ? (b[e] = { ...t, error: Error(String(t.error)) })
            : (b[e] = t);
      }
      let x = f != null,
        S = _ != null && Object.keys(_).length > 0,
        D = x && f?._skipOnMount === !0 && S,
        k = v(d, _),
        A = [],
        j = new AbortController();
      A.push(() => j.abort());
      let { proxy: M, setup: N } = Rt({ entries: i, state: k, input: d, derivedSnapshot: b }),
        ee = () => {},
        P = {};
      function F(e, n) {
        let r = e instanceof Error ? e : Error(String(e));
        if (l.length === 0) {
          Yt(r, n) || console.error(r);
          return;
        }
        for (let e of l)
          try {
            e.fn({ error: r, source: n, state: k, derived: M, action: P, input: d, host: t });
          } catch (e) {
            console.error(e);
          }
      }
      let I = a,
        L = {},
        te = !1;
      A.push(() => {
        te = !0;
      });
      for (let e of I) {
        let n = E({ pending: 0, data: void 0, error: void 0 }),
          r = () => Nt(() => n()),
          i = 0,
          a = (a) => {
            if (et() || te) return;
            let o = ++i,
              s = j.signal,
              c = { state: k, derived: M, input: d, host: t, signal: s },
              l,
              u = !1;
            w();
            try {
              ((l = e.fn(a, c)), (u = l != null && typeof l.then == `function`));
              let t = r();
              n(
                u
                  ? { pending: t.pending + 1, data: t.data, error: void 0 }
                  : { pending: t.pending, data: l, error: void 0 },
              );
            } catch (e) {
              let t = e instanceof Error ? e : Error(String(e));
              (n({ pending: r().pending, data: void 0, error: t }), F(t, `action`));
              return;
            } finally {
              T();
            }
            u &&
              Promise.resolve(l)
                .then((e) => {
                  if (te || s.aborted || o !== i) return;
                  let t = r();
                  n({ pending: t.pending, data: e, error: void 0 });
                })
                .catch((e) => {
                  if (te || s.aborted || e?.name === `AbortError`) return;
                  let t = e instanceof Error ? e : Error(String(e));
                  if (o === i) {
                    let e = r();
                    n({ pending: e.pending, data: void 0, error: t });
                  }
                  F(t, `action`);
                })
                .finally(() => {
                  if (te) return;
                  let e = r();
                  n({ ...e, pending: Math.max(0, e.pending - 1) });
                });
          };
        (Object.defineProperties(a, {
          pending: { get: () => n().pending > 0, enumerable: !0 },
          data: { get: () => n().data, enumerable: !0 },
          error: { get: () => n().error, enumerable: !0 },
        }),
          (L[e.key] = a));
      }
      if (((P = L), u?.enter))
        try {
          let e = u.enter(t);
          e instanceof Promise && e.catch((e) => F(e, `transition`));
        } catch (e) {
          F(e, `transition`);
        }
      let R = new Map(),
        z = new Map();
      function B(e, t) {
        R.delete(e);
        let n = Symbol(),
          r = t.unmount(),
          i = (t) => {
            let r = z.get(e);
            !r || r.token !== n || (r.el.remove(), t?.remove(), z.delete(e));
          };
        if (r instanceof Promise)
          return (
            t.el.removeAttribute(We),
            t.el.setAttribute(Ge, ``),
            z.set(e, { el: t.el, token: n }),
            r.finally(() => i())
          );
        t.el.remove();
      }
      function V(e) {
        let n = e;
        for (; n && n !== t; ) {
          if (n.hasAttribute(`data-ilha`)) return !1;
          n = n.parentElement;
        }
        return n === t;
      }
      function ne() {
        let e = new Set([...z.values()].map((e) => e.el)),
          n = new Map();
        for (let r of t.querySelectorAll(`[${We}]`)) {
          if (e.has(r)) continue;
          let t = r.getAttribute(We);
          t === null || n.has(t) || (V(r) && n.set(t, r));
        }
        return n;
      }
      function ie(e) {
        for (let [t, n] of R) {
          let r = e.get(t);
          r && n.updateProps(r.props);
        }
      }
      function ae(e) {
        for (let [t, n] of R) e.has(t) || B(t, n);
        for (let [t, n] of R) {
          let r = e.get(t);
          r && r.island !== n.island && B(t, n);
        }
        let t = null;
        for (let [n, { island: r, props: i }] of e) {
          let e = R.get(n);
          if (e) {
            e.updateProps(i);
            continue;
          }
          t === null && (t = ne());
          let a = t.get(n) ?? null;
          if (!a) continue;
          let o = i;
          if (o === void 0) {
            let e = a.getAttribute(Ke) ?? a.getAttribute(`data-props`);
            if (e) {
              let t = H(e, `props on [${We}="${n}"]`);
              t !== void 0 && (o = ye(t));
            }
          }
          let s = C(void 0),
            c;
          try {
            let e = r[Ve];
            c = e ? e(a, o) : { unmount: r.mount(a, o), updateProps: () => {} };
          } finally {
            C(s);
          }
          R.set(n, { el: a, island: r, ...c });
        }
      }
      let oe = [],
        se = new Set(),
        ce = new WeakMap();
      function le() {
        for (let e of o) {
          if (e.options.once && se.has(e)) continue;
          let n;
          try {
            n =
              e.selector === ``
                ? [t]
                : Array.from(t.querySelectorAll(e.selector)).filter((e) => Ut(t, e));
          } catch {
            continue;
          }
          n.forEach((n) => {
            let r = (r) => {
                if (e.options.once) {
                  se.add(e);
                  for (let t of oe.filter((t) => t.entry === e))
                    t.target.removeEventListener(t.type, t.fn, t.options);
                  oe.splice(0, oe.length, ...oe.filter((t) => t.entry !== e));
                }
                let i = r.target instanceof Element ? r.target : n,
                  a = e.selector === `` ? i : n,
                  o;
                if (e.abortable) {
                  let t = ce.get(e);
                  t || ((t = new WeakMap()), ce.set(e, t));
                  let r = t.get(n);
                  r && r.abort();
                  let i = new AbortController();
                  (t.set(n, i), (o = qt([j.signal, i.signal])));
                } else o = j.signal;
                let s;
                w();
                try {
                  s = e.handler({
                    state: k,
                    derived: M,
                    action: P,
                    input: d,
                    host: t,
                    target: a,
                    event: r,
                    signal: o,
                  });
                } catch (e) {
                  (F(e, `on`), T());
                  return;
                }
                (T(),
                  s instanceof Promise &&
                    s.catch((e) => {
                      (e && e.name === `AbortError`) || F(e, `on`);
                    }));
              },
              i = { ...e.options, once: !1 };
            (n.addEventListener(e.event, r, i),
              oe.push({ target: n, type: e.event, fn: r, options: i, entry: e }));
          });
        }
      }
      function ue() {
        for (let e of oe) e.target.removeEventListener(e.type, e.fn, e.options);
        oe.length = 0;
      }
      function fe() {
        for (let e of c) {
          let n = C(void 0),
            r;
          try {
            r = e.fn({ state: k, derived: M, action: P, input: d, host: t, hydrated: x });
          } catch (e) {
            F(e, `mount`);
          } finally {
            C(n);
          }
          if (r) {
            let e = r;
            A.push(() => {
              try {
                e();
              } catch (e) {
                F(e, `mount`);
              }
            });
          }
        }
      }
      let pe = x && t.childNodes.length > 0;
      x && c.length > 0 && !D && fe();
      let me = new WeakMap(),
        he = g({
          render: () => e({ state: k, derived: M, action: P, input: d }),
          liveHost: pe ? t : void 0,
        });
      pe || (t.innerHTML = p + he.html);
      let ge = Gt(t, he.binds);
      A.push(() => ge());
      let _e = Wt({
        host: t,
        records: he.events,
        reportError: (e) => F(e, `on`),
        unmountSignal: j.signal,
        onceFired: me,
      });
      (A.push(() => _e()),
        ae(he.slots),
        A.push(() => R.forEach((e) => e.unmount())),
        le(),
        !x && c.length > 0 && fe());
      for (let e of s) {
        let n,
          r = null,
          i = O(() => {
            if (n) {
              try {
                n();
              } catch (e) {
                F(e, `effect`);
              }
              n = void 0;
            }
            (r && r.abort(), (r = new AbortController()));
            let i = qt([j.signal, r.signal]);
            w();
            try {
              n = e.fn({ state: k, derived: M, action: P, input: d, host: t, signal: i });
            } catch (e) {
              F(e, `effect`);
            } finally {
              T();
            }
          });
        A.push(() => {
          if ((i(), n))
            try {
              n();
            } catch (e) {
              F(e, `effect`);
            }
          r && r.abort();
        });
      }
      ((ee = N()), A.push(ee));
      let ve = !1,
        be = he.html,
        Se = null,
        Ce = 0,
        we = O(() => {
          let n = ++Ce,
            {
              html: r,
              slots: i,
              binds: a,
              events: o,
            } = g({ render: () => e({ state: k, derived: M, action: P, input: d }), liveHost: t });
          (_e(),
            (_e = Wt({
              host: t,
              records: o,
              reportError: (e) => F(e, `on`),
              unmountSignal: j.signal,
              onceFired: me,
            })));
          let s = p + r;
          if (!ve) {
            if (((ve = !0), pe && (ie(i), r === be))) {
              Se = r;
              return;
            }
            if (r === be) {
              Se = r;
              return;
            }
            if (
              R.size > 0 &&
              R.size === i.size &&
              [...i.keys()].every((e) => R.has(e)) &&
              de({ initialHtml: be, renderedHtml: r, slotIds: i.keys() })
            ) {
              ie(i);
              return;
            }
          }
          if (
            r === Se &&
            R.size === i.size &&
            [...i].every(([e, t]) => R.get(e)?.island === t.island)
          ) {
            ie(i);
            return;
          }
          (ue(), ge(), _e());
          let c = R.size,
            l = [];
          for (let [e, t] of R)
            if (!i.has(e)) {
              let n = B(e, t);
              n instanceof Promise && l.push(n);
            }
          for (let [e, t] of R) {
            let n = i.get(e);
            if (n && n.island !== t.island) {
              let n = B(e, t);
              n instanceof Promise && l.push(n);
            }
          }
          let u = () => {
            if (n !== Ce) return;
            if (i.size < c) {
              let e = 1 / 0;
              for (let [t, n] of R) {
                if (!t.startsWith(`p:`)) continue;
                let r = i.get(t);
                if (!r) continue;
                let a = Number(t.slice(2));
                Number.isNaN(a) ||
                  a >= e ||
                  (xe(r.props) !== (n.el.getAttribute(Ke) ?? ``) && (e = a));
              }
              for (let [t, n] of R)
                i.has(t) &&
                  n.el.isConnected &&
                  t.startsWith(`p:`) &&
                  Number(t.slice(2)) >= e &&
                  B(t, n);
            }
            let e = document.createElement(`template`),
              l = t.tagName.toLowerCase();
            ((e.innerHTML = `<${l}>${s}</${l}>`), je(t, e.content.firstElementChild), (Se = r));
            let u = null;
            for (let [e, t] of R) {
              if (!i.has(e) || t.el.isConnected) continue;
              u ??= ne();
              let n = u.get(e);
              n && n !== t.el && n.replaceWith(t.el);
            }
            (le(),
              (ge = Gt(t, a)),
              (_e = Wt({
                host: t,
                records: o,
                reportError: (e) => F(e, `on`),
                unmountSignal: j.signal,
                onceFired: me,
              })),
              ae(i));
          };
          l.length > 0
            ? Promise.allSettled(l).then((e) => {
                for (let t of e) t.status === `rejected` && console.error(t.reason);
                u();
              })
            : u();
        }),
        Te = !1,
        Ee = {
          unmount: () => {
            if (Te) return;
            ((Te = !0), (te = !0), j.abort(), Ue.delete(t), we(), ue());
            let e = [];
            for (let [, t] of R) {
              let n = t.unmount();
              n instanceof Promise && e.push(n);
            }
            if (u?.leave)
              try {
                let n = u.leave(t);
                n instanceof Promise && e.push(n);
              } catch (e) {
                F(e, `transition`);
              }
            let n = () => {
              for (let e of A) e();
            };
            if (e.length > 0)
              return Promise.all(e)
                .then(n)
                .catch((e) => {
                  (F(e, `transition`), n());
                });
            n();
          },
          updateProps: (e) => {
            if (Te) return;
            let t = h(e);
            re(r(), t) || r(t);
          },
        };
      return (Ue.set(t, Ee), Ee);
    }
    let A = (e) => (et() ? { [Be]: !0, island: A, props: e, key: void 0 } : S(e));
    return (
      (A.toString = (e) => S(e, !0)),
      (A.mount = (e, t) => D(e, t)),
      (A[Ve] = (e, t) => k(e, t)),
      (A[He] = m),
      (A.key = (e) => {
        if (typeof e != `string` || e.trim().length === 0)
          throw Error(`island.key() requires a non-empty string.`);
        if (e.includes(`:`))
          throw Error(`island.key() key cannot contain the slot separator ":" (got "${e}").`);
        let t = (t) => ({ [Be]: !0, island: A, props: t, key: e });
        return ((t[Be] = !0), t);
      }),
      (A[ze] = !0),
      (A.define = (e, t) => {
        if (typeof customElements > `u` || typeof HTMLElement > `u`) {
          `${e}`;
          return;
        }
        let n = new Set([
          `annotation-xml`,
          `color-profile`,
          `font-face`,
          `font-face-src`,
          `font-face-uri`,
          `font-face-format`,
          `font-face-name`,
          `missing-glyph`,
        ]);
        if (typeof e != `string` || !/^[a-z][a-z0-9._-]*-[a-z0-9._-]*$/.test(e) || n.has(e)) {
          `${e}`;
          return;
        }
        if (customElements.get(e)) {
          `${e}`;
          return;
        }
        let r = t?.observe ?? [];
        class i extends HTMLElement {
          static observedAttributes = r;
          _handle = null;
          _props;
          _unmounting = !1;
          _reconnect = !1;
          get props() {
            return this._props;
          }
          set props(e) {
            ((this._props = e),
              this._handle && !this._unmounting && this._handle.updateProps(this._mergedProps()));
          }
          _mergedProps() {
            let e = {},
              t = !1;
            for (let n of r) {
              let r = this.getAttribute(n);
              r !== null && ((e[n] = r), (t = !0));
            }
            if (!(!t && this._props === void 0)) return { ...e, ...(this._props ?? {}) };
          }
          connectedCallback() {
            if (this._unmounting) {
              this._reconnect = !0;
              return;
            }
            this._handle ||= k(this, this._mergedProps());
          }
          disconnectedCallback() {
            !this._handle ||
              this._unmounting ||
              ((this._unmounting = !0),
              (this._reconnect = !1),
              Promise.resolve(this._handle.unmount()).finally(() => {
                ((this._handle = null),
                  (this._unmounting = !1),
                  this._reconnect &&
                    ((this._reconnect = !1),
                    this.isConnected && (this._handle = k(this, this._mergedProps()))));
              }));
          }
          attributeChangedCallback() {
            this._handle && !this._unmounting && this._handle.updateProps(this._mergedProps());
          }
        }
        customElements.define(e, i);
      }),
      (A.hydratable = async (e, t) => {
        let { name: n, as: a = `div`, snapshot: o = !1, skipOnMount: s } = t,
          c = ce(a),
          l = e ?? {},
          u = await S(l),
          d = Fe(JSON.stringify(l)),
          f = ``;
        if (o !== !1) {
          let e = o === !0 || o.state !== !1,
            t = o === !0 || o.derived !== !1,
            n = s ?? (e || t),
            a = {},
            c = h(l),
            u = _(c);
          if (e) for (let e of r) a[e.key] = u[e.key]();
          if (t) {
            let e = {};
            for (let t of i) {
              let n = C(void 0),
                r,
                i,
                a = !1;
              try {
                r = t.fn({ state: u, input: c, signal: new AbortController().signal });
              } catch (e) {
                ((a = !0), (i = e));
              } finally {
                C(n);
              }
              if (a) {
                e[t.key] = {
                  loading: !1,
                  value: void 0,
                  error: i instanceof Error ? i.message : String(i),
                };
                continue;
              }
              try {
                let n = await Promise.resolve(r);
                e[t.key] = { loading: !1, value: n, error: void 0 };
              } catch (n) {
                e[t.key] = {
                  loading: !1,
                  value: void 0,
                  error: n instanceof Error ? n.message : String(n),
                };
              }
            }
            a._derived = e;
          }
          (n && (a._skipOnMount = !0), (f = ` ${qe}='${Fe(JSON.stringify(a))}'`));
        }
        return `<${c} data-ilha="${Fe(n)}" ${Ke}='${d}'${f}>${u}</${c}>`;
      }),
      A
    );
  }
};
function Qt(e, t, n) {
  let r = typeof e == `string` ? document.querySelector(e) : e;
  return r ? t.mount(r, n) : (console.warn(`[ilha] from(): element not found: ${e}`), null);
}
function $t(e, t = {}) {
  let n = t.root ?? document.body,
    r = t.lazy ?? !1,
    i = [];
  function a(t) {
    let n = t.getAttribute(`data-ilha`);
    if (!n) return;
    let r = e[n];
    if (!r) {
      `${n}${Object.keys(e).join(`, `)}`;
      return;
    }
    let a = {},
      o = t.getAttribute(Ke);
    if (o) {
      let e = H(o, `${Ke} on [data-ilha="${n}"]`);
      e !== void 0 && (a = ye(e));
    }
    i.push(r.mount(t, a));
  }
  let o = Array.from(n.querySelectorAll(`[data-ilha]`));
  if (r && typeof IntersectionObserver < `u`) {
    let e = !1,
      t = new IntersectionObserver((n) => {
        if (!e) for (let e of n) e.isIntersecting && (a(e.target), t.unobserve(e.target));
      });
    (o.forEach((e) => t.observe(e)),
      i.push(() => {
        ((e = !0), t.disconnect());
      }));
  } else o.forEach(a);
  return {
    unmount: () => {
      let e = [];
      for (let t of i) {
        let n = t();
        n instanceof Promise && e.push(n);
      }
      if (e.length > 0) return Promise.all(e).then(() => {});
    },
  };
}
var en = new Zt({
    schema: null,
    defaultInput: null,
    states: [],
    deriveds: [],
    actions: [],
    ons: [],
    effects: [],
    onMounts: [],
    onErrors: [],
    transition: null,
    css: null,
    as: null,
  }),
  tn = (e) => en.input().render(e);
Object.defineProperty(tn, "_cfg", { value: en._cfg, enumerable: !1 });
for (let e of Object.getOwnPropertyNames(Zt.prototype)) {
  if (e === `constructor`) continue;
  let t = Object.getOwnPropertyDescriptor(Zt.prototype, e);
  t && Object.defineProperty(tn, e, t);
}
var nn = Object.assign(tn, {
  html: Tt,
  raw: mt,
  mount: $t,
  from: Qt,
  context: At,
  signal: jt,
  computed: Mt,
  batch: Pt,
  untrack: Nt,
  onUncaughtError: Xt,
});
function rn({ type: e, handler: t, modifier: n }) {
  let r = et();
  if (!r) return;
  let i = r.events.length;
  return (r.events.push({ type: e, handler: t, modifier: n }), i);
}
function an({ island: e, props: t, key: n }) {
  return mt(rt({ island: e, props: t, key: n }));
}
var U = Tt,
  W = mt,
  on = $t,
  sn = At,
  cn = (() => {
    let e = function () {};
    return ((e.prototype = Object.create(null)), Object.freeze(e.prototype), e);
  })();
function ln() {
  return { root: { key: `` }, static: new cn() };
}
function un(e) {
  let t = 0,
    n = 0;
  for (; t < e.length; t++) {
    let r = e.charCodeAt(t);
    if (r === 92) t++;
    else if (r === 40) n++;
    else if (r === 41 && n > 0) n--;
    else if (r === 123 && n === 0) break;
  }
  if (t >= e.length) return;
  let r = t + 1;
  for (n = 0; r < e.length; r++) {
    let t = e.charCodeAt(r);
    if (t === 92) r++;
    else if (t === 40) n++;
    else if (t === 41 && n > 0) n--;
    else if (t === 125 && n === 0) break;
  }
  if (r >= e.length) return;
  let i = e[r + 1],
    a = i === `?` || i === `+` || i === `*`;
  return [e.slice(0, t), e.slice(t + 1, r), e.slice(r + (a ? 2 : 1)), a ? i : void 0];
}
function dn(e) {
  if (!e.includes(`{`)) return;
  let t = un(e);
  if (!t) return;
  let [n, r, i, a] = t;
  if (!a) return [n + r + i];
  if (a === `?`) return [n + r + i, n + i];
  if (r.includes(`/`)) throw Error(`unsupported group repetition across segments`);
  return [`${n}(?:${r})${a}${i}`];
}
var fn = `__rou3_unnamed_`,
  pn = 15;
function mn(e) {
  let t = 0;
  for (let n = 0; n < e.length; n++) {
    let r = e.charCodeAt(n);
    if (r === 92) {
      n++;
      continue;
    }
    if (r === 40) {
      t++;
      continue;
    }
    if (r === 41 && t > 0) {
      t--;
      continue;
    }
    if (r === 42 && t === 0) return !0;
  }
  return !1;
}
function hn(e, t, n = gn) {
  let r = 0,
    i = t,
    a = ``;
  for (let t = 0; t < e.length; t++) {
    let o = e.charCodeAt(t);
    if (o === 92) {
      ((a += e[t]), t + 1 < e.length && (a += e[++t]));
      continue;
    }
    if (o === 40) {
      (r++, (a += e[t]));
      continue;
    }
    if (o === 41 && r > 0) {
      (r--, (a += e[t]));
      continue;
    }
    if (o === 42 && r === 0) {
      a += `(?<${n(i++)}>[^/]*)`;
      continue;
    }
    a += e[t];
  }
  return [a, i];
}
function gn(e) {
  return `${fn}${e}`;
}
function _n(e) {
  return e.startsWith(`__rou3_unnamed_`) ? e.slice(pn) : e;
}
function vn(e) {
  return e.includes(`\\`)
    ? e.replace(/\\([:(){}])/g, (e, t) => `�` + `ABCDE`[`:(){}`.indexOf(t)])
    : e;
}
function yn(e) {
  return e.includes(`�`)
    ? e.replace(/\uFFFD([A-E])/g, (e, t) =>
        t === `A` ? `:` : t === `B` ? `(` : t === `C` ? `)` : t === `D` ? `{` : `}`,
      )
    : e;
}
function bn(e) {
  for (let t = 0; t < e.length; t++) {
    let n = e[t].charCodeAt(e[t].length - 1);
    if (n !== 63 && n !== 43 && n !== 42) continue;
    let r = e[t].match(/^(.*:[\w-]+(?:\([^)]*\))?)([?+*])$/);
    if (!r) continue;
    let i = e.slice(0, t),
      a = e.slice(t + 1);
    if (r[2] === `?`)
      return [`/` + i.concat(r[1]).concat(a).join(`/`), `/` + i.concat(a).join(`/`)];
    let o = r[1].match(/:([\w-]+)/)?.[1] || `_`,
      s = `/` + [...i, `**:${o}`, ...a].join(`/`),
      c = `/` + [...i, ...a].join(`/`);
    return r[2] === `+` ? [s] : [s, c];
  }
}
function xn(e) {
  if (!e.includes(`/.`)) return e;
  let t = [];
  for (let n of e.split(`/`))
    if (n === `.`) continue;
    else n === `..` && t.length > 1 ? t.pop() : t.push(n);
  return t.join(`/`) || `/`;
}
function Sn(e) {
  let t = e.split(`/`);
  return (t.shift(), t[t.length - 1] === `` && t.pop(), t);
}
function Cn(e, t) {
  let n = new cn();
  for (let [r, i] of t) {
    let t = r < 0 ? e.slice(-(r + 1)).join(`/`) : e[r];
    if (typeof i == `string`) n[i] = t;
    else {
      let e = t.match(i);
      if (e) for (let t in e.groups) n[_n(t)] = e.groups[t];
    }
  }
  return n;
}
function wn(e, t = ``, n, r) {
  ((t = t.toUpperCase()), n.charCodeAt(0) !== 47 && (n = `/${n}`));
  let i = dn(n);
  if (i) {
    for (let n of i) wn(e, t, n, r);
    return;
  }
  n = vn(n);
  let a = Sn(n),
    o = bn(a);
  if (o) {
    for (let n of o) wn(e, t, n, r);
    return;
  }
  let s = e.root,
    c = 0,
    l = [],
    u = [];
  for (let e = 0; e < a.length; e++) {
    let t = a[e];
    if (t.startsWith(`**`)) {
      ((s.wildcard ||= { key: `**` }),
        (s = s.wildcard),
        l.push([-(e + 1), t.split(`:`)[1] || `_`, t.length === 2]));
      break;
    }
    let n = t.includes(`(`),
      r = !n && mn(t);
    if (t === `*` || n || r || t.includes(`:`)) {
      if (((s.param ||= { key: `*` }), (s = s.param), t === `*`)) l.push([e, String(c++), !0]);
      else if (n || r || t.includes(`:`, 1) || !/^:[\w-]+$/.test(t)) {
        let [n, r] = Tn(t, c);
        ((c = r), (u[e] = n), (s.hasRegexParam = !0), l.push([e, n, !1]));
      } else l.push([e, t.slice(1), !1]);
      continue;
    }
    (t === `\\*` ? (t = a[e] = `*`) : t === `\\*\\*` && (t = a[e] = `**`), (t = a[e] = yn(t)));
    let i = s.static?.[t];
    if (i) s = i;
    else {
      let e = { key: t };
      ((s.static ||= new cn()), (s.static[t] = e), (s = e));
    }
  }
  let d = l.length > 0,
    f = (s.methods ??= new cn());
  ((f[t] ??= []).push({ data: r || null, paramsRegexp: u, paramsMap: d ? l : void 0 }),
    d || (e.static[`/` + a.join(`/`)] = s));
}
function Tn(e, t = 0) {
  let n = t,
    r = ``,
    i = 0;
  for (let t = 0; t < e.length; t++) {
    let n = e.charCodeAt(t);
    if (n === 40) i++;
    else if (n === 41 && i > 0) i--;
    else if (n === 92 && i === 0 && t + 1 < e.length) {
      let n = e[t + 1];
      if (n !== `:` && n !== `(` && n !== `*` && n !== `\\`) {
        ((r += `￾` + n), t++);
        continue;
      }
    } else if (n === 46 && i === 0) {
      r += `\\.`;
      continue;
    }
    r += e[t];
  }
  [r, n] = hn(r, n);
  let a = r
    .replace(/:([\w-]+)(?:\(([^)]*)\))?/g, (e, t, n) => `(?<${t}>${n || `[^/]+`})`)
    .replace(/\((?![?<])/g, () => `(?<${gn(n++)}>`)
    .replace(/\uFFFE(.)/g, (e, t) => (/[.*+?^${}()|[\]\\]/.test(t) ? `\\${t}` : t));
  return [RegExp(`^${a}$`), n];
}
function En(e, t = ``, n, r) {
  (r?.normalize && (n = xn(n)), n.charCodeAt(n.length - 1) === 47 && (n = n.slice(0, -1)));
  let i = e.static[n];
  if (i && i.methods) {
    let e = i.methods[t] || i.methods[``];
    if (e !== void 0) return e[0];
  }
  let a = Sn(n),
    o = Dn(e.root, t, a, 0);
  if (o !== void 0)
    return r?.params === !1
      ? o
      : { data: o.data, params: o.paramsMap ? Cn(a, o.paramsMap) : void 0 };
}
function Dn(e, t, n, r) {
  if (r === n.length) {
    if (e.methods) {
      let r = On(e.methods, t, n, e.key === `*`, !1);
      if (r) return r;
    }
    return (
      (e.param?.methods && On(e.param.methods, t, n, !0, !0)) ||
      (e.wildcard?.methods && On(e.wildcard.methods, t, n, !0, !0)) ||
      void 0
    );
  }
  let i = n[r];
  if (e.static) {
    let a = e.static[i];
    if (a) {
      let e = Dn(a, t, n, r + 1);
      if (e) return e;
    }
  }
  if (e.param) {
    let i = Dn(e.param, t, n, r + 1);
    if (i) return i;
  }
  if (e.wildcard && e.wildcard.methods) return On(e.wildcard.methods, t, n, !0, !1);
}
function On(e, t, n, r, i) {
  let a = e[t] || e[``];
  if (!a) return;
  let o = a[0];
  if (a.length === 1 && o.paramsRegexp.length === 0) {
    if (!i) return o;
    let e = o.paramsMap;
    return e?.[e.length - 1]?.[2] ? o : void 0;
  }
  let s,
    c = -1;
  for (let e of a) {
    let t = e.paramsMap,
      a = t?.[t.length - 1]?.[2];
    if (i && !a) continue;
    let o = r && t && !a ? 1 : 0,
      l = e.paramsRegexp;
    for (let e = 0; e < l.length; e++)
      if (l[e]) {
        if (!l[e].test(n[e])) {
          o = -1;
          break;
        }
        o++;
      }
    o > c && ((s = e), (c = o));
  }
  return s;
}
var kn = `modulepreload`,
  An = function (e) {
    return `/` + e;
  },
  jn = {},
  Mn = function (e, t, n) {
    let r = Promise.resolve();
    if (t && t.length > 0) {
      let e = document.getElementsByTagName(`link`),
        i = document.querySelector(`meta[property=csp-nonce]`),
        a = i?.nonce || i?.getAttribute(`nonce`);
      function o(e) {
        return Promise.all(
          e.map((e) =>
            Promise.resolve(e).then(
              (e) => ({ status: `fulfilled`, value: e }),
              (e) => ({ status: `rejected`, reason: e }),
            ),
          ),
        );
      }
      function s(e) {
        return import.meta.resolve ? import.meta.resolve(e) : new URL(e, import.meta.url).href;
      }
      r = o(
        t.map((t) => {
          if (((t = An(t, n)), (t = s(t)), t in jn)) return;
          jn[t] = !0;
          let r = t.endsWith(`.css`);
          for (let n = e.length - 1; n >= 0; n--) {
            let i = e[n];
            if (i.href === t && (!r || i.rel === `stylesheet`)) return;
          }
          let i = document.createElement(`link`);
          if (
            ((i.rel = r ? `stylesheet` : kn),
            r || (i.as = `script`),
            (i.crossOrigin = ``),
            (i.href = t),
            a && i.setAttribute(`nonce`, a),
            document.head.appendChild(i),
            r)
          )
            return new Promise((e, n) => {
              (i.addEventListener(`load`, e),
                i.addEventListener(`error`, () => n(Error(`Unable to preload CSS for ${t}`))));
            });
        }),
      );
    }
    function i(e) {
      let t = new Event(`vite:preloadError`, { cancelable: !0 });
      if (((t.payload = e), window.dispatchEvent(t), !t.defaultPrevented)) throw e;
    }
    return r.then((t) => {
      for (let e of t || []) e.status === `rejected` && i(e.reason);
      return e().catch(i);
    });
  },
  Nn = typeof window < `u` && typeof document < `u`,
  Pn = {
    readLocation() {
      return Nn
        ? { pathname: location.pathname, search: location.search, hash: location.hash }
        : { pathname: `/`, search: ``, hash: `` };
    },
    push(e, t) {
      Nn && history.pushState(t ?? null, ``, e);
    },
    replace(e, t) {
      Nn && history.replaceState(t ?? null, ``, e);
    },
    onChange(e) {
      return Nn
        ? (window.addEventListener(`popstate`, e), () => window.removeEventListener(`popstate`, e))
        : () => {};
    },
    toLinkHref(e) {
      return e;
    },
    extractLogicalPath(e) {
      let t = e.getAttribute(`href`);
      return !t ||
        (e.protocol && !/^(http:|https:)$/.test(e.protocol)) ||
        t.startsWith(`#`) ||
        (e.hostname && (e.hostname !== location.hostname || e.protocol !== location.protocol))
        ? null
        : e.pathname + e.search + e.hash;
    },
  },
  Fn = `history`,
  In = Pn;
function Ln() {
  return Fn;
}
function Rn() {
  return In;
}
var zn = typeof window < `u` && typeof document < `u`;
function Bn(e) {
  return e;
}
var Vn = class {
    __ilhaRedirect = !0;
    to;
    status;
    constructor(e, t = 302) {
      ((this.to = e), (this.status = t));
    }
  },
  Hn = class {
    __ilhaLoaderError = !0;
    status;
    message;
    constructor(e, t) {
      ((this.status = e), (this.message = t));
    }
  },
  Un = Symbol.for(`ilha.router.wrapLayout.leaf`),
  Wn = Symbol.for(`ilha.router.wrapLayout.handler`),
  Gn = Symbol.for(`ilha.islandCall`);
function Kn(e) {
  let t = e.match(/^<([a-zA-Z][\w-]*)\s[^>]*>([\s\S]*)<\/\1>\s*$/);
  return t ? t[2] : e;
}
function qn(e) {
  let t = e.match(/^<([a-zA-Z][\w-]*)\s([^>]*)>/);
  return t ? { tag: t[1], attrs: t[2] } : null;
}
var Jn = /<(pre|script|style|textarea)\b/i;
function Yn(e, t, n) {
  let r = RegExp(`<${n}\\b`, `gi`),
    i = RegExp(`</${n}>`, `gi`),
    a = 1,
    o = t;
  for (; a > 0 && o < e.length; ) {
    ((r.lastIndex = o), (i.lastIndex = o));
    let t = r.exec(e),
      n = i.exec(e);
    if (!n) return null;
    if (t && t.index < n.index) ((a += 1), (o = t.index + t[0].length));
    else {
      if ((--a, a === 0)) return n.index + n[0].length;
      o = n.index + n[0].length;
    }
  }
  return o;
}
function Xn(e, t) {
  let n = t;
  for (; n < e.length; ) {
    if (e.startsWith(`<!--`, n)) {
      let t = e.indexOf(`-->`, n);
      if (t === -1) return null;
      n = t + 3;
      continue;
    }
    let t = e.slice(n).match(Jn);
    if (t && t.index != null && t.index >= 0) {
      let r = n + t.index,
        i = !1,
        a = n;
      for (; a < r; ) {
        let t = e.indexOf(`<!--`, a);
        if (t === -1 || t >= r) break;
        let o = e.indexOf(`-->`, t);
        if (o === -1) return null;
        if (r < o + 3) {
          ((n = o + 3), (i = !0));
          break;
        }
        a = o + 3;
      }
      if (i) continue;
      let o = e.indexOf(`<div`, n),
        s = e.indexOf(`</div>`, n);
      if (!((o !== -1 && o < r) || (s !== -1 && s < r))) {
        let i = t[1].toLowerCase(),
          a = Yn(e, r + t[0].length, i);
        if (a === null) return null;
        n = a;
        continue;
      }
    }
    let r = e.indexOf(`<div`, n),
      i = e.indexOf(`</div>`, n);
    return i === -1 && r === -1
      ? null
      : r === -1 || (i !== -1 && i < r)
        ? { kind: `close`, index: i }
        : { kind: `open`, index: r };
  }
  return null;
}
function Zn(e) {
  let t = [];
  for (let n of e.matchAll(/<div\s[^>]*data-ilha-slot="k:page"[^>]*>/g)) {
    let r = n.index + n[0].length,
      i = 1,
      a = r;
    for (; i > 0; ) {
      let n = Xn(e, a);
      if (!n) break;
      if (n.kind === `open`) ((i += 1), (a = n.index + 4));
      else {
        if ((--i, i === 0)) {
          t.push({ openEnd: r, closeStart: n.index });
          break;
        }
        a = n.index + 6;
      }
    }
  }
  return t;
}
function Qn(e, t, n) {
  let r = Zn(e);
  if (r.length === 0) return e;
  let i = n === `innermost` ? r[r.length - 1] : r[0];
  return e.slice(0, i.openEnd) + t + e.slice(i.closeStart);
}
function $n(e, t) {
  let n = e[Wn];
  if (!n) return e.toString(t);
  let r = (e[Un] ?? e).key(`page`),
    i = (e) => r({ ...t, ...(e ?? {}) });
  return (Object.assign(i, { toString: () => `` }), (i[Gn] = !0), n(i).toString(t));
}
async function er(e, t, n, r) {
  let i = Kn(await t.hydratable(n, r));
  return Qn(Qn($n(e, n), ``, `innermost`), i, `innermost`);
}
function tr(e, t) {
  let n = t[Un] ?? t,
    r = n === t ? null : t,
    i = t.key(`page`),
    a = {},
    o = (e) => {
      let t = a.merged,
        n = t && typeof t == `object` ? { ...t, ...(e ?? {}) } : e;
      return i(n);
    };
  (Object.assign(o, { toString: t.toString.bind(t) }), (o[Gn] = !0));
  let s = e(o);
  ((s[Un] = n), (s[Wn] = e));
  function c(e) {
    a.merged = e;
  }
  function l(e) {
    let t = [...e.querySelectorAll(`[data-ilha-slot="k:page"]`)].filter((t) => {
      let n = t.closest(`[data-ilha]`);
      return n === null || n === e;
    });
    return t.length === 0 ? e : t[t.length - 1];
  }
  function u(e, t) {
    let n = (e) => {
      (delete e._skipOnMount, t.setAttribute(`data-ilha-state`, JSON.stringify(e)));
    };
    if (t.hasAttribute(`data-ilha-state`)) {
      let r = e.getAttribute(`data-ilha-state`);
      if (r)
        try {
          n(JSON.parse(r));
          return;
        } catch {}
      let i = t.getAttribute(`data-ilha-state`);
      if (i)
        try {
          let e = JSON.parse(i);
          (delete e._skipOnMount, t.setAttribute(`data-ilha-state`, JSON.stringify(e)));
        } catch {}
      return;
    }
    let r = e.getAttribute(`data-ilha-state`);
    if (r)
      try {
        n(JSON.parse(r));
        return;
      } catch {}
    t.childNodes.length > 0 && t.setAttribute(`data-ilha-state`, `{}`);
  }
  function d(e) {
    let t = e[Ve];
    if (typeof t != `function`) return;
    e[Ve] = (e, n) => {
      let r = e.closest(`[data-ilha]`);
      return (r && r !== e && u(r, e), t(e, n));
    };
    let n = e.mount.bind(e);
    e.mount = (e, t) => {
      let r = e.closest(`[data-ilha]`);
      return (r && r !== e && u(r, e), n(e, t));
    };
  }
  d(n);
  let f = new Map(),
    p = t[Ve];
  typeof p == `function` &&
    (t[Ve] = (e, t) => {
      let n = p(e, t),
        r = { handle: n, mountProps: t };
      return (
        f.set(e, r),
        {
          unmount: () => (f.get(e) === r && f.delete(e), n.unmount()),
          updateProps: (e) => {
            ((r.mountProps = e), n.updateProps(e));
          },
        }
      );
    });
  let m = (e, t) => (n) => {
      c(n);
      for (let [t, r] of f)
        e.contains(t) && r.handle.updateProps({ ...(r.mountProps ?? {}), ...(n ?? {}) });
      t?.(n);
    },
    h = s.mount.bind(s),
    g = s[Ve];
  function _(e) {
    u(e, l(e));
  }
  return (
    (s.mount = (e, t) => {
      (c(t), _(e));
      let n = h(e, t),
        r = Ue.get(e);
      return (Ue.set(e, { unmount: n, updateProps: m(e, r?.updateProps) }), n);
    }),
    (s[Ve] = (e, t) => {
      (c(t), _(e));
      let n = typeof g == `function` ? g(e, t) : { unmount: h(e, t), updateProps: () => {} },
        r = { unmount: n.unmount, updateProps: m(e, n.updateProps) };
      return (Ue.set(e, r), r);
    }),
    (s.hydratable = async (e, t) => {
      if (!t?.name) throw Error(`wrapLayout: hydratable requires options.name`);
      let i = e ?? {};
      c(i);
      let a = await n.hydratable(i, t),
        o = qn(a);
      if (!o) return a;
      let l = Kn(a);
      r && (l = await er(r, n, i, t));
      let u = Qn(Qn($n(s, i), ``, `first`), l, `first`);
      return `<${o.tag} ${o.attrs}>${u}</${o.tag}>`;
    }),
    s
  );
}
function nr(e) {
  return e;
}
function rr(e) {
  let t = new Map();
  for (let [n, r] of Object.entries(e)) t.has(r) || t.set(r, n);
  return t;
}
var ir = `/__ilha/loader`,
  ar = new Map(),
  or = 3e4,
  sr = !1;
async function cr(e) {
  let t = document.startViewTransition?.bind(document);
  if (!sr || !t) return e();
  let n,
    r,
    i = !1;
  if (
    (await t(() => {
      try {
        n = e();
      } catch (e) {
        throw ((i = !0), (r = e), e);
      }
    }).updateCallbackDone?.catch(() => {}),
    i)
  )
    throw r;
  return n;
}
async function lr(e, t, n, r) {
  let i = new URL(n, location.origin),
    a = Lr(t),
    o = [],
    s = await ji(e, i, a, Ai(i), r ?? new AbortController().signal, (e) => o.push(e));
  if ((r?.throwIfAborted(), s.kind === `redirect`)) {
    let e = Oi(s.to, i, ti);
    return e.ok
      ? { kind: `redirect`, to: e.to, status: s.status }
      : (console.warn(
          `[ilha-router] Blocked unsafe redirect target "${s.to}". Set allowExternalRedirects: true to allow cross-origin redirects.`,
        ),
        { kind: `error`, status: 500, message: `Unsafe redirect target` });
  }
  return s.kind === `data`
    ? o.length > 0
      ? { kind: `data`, data: s.data, headEntries: o }
      : { kind: `data`, data: s.data }
    : s;
}
async function ur(e, t) {
  let n = ar.get(e);
  if (n && (ar.delete(e), Date.now() <= n.expires))
    try {
      t?.throwIfAborted();
      let e = await n.promise;
      return (t?.throwIfAborted(), e);
    } catch (e) {
      if (e?.name === `AbortError`) throw e;
    }
  let r = e.split(`?`)[0] ?? ``,
    i = En(Ir, `GET`, r),
    a = i?.data?.clientLoader ?? i?.data?.loader;
  if (a) return lr(a, i?.params, e, t);
  let o = `${ir}?path=${encodeURIComponent(e)}`;
  try {
    let e = await fetch(o, { signal: t, headers: { accept: `application/json` } });
    if (!e.ok) {
      try {
        let t = await e.json();
        if (t && typeof t == `object` && `kind` in t) return t;
      } catch {}
      return { kind: `error`, status: e.status, message: e.statusText };
    }
    return await e.json();
  } catch (e) {
    if (e?.name === `AbortError`) throw e;
    return { kind: `error`, status: 0, message: e?.message ?? `network error` };
  }
}
function dr(e) {
  if (!zn) return;
  let t = ar.get(e);
  if (t && Date.now() <= t.expires) return;
  let n = e.split(`?`)[0] ?? ``;
  if (!En(Ir, `GET`, n)?.data?.hasLoader) return;
  let r = ur(e).catch((e) => ({
    kind: `error`,
    status: 0,
    message: e?.message ?? `prefetch failed`,
  }));
  ar.set(e, { promise: r, expires: Date.now() + or });
}
var fr = () => ({ unmount: () => {}, updateProps: null });
function pr(e, t, n) {
  let r = e[Ve];
  if (typeof r == `function`) {
    let e = r(t, n);
    return { unmount: () => void e.unmount(), updateProps: (t) => e.updateProps(t) };
  }
  return { unmount: e.mount(t, n), updateProps: null };
}
async function mr(e, t, n) {
  if (!e.updateProps) return `remount`;
  let r = En(Ir, `GET`, t.split(`?`)[0] ?? ``)?.data?.hasLoader
    ? await ur(t, n)
    : { kind: `data`, data: {} };
  return (
    n.throwIfAborted(),
    r.kind === `redirect`
      ? (Qr(r.to), `updated`)
      : r.kind === `data`
        ? (r.headEntries?.length && gi([...r.headEntries]), e.updateProps(r.data), `updated`)
        : `remount`
  );
}
async function hr(e, t, n, r, i, a) {
  if (!e) {
    if (ei) {
      let e = ei;
      return cr(() => {
        t.innerHTML = `<div data-router-view data-router-not-found>${e.toString()}</div>`;
        let n = t.firstElementChild;
        return { unmount: n ? e.mount(n) : () => {}, updateProps: null };
      });
    }
    return (
      await cr(() => {
        t.innerHTML = `<div data-router-empty></div>`;
      }),
      fr()
    );
  }
  let o = En(Ir, `GET`, n.split(`?`)[0] ?? ``),
    s = !!o?.data?.hasLoader,
    c = {},
    l = s ? await ur(n, r) : { kind: `data`, data: {} };
  if (l.kind === `redirect`) return (Qr(l.to), fr());
  if (l.kind === `error`) {
    let e = o?.data?.errorHandler;
    if (e) return cr(() => ({ unmount: gr(e, t, l.status, l.message), updateProps: null }));
    let n = bi(l.message);
    return (
      await cr(() => {
        t.innerHTML = `<div data-router-view data-router-error="${l.status}">${n}</div>`;
      }),
      fr()
    );
  }
  if (l.kind === `not-found`)
    return (
      await cr(() => {
        t.innerHTML = `<div data-router-empty></div>`;
      }),
      fr()
    );
  c = l.data;
  let u = { entries: [...(l.headEntries ?? [])] };
  if (!i) {
    console.warn(
      `[ilha-router] No registry provided for client-side navigation. Island will not be interactive.`,
    );
    let n = await _i(u, () => e.toString(c));
    return (
      await cr(() => {
        (gi(u.entries), (t.innerHTML = `<div data-router-view>${n}</div>`));
      }),
      fr()
    );
  }
  let d = a?.get(e) ?? Object.entries(i).find(([, t]) => t === e)?.[0];
  if (!d) {
    console.warn(`[ilha-router] Island not found in registry for client-side navigation.`);
    let n = await _i(u, () => e.toString(c));
    return (
      await cr(() => {
        (gi(u.entries), (t.innerHTML = `<div data-router-view>${n}</div>`));
      }),
      fr()
    );
  }
  let f = await _i(u, () => e.hydratable(c, { name: d, as: `div`, snapshot: !0 }));
  return cr(() => {
    (gi(u.entries), (t.innerHTML = `<div data-router-view>${f}</div>`));
    let n = t.querySelector(`[data-ilha="${d}"]`);
    return n ? pr(e, n) : fr();
  });
}
function gr(e, t, n, r) {
  try {
    let i = e({ message: r, status: n }, { path: Er(), params: Dr(), search: Or(), hash: kr() });
    t.innerHTML = `<div data-router-view data-router-error="${n}">${i.toString()}</div>`;
    let a = t.firstElementChild;
    return a ? i.mount(a) : () => {};
  } catch (e) {
    return (
      console.error(`[ilha-router] error boundary threw while rendering a loader error:`, e),
      (t.innerHTML = `<div data-router-view data-router-error="${n}"></div>`),
      () => {}
    );
  }
}
var _r = null,
  vr = null;
async function yr() {
  return (
    _r ||
    ((vr ||= Mn(async () => {
      let { AsyncLocalStorage: e } = await import(`./__vite-browser-external-B6Ybjjxc.js`).then(
        (e) => c(e.default, 1),
      );
      return { AsyncLocalStorage: e };
    }, []).then(({ AsyncLocalStorage: e }) => ((_r = new e()), _r))),
    vr)
  );
}
zn || yr().catch(() => {});
function br() {
  return zn ? null : (_r?.getStore() ?? null);
}
function xr() {
  return { path: ``, params: {}, search: ``, hash: ``, island: null };
}
var Sr = sn(`router.path`, ``),
  Cr = sn(`router.params`, {}),
  wr = sn(`router.search`, ``),
  Tr = sn(`router.hash`, ``);
function Er(e) {
  let t = br();
  return arguments.length > 0 ? (t ? (t.path = e) : (Sr(e), e)) : t ? t.path : Sr();
}
function Dr(e) {
  let t = br();
  return arguments.length > 0 ? (t ? (t.params = e) : (Cr(e), e)) : t ? t.params : Cr();
}
function Or(e) {
  let t = br();
  return arguments.length > 0 ? (t ? (t.search = e) : (wr(e), e)) : t ? t.search : wr();
}
function kr(e) {
  let t = br();
  return arguments.length > 0 ? (t ? (t.hash = e) : (Tr(e), e)) : t ? t.hash : Tr();
}
var Ar = sn(`router.navigating`, 0);
function jr() {
  return Ar() > 0;
}
function Mr() {
  if (!zn) return () => {};
  Ar(Ar() + 1);
  let e = !1;
  return () => {
    e || ((e = !0), Ar(Math.max(0, Ar() - 1)));
  };
}
function Nr() {
  return { path: Er, params: Dr, search: Or, hash: kr, navigating: jr };
}
var Pr = sn(`router.active`, null);
function Fr(e) {
  let t = br();
  if (arguments.length > 0) {
    let n = e ?? null;
    return t ? (t.island = n) : (Pr(n === null ? null : () => n), n);
  }
  return t ? t.island : Pr();
}
var Ir = ln();
function Lr(e) {
  let t = {};
  if (e) for (let [n, r] of Object.entries(e)) t[n] = decodeURIComponent(r);
  return t;
}
function Rr(e, t = Ir) {
  let n = typeof e == `string` ? new URL(e, `http://localhost`) : e,
    r = En(t, `GET`, n.pathname);
  (Er(n.pathname), Dr(Lr(r?.params)), Or(n.search), kr(n.hash), Fr(r?.data?.island ?? null));
}
function zr() {
  let e = Rn().readLocation(),
    t = En(Ir, `GET`, e.pathname);
  (Er(e.pathname), Dr(Lr(t?.params)), Or(e.search), kr(e.hash), Fr(t?.data?.island ?? null));
}
function Br() {
  zn && zr();
}
var Vr = new Set(),
  Hr = new Set();
function Ur(e) {
  for (let t of Hr)
    try {
      t(e);
    } catch (e) {
      console.error(`[ilha-router] afterNavigate hook threw:`, e);
    }
}
var Wr = new Map(),
  Gr = 0,
  Kr = 0;
function qr() {
  if (!zn) return 0;
  let e = history.state;
  return typeof e?.__ilhaNavKey == `number` ? e.__ilhaNavKey : 0;
}
function Jr() {
  Wr.set(qr(), { x: window.scrollX, y: window.scrollY });
}
function Yr(e) {
  requestAnimationFrame(() => {
    if (e && e !== `#`) {
      let t =
        document.getElementById(e.slice(1)) ??
        document.querySelector(`a[name="${pi(e.slice(1))}"]`);
      if (t) {
        t.scrollIntoView();
        return;
      }
    }
    window.scrollTo(0, 0);
  });
}
function Xr() {
  let e = Wr.get(qr());
  e && requestAnimationFrame(() => window.scrollTo(e.x, e.y));
}
function Zr(e, t = {}) {
  if (!zn) return;
  let n = Rn(),
    r = n.readLocation(),
    i = r.pathname + r.search + r.hash;
  if (e === i) return;
  let a = t.replace ? `replace` : `push`,
    o = !1;
  for (let t of Vr)
    try {
      t({ from: i, to: e, type: a, cancel: () => (o = !0) });
    } catch (e) {
      console.error(`[ilha-router] beforeNavigate hook threw:`, e);
    }
  if (!o) {
    if (
      (t.replace
        ? n.replace(e, { __ilhaNavKey: qr() })
        : (Jr(), (Gr = Math.max(Gr + 1, qr() + 1)), n.push(e, { __ilhaNavKey: Gr })),
      (Kr = qr()),
      zr(),
      t.scroll !== !1)
    ) {
      let e = n.readLocation(),
        t = En(Ir, `GET`, r.pathname),
        i = En(Ir, `GET`, e.pathname);
      (t?.data?.island == null ||
        i?.data?.island !== t.data.island ||
        (e.hash && e.hash !== `#`)) &&
        Yr(e.hash);
    }
    Ur({ from: i, to: e, type: a });
  }
}
function Qr(e) {
  if (/^https?:\/\//i.test(e)) {
    try {
      let t = new URL(e);
      if (t.origin === location.origin) {
        Zr(t.pathname + t.search + t.hash, { replace: !0 });
        return;
      }
    } catch {
      return;
    }
    location.assign(e);
    return;
  }
  Zr(e, { replace: !0 });
}
function $r(e = document, t = {}) {
  if (!zn) return () => {};
  let n = t.prefetch !== !1;
  function r(e, t) {
    let n = e.getAttribute(`target`) === `_blank`,
      r = !!t && (t.ctrlKey || t.metaKey || t.shiftKey || t.altKey),
      i = e.hasAttribute(`data-no-intercept`),
      a = e.hasAttribute(`download`),
      o = /\bexternal\b/i.test(e.getAttribute(`rel`) ?? ``);
    return n || r || i || a || o ? null : Rn().extractLogicalPath(e);
  }
  let i = (e) => {
      if (e.defaultPrevented || (typeof e.button == `number` && e.button !== 0)) return;
      let t = e.target.closest(`a`);
      if (!t) return;
      let n = r(t, e);
      n !== null && (e.preventDefault(), Zr(n));
    },
    a = (e) => {
      let t = e.target.closest(`a`);
      if (!t) return;
      let n = t.getAttribute(`data-prefetch`);
      if (n === null || n === `false`) return;
      let i = r(t);
      i !== null && dr(i.split(`#`)[0] ?? i);
    };
  return (
    e.addEventListener(`click`, i),
    n && e.addEventListener(`mouseover`, a, { passive: !0 }),
    () => {
      (e.removeEventListener(`click`, i), n && e.removeEventListener(`mouseover`, a));
    }
  );
}
var ei = null,
  ti = !1,
  ni = nn.render(() => {
    let e = Fr();
    return e
      ? `<div data-router-view>${e.toString()}</div>`
      : ei
        ? `<div data-router-view data-router-not-found>${ei.toString()}</div>`
        : `<div data-router-empty></div>`;
  });
nn.state(`href`, ``)
  .state(`label`, ``)
  .on(`[data-link]@click`, ({ state: e, event: t }) => {
    (t.preventDefault(), Zr(e.href()));
  })
  .on(`[data-link]@mouseenter`, ({ state: e }) => {
    let t = e.href();
    if (t) {
      if (/^https?:\/\//i.test(t))
        try {
          let e = new URL(t);
          if (e.origin !== location.origin) return;
          dr(e.pathname + e.search);
          return;
        } catch {
          return;
        }
      dr(t);
    }
  })
  .render(
    ({ state: e }) => U`<a data-link data-prefetch href="${() => Rn().toLinkHref(e.href())}"
        >${e.label}</a
      >`,
  );
function ri(e, t = {}) {
  if (t.exact === !1) {
    let t = Er(),
      n = e.endsWith(`/`) ? e.slice(0, -1) : e;
    return t === n || t === n + `/` || t.startsWith(n + `/`);
  }
  let n = En(Ir, `GET`, Er());
  return n ? n.data.pattern === e : !1;
}
var ii = `data-ilha-head`,
  ai = `data-ilha-router-html`,
  oi = `data-ilha-router-body`,
  si = null,
  ci = null,
  li = null;
async function ui() {
  return (
    ci ||
    ((li ||= Mn(async () => {
      let { AsyncLocalStorage: e } = await import(`./__vite-browser-external-B6Ybjjxc.js`).then(
        (e) => c(e.default, 1),
      );
      return { AsyncLocalStorage: e };
    }, []).then(({ AsyncLocalStorage: e }) => ((ci = new e()), ci))),
    li)
  );
}
function di() {
  return zn ? si : (ci?.getStore() ?? null);
}
function fi(e) {
  let t = di();
  if (!t) {
    zn || console.warn(`[ilha-router] head() called outside an SSR render window — ignored.`);
    return;
  }
  t.entries.push(e);
}
function pi(e) {
  return typeof CSS < `u` && typeof CSS.escape == `function`
    ? CSS.escape(e)
    : e.replace(/\\/g, `\\\\`).replace(/"/g, `\\"`);
}
function mi(e) {
  return `charset` in e
    ? `meta[charset][${ii}]`
    : `name` in e
      ? `meta[name="${pi(e.name)}"][${ii}]`
      : `property` in e
        ? `meta[property="${pi(e.property)}"][${ii}]`
        : `http-equiv` in e
          ? `meta[http-equiv="${pi(e[`http-equiv`])}"][${ii}]`
          : null;
}
function hi(e) {
  return e.rel && e.href ? `link[rel="${pi(e.rel)}"][href="${pi(e.href)}"][${ii}]` : null;
}
function gi(e) {
  if (!zn) return;
  let t,
    n,
    r = [],
    i = [],
    a = {},
    o = {};
  for (let s of e)
    (s.title !== void 0 && (t = s.title),
      s.titleTemplate !== void 0 && (n = s.titleTemplate),
      s.meta && r.push(...s.meta),
      s.link && i.push(...s.link),
      s.htmlAttrs && (a = { ...a, ...s.htmlAttrs }),
      s.bodyAttrs && (o = { ...o, ...s.bodyAttrs }));
  let s = wi(t, n);
  s !== void 0 && (document.title = s);
  let c = Ci(r, Si),
    l = Ci(i, (e) => `${e.rel ?? ``}:${e.href ?? ``}`),
    u = new Set();
  for (let e of c) {
    let t = mi(e);
    if (!t) continue;
    let n = document.querySelector(t);
    n ||
      ((n = document.createElement(`meta`)), n.setAttribute(ii, ``), document.head.appendChild(n));
    for (let [t, r] of Object.entries(e)) n.setAttribute(t, r);
    u.add(n);
  }
  for (let e of l) {
    let t = hi(e),
      n = t ? document.querySelector(t) : null;
    n ||
      ((n = document.createElement(`link`)), n.setAttribute(ii, ``), document.head.appendChild(n));
    for (let [t, r] of Object.entries(e)) n.setAttribute(t, r);
    u.add(n);
  }
  for (let e of [...document.head.querySelectorAll(`[${ii}]`)]) u.has(e) || e.remove();
  let d = document.documentElement,
    f = (d.getAttribute(ai) ?? ``).split(/\s+/).filter(Boolean);
  for (let e of f) d.removeAttribute(e);
  let p = Object.keys(a);
  for (let [e, t] of Object.entries(a)) d.setAttribute(e, t);
  p.length ? d.setAttribute(ai, p.join(` `)) : d.removeAttribute(ai);
  let m = document.body,
    h = (m.getAttribute(oi) ?? ``).split(/\s+/).filter(Boolean);
  for (let e of h) m.removeAttribute(e);
  let g = Object.keys(o);
  for (let [e, t] of Object.entries(o)) m.setAttribute(e, t);
  g.length ? m.setAttribute(oi, g.join(` `)) : m.removeAttribute(oi);
}
async function _i(e, t) {
  if (zn) {
    let n = si;
    si = e;
    try {
      return await t();
    } finally {
      si = n;
    }
  }
  return await (await ui()).run(e, () => Promise.resolve(t()));
}
var vi = { "&": `&amp;`, "<": `&lt;`, ">": `&gt;`, '"': `&quot;`, "'": `&#39;` };
function yi(e) {
  return String(e).replace(/[&<>"']/g, (e) => vi[e]);
}
function bi(e) {
  return String(e).replace(/[&<>]/g, (e) => vi[e]);
}
function xi(e) {
  return Object.entries(e)
    .map(([e, t]) => ` ${e}="${yi(t)}"`)
    .join(``);
}
function Si(e) {
  return `charset` in e
    ? `charset`
    : `name` in e
      ? `name:${e.name}`
      : `property` in e
        ? `property:${e.property}`
        : `http-equiv` in e
          ? `http-equiv:${e[`http-equiv`]}`
          : JSON.stringify(e);
}
function Ci(e, t) {
  let n = new Map();
  for (let r of e) n.set(t(r), r);
  return [...n.values()];
}
function wi(e, t) {
  return t === void 0 ? e : typeof t == `function` ? t(e) : t.replace(/%s/g, e ?? ``);
}
function Ti(e) {
  let t,
    n,
    r = [],
    i = [],
    a = [],
    o = {},
    s = {};
  for (let c of e)
    (c.title !== void 0 && (t = c.title),
      c.titleTemplate !== void 0 && (n = c.titleTemplate),
      c.meta && r.push(...c.meta),
      c.link && i.push(...c.link),
      c.script && a.push(...c.script),
      c.htmlAttrs && (o = { ...o, ...c.htmlAttrs }),
      c.bodyAttrs && (s = { ...s, ...c.bodyAttrs }));
  let c = wi(t, n),
    l = [];
  c !== void 0 && l.push(`<title>${yi(c)}</title>`);
  for (let e of Ci(r, Si)) l.push(`<meta${xi({ ...e, [ii]: `` })} />`);
  for (let e of Ci(i, (e) => `${e.rel ?? ``}:${e.href ?? ``}`))
    l.push(`<link${xi({ ...e, [ii]: `` })} />`);
  for (let e of a) {
    let { children: t, ...n } = e,
      r = (t ?? ``).replace(/<\/script/gi, `<\\/script`);
    l.push(`<script${xi(n)}>${r}<\/script>`);
  }
  return {
    headTags: l.join(`
  `),
    htmlAttrs: xi(o),
    bodyAttrs: xi(s),
  };
}
function Ei(e) {
  return typeof e == `string` ? new URL(e, `http://localhost`) : e;
}
function Di() {
  try {
    return typeof process < `u` && !1;
  } catch {
    return !1;
  }
}
function Oi(e, t, n) {
  if (e.startsWith(`/`) && !e.startsWith(`//`)) return { ok: !0, to: e };
  try {
    let r = new URL(e, t);
    return /^https?:$/.test(r.protocol)
      ? r.origin === t.origin
        ? { ok: !0, to: r.pathname + r.search + r.hash }
        : n
          ? { ok: !0, to: r.href }
          : { ok: !1 }
      : { ok: !1 };
  } catch {
    return { ok: !1 };
  }
}
function ki(e, t) {
  let n = new AbortController(),
    r = () => n.abort(),
    i = e?.signal;
  i && (i.aborted ? r() : i.addEventListener(`abort`, r, { once: !0 }));
  let a;
  return (
    t && t > 0 && (a = setTimeout(r, t)),
    {
      signal: n.signal,
      done: () => {
        (a !== void 0 && clearTimeout(a), i?.removeEventListener(`abort`, r));
      },
    }
  );
}
function Ai(e) {
  try {
    return new Request(e.toString());
  } catch {
    return { url: e.toString(), headers: new Headers() };
  }
}
async function ji(e, t, n, r, i, a) {
  let o = [],
    s = a ?? ((e) => o.push(e));
  try {
    let a = Promise.resolve(e({ params: n, request: r, url: t, signal: i, head: s }));
    a.catch(() => {});
    let c = {
      kind: `data`,
      data:
        (await Promise.race([
          a,
          new Promise((e, t) => {
            let n = () => t(new Hn(504, `Loader aborted or timed out`));
            i.aborted ? n() : i.addEventListener(`abort`, n, { once: !0 });
          }),
        ])) ?? {},
    };
    return (o.length > 0 && (c.head = Ti(o)), c);
  } catch (e) {
    return e instanceof Vn
      ? { kind: `redirect`, to: e.to, status: e.status }
      : e instanceof Hn
        ? { kind: `error`, status: e.status, message: e.message }
        : (console.error(`[ilha-router] loader failed:`, e),
          {
            kind: `error`,
            status: typeof e?.status == `number` ? e.status : 500,
            message: Di() ? (e?.message ?? `Loader failed`) : `Internal error`,
          });
  }
}
function Mi(e = {}) {
  let t = e.mode ?? `spa`,
    n = e.interceptLinks !== !1,
    r = e.allowExternalRedirects === !0,
    i = e.loaderTimeout,
    a = [],
    o = ln(),
    s = new Map(),
    c = e.notFound ?? null;
  ((Ir = o), (ei = c), (ti = r), (sr = e.viewTransitions === !0));
  let l = null,
    u = null,
    d = {
      route(e, t, n) {
        let r = !!n,
          i = { island: t, pattern: e, loader: n, hasLoader: r };
        return (
          a.push({ pattern: e, island: t, loader: n, hasLoader: r }),
          wn(o, `GET`, e, i),
          s.set(e, i),
          d
        );
      },
      attachLoader(e, t) {
        let n = s.get(e);
        if (!n)
          return (
            console.warn(
              `[ilha-router] attachLoader("${e}", …): pattern was never registered via .route(). The loader will be ignored.`,
            ),
            d
          );
        ((n.loader = t), (n.hasLoader = !0));
        let r = a.find((t) => t.pattern === e);
        return (r && ((r.loader = t), (r.hasLoader = !0)), d);
      },
      clientLoader(e, t) {
        let n = s.get(e);
        if (!n)
          return (
            console.warn(
              `[ilha-router] clientLoader("${e}", …): pattern was never registered via .route(). The loader will be ignored.`,
            ),
            d
          );
        ((n.clientLoader = t), (n.hasLoader = !0));
        let r = a.find((t) => t.pattern === e);
        return (r && (r.hasLoader = !0), d);
      },
      errorBoundary(e, t) {
        let n = s.get(e);
        return n
          ? ((n.errorHandler = t), d)
          : (console.warn(
              `[ilha-router] errorBoundary("${e}", …): pattern was never registered via .route(). The boundary will be ignored.`,
            ),
            d);
      },
      markLoader(e) {
        let t = s.get(e);
        if (!t)
          return (
            console.warn(
              `[ilha-router] markLoader("${e}"): pattern was never registered via .route(). The loader marker will be ignored.`,
            ),
            d
          );
        t.hasLoader = !0;
        let n = a.find((t) => t.pattern === e);
        return (n && (n.hasLoader = !0), d);
      },
      routes() {
        return a.map((e) => ({ ...e }));
      },
      prime: Br,
      hydrateStatic(e, t = {}) {
        if (!zn) return () => {};
        let n = t.root ?? document.body;
        Br();
        let { unmount: r } = on(e, { root: n });
        return r;
      },
      mount(e, { hydrate: r = !1, registry: i, interceptLinks: a } = {}) {
        if (!zn)
          return (
            console.warn(`[ilha-router] mount() called in a non-browser environment`), () => {}
          );
        let o = typeof e == `string` ? document.querySelector(e) : e;
        if (!o)
          return (console.warn(`[ilha-router] No element found for selector "${e}"`), () => {});
        if ((zr(), (Kr = qr()), t === `static`))
          return (
            console.warn(
              `[ilha-router] router.mount() called in static mode. Use router.hydrateStatic(registry) instead.`,
            ),
            () => {}
          );
        let s = !0,
          c = `scrollRestoration` in history ? history.scrollRestoration : null;
        (c !== null && (history.scrollRestoration = `manual`),
          (l = Rn().onChange(() => {
            if (!s) return;
            let e = Er() + Or() + kr();
            (Wr.set(Kr, { x: window.scrollX, y: window.scrollY }),
              (Kr = qr()),
              zr(),
              Xr(),
              Ur({ from: e, to: Er() + Or() + kr(), type: `pop` }));
          })),
          (u = (a ?? n) ? $r(document) : null));
        let d = null,
          f = null;
        if (r) {
          Ln() === `hash` &&
            console.warn(
              "[ilha-router] mount({ hydrate: true }) was called in hash mode. SSR + hydration assumes the server can render the active route, but in hash mode the server only ever sees the document URL. Use plain SPA mode (`mount(target)` without `hydrate: true`) for hash-mode apps.",
            );
          let e = o.querySelector(`[data-router-view]`) ?? o,
            t = Fr(),
            n = Er() + Or(),
            r = null,
            a = () => {
              let t = e.querySelector(`[data-ilha]`);
              if (!t) return null;
              let n = Ue.get(t);
              return n
                ? { unmount: () => void n.unmount(), updateProps: (e) => n.updateProps(e) }
                : null;
            },
            d = i ? rr(i) : void 0,
            p = 0,
            m = nn.render(() => {
              let o = Fr(),
                s = Er() + Or();
              if (o !== t || s !== n) {
                let c = ++p;
                (f?.abort(), (f = new AbortController()));
                let l = f.signal;
                queueMicrotask(async () => {
                  if (c !== p) return;
                  let u = Mr();
                  try {
                    if (o !== null && o === t) {
                      let e = r ?? a();
                      if (e?.updateProps && (await mr(e, s, l)) === `updated`) {
                        ((r = e), (n = s));
                        return;
                      }
                    }
                    (r?.unmount(), (r = null), (r = await hr(o, e, s, l, i, d)));
                  } catch (t) {
                    if (t?.name === `AbortError`) return;
                    (console.error(`[ilha-router] navigation failed:`, t),
                      (e.innerHTML = `<div data-router-view data-router-error="500"></div>`));
                    return;
                  } finally {
                    u();
                  }
                  ((t = o), (n = s));
                });
              }
              return ``;
            }),
            h = document.createElement(`div`);
          ((h.style.display = `none`), o.appendChild(h));
          let g = m.mount(h);
          return (
            (async () => {
              let t = Fr();
              if (!t) return;
              let n = Rn().readLocation(),
                a = n.pathname + n.search,
                o = En(Ir, `GET`, n.pathname);
              if (o?.data?.clientLoader) {
                let n = ++p,
                  o = new AbortController();
                f = o;
                try {
                  let s = await hr(t, e, a, o.signal, i, d);
                  n === p ? (r = s) : s.unmount();
                } catch (e) {
                  e?.name !== `AbortError` &&
                    console.error(`[ilha-router] initial client loader render failed:`, e);
                }
                return;
              }
              let c = o?.data?.hasLoader ? await ur(a) : { kind: `data`, data: {} };
              if (c.kind === `redirect` || c.kind === `error`) return;
              let l = c.kind === `data` ? c.data : {},
                u = { entries: [...(c.kind === `data` ? (c.headEntries ?? []) : [])] };
              (await _i(u, () => t.toString(l)), s && gi(u.entries));
            })(),
            () => {
              ((s = !1),
                ++p,
                f?.abort(),
                g(),
                h.remove(),
                r?.unmount(),
                u?.(),
                l?.(),
                (u = null),
                (l = null),
                c !== null && (history.scrollRestoration = c));
            }
          );
        }
        let p = null,
          m = null,
          h = null,
          g = null,
          _ = 0;
        d = ni.mount(o);
        async function v(e, t) {
          let n = e !== null && e === m && p?.updateProps != null,
            r = () => {
              (p?.unmount(), (p = null), (m = null));
            };
          if ((n || r(), (h = e), (g = Er() + Or()), !e)) {
            let e = o?.querySelector(`[data-router-not-found]`);
            ei && e && (p = { unmount: ei.mount(e), updateProps: null });
            return;
          }
          let i = o?.querySelector(`[data-router-view]`);
          if (!i) return;
          let a = Rn().readLocation(),
            s = En(Ir, `GET`, a.pathname),
            c = s?.data?.hasLoader
              ? await ur(a.pathname + a.search, t)
              : { kind: `data`, data: {} };
          if (t.aborted) return;
          if (c.kind === `redirect`) {
            Qr(c.to);
            return;
          }
          if (c.kind === `error`) {
            n && r();
            let e = s?.data?.errorHandler;
            if (e) {
              p = await cr(() => ({ unmount: gr(e, i, c.status, c.message), updateProps: null }));
              return;
            }
            let t = bi(c.message);
            await cr(() => {
              i.innerHTML = `<div data-router-error="${c.status}">${t}</div>`;
            });
            return;
          }
          let l = c.kind === `data` ? c.data : {};
          if (n && p?.updateProps) {
            (c.kind === `data` && c.headEntries?.length && gi([...c.headEntries]),
              p.updateProps(l));
            return;
          }
          let u = { entries: [...(c.kind === `data` ? (c.headEntries ?? []) : [])] },
            d = await _i(u, () => e.toString(l));
          ((p = await cr(() => (gi(u.entries), (i.innerHTML = d), pr(e, i, l)))), (m = e));
        }
        ((f = new AbortController()),
          v(Fr(), f.signal).catch((e) => {
            e?.name !== `AbortError` && console.error(`[ilha-router] initial mount failed:`, e);
          }));
        let y = nn.render(() => {
            let e = Fr(),
              t = Er() + Or();
            if (e !== h || t !== g) {
              let t = ++_;
              (f?.abort(), (f = new AbortController()));
              let n = f.signal;
              queueMicrotask(() => {
                if (t !== _) return;
                let r = Mr();
                v(e, n)
                  .catch((e) => {
                    e?.name !== `AbortError` &&
                      console.error(`[ilha-router] navigation failed:`, e);
                  })
                  .finally(r);
              });
            }
            return ``;
          }),
          b = document.createElement(`div`);
        ((b.style.display = `none`), o.appendChild(b));
        let x = y.mount(b);
        return () => {
          ((s = !1),
            ++_,
            f?.abort(),
            p?.unmount(),
            x(),
            b.remove(),
            d?.(),
            u?.(),
            l?.(),
            (u = null),
            (l = null),
            c !== null && (history.scrollRestoration = c));
        };
      },
      render(e) {
        let t = () => (Rr(e, o), ni.toString());
        return !zn && _r ? _r.run(xr(), t) : t();
      },
      async renderHydratable(e, t, n = {}, r) {
        let i = await this.renderResponse(e, t, n, r);
        return i.kind === `html` || i.kind === `error`
          ? i.html
          : `<meta http-equiv="refresh" content="0; url=${yi(i.to)}">`;
      },
      async renderResponse(e, t, n = {}, r) {
        if (!zn) {
          let i = await yr();
          if (!i.getStore()) return i.run(xr(), () => f(e, t, n, r));
        }
        return f(e, t, n, r);
      },
      async runLoader(e, t) {
        let n = Ei(e),
          a = En(o, `GET`, n.pathname);
        if (!a?.data?.island) return { kind: `not-found` };
        if (!a.data.loader) return { kind: `data`, data: {} };
        let s = Lr(a.params),
          c = t ?? Ai(n),
          l = ki(t, i),
          u = { entries: [] };
        try {
          let e = await ji(a.data.loader, n, s, c, l.signal, (e) => u.entries.push(e));
          if (e.kind === `redirect`) {
            let t = Oi(e.to, n, r);
            return t.ok
              ? { ...e, to: t.to }
              : (console.warn(
                  `[ilha-router] Blocked unsafe redirect target "${e.to}". Set allowExternalRedirects: true to allow cross-origin redirects.`,
                ),
                { kind: `error`, status: 500, message: `Unsafe redirect target` });
          }
          return e.kind !== `data` || u.entries.length === 0
            ? e
            : { ...e, head: Ti(u.entries), headEntries: u.entries };
        } finally {
          l.done();
        }
      },
      hydrate(e, t = {}) {
        if (!zn)
          return (
            console.warn(`[ilha-router] hydrate() called in a non-browser environment`), () => {}
          );
        let n = t.root ?? document.body,
          r = t.target ?? n;
        Br();
        let { unmount: i } = on(e, { root: n }),
          a = this.mount(r, { hydrate: !0, registry: e, interceptLinks: t.interceptLinks });
        return () => {
          (i(), a());
        };
      },
    };
  async function f(e, t, n = {}, a) {
    let { baseHead: s, ...l } = n,
      u = Ei(e);
    Rr(u, o);
    let d = En(o, `GET`, u.pathname),
      f = d?.data?.island ?? null;
    if (!f) {
      let e = { entries: s ? [s] : [] };
      return c
        ? {
            kind: `html`,
            html: `<div data-router-view data-router-not-found>${await _i(e, () => c.toString())}</div>`,
            status: 404,
            head: Ti(e.entries),
          }
        : {
            kind: `html`,
            html: `<div data-router-empty></div>`,
            status: 404,
            head: s ? Ti([s]) : void 0,
          };
    }
    let p = { entries: s ? [s] : [] },
      m = {};
    if (d?.data?.loader) {
      let e = a ?? Ai(u),
        t = ki(a, i),
        n;
      try {
        n = await ji(d.data.loader, u, Dr(), e, t.signal, (e) => p.entries.push(e));
      } finally {
        t.done();
      }
      if (n.kind === `redirect`) {
        let e = Oi(n.to, u, r);
        if (!e.ok)
          (console.warn(
            `[ilha-router] Blocked unsafe redirect target "${n.to}". Set allowExternalRedirects: true to allow cross-origin redirects.`,
          ),
            (n = { kind: `error`, status: 500, message: `Unsafe redirect target` }));
        else return { kind: `redirect`, to: e.to, status: n.status };
      }
      if (n.kind === `error`) {
        let e = d.data.errorHandler;
        if (e)
          try {
            let t = e(
                { message: n.message, status: n.status },
                { path: Er(), params: Dr(), search: Or(), hash: kr() },
              ),
              r = await _i(p, () => t.toString());
            return {
              kind: `error`,
              status: n.status,
              message: n.message,
              html: `<div data-router-view data-router-error="${n.status}">${r}</div>`,
              head: Ti(p.entries),
            };
          } catch (e) {
            console.error(`[ilha-router] error boundary threw while rendering a loader error:`, e);
          }
        let t = bi(n.message),
          r = `<div data-router-view data-router-error="${n.status}">${t}</div>`;
        return {
          kind: `error`,
          status: n.status,
          message: n.message,
          html: r,
          head: Ti(p.entries),
        };
      }
      m = n.data;
    }
    let h = rr(t).get(f);
    return h
      ? {
          kind: `html`,
          html: `<div data-router-view>${await _i(p, () => f.hydratable(m, { name: h, as: `div`, snapshot: !0, ...l }))}</div>`,
          head: Ti(p.entries),
        }
      : (console.warn(
          `[ilha-router] renderHydratable: active island for "${Er()}" is not in the registry. Falling back to plain SSR — the island will not be interactive on the client.`,
        ),
        {
          kind: `html`,
          html: `<div data-router-view>${await _i(p, () => f.toString(m))}</div>`,
          head: Ti(p.entries),
        });
  }
  return d;
}
var Ni = /^[\w!#$%&'*.^`|~+-]+$/,
  Pi = (e, t, n = {}) => {
    if (!Ni.test(e)) throw Error(`Invalid cookie name`);
    let r = `${e}=${t}`;
    if (e.startsWith(`__Secure-`) && !n.secure)
      throw Error(`__Secure- Cookie must have Secure attributes`);
    if (e.startsWith(`__Host-`)) {
      if (!n.secure) throw Error(`__Host- Cookie must have Secure attributes`);
      if (n.path !== `/`) throw Error(`__Host- Cookie must have Path attributes with "/"`);
      if (n.domain) throw Error(`__Host- Cookie must not have Domain attributes`);
    }
    for (let e of [`domain`, `path`, `sameSite`, `priority`])
      if (n[e] && /[;\r\n]/.test(n[e])) throw Error(`${e} must not contain ";", "\\r", or "\\n"`);
    if (n && typeof n.maxAge == `number` && n.maxAge >= 0) {
      if (n.maxAge > 3456e4)
        throw Error(
          `Cookies Max-Age SHOULD NOT be greater than 400 days (34560000 seconds) in duration.`,
        );
      r += `; Max-Age=${n.maxAge | 0}`;
    }
    if (
      (n.domain && n.prefix !== `host` && (r += `; Domain=${n.domain}`),
      n.path && (r += `; Path=${n.path}`),
      n.expires)
    ) {
      if (n.expires.getTime() - Date.now() > 3456e7)
        throw Error(
          `Cookies Expires SHOULD NOT be greater than 400 days (34560000 seconds) in the future.`,
        );
      r += `; Expires=${n.expires.toUTCString()}`;
    }
    if (
      (n.httpOnly && (r += `; HttpOnly`),
      n.secure && (r += `; Secure`),
      n.sameSite && (r += `; SameSite=${n.sameSite.charAt(0).toUpperCase() + n.sameSite.slice(1)}`),
      n.priority && (r += `; Priority=${n.priority.charAt(0).toUpperCase() + n.priority.slice(1)}`),
      n.partitioned)
    ) {
      if (!n.secure) throw Error(`Partitioned Cookie must have Secure attributes`);
      r += `; Partitioned`;
    }
    return r;
  },
  Fi = (e, t, n) => ((t = encodeURIComponent(t)), Pi(e, t, n)),
  Ii = (e, t) => ((e = e.replace(/\/+$/, ``)), (e += `/`), (t = t.replace(/^\/+/, ``)), e + t),
  Li = (e, t) => {
    for (let [n, r] of Object.entries(t)) {
      let t = RegExp(`/:` + n + `(?:{[^/]+})?\\??(?=/|$)`);
      e = e.replace(t, r ? `/${r}` : ``);
    }
    return e;
  },
  Ri = (e) => {
    let t = new URLSearchParams();
    for (let [n, r] of Object.entries(e))
      if (r !== void 0)
        if (Array.isArray(r)) for (let e of r) t.append(n, e);
        else t.set(n, r);
    return t;
  },
  zi = (e, t) => {
    switch (t) {
      case `ws`:
        return e.replace(/^http/, `ws`);
      case `http`:
        return e.replace(/^ws/, `http`);
    }
  },
  Bi = (e) =>
    /^https?:\/\/[^\/]+?\/index(?=\?|$)/.test(e)
      ? e.replace(/\/index(?=\?|$)/, `/`)
      : e.replace(/\/index(?=\?|$)/, ``);
function Vi(e) {
  return typeof e == `object` && !!e && !Array.isArray(e);
}
function Hi(e, t) {
  if (!Vi(e) && !Vi(t)) return t;
  let n = { ...e };
  for (let e in t) {
    let r = t[e];
    Vi(n[e]) && Vi(r) ? (n[e] = Hi(n[e], r)) : (n[e] = r);
  }
  return n;
}
var Ui = (e, t) =>
    new Proxy(() => {}, {
      get(n, r) {
        if (typeof r == `string` && r !== `then`) return Ui(e, [...t, r]);
      },
      apply(n, r, i) {
        return e({ path: t, args: i });
      },
    }),
  Wi = class {
    url;
    method;
    buildSearchParams;
    queryParams = void 0;
    pathParams = {};
    rBody;
    cType = void 0;
    constructor(e, t, n) {
      ((this.url = e), (this.method = t), (this.buildSearchParams = n.buildSearchParams));
    }
    fetch = async (e, t) => {
      if (e) {
        if ((e.query && (this.queryParams = this.buildSearchParams(e.query)), e.form)) {
          let t = new FormData();
          for (let [n, r] of Object.entries(e.form))
            if (r !== void 0)
              if (Array.isArray(r)) for (let e of r) t.append(n, e);
              else t.append(n, r);
          this.rBody = t;
        }
        (e.json && ((this.rBody = JSON.stringify(e.json)), (this.cType = `application/json`)),
          e.param && (this.pathParams = e.param));
      }
      let n = this.method.toUpperCase(),
        r = { ...e?.header, ...(typeof t?.headers == `function` ? await t.headers() : t?.headers) };
      if (e?.cookie) {
        let t = [];
        for (let [n, r] of Object.entries(e.cookie)) t.push(Fi(n, r, { path: `/` }));
        r.Cookie = t.join(`,`);
      }
      this.cType && (r[`Content-Type`] = this.cType);
      let i = new Headers(r ?? void 0),
        a = this.url;
      ((a = Bi(a)),
        (a = Li(a, this.pathParams)),
        this.queryParams && (a = a + `?` + this.queryParams.toString()),
        (n = this.method.toUpperCase()));
      let o = n !== `GET` && n !== `HEAD`;
      return (t?.fetch || fetch)(a, {
        body: o ? this.rBody : void 0,
        method: n,
        headers: i,
        ...t?.init,
      });
    };
  },
  Gi = ((e, t) =>
    Ui(function n(r) {
      let i = t?.buildSearchParams ?? Ri,
        a = [...r.path],
        o = a.slice(-3).reverse();
      if (o[0] === `toString`) return o[1] === `name` ? o[2] || `` : n.toString();
      if (o[0] === `valueOf`) return o[1] === `name` ? o[2] || `` : n;
      let s = ``;
      if (/^\$/.test(o[0])) {
        let e = a.pop();
        e && (s = e.replace(/^\$/, ``));
      }
      let c = Ii(e, a.join(`/`));
      if (s === `url` || s === `path`) {
        let t = c;
        return (
          r.args[0] &&
            (r.args[0].param && (t = Li(c, r.args[0].param)),
            r.args[0].query && (t = t + `?` + i(r.args[0].query).toString())),
          (t = Bi(t)),
          s === `url` ? new URL(t) : t.slice(e.replace(/\/+$/, ``).length).replace(/^\/?/, `/`)
        );
      }
      if (s === `ws`) {
        let e = zi(r.args[0] && r.args[0].param ? Li(c, r.args[0].param) : c, `ws`),
          n = new URL(e),
          i = r.args[0]?.query;
        return (
          i &&
            Object.entries(i).forEach(([e, t]) => {
              Array.isArray(t)
                ? t.forEach((t) => n.searchParams.append(e, t))
                : n.searchParams.set(e, t);
            }),
          ((...e) =>
            t?.webSocket !== void 0 && typeof t.webSocket == `function`
              ? t.webSocket(...e)
              : new WebSocket(...e))(n.toString())
        );
      }
      let l = new Wi(c, s, { buildSearchParams: i });
      if (s) {
        t ??= {};
        let e = { ...r.args[1] },
          n = t.headers,
          i = e.headers;
        n &&
          i &&
          (e.headers = async () => ({
            ...(typeof n == `function` ? await n() : n),
            ...(typeof i == `function` ? await i() : i),
          }));
        let a = Hi(t, e);
        return l.fetch(r.args[0], a);
      }
      return l;
    }, []))(window.location.origin);
function Ki(e, t) {
  let n;
  try {
    n = e[`~standard`].validate(t);
  } catch (e) {
    let t = e instanceof Error ? e.message : `Schema validation threw: ` + String(e);
    return (
      console.warn(`[@ilha/store/form] Schema validation threw an exception:`, t),
      { ok: !1, issues: [{ message: t }] }
    );
  }
  return n instanceof Promise
    ? (console.warn(
        `[@ilha/store/form] Schema validation returned a Promise. validateWithSchema is synchronous — use validateWithSchemaAsync or call schema['~standard'].validate(...) directly for async schemas.`,
      ),
      n.catch(() => {}),
      {
        ok: !1,
        issues: [{ message: `Async schema validation is not supported by validateWithSchema.` }],
      })
    : n.issues === void 0
      ? { ok: !0, data: n.value }
      : { ok: !1, issues: n.issues };
}
function qi(e) {
  let t = Object.create(null);
  for (let n of e) {
    let e = n.path?.map((e) => String(typeof e == `object` ? e.key : e)).join(`.`) ?? ``;
    (t[e] || (t[e] = []), t[e].push(n.message));
  }
  return t;
}
var Ji = "store.bind(selector) only supports property-path selectors like `s => s.user.name`.";
function Yi(e, t) {
  return typeof e == `symbol` || (t && e === `length`)
    ? null
    : t && /^\d+$/.test(e)
      ? Number(e)
      : e;
}
function Xi(e, t) {
  let n = e;
  for (let e of t) {
    if (n == null) return;
    n = n[e];
  }
  return n;
}
var Zi = new Set([`__proto__`, `constructor`, `prototype`]);
function Qi(e, t, n) {
  if (t.length === 0) return n;
  let [r, ...i] = t;
  if (typeof r == `string` && Zi.has(r))
    throw Error(`@ilha/store: refusing to write through unsafe path segment "${r}".`);
  let a = e ?? (typeof r == `number` ? [] : {}),
    o = Array.isArray(a) ? [...a] : { ...a };
  return ((o[r] = Qi(a[r], i, n)), o);
}
function $i(e, t) {
  let n = [],
    r = (e) =>
      e === null || (typeof e != `object` && typeof e != `function`)
        ? e
        : new Proxy(e, {
            get(e, t, i) {
              let a = Yi(t, Array.isArray(e));
              a != null && n.push(a);
              let o = Reflect.get(e, t, i);
              return a != null && typeof o == `object` && o ? r(o) : o;
            },
          });
  return (t(r(e)), n);
}
function ea(e, t) {
  let n = e(),
    r = $i(n, t),
    i = t(n),
    a = r.length === 0 ? n : Xi(n, r);
  if (typeof i == `function` || !Object.is(i, a) || r.length === 0) throw Error(Ji);
  return r;
}
function ta(e, t, n) {
  let r = t[0],
    i = t.slice(1),
    a = e[r],
    o = Qi(a, i, n);
  return { [r]: o };
}
var na = Symbol.for(`ilha.signalAccessor`);
function ra(e, t) {
  if (typeof t != `function`) return t;
  let n = C(void 0);
  try {
    return t(e());
  } finally {
    C(n);
  }
}
function ia(e) {
  return ((e[na] = !0), e);
}
function aa(e) {
  e[na] = !0;
}
function oa(e, t, n, r) {
  let i = ia((...e) => (e.length === 0 || n(ra(t, e[0])), t()));
  return ((i.select = (t) => r((n) => t(n[e]))), i);
}
function sa(e, t, n, r, i) {
  let a = ea(e, r);
  return ia((...t) => (t.length === 0 || n(ta(e(), a, ra(i, t[0]))), i()));
}
var ca = class extends Error {
  issues;
  fieldErrors;
  patch;
  constructor(e, t) {
    let n = qi(e),
      r = Object.values(n).flat()[0] ?? `Validation failed`;
    (super(r),
      (this.name = `StoreValidationError`),
      (this.issues = e),
      (this.fieldErrors = n),
      (this.patch = t));
  }
};
function la(e) {
  if (typeof e != `object` || !e) return !1;
  let t = e[`~standard`];
  return t != null && typeof t.validate == `function` && t.version === 1;
}
function ua(e, t) {
  if (typeof e != `object` || !e || Array.isArray(e))
    throw Error(
      `@ilha/store: ${t} must be a plain object, got ${e === null ? `null` : Array.isArray(e) ? `array` : typeof e}.`,
    );
}
function da(e) {
  let t = [{}, void 0, { step: `requestOtp` }, { step: `REQUEST_OTP` }];
  for (let n of t) {
    let t = Ki(e, n);
    if (t.ok) return t.data;
  }
  let n = Ki(e, {}),
    r = n.ok ? `` : JSON.stringify(qi(n.issues));
  throw Error(
    `@ilha/store: could not derive initial state from schema (tried ${t.length} seeds including {}, undefined, and common step discriminators). ${r}`,
  );
}
function fa(e, t) {
  let n = Ki(e, t);
  return n.ok ? { ok: !0, data: n.data } : { ok: !1, issues: [...n.issues] };
}
function pa(e, t, n) {
  if (!(`step` in t) || !Object.prototype.hasOwnProperty.call(t, `step`)) return n;
  let r = e,
    i = t,
    a = n,
    o = r.step,
    s = i.step;
  if (o === s) return n;
  let c = { step: s };
  for (let e of Object.keys(i)) e !== `step` && (c[e] = i[e]);
  for (let e of Object.keys(a))
    if (!(e === `step` || e in i)) {
      if (e === `otp`) {
        c.otp = ``;
        continue;
      }
      c[e] = a[e];
    }
  return (`otp` in c || (c.otp = ``), c);
}
function ma(e) {
  let t = e[0];
  if (t?.path?.length)
    return t.path
      .map((e) => (typeof e == `object` && e && `key` in e ? String(e.key) : String(e)))
      .join(`.`);
}
var ha = [
    `setState`,
    `reset`,
    `subscribe`,
    `select`,
    `bind`,
    `getState`,
    `getInitialState`,
    `dispose`,
  ],
  ga = new Set(ha);
function _a(e) {
  let t = C(void 0);
  try {
    return e();
  } finally {
    C(t);
  }
}
function va(e) {
  let t = () => e().value;
  return (
    aa(t),
    new Proxy(t, {
      get(t, n, r) {
        return n === `loading` || n === `value` || n === `error` ? e()[n] : Reflect.get(t, n, r);
      },
    })
  );
}
function ya(e, t) {
  for (let n in t)
    if (Object.prototype.hasOwnProperty.call(t, n) && !Object.is(e[n], t[n])) return !1;
  return !0;
}
function ba(e, t) {
  let n = Object.keys(e),
    r = Object.keys(t);
  if (n.length !== r.length) return !1;
  for (let r of n) if (!Object.is(e[r], t[r])) return !1;
  return !0;
}
function xa(e) {
  let t = { ...e };
  for (let e of Object.keys(t)) t[e] === void 0 && delete t[e];
  return t;
}
function Sa(e) {
  try {
    return structuredClone(e);
  } catch {
    return { ...e };
  }
}
function Ca(e, t) {
  return Error(`@ilha/store: key collision — "${e}" is already defined as a ${t} key.`);
}
var wa = class e {
  _cfg;
  constructor(e) {
    this._cfg = e;
  }
  static create(t) {
    return new e({
      initialState: t,
      deriveds: [],
      actions: [],
      middlewares: [],
      listeners: [],
      errorHandlers: [],
    });
  }
  static createWithSchema(t) {
    let n = da(t);
    return (
      ua(n, `initial state from schema`),
      new e({
        initialState: n,
        schema: t,
        deriveds: [],
        actions: [],
        middlewares: [],
        listeners: [],
        errorHandlers: [],
      })
    );
  }
  derived(t, n) {
    return new e({ ...this._cfg, deriveds: [...this._cfg.deriveds, { key: t, fn: n }] });
  }
  action(t, n) {
    return new e({ ...this._cfg, actions: [...this._cfg.actions, { key: t, fn: n }] });
  }
  middleware(t) {
    return new e({ ...this._cfg, middlewares: [...this._cfg.middlewares, t] });
  }
  on(t, n) {
    return new e({ ...this._cfg, listeners: [...this._cfg.listeners, { event: t, handler: n }] });
  }
  onError(t) {
    return new e({ ...this._cfg, errorHandlers: [...this._cfg.errorHandlers, { fn: t }] });
  }
  build() {
    return Ta(this._cfg);
  }
};
function Ta(e) {
  let t = new Set(Object.keys(e.initialState)),
    n = new Set(),
    r = new Set();
  for (let { key: r } of e.deriveds) {
    if (ga.has(r)) throw Ca(r, `built-in`);
    if (t.has(r)) throw Ca(r, `state`);
    if (n.has(r)) throw Ca(r, `derived`);
    n.add(r);
  }
  for (let { key: i } of e.actions) {
    if (ga.has(i)) throw Ca(i, `built-in`);
    if (t.has(i)) throw Ca(i, `state`);
    if (n.has(i)) throw Ca(i, `derived`);
    if (r.has(i)) throw Ca(i, `action`);
    r.add(i);
  }
  for (let e of t) if (ga.has(e)) throw Ca(e, `built-in`);
  let i = E(Sa(e.initialState)),
    a = Sa(e.initialState),
    o = new Set(),
    s = !1;
  function c(e) {
    if (s) return (e(), () => {});
    let t = () => {
      (o.delete(t), e());
    };
    return (o.add(t), t);
  }
  let l = e.listeners.filter((e) => e.event === `change`).map((e) => e.handler),
    u = e.listeners.filter((e) => e.event === `init`).map((e) => e.handler),
    d = e.errorHandlers;
  function f() {
    return i();
  }
  function p(e, t, n) {
    let r = e instanceof ca ? e.issues : void 0,
      i = { error: e, source: t, patch: n, path: r ? ma(r) : void 0, issues: r, get: f };
    if (d.length === 0) {
      console.error(e);
      return;
    }
    for (let { fn: e } of d)
      try {
        e(i);
      } catch (e) {
        console.error(e);
      }
  }
  let m = (t, n) => {
      let r = i();
      if (ya(r, t)) return;
      let a = { ...r, ...t },
        o = a,
        s = n?.validateSchema !== !1;
      if (e.schema && s) {
        let n = pa(r, t, a),
          i = fa(e.schema, xa(n));
        if (!i.ok) {
          p(new ca(i.issues, t), `validate`, t);
          return;
        }
        (ua(i.data, `validated state`), (o = i.data));
      }
      if (!ba(r, o)) {
        i(o);
        for (let e of l)
          try {
            e(o, r);
          } catch (e) {
            p(e instanceof Error ? e : Error(String(e)), `listener`, t);
          }
      }
    },
    h = { get: () => i(), getInitial: () => a },
    g = e.middlewares.reduceRight((e, t) => (n, r) => t(n, h, (t) => e(t, r)), m),
    _ = (e, t) => {
      s || typeof e != `object` || !e || (Object.keys(e).length !== 0 && _a(() => g(e, t)));
    },
    v = (t) => {
      _(t, e.schema ? { validateSchema: !1 } : void 0);
    };
  function y(e) {
    let t = D(() => e(i()));
    return () => t();
  }
  function b(e, t, n) {
    if (t === void 0) {
      let t = e,
        n = i(),
        r = !0;
      return c(
        O(() => {
          let e = i();
          if (r) {
            r = !1;
            return;
          }
          (t(e, n), (n = e));
        }),
      );
    }
    let r = e,
      a = n?.equal ?? Object.is,
      o = D(() => r(i())),
      s = o(),
      l = !0;
    return c(
      O(() => {
        let e = o();
        if (l) {
          l = !1;
          return;
        }
        a(e, s) || (t(e, s), (s = e));
      }),
    );
  }
  function x(e) {
    return sa(f, _, v, e, y(e));
  }
  let S = {
      setState: _,
      reset: () => _(Sa(a)),
      subscribe: b,
      select: y,
      bind: x,
      getState: f,
      getInitialState: () => a,
      dispose: () => {
        if (!s) {
          s = !0;
          for (let e of [...o])
            try {
              e();
            } catch (e) {
              console.error(e);
            }
          o.clear();
        }
      },
    },
    C = new Map();
  for (let e of t) {
    let t = e,
      n = oa(
        t,
        () => i()[t],
        (e) => v({ [t]: e }),
        x,
      );
    C.set(e, n);
  }
  let w = new AbortController().signal,
    T = new Map();
  for (let { key: t, fn: n } of e.deriveds) {
    if (n.constructor.name !== `AsyncFunction` && n.constructor.name !== `AsyncGeneratorFunction`) {
      let e = D(() => n({ get: () => i(), signal: w })),
        r,
        a = !1;
      try {
        ((r = e()), (a = r instanceof Promise));
      } catch {
        a = !0;
      }
      if (!a) {
        T.set(
          t,
          va(() => ({ loading: !1, value: e(), error: void 0 })),
        );
        continue;
      }
    }
    let e = E({ loading: !0, value: void 0, error: void 0 });
    T.set(
      t,
      va(() => e()),
    );
    let r = new AbortController(),
      a = O(() => {
        (r.abort(), (r = new AbortController()));
        let t = r,
          a;
        try {
          a = n({ get: () => i(), signal: t.signal });
        } catch (t) {
          _a(() =>
            e({ loading: !1, value: void 0, error: t instanceof Error ? t : Error(String(t)) }),
          );
          return;
        }
        if (!(a instanceof Promise)) {
          _a(() => e({ loading: !1, value: a, error: void 0 }));
          return;
        }
        let o = _a(() => e().value);
        (_a(() => e({ loading: !0, value: o, error: void 0 })),
          a
            .then((n) => {
              t.signal.aborted || e({ loading: !1, value: n, error: void 0 });
            })
            .catch((n) => {
              t.signal.aborted ||
                e({ loading: !1, value: void 0, error: n instanceof Error ? n : Error(String(n)) });
            }));
      });
    o.add(() => {
      (a(), r.abort());
    });
  }
  let k = { get: f, getInitial: () => a, set: _ },
    A = new Map();
  for (let { key: t, fn: n } of e.actions) {
    let e = E(0),
      r = (t) => {
        let r = n(t, k),
          i = (e) => {
            e != null && _(e);
          };
        r != null && typeof r.then == `function`
          ? (_a(() => e(e() + 1)),
            r
              .then(i)
              .catch((e) => {
                p(e instanceof Error ? e : Error(String(e)), `action`);
              })
              .finally(() => _a(() => e(Math.max(0, e() - 1)))))
          : i(r);
      };
    (Object.defineProperty(r, "pending", { get: () => e() > 0, enumerable: !1 }), A.set(t, r));
  }
  let j = [...ha, ...r, ...n, ...t],
    M = (e) => {
      if (ga.has(e)) return S[e];
      let t = A.get(e);
      if (t) return t;
      let n = T.get(e);
      if (n) return n;
      let r = C.get(e);
      if (r) return r;
    },
    N = new Proxy(Object.create(null), {
      get(e, t) {
        if (typeof t != `symbol`) return M(t);
      },
      set() {
        return !1;
      },
      has(e, i) {
        return typeof i == `symbol` ? !1 : ga.has(i) || r.has(i) || n.has(i) || t.has(i);
      },
      ownKeys() {
        return [...j];
      },
      getOwnPropertyDescriptor(e, i) {
        if (typeof i != `symbol` && (ga.has(i) || r.has(i) || n.has(i) || t.has(i)))
          return { configurable: !0, enumerable: !0, value: M(i), writable: !1 };
      },
    });
  for (let e of u) e(a, a);
  return N;
}
function Ea(e) {
  return la(e) ? wa.createWithSchema(e) : wa.create(e);
}
function Da(e) {
  var t,
    n,
    r = ``;
  if (typeof e == `string` || typeof e == `number`) r += e;
  else if (typeof e == `object`)
    if (Array.isArray(e)) {
      var i = e.length;
      for (t = 0; t < i; t++) e[t] && (n = Da(e[t])) && (r && (r += ` `), (r += n));
    } else for (n in e) e[n] && (r && (r += ` `), (r += n));
  return r;
}
function Oa() {
  for (var e, t, n = 0, r = ``, i = arguments.length; n < i; n++)
    (e = arguments[n]) && (t = Da(e)) && (r && (r += ` `), (r += t));
  return r;
}
var ka = (e, t) => {
    let n = Array(e.length + t.length);
    for (let t = 0; t < e.length; t++) n[t] = e[t];
    for (let r = 0; r < t.length; r++) n[e.length + r] = t[r];
    return n;
  },
  Aa = (e, t) => ({ classGroupId: e, validator: t }),
  ja = (e = new Map(), t = null, n) => ({ nextPart: e, validators: t, classGroupId: n }),
  Ma = `-`,
  Na = [],
  Pa = `arbitrary..`,
  Fa = (e) => {
    let t = Ra(e),
      { conflictingClassGroups: n, conflictingClassGroupModifiers: r } = e;
    return {
      getClassGroupId: (e) => {
        if (e.startsWith(`[`) && e.endsWith(`]`)) return La(e);
        let n = e.split(Ma);
        return Ia(n, +(n[0] === `` && n.length > 1), t);
      },
      getConflictingClassGroupIds: (e, t) => {
        if (t) {
          let t = r[e],
            i = n[e];
          return t ? (i ? ka(i, t) : t) : i || Na;
        }
        return n[e] || Na;
      },
    };
  },
  Ia = (e, t, n) => {
    if (e.length - t === 0) return n.classGroupId;
    let r = e[t],
      i = n.nextPart.get(r);
    if (i) {
      let n = Ia(e, t + 1, i);
      if (n) return n;
    }
    let a = n.validators;
    if (a === null) return;
    let o = t === 0 ? e.join(Ma) : e.slice(t).join(Ma),
      s = a.length;
    for (let e = 0; e < s; e++) {
      let t = a[e];
      if (t.validator(o)) return t.classGroupId;
    }
  },
  La = (e) =>
    e.slice(1, -1).indexOf(`:`) === -1
      ? void 0
      : (() => {
          let t = e.slice(1, -1),
            n = t.indexOf(`:`),
            r = t.slice(0, n);
          return r ? Pa + r : void 0;
        })(),
  Ra = (e) => {
    let { theme: t, classGroups: n } = e;
    return za(n, t);
  },
  za = (e, t) => {
    let n = ja();
    for (let r in e) {
      let i = e[r];
      Ba(i, n, r, t);
    }
    return n;
  },
  Ba = (e, t, n, r) => {
    let i = e.length;
    for (let a = 0; a < i; a++) {
      let i = e[a];
      Va(i, t, n, r);
    }
  },
  Va = (e, t, n, r) => {
    if (typeof e == `string`) {
      Ha(e, t, n);
      return;
    }
    if (typeof e == `function`) {
      Ua(e, t, n, r);
      return;
    }
    Wa(e, t, n, r);
  },
  Ha = (e, t, n) => {
    let r = e === `` ? t : Ga(t, e);
    r.classGroupId = n;
  },
  Ua = (e, t, n, r) => {
    if (Ka(e)) {
      Ba(e(r), t, n, r);
      return;
    }
    (t.validators === null && (t.validators = []), t.validators.push(Aa(n, e)));
  },
  Wa = (e, t, n, r) => {
    let i = Object.entries(e),
      a = i.length;
    for (let e = 0; e < a; e++) {
      let [a, o] = i[e];
      Ba(o, Ga(t, a), n, r);
    }
  },
  Ga = (e, t) => {
    let n = e,
      r = t.split(Ma),
      i = r.length;
    for (let e = 0; e < i; e++) {
      let t = r[e],
        i = n.nextPart.get(t);
      (i || ((i = ja()), n.nextPart.set(t, i)), (n = i));
    }
    return n;
  },
  Ka = (e) => `isThemeGetter` in e && e.isThemeGetter === !0,
  qa = (e) => {
    if (e < 1) return { get: () => void 0, set: () => {} };
    let t = 0,
      n = Object.create(null),
      r = Object.create(null),
      i = (i, a) => {
        ((n[i] = a), t++, t > e && ((t = 0), (r = n), (n = Object.create(null))));
      };
    return {
      get(e) {
        let t = n[e];
        if (t !== void 0) return t;
        if ((t = r[e]) !== void 0) return (i(e, t), t);
      },
      set(e, t) {
        e in n ? (n[e] = t) : i(e, t);
      },
    };
  },
  Ja = `!`,
  Ya = `:`,
  Xa = [],
  Za = (e, t, n, r, i) => ({
    modifiers: e,
    hasImportantModifier: t,
    baseClassName: n,
    maybePostfixModifierPosition: r,
    isExternal: i,
  }),
  Qa = (e) => {
    let { prefix: t, experimentalParseClassName: n } = e,
      r = (e) => {
        let t = [],
          n = 0,
          r = 0,
          i = 0,
          a,
          o = e.length;
        for (let s = 0; s < o; s++) {
          let o = e[s];
          if (n === 0 && r === 0) {
            if (o === Ya) {
              (t.push(e.slice(i, s)), (i = s + 1));
              continue;
            }
            if (o === `/`) {
              a = s;
              continue;
            }
          }
          o === `[` ? n++ : o === `]` ? n-- : o === `(` ? r++ : o === `)` && r--;
        }
        let s = t.length === 0 ? e : e.slice(i),
          c = s,
          l = !1;
        s.endsWith(Ja)
          ? ((c = s.slice(0, -1)), (l = !0))
          : s.startsWith(Ja) && ((c = s.slice(1)), (l = !0));
        let u = a && a > i ? a - i : void 0;
        return Za(t, l, c, u);
      };
    if (t) {
      let e = t + Ya,
        n = r;
      r = (t) => (t.startsWith(e) ? n(t.slice(e.length)) : Za(Xa, !1, t, void 0, !0));
    }
    if (n) {
      let e = r;
      r = (t) => n({ className: t, parseClassName: e });
    }
    return r;
  },
  $a = (e) => {
    let t = new Map();
    return (
      e.orderSensitiveModifiers.forEach((e, n) => {
        t.set(e, 1e6 + n);
      }),
      (e) => {
        let n = [],
          r = [];
        for (let i = 0; i < e.length; i++) {
          let a = e[i],
            o = a[0] === `[`,
            s = t.has(a);
          o || s ? (r.length > 0 && (r.sort(), n.push(...r), (r = [])), n.push(a)) : r.push(a);
        }
        return (r.length > 0 && (r.sort(), n.push(...r)), n);
      }
    );
  },
  eo = (e) => ({
    cache: qa(e.cacheSize),
    parseClassName: Qa(e),
    sortModifiers: $a(e),
    postfixLookupClassGroupIds: to(e),
    ...Fa(e),
  }),
  to = (e) => {
    let t = Object.create(null),
      n = e.postfixLookupClassGroups;
    if (n) for (let e = 0; e < n.length; e++) t[n[e]] = !0;
    return t;
  },
  no = /\s+/,
  ro = (e, t) => {
    let {
        parseClassName: n,
        getClassGroupId: r,
        getConflictingClassGroupIds: i,
        sortModifiers: a,
        postfixLookupClassGroupIds: o,
      } = t,
      s = [],
      c = e.trim().split(no),
      l = ``;
    for (let e = c.length - 1; e >= 0; --e) {
      let t = c[e],
        {
          isExternal: u,
          modifiers: d,
          hasImportantModifier: f,
          baseClassName: p,
          maybePostfixModifierPosition: m,
        } = n(t);
      if (u) {
        l = t + (l.length > 0 ? ` ` + l : l);
        continue;
      }
      let h = !!m,
        g;
      if (h) {
        g = r(p.substring(0, m));
        let e = g && o[g] ? r(p) : void 0;
        e && e !== g && ((g = e), (h = !1));
      } else g = r(p);
      if (!g) {
        if (!h) {
          l = t + (l.length > 0 ? ` ` + l : l);
          continue;
        }
        if (((g = r(p)), !g)) {
          l = t + (l.length > 0 ? ` ` + l : l);
          continue;
        }
        h = !1;
      }
      let _ = d.length === 0 ? `` : d.length === 1 ? d[0] : a(d).join(`:`),
        v = f ? _ + Ja : _,
        y = v + g;
      if (s.indexOf(y) > -1) continue;
      s.push(y);
      let b = i(g, h);
      for (let e = 0; e < b.length; ++e) {
        let t = b[e];
        s.push(v + t);
      }
      l = t + (l.length > 0 ? ` ` + l : l);
    }
    return l;
  },
  io = (...e) => {
    let t = 0,
      n,
      r,
      i = ``;
    for (; t < e.length; ) (n = e[t++]) && (r = ao(n)) && (i && (i += ` `), (i += r));
    return i;
  },
  ao = (e) => {
    if (typeof e == `string`) return e;
    let t,
      n = ``;
    for (let r = 0; r < e.length; r++) e[r] && (t = ao(e[r])) && (n && (n += ` `), (n += t));
    return n;
  },
  oo = (e, ...t) => {
    let n,
      r,
      i,
      a,
      o = (o) => (
        (n = eo(t.reduce((e, t) => t(e), e()))),
        (r = n.cache.get),
        (i = n.cache.set),
        (a = s),
        s(o)
      ),
      s = (e) => {
        let t = r(e);
        if (t) return t;
        let a = ro(e, n);
        return (i(e, a), a);
      };
    return ((a = o), (...e) => a(io(...e)));
  },
  so = [],
  co = (e) => {
    let t = (t) => t[e] || so;
    return ((t.isThemeGetter = !0), t);
  },
  lo = /^\[(?:(\w[\w-]*):)?(.+)\]$/i,
  uo = /^\((?:(\w[\w-]*):)?(.+)\)$/i,
  fo = /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/,
  po = /^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/,
  mo =
    /\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/,
  ho = /^(rgba?|hsla?|hwb|(ok)?(lab|lch)|color-mix)\(.+\)$/,
  go = /^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/,
  _o =
    /^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/,
  vo = (e) => fo.test(e),
  yo = (e) => !!e && !Number.isNaN(Number(e)),
  bo = (e) => !!e && Number.isInteger(Number(e)),
  xo = (e) => e.endsWith(`%`) && yo(e.slice(0, -1)),
  So = (e) => po.test(e),
  Co = () => !0,
  wo = (e) => mo.test(e) && !ho.test(e),
  To = () => !1,
  Eo = (e) => go.test(e),
  Do = (e) => _o.test(e),
  Oo = (e) => !G(e) && !K(e),
  ko = (e) =>
    e.startsWith(`@container`) &&
    ((e[10] === `/` && e[11] !== void 0) ||
      (e[11] === `s` && e[16] !== void 0 && e.startsWith(`-size/`, 10)) ||
      (e[11] === `n` && e[18] !== void 0 && e.startsWith(`-normal/`, 10))),
  Ao = (e) => Go(e, Yo, To),
  G = (e) => lo.test(e),
  jo = (e) => Go(e, Xo, wo),
  Mo = (e) => Go(e, Zo, yo),
  No = (e) => Go(e, $o, Co),
  Po = (e) => Go(e, Qo, To),
  Fo = (e) => Go(e, qo, To),
  Io = (e) => Go(e, Jo, Do),
  Lo = (e) => Go(e, es, Eo),
  K = (e) => uo.test(e),
  Ro = (e) => Ko(e, Xo),
  zo = (e) => Ko(e, Qo),
  Bo = (e) => Ko(e, qo),
  Vo = (e) => Ko(e, Yo),
  Ho = (e) => Ko(e, Jo),
  Uo = (e) => Ko(e, es, !0),
  Wo = (e) => Ko(e, $o, !0),
  Go = (e, t, n) => {
    let r = lo.exec(e);
    return r ? (r[1] ? t(r[1]) : n(r[2])) : !1;
  },
  Ko = (e, t, n = !1) => {
    let r = uo.exec(e);
    return r ? (r[1] ? t(r[1]) : n) : !1;
  },
  qo = (e) => e === `position` || e === `percentage`,
  Jo = (e) => e === `image` || e === `url`,
  Yo = (e) => e === `length` || e === `size` || e === `bg-size`,
  Xo = (e) => e === `length`,
  Zo = (e) => e === `number`,
  Qo = (e) => e === `family-name`,
  $o = (e) => e === `number` || e === `weight`,
  es = (e) => e === `shadow`,
  ts = oo(() => {
    let e = co(`color`),
      t = co(`font`),
      n = co(`text`),
      r = co(`font-weight`),
      i = co(`tracking`),
      a = co(`leading`),
      o = co(`breakpoint`),
      s = co(`container`),
      c = co(`spacing`),
      l = co(`radius`),
      u = co(`shadow`),
      d = co(`inset-shadow`),
      f = co(`text-shadow`),
      p = co(`drop-shadow`),
      m = co(`blur`),
      h = co(`perspective`),
      g = co(`aspect`),
      _ = co(`ease`),
      v = co(`animate`),
      y = () => [`auto`, `avoid`, `all`, `avoid-page`, `page`, `left`, `right`, `column`],
      b = () => [
        `center`,
        `top`,
        `bottom`,
        `left`,
        `right`,
        `top-left`,
        `left-top`,
        `top-right`,
        `right-top`,
        `bottom-right`,
        `right-bottom`,
        `bottom-left`,
        `left-bottom`,
      ],
      x = () => [...b(), K, G],
      S = () => [`auto`, `hidden`, `clip`, `visible`, `scroll`],
      C = () => [`auto`, `contain`, `none`],
      w = () => [K, G, c],
      T = () => [vo, `full`, `auto`, ...w()],
      E = () => [bo, `none`, `subgrid`, K, G],
      D = () => [`auto`, { span: [`full`, bo, K, G] }, bo, K, G],
      O = () => [bo, `auto`, K, G],
      k = () => [`auto`, `min`, `max`, `fr`, K, G],
      A = () => [
        `start`,
        `end`,
        `center`,
        `between`,
        `around`,
        `evenly`,
        `stretch`,
        `baseline`,
        `center-safe`,
        `end-safe`,
      ],
      j = () => [`start`, `end`, `center`, `stretch`, `center-safe`, `end-safe`],
      M = () => [`auto`, ...w()],
      N = () => [
        vo,
        `auto`,
        `full`,
        `dvw`,
        `dvh`,
        `lvw`,
        `lvh`,
        `svw`,
        `svh`,
        `min`,
        `max`,
        `fit`,
        ...w(),
      ],
      ee = () => [vo, `screen`, `full`, `dvw`, `lvw`, `svw`, `min`, `max`, `fit`, ...w()],
      P = () => [vo, `screen`, `full`, `lh`, `dvh`, `lvh`, `svh`, `min`, `max`, `fit`, ...w()],
      F = () => [e, K, G],
      I = () => [...b(), Bo, Fo, { position: [K, G] }],
      L = () => [`no-repeat`, { repeat: [``, `x`, `y`, `space`, `round`] }],
      te = () => [`auto`, `cover`, `contain`, Vo, Ao, { size: [K, G] }],
      R = () => [xo, Ro, jo],
      z = () => [``, `none`, `full`, l, K, G],
      B = () => [``, yo, Ro, jo],
      V = () => [`solid`, `dashed`, `dotted`, `double`],
      ne = () => [
        `normal`,
        `multiply`,
        `screen`,
        `overlay`,
        `darken`,
        `lighten`,
        `color-dodge`,
        `color-burn`,
        `hard-light`,
        `soft-light`,
        `difference`,
        `exclusion`,
        `hue`,
        `saturation`,
        `color`,
        `luminosity`,
      ],
      H = () => [yo, xo, Bo, Fo],
      re = () => [``, `none`, m, K, G],
      ie = () => [`none`, yo, K, G],
      ae = () => [`none`, yo, K, G],
      oe = () => [yo, K, G],
      se = () => [vo, `full`, ...w()];
    return {
      cacheSize: 500,
      theme: {
        animate: [`spin`, `ping`, `pulse`, `bounce`],
        aspect: [`video`],
        blur: [So],
        breakpoint: [So],
        color: [Co],
        container: [So],
        "drop-shadow": [So],
        ease: [`in`, `out`, `in-out`],
        font: [Oo],
        "font-weight": [
          `thin`,
          `extralight`,
          `light`,
          `normal`,
          `medium`,
          `semibold`,
          `bold`,
          `extrabold`,
          `black`,
        ],
        "inset-shadow": [So],
        leading: [`none`, `tight`, `snug`, `normal`, `relaxed`, `loose`],
        perspective: [`dramatic`, `near`, `normal`, `midrange`, `distant`, `none`],
        radius: [So],
        shadow: [So],
        spacing: [`px`, yo],
        text: [So],
        "text-shadow": [So],
        tracking: [`tighter`, `tight`, `normal`, `wide`, `wider`, `widest`],
      },
      classGroups: {
        aspect: [{ aspect: [`auto`, `square`, vo, G, K, g] }],
        container: [`container`],
        "container-type": [{ "@container": [``, `normal`, `size`, K, G] }],
        "container-named": [ko],
        columns: [{ columns: [yo, G, K, s] }],
        "break-after": [{ "break-after": y() }],
        "break-before": [{ "break-before": y() }],
        "break-inside": [{ "break-inside": [`auto`, `avoid`, `avoid-page`, `avoid-column`] }],
        "box-decoration": [{ "box-decoration": [`slice`, `clone`] }],
        box: [{ box: [`border`, `content`] }],
        display: [
          `block`,
          `inline-block`,
          `inline`,
          `flex`,
          `inline-flex`,
          `table`,
          `inline-table`,
          `table-caption`,
          `table-cell`,
          `table-column`,
          `table-column-group`,
          `table-footer-group`,
          `table-header-group`,
          `table-row-group`,
          `table-row`,
          `flow-root`,
          `grid`,
          `inline-grid`,
          `contents`,
          `list-item`,
          `hidden`,
        ],
        sr: [`sr-only`, `not-sr-only`],
        float: [{ float: [`right`, `left`, `none`, `start`, `end`] }],
        clear: [{ clear: [`left`, `right`, `both`, `none`, `start`, `end`] }],
        isolation: [`isolate`, `isolation-auto`],
        "object-fit": [{ object: [`contain`, `cover`, `fill`, `none`, `scale-down`] }],
        "object-position": [{ object: x() }],
        overflow: [{ overflow: S() }],
        "overflow-x": [{ "overflow-x": S() }],
        "overflow-y": [{ "overflow-y": S() }],
        overscroll: [{ overscroll: C() }],
        "overscroll-x": [{ "overscroll-x": C() }],
        "overscroll-y": [{ "overscroll-y": C() }],
        position: [`static`, `fixed`, `absolute`, `relative`, `sticky`],
        inset: [{ inset: T() }],
        "inset-x": [{ "inset-x": T() }],
        "inset-y": [{ "inset-y": T() }],
        start: [{ "inset-s": T(), start: T() }],
        end: [{ "inset-e": T(), end: T() }],
        "inset-bs": [{ "inset-bs": T() }],
        "inset-be": [{ "inset-be": T() }],
        top: [{ top: T() }],
        right: [{ right: T() }],
        bottom: [{ bottom: T() }],
        left: [{ left: T() }],
        visibility: [`visible`, `invisible`, `collapse`],
        z: [{ z: [bo, `auto`, K, G] }],
        basis: [{ basis: [vo, `full`, `auto`, s, ...w()] }],
        "flex-direction": [{ flex: [`row`, `row-reverse`, `col`, `col-reverse`] }],
        "flex-wrap": [{ flex: [`nowrap`, `wrap`, `wrap-reverse`] }],
        flex: [{ flex: [yo, vo, `auto`, `initial`, `none`, G] }],
        grow: [{ grow: [``, yo, K, G] }],
        shrink: [{ shrink: [``, yo, K, G] }],
        order: [{ order: [bo, `first`, `last`, `none`, K, G] }],
        "grid-cols": [{ "grid-cols": E() }],
        "col-start-end": [{ col: D() }],
        "col-start": [{ "col-start": O() }],
        "col-end": [{ "col-end": O() }],
        "grid-rows": [{ "grid-rows": E() }],
        "row-start-end": [{ row: D() }],
        "row-start": [{ "row-start": O() }],
        "row-end": [{ "row-end": O() }],
        "grid-flow": [{ "grid-flow": [`row`, `col`, `dense`, `row-dense`, `col-dense`] }],
        "auto-cols": [{ "auto-cols": k() }],
        "auto-rows": [{ "auto-rows": k() }],
        gap: [{ gap: w() }],
        "gap-x": [{ "gap-x": w() }],
        "gap-y": [{ "gap-y": w() }],
        "justify-content": [{ justify: [...A(), `normal`] }],
        "justify-items": [{ "justify-items": [...j(), `normal`] }],
        "justify-self": [{ "justify-self": [`auto`, ...j()] }],
        "align-content": [{ content: [`normal`, ...A()] }],
        "align-items": [{ items: [...j(), { baseline: [``, `last`] }] }],
        "align-self": [{ self: [`auto`, ...j(), { baseline: [``, `last`] }] }],
        "place-content": [{ "place-content": A() }],
        "place-items": [{ "place-items": [...j(), `baseline`] }],
        "place-self": [{ "place-self": [`auto`, ...j()] }],
        p: [{ p: w() }],
        px: [{ px: w() }],
        py: [{ py: w() }],
        ps: [{ ps: w() }],
        pe: [{ pe: w() }],
        pbs: [{ pbs: w() }],
        pbe: [{ pbe: w() }],
        pt: [{ pt: w() }],
        pr: [{ pr: w() }],
        pb: [{ pb: w() }],
        pl: [{ pl: w() }],
        m: [{ m: M() }],
        mx: [{ mx: M() }],
        my: [{ my: M() }],
        ms: [{ ms: M() }],
        me: [{ me: M() }],
        mbs: [{ mbs: M() }],
        mbe: [{ mbe: M() }],
        mt: [{ mt: M() }],
        mr: [{ mr: M() }],
        mb: [{ mb: M() }],
        ml: [{ ml: M() }],
        "space-x": [{ "space-x": w() }],
        "space-x-reverse": [`space-x-reverse`],
        "space-y": [{ "space-y": w() }],
        "space-y-reverse": [`space-y-reverse`],
        size: [{ size: N() }],
        "inline-size": [{ inline: [`auto`, ...ee()] }],
        "min-inline-size": [{ "min-inline": [`auto`, ...ee()] }],
        "max-inline-size": [{ "max-inline": [`none`, ...ee()] }],
        "block-size": [{ block: [`auto`, ...P()] }],
        "min-block-size": [{ "min-block": [`auto`, ...P()] }],
        "max-block-size": [{ "max-block": [`none`, ...P()] }],
        w: [{ w: [s, `screen`, ...N()] }],
        "min-w": [{ "min-w": [s, `screen`, `none`, ...N()] }],
        "max-w": [{ "max-w": [s, `screen`, `none`, `prose`, { screen: [o] }, ...N()] }],
        h: [{ h: [`screen`, `lh`, ...N()] }],
        "min-h": [{ "min-h": [`screen`, `lh`, `none`, ...N()] }],
        "max-h": [{ "max-h": [`screen`, `lh`, ...N()] }],
        "font-size": [{ text: [`base`, n, Ro, jo] }],
        "font-smoothing": [`antialiased`, `subpixel-antialiased`],
        "font-style": [`italic`, `not-italic`],
        "font-weight": [{ font: [r, Wo, No] }],
        "font-stretch": [
          {
            "font-stretch": [
              `ultra-condensed`,
              `extra-condensed`,
              `condensed`,
              `semi-condensed`,
              `normal`,
              `semi-expanded`,
              `expanded`,
              `extra-expanded`,
              `ultra-expanded`,
              xo,
              G,
            ],
          },
        ],
        "font-family": [{ font: [zo, Po, t] }],
        "font-features": [{ "font-features": [G] }],
        "fvn-normal": [`normal-nums`],
        "fvn-ordinal": [`ordinal`],
        "fvn-slashed-zero": [`slashed-zero`],
        "fvn-figure": [`lining-nums`, `oldstyle-nums`],
        "fvn-spacing": [`proportional-nums`, `tabular-nums`],
        "fvn-fraction": [`diagonal-fractions`, `stacked-fractions`],
        tracking: [{ tracking: [i, K, G] }],
        "line-clamp": [{ "line-clamp": [yo, `none`, K, Mo] }],
        leading: [{ leading: [a, ...w()] }],
        "list-image": [{ "list-image": [`none`, K, G] }],
        "list-style-position": [{ list: [`inside`, `outside`] }],
        "list-style-type": [{ list: [`disc`, `decimal`, `none`, K, G] }],
        "text-alignment": [{ text: [`left`, `center`, `right`, `justify`, `start`, `end`] }],
        "placeholder-color": [{ placeholder: F() }],
        "text-color": [{ text: F() }],
        "text-decoration": [`underline`, `overline`, `line-through`, `no-underline`],
        "text-decoration-style": [{ decoration: [...V(), `wavy`] }],
        "text-decoration-thickness": [{ decoration: [yo, `from-font`, `auto`, K, jo] }],
        "text-decoration-color": [{ decoration: F() }],
        "underline-offset": [{ "underline-offset": [yo, `auto`, K, G] }],
        "text-transform": [`uppercase`, `lowercase`, `capitalize`, `normal-case`],
        "text-overflow": [`truncate`, `text-ellipsis`, `text-clip`],
        "text-wrap": [{ text: [`wrap`, `nowrap`, `balance`, `pretty`] }],
        indent: [{ indent: w() }],
        "tab-size": [{ tab: [bo, K, G] }],
        "vertical-align": [
          {
            align: [
              `baseline`,
              `top`,
              `middle`,
              `bottom`,
              `text-top`,
              `text-bottom`,
              `sub`,
              `super`,
              K,
              G,
            ],
          },
        ],
        whitespace: [
          { whitespace: [`normal`, `nowrap`, `pre`, `pre-line`, `pre-wrap`, `break-spaces`] },
        ],
        break: [{ break: [`normal`, `words`, `all`, `keep`] }],
        wrap: [{ wrap: [`break-word`, `anywhere`, `normal`] }],
        hyphens: [{ hyphens: [`none`, `manual`, `auto`] }],
        content: [{ content: [`none`, K, G] }],
        "bg-attachment": [{ bg: [`fixed`, `local`, `scroll`] }],
        "bg-clip": [{ "bg-clip": [`border`, `padding`, `content`, `text`] }],
        "bg-origin": [{ "bg-origin": [`border`, `padding`, `content`] }],
        "bg-position": [{ bg: I() }],
        "bg-repeat": [{ bg: L() }],
        "bg-size": [{ bg: te() }],
        "bg-image": [
          {
            bg: [
              `none`,
              {
                linear: [{ to: [`t`, `tr`, `r`, `br`, `b`, `bl`, `l`, `tl`] }, bo, K, G],
                radial: [``, K, G],
                conic: [bo, K, G],
              },
              Ho,
              Io,
            ],
          },
        ],
        "bg-color": [{ bg: F() }],
        "gradient-from-pos": [{ from: R() }],
        "gradient-via-pos": [{ via: R() }],
        "gradient-to-pos": [{ to: R() }],
        "gradient-from": [{ from: F() }],
        "gradient-via": [{ via: F() }],
        "gradient-to": [{ to: F() }],
        rounded: [{ rounded: z() }],
        "rounded-s": [{ "rounded-s": z() }],
        "rounded-e": [{ "rounded-e": z() }],
        "rounded-t": [{ "rounded-t": z() }],
        "rounded-r": [{ "rounded-r": z() }],
        "rounded-b": [{ "rounded-b": z() }],
        "rounded-l": [{ "rounded-l": z() }],
        "rounded-ss": [{ "rounded-ss": z() }],
        "rounded-se": [{ "rounded-se": z() }],
        "rounded-ee": [{ "rounded-ee": z() }],
        "rounded-es": [{ "rounded-es": z() }],
        "rounded-tl": [{ "rounded-tl": z() }],
        "rounded-tr": [{ "rounded-tr": z() }],
        "rounded-br": [{ "rounded-br": z() }],
        "rounded-bl": [{ "rounded-bl": z() }],
        "border-w": [{ border: B() }],
        "border-w-x": [{ "border-x": B() }],
        "border-w-y": [{ "border-y": B() }],
        "border-w-s": [{ "border-s": B() }],
        "border-w-e": [{ "border-e": B() }],
        "border-w-bs": [{ "border-bs": B() }],
        "border-w-be": [{ "border-be": B() }],
        "border-w-t": [{ "border-t": B() }],
        "border-w-r": [{ "border-r": B() }],
        "border-w-b": [{ "border-b": B() }],
        "border-w-l": [{ "border-l": B() }],
        "divide-x": [{ "divide-x": B() }],
        "divide-x-reverse": [`divide-x-reverse`],
        "divide-y": [{ "divide-y": B() }],
        "divide-y-reverse": [`divide-y-reverse`],
        "border-style": [{ border: [...V(), `hidden`, `none`] }],
        "divide-style": [{ divide: [...V(), `hidden`, `none`] }],
        "border-color": [{ border: F() }],
        "border-color-x": [{ "border-x": F() }],
        "border-color-y": [{ "border-y": F() }],
        "border-color-s": [{ "border-s": F() }],
        "border-color-e": [{ "border-e": F() }],
        "border-color-bs": [{ "border-bs": F() }],
        "border-color-be": [{ "border-be": F() }],
        "border-color-t": [{ "border-t": F() }],
        "border-color-r": [{ "border-r": F() }],
        "border-color-b": [{ "border-b": F() }],
        "border-color-l": [{ "border-l": F() }],
        "divide-color": [{ divide: F() }],
        "outline-style": [{ outline: [...V(), `none`, `hidden`] }],
        "outline-offset": [{ "outline-offset": [yo, K, G] }],
        "outline-w": [{ outline: [``, yo, Ro, jo] }],
        "outline-color": [{ outline: F() }],
        shadow: [{ shadow: [``, `none`, u, Uo, Lo] }],
        "shadow-color": [{ shadow: F() }],
        "inset-shadow": [{ "inset-shadow": [`none`, d, Uo, Lo] }],
        "inset-shadow-color": [{ "inset-shadow": F() }],
        "ring-w": [{ ring: B() }],
        "ring-w-inset": [`ring-inset`],
        "ring-color": [{ ring: F() }],
        "ring-offset-w": [{ "ring-offset": [yo, jo] }],
        "ring-offset-color": [{ "ring-offset": F() }],
        "inset-ring-w": [{ "inset-ring": B() }],
        "inset-ring-color": [{ "inset-ring": F() }],
        "text-shadow": [{ "text-shadow": [`none`, f, Uo, Lo] }],
        "text-shadow-color": [{ "text-shadow": F() }],
        opacity: [{ opacity: [yo, K, G] }],
        "mix-blend": [{ "mix-blend": [...ne(), `plus-darker`, `plus-lighter`] }],
        "bg-blend": [{ "bg-blend": ne() }],
        "mask-clip": [
          { "mask-clip": [`border`, `padding`, `content`, `fill`, `stroke`, `view`] },
          `mask-no-clip`,
        ],
        "mask-composite": [{ mask: [`add`, `subtract`, `intersect`, `exclude`] }],
        "mask-image-linear-pos": [{ "mask-linear": [yo] }],
        "mask-image-linear-from-pos": [{ "mask-linear-from": H() }],
        "mask-image-linear-to-pos": [{ "mask-linear-to": H() }],
        "mask-image-linear-from-color": [{ "mask-linear-from": F() }],
        "mask-image-linear-to-color": [{ "mask-linear-to": F() }],
        "mask-image-t-from-pos": [{ "mask-t-from": H() }],
        "mask-image-t-to-pos": [{ "mask-t-to": H() }],
        "mask-image-t-from-color": [{ "mask-t-from": F() }],
        "mask-image-t-to-color": [{ "mask-t-to": F() }],
        "mask-image-r-from-pos": [{ "mask-r-from": H() }],
        "mask-image-r-to-pos": [{ "mask-r-to": H() }],
        "mask-image-r-from-color": [{ "mask-r-from": F() }],
        "mask-image-r-to-color": [{ "mask-r-to": F() }],
        "mask-image-b-from-pos": [{ "mask-b-from": H() }],
        "mask-image-b-to-pos": [{ "mask-b-to": H() }],
        "mask-image-b-from-color": [{ "mask-b-from": F() }],
        "mask-image-b-to-color": [{ "mask-b-to": F() }],
        "mask-image-l-from-pos": [{ "mask-l-from": H() }],
        "mask-image-l-to-pos": [{ "mask-l-to": H() }],
        "mask-image-l-from-color": [{ "mask-l-from": F() }],
        "mask-image-l-to-color": [{ "mask-l-to": F() }],
        "mask-image-x-from-pos": [{ "mask-x-from": H() }],
        "mask-image-x-to-pos": [{ "mask-x-to": H() }],
        "mask-image-x-from-color": [{ "mask-x-from": F() }],
        "mask-image-x-to-color": [{ "mask-x-to": F() }],
        "mask-image-y-from-pos": [{ "mask-y-from": H() }],
        "mask-image-y-to-pos": [{ "mask-y-to": H() }],
        "mask-image-y-from-color": [{ "mask-y-from": F() }],
        "mask-image-y-to-color": [{ "mask-y-to": F() }],
        "mask-image-radial": [{ "mask-radial": [K, G] }],
        "mask-image-radial-from-pos": [{ "mask-radial-from": H() }],
        "mask-image-radial-to-pos": [{ "mask-radial-to": H() }],
        "mask-image-radial-from-color": [{ "mask-radial-from": F() }],
        "mask-image-radial-to-color": [{ "mask-radial-to": F() }],
        "mask-image-radial-shape": [{ "mask-radial": [`circle`, `ellipse`] }],
        "mask-image-radial-size": [
          { "mask-radial": [{ closest: [`side`, `corner`], farthest: [`side`, `corner`] }] },
        ],
        "mask-image-radial-pos": [{ "mask-radial-at": b() }],
        "mask-image-conic-pos": [{ "mask-conic": [yo] }],
        "mask-image-conic-from-pos": [{ "mask-conic-from": H() }],
        "mask-image-conic-to-pos": [{ "mask-conic-to": H() }],
        "mask-image-conic-from-color": [{ "mask-conic-from": F() }],
        "mask-image-conic-to-color": [{ "mask-conic-to": F() }],
        "mask-mode": [{ mask: [`alpha`, `luminance`, `match`] }],
        "mask-origin": [
          { "mask-origin": [`border`, `padding`, `content`, `fill`, `stroke`, `view`] },
        ],
        "mask-position": [{ mask: I() }],
        "mask-repeat": [{ mask: L() }],
        "mask-size": [{ mask: te() }],
        "mask-type": [{ "mask-type": [`alpha`, `luminance`] }],
        "mask-image": [{ mask: [`none`, K, G] }],
        filter: [{ filter: [``, `none`, K, G] }],
        blur: [{ blur: re() }],
        brightness: [{ brightness: [yo, K, G] }],
        contrast: [{ contrast: [yo, K, G] }],
        "drop-shadow": [{ "drop-shadow": [``, `none`, p, Uo, Lo] }],
        "drop-shadow-color": [{ "drop-shadow": F() }],
        grayscale: [{ grayscale: [``, yo, K, G] }],
        "hue-rotate": [{ "hue-rotate": [yo, K, G] }],
        invert: [{ invert: [``, yo, K, G] }],
        saturate: [{ saturate: [yo, K, G] }],
        sepia: [{ sepia: [``, yo, K, G] }],
        "backdrop-filter": [{ "backdrop-filter": [``, `none`, K, G] }],
        "backdrop-blur": [{ "backdrop-blur": re() }],
        "backdrop-brightness": [{ "backdrop-brightness": [yo, K, G] }],
        "backdrop-contrast": [{ "backdrop-contrast": [yo, K, G] }],
        "backdrop-grayscale": [{ "backdrop-grayscale": [``, yo, K, G] }],
        "backdrop-hue-rotate": [{ "backdrop-hue-rotate": [yo, K, G] }],
        "backdrop-invert": [{ "backdrop-invert": [``, yo, K, G] }],
        "backdrop-opacity": [{ "backdrop-opacity": [yo, K, G] }],
        "backdrop-saturate": [{ "backdrop-saturate": [yo, K, G] }],
        "backdrop-sepia": [{ "backdrop-sepia": [``, yo, K, G] }],
        "border-collapse": [{ border: [`collapse`, `separate`] }],
        "border-spacing": [{ "border-spacing": w() }],
        "border-spacing-x": [{ "border-spacing-x": w() }],
        "border-spacing-y": [{ "border-spacing-y": w() }],
        "table-layout": [{ table: [`auto`, `fixed`] }],
        caption: [{ caption: [`top`, `bottom`] }],
        transition: [
          { transition: [``, `all`, `colors`, `opacity`, `shadow`, `transform`, `none`, K, G] },
        ],
        "transition-behavior": [{ transition: [`normal`, `discrete`] }],
        duration: [{ duration: [yo, `initial`, K, G] }],
        ease: [{ ease: [`linear`, `initial`, _, K, G] }],
        delay: [{ delay: [yo, K, G] }],
        animate: [{ animate: [`none`, v, K, G] }],
        backface: [{ backface: [`hidden`, `visible`] }],
        perspective: [{ perspective: [h, K, G] }],
        "perspective-origin": [{ "perspective-origin": x() }],
        rotate: [{ rotate: ie() }],
        "rotate-x": [{ "rotate-x": ie() }],
        "rotate-y": [{ "rotate-y": ie() }],
        "rotate-z": [{ "rotate-z": ie() }],
        scale: [{ scale: ae() }],
        "scale-x": [{ "scale-x": ae() }],
        "scale-y": [{ "scale-y": ae() }],
        "scale-z": [{ "scale-z": ae() }],
        "scale-3d": [`scale-3d`],
        skew: [{ skew: oe() }],
        "skew-x": [{ "skew-x": oe() }],
        "skew-y": [{ "skew-y": oe() }],
        transform: [{ transform: [K, G, ``, `none`, `gpu`, `cpu`] }],
        "transform-origin": [{ origin: x() }],
        "transform-style": [{ transform: [`3d`, `flat`] }],
        translate: [{ translate: se() }],
        "translate-x": [{ "translate-x": se() }],
        "translate-y": [{ "translate-y": se() }],
        "translate-z": [{ "translate-z": se() }],
        "translate-none": [`translate-none`],
        zoom: [{ zoom: [bo, K, G] }],
        accent: [{ accent: F() }],
        appearance: [{ appearance: [`none`, `auto`] }],
        "caret-color": [{ caret: F() }],
        "color-scheme": [
          { scheme: [`normal`, `dark`, `light`, `light-dark`, `only-dark`, `only-light`] },
        ],
        cursor: [
          {
            cursor: [
              `auto`,
              `default`,
              `pointer`,
              `wait`,
              `text`,
              `move`,
              `help`,
              `not-allowed`,
              `none`,
              `context-menu`,
              `progress`,
              `cell`,
              `crosshair`,
              `vertical-text`,
              `alias`,
              `copy`,
              `no-drop`,
              `grab`,
              `grabbing`,
              `all-scroll`,
              `col-resize`,
              `row-resize`,
              `n-resize`,
              `e-resize`,
              `s-resize`,
              `w-resize`,
              `ne-resize`,
              `nw-resize`,
              `se-resize`,
              `sw-resize`,
              `ew-resize`,
              `ns-resize`,
              `nesw-resize`,
              `nwse-resize`,
              `zoom-in`,
              `zoom-out`,
              K,
              G,
            ],
          },
        ],
        "field-sizing": [{ "field-sizing": [`fixed`, `content`] }],
        "pointer-events": [{ "pointer-events": [`auto`, `none`] }],
        resize: [{ resize: [`none`, ``, `y`, `x`] }],
        "scroll-behavior": [{ scroll: [`auto`, `smooth`] }],
        "scrollbar-thumb-color": [{ "scrollbar-thumb": F() }],
        "scrollbar-track-color": [{ "scrollbar-track": F() }],
        "scrollbar-gutter": [{ "scrollbar-gutter": [`auto`, `stable`, `both`] }],
        "scrollbar-w": [{ scrollbar: [`auto`, `thin`, `none`] }],
        "scroll-m": [{ "scroll-m": w() }],
        "scroll-mx": [{ "scroll-mx": w() }],
        "scroll-my": [{ "scroll-my": w() }],
        "scroll-ms": [{ "scroll-ms": w() }],
        "scroll-me": [{ "scroll-me": w() }],
        "scroll-mbs": [{ "scroll-mbs": w() }],
        "scroll-mbe": [{ "scroll-mbe": w() }],
        "scroll-mt": [{ "scroll-mt": w() }],
        "scroll-mr": [{ "scroll-mr": w() }],
        "scroll-mb": [{ "scroll-mb": w() }],
        "scroll-ml": [{ "scroll-ml": w() }],
        "scroll-p": [{ "scroll-p": w() }],
        "scroll-px": [{ "scroll-px": w() }],
        "scroll-py": [{ "scroll-py": w() }],
        "scroll-ps": [{ "scroll-ps": w() }],
        "scroll-pe": [{ "scroll-pe": w() }],
        "scroll-pbs": [{ "scroll-pbs": w() }],
        "scroll-pbe": [{ "scroll-pbe": w() }],
        "scroll-pt": [{ "scroll-pt": w() }],
        "scroll-pr": [{ "scroll-pr": w() }],
        "scroll-pb": [{ "scroll-pb": w() }],
        "scroll-pl": [{ "scroll-pl": w() }],
        "snap-align": [{ snap: [`start`, `end`, `center`, `align-none`] }],
        "snap-stop": [{ snap: [`normal`, `always`] }],
        "snap-type": [{ snap: [`none`, `x`, `y`, `both`] }],
        "snap-strictness": [{ snap: [`mandatory`, `proximity`] }],
        touch: [{ touch: [`auto`, `none`, `manipulation`] }],
        "touch-x": [{ "touch-pan": [`x`, `left`, `right`] }],
        "touch-y": [{ "touch-pan": [`y`, `up`, `down`] }],
        "touch-pz": [`touch-pinch-zoom`],
        select: [{ select: [`none`, `text`, `all`, `auto`] }],
        "will-change": [{ "will-change": [`auto`, `scroll`, `contents`, `transform`, K, G] }],
        fill: [{ fill: [`none`, ...F()] }],
        "stroke-w": [{ stroke: [yo, Ro, jo, Mo] }],
        stroke: [{ stroke: [`none`, ...F()] }],
        "forced-color-adjust": [{ "forced-color-adjust": [`auto`, `none`] }],
      },
      conflictingClassGroups: {
        "container-named": [`container-type`],
        overflow: [`overflow-x`, `overflow-y`],
        overscroll: [`overscroll-x`, `overscroll-y`],
        inset: [
          `inset-x`,
          `inset-y`,
          `inset-bs`,
          `inset-be`,
          `start`,
          `end`,
          `top`,
          `right`,
          `bottom`,
          `left`,
        ],
        "inset-x": [`right`, `left`],
        "inset-y": [`top`, `bottom`],
        flex: [`basis`, `grow`, `shrink`],
        gap: [`gap-x`, `gap-y`],
        p: [`px`, `py`, `ps`, `pe`, `pbs`, `pbe`, `pt`, `pr`, `pb`, `pl`],
        px: [`pr`, `pl`],
        py: [`pt`, `pb`],
        m: [`mx`, `my`, `ms`, `me`, `mbs`, `mbe`, `mt`, `mr`, `mb`, `ml`],
        mx: [`mr`, `ml`],
        my: [`mt`, `mb`],
        size: [`w`, `h`],
        "font-size": [`leading`],
        "fvn-normal": [
          `fvn-ordinal`,
          `fvn-slashed-zero`,
          `fvn-figure`,
          `fvn-spacing`,
          `fvn-fraction`,
        ],
        "fvn-ordinal": [`fvn-normal`],
        "fvn-slashed-zero": [`fvn-normal`],
        "fvn-figure": [`fvn-normal`],
        "fvn-spacing": [`fvn-normal`],
        "fvn-fraction": [`fvn-normal`],
        "line-clamp": [`display`, `overflow`],
        rounded: [
          `rounded-s`,
          `rounded-e`,
          `rounded-t`,
          `rounded-r`,
          `rounded-b`,
          `rounded-l`,
          `rounded-ss`,
          `rounded-se`,
          `rounded-ee`,
          `rounded-es`,
          `rounded-tl`,
          `rounded-tr`,
          `rounded-br`,
          `rounded-bl`,
        ],
        "rounded-s": [`rounded-ss`, `rounded-es`],
        "rounded-e": [`rounded-se`, `rounded-ee`],
        "rounded-t": [`rounded-tl`, `rounded-tr`],
        "rounded-r": [`rounded-tr`, `rounded-br`],
        "rounded-b": [`rounded-br`, `rounded-bl`],
        "rounded-l": [`rounded-tl`, `rounded-bl`],
        "border-spacing": [`border-spacing-x`, `border-spacing-y`],
        "border-w": [
          `border-w-x`,
          `border-w-y`,
          `border-w-s`,
          `border-w-e`,
          `border-w-bs`,
          `border-w-be`,
          `border-w-t`,
          `border-w-r`,
          `border-w-b`,
          `border-w-l`,
        ],
        "border-w-x": [`border-w-r`, `border-w-l`],
        "border-w-y": [`border-w-t`, `border-w-b`],
        "border-color": [
          `border-color-x`,
          `border-color-y`,
          `border-color-s`,
          `border-color-e`,
          `border-color-bs`,
          `border-color-be`,
          `border-color-t`,
          `border-color-r`,
          `border-color-b`,
          `border-color-l`,
        ],
        "border-color-x": [`border-color-r`, `border-color-l`],
        "border-color-y": [`border-color-t`, `border-color-b`],
        translate: [`translate-x`, `translate-y`, `translate-none`],
        "translate-none": [`translate`, `translate-x`, `translate-y`, `translate-z`],
        "scroll-m": [
          `scroll-mx`,
          `scroll-my`,
          `scroll-ms`,
          `scroll-me`,
          `scroll-mbs`,
          `scroll-mbe`,
          `scroll-mt`,
          `scroll-mr`,
          `scroll-mb`,
          `scroll-ml`,
        ],
        "scroll-mx": [`scroll-mr`, `scroll-ml`],
        "scroll-my": [`scroll-mt`, `scroll-mb`],
        "scroll-p": [
          `scroll-px`,
          `scroll-py`,
          `scroll-ps`,
          `scroll-pe`,
          `scroll-pbs`,
          `scroll-pbe`,
          `scroll-pt`,
          `scroll-pr`,
          `scroll-pb`,
          `scroll-pl`,
        ],
        "scroll-px": [`scroll-pr`, `scroll-pl`],
        "scroll-py": [`scroll-pt`, `scroll-pb`],
        touch: [`touch-x`, `touch-y`, `touch-pz`],
        "touch-x": [`touch`],
        "touch-y": [`touch`],
        "touch-pz": [`touch`],
      },
      conflictingClassGroupModifiers: { "font-size": [`leading`] },
      postfixLookupClassGroups: [`container-type`],
      orderSensitiveModifiers: [
        `*`,
        `**`,
        `after`,
        `backdrop`,
        `before`,
        `details-content`,
        `file`,
        `first-letter`,
        `first-line`,
        `marker`,
        `placeholder`,
        `selection`,
      ],
    };
  });
function q(...e) {
  return ts(Oa(e));
}
function ns(e) {
  return e.replace(/[A-Z]/g, (e) => `-${e.toLowerCase()}`);
}
function rs(e) {
  return e.replace(/&/g, `&amp;`).replace(/"/g, `&quot;`);
}
function J(e) {
  let t = { className: `class`, htmlFor: `for` },
    n = Object.entries(e)
      .flatMap(([e, n]) => {
        if (e.startsWith(`bind:`) || n == null || n === !1) return [];
        let r = t[e] ?? ns(e);
        return n === !0 ? [r] : [`${r}="${rs(String(n))}"`];
      })
      .join(` `);
  return n.length ? ` ${n}` : ``;
}
function is(e, t) {
  return { handler: e, config: t };
}
is.withOptions = function (e, t = () => ({})) {
  function n(n) {
    return { handler: e(n), config: t(n) };
  }
  return ((n.__isOptionsFunction = !0), n);
};
var as = is,
  os = {
    "--areia-background": `var(--color-white)`,
    "--areia-foreground": `var(--color-neutral-900, oklch(21% 0.006 285.885))`,
    "--areia-surface": `var(--color-white, oklch(98.5% 0 0))`,
    "--areia-surface-foreground": `var(--color-neutral-900, oklch(21% 0.006 285.885))`,
    "--areia-surface-muted": `var(--color-neutral-100, oklch(97% 0 0))`,
    "--areia-surface-muted-foreground": `var(--color-neutral-500, oklch(55.6% 0 0))`,
    "--areia-surface-elevated": `var(--color-neutral-50, #fff)`,
    "--areia-surface-elevated-foreground": `var(--color-neutral-950, oklch(14.5% 0 0))`,
    "--areia-overlay": `oklch(0% 0 0 / 0.4)`,
    "--areia-border": `var(--color-neutral-200)`,
    "--areia-input": `var(--color-white, #fff)`,
    "--areia-ring": `var(--areia-primary)`,
    "--areia-divider": `oklch(14.5% 0 0 / 0.1)`,
    "--areia-text-default": `var(--color-neutral-900, oklch(21% 0.006 285.885))`,
    "--areia-text-strong": `var(--color-neutral-950, oklch(14.5% 0 0))`,
    "--areia-text-subtle": `var(--color-neutral-500, oklch(55.6% 0 0))`,
    "--areia-text-muted": `var(--color-neutral-400, oklch(70.8% 0 0))`,
    "--areia-text-placeholder": `var(--color-neutral-400, oklch(70.8% 0 0))`,
    "--areia-text-inverse": `var(--color-neutral-100, oklch(97% 0 0))`,
    "--areia-text-disabled": `var(--color-neutral-300, oklch(87% 0 0))`,
    "--areia-primary": `oklch(0.5772 0.2324 260)`,
    "--areia-primary-foreground": `var(--color-white, #fff)`,
    "--areia-primary-soft": `color-mix(in oklch, var(--areia-primary) 14%, var(--areia-background))`,
    "--areia-primary-soft-foreground": `var(--areia-primary)`,
    "--areia-accent": `#f6821f`,
    "--areia-accent-foreground": `var(--color-white, #fff)`,
    "--areia-accent-soft": `var(--color-orange-100, oklch(95.4% 0.038 75.164))`,
    "--areia-accent-soft-foreground": `var(--color-orange-800, oklch(47% 0.157 37.304))`,
    "--areia-badge-neutral": `var(--color-neutral-600, oklch(43.9% 0 0))`,
    "--areia-badge-neutral-foreground": `var(--color-white, #fff)`,
    "--areia-badge-purple": `var(--color-purple-600, oklch(60% 0.118 184.704))`,
    "--areia-badge-purple-foreground": `var(--color-white, #fff)`,
    "--areia-badge-teal": `var(--color-teal-600, oklch(60% 0.118 184.704))`,
    "--areia-badge-teal-foreground": `var(--color-white, #fff)`,
    "--areia-badge-teal-soft": `var(--color-teal-100, oklch(95.3% 0.051 180.801))`,
    "--areia-badge-teal-soft-foreground": `var(--color-teal-800, oklch(43.7% 0.078 188.216))`,
    "--areia-success": `var(--color-green-600, oklch(62.7% 0.194 149.214))`,
    "--areia-success-foreground": `var(--color-white, #fff)`,
    "--areia-success-soft": `var(--color-emerald-100, oklch(95% 0.052 163.051))`,
    "--areia-success-soft-foreground": `var(--color-emerald-800, oklch(43.2% 0.095 166.913))`,
    "--areia-info": `var(--color-blue-600, oklch(54.6% 0.245 262.881))`,
    "--areia-info-foreground": `var(--color-white, #fff)`,
    "--areia-info-soft": `var(--color-blue-100, oklch(93.2% 0.032 255.585))`,
    "--areia-info-soft-foreground": `var(--color-blue-800, oklch(42.4% 0.199 265.638))`,
    "--areia-warning": `var(--color-yellow-300, oklch(90.5% 0.182 98.111))`,
    "--areia-warning-foreground": `var(--color-yellow-900, oklch(42.1% 0.095 57.708))`,
    "--areia-warning-soft": `var(--color-yellow-100, oklch(97.3% 0.071 103.193))`,
    "--areia-warning-soft-foreground": `var(--color-yellow-800, oklch(47.6% 0.114 61.907))`,
    "--areia-destructive": `var(--color-red-500, oklch(63.7% 0.237 25.331))`,
    "--areia-destructive-foreground": `var(--color-white, #fff)`,
    "--areia-destructive-soft": `var(--color-red-100, oklch(93.6% 0.032 17.717))`,
    "--areia-destructive-soft-foreground": `var(--color-red-700, oklch(50.5% 0.213 27.518))`,
    "--areia-control-background": `var(--areia-surface)`,
    "--areia-control-foreground": `var(--areia-text-default)`,
    "--areia-control-border": `var(--areia-border)`,
    "--areia-control-hover": `var(--areia-surface-muted)`,
    "--areia-control-active": `var(--color-neutral-200, oklch(92.2% 0 0))`,
    "--areia-control-disabled": `oklch(100% 0 0 / 0.5)`,
    "--areia-control-disabled-foreground": `var(--areia-text-disabled)`,
    "--areia-font-sans": `"Geist Variable", system-ui, sans-serif`,
    "--areia-font-mono": `"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace`,
    "--areia-text-xs": `12px`,
    "--areia-text-xs-line-height": `1.2`,
    "--areia-text-sm": `13px`,
    "--areia-text-sm-line-height": `1.35`,
    "--areia-text-md": `14px`,
    "--areia-text-md-line-height": `1.5`,
    "--areia-text-lg": `16px`,
    "--areia-text-lg-line-height": `1.5`,
    "--areia-text-xl": `20px`,
    "--areia-text-xl-line-height": `1.4`,
    "--areia-space-0": `0px`,
    "--areia-space-1": `4px`,
    "--areia-space-2": `8px`,
    "--areia-space-3": `12px`,
    "--areia-space-4": `16px`,
    "--areia-space-5": `20px`,
    "--areia-space-6": `24px`,
    "--areia-radius-none": `0`,
    "--areia-radius-sm": `0.25rem`,
    "--areia-radius-md": `0.375rem`,
    "--areia-radius-lg": `0.5rem`,
    "--areia-radius-full": `999px`,
    "--areia-shadow-none": `none`,
    "--areia-shadow-sm": `0 1px 2px 0 oklch(0% 0 0 / 0.05)`,
    "--areia-shadow-md": `0 4px 6px -1px oklch(0% 0 0 / 0.1), 0 2px 4px -2px oklch(0% 0 0 / 0.1)`,
    "--areia-shadow-lg": `0 10px 15px -3px oklch(0% 0 0 / 0.1), 0 4px 6px -4px oklch(0% 0 0 / 0.1)`,
    "--areia-z-base": `0`,
    "--areia-z-sticky": `10`,
    "--areia-z-dropdown": `20`,
    "--areia-z-tooltip": `30`,
    "--areia-z-modal": `40`,
    "--areia-z-toast": `50`,
  },
  ss = {
    "--areia-background": `oklch(10% 0 0)`,
    "--areia-foreground": `var(--color-neutral-100)`,
    "--areia-surface": `var(--color-neutral-950)`,
    "--areia-surface-foreground": `var(--color-neutral-100)`,
    "--areia-surface-muted": `var(--color-neutral-800)`,
    "--areia-surface-muted-foreground": `var(--color-neutral-400)`,
    "--areia-surface-elevated": `var(--color-neutral-900)`,
    "--areia-surface-elevated-foreground": `var(--color-neutral-50)`,
    "--areia-overlay": `oklch(0% 0 0 / 0.65)`,
    "--areia-border": `var(--color-neutral-800)`,
    "--areia-input": `var(--color-neutral-900)`,
    "--areia-ring": `var(--areia-primary)`,
    "--areia-divider": `var(--color-neutral-800)`,
    "--areia-text-default": `var(--color-neutral-100)`,
    "--areia-text-strong": `var(--color-neutral-50)`,
    "--areia-text-subtle": `var(--color-neutral-400)`,
    "--areia-text-muted": `var(--color-neutral-500)`,
    "--areia-text-placeholder": `var(--color-neutral-500)`,
    "--areia-text-inverse": `var(--color-neutral-900)`,
    "--areia-text-disabled": `var(--color-neutral-600)`,
    "--areia-primary-soft": `color-mix(in oklch, var(--areia-primary) 32%, var(--areia-background))`,
    "--areia-primary-soft-foreground": `var(--areia-primary)`,
    "--areia-accent-soft": `var(--color-orange-900)`,
    "--areia-accent-soft-foreground": `var(--color-orange-200)`,
    "--areia-badge-purple": `var(--color-purple-700)`,
    "--areia-badge-teal": `var(--color-teal-700)`,
    "--areia-badge-teal-soft": `var(--color-teal-900)`,
    "--areia-badge-teal-soft-foreground": `var(--color-teal-200)`,
    "--areia-success": `var(--color-green-900)`,
    "--areia-success-soft": `var(--color-emerald-900)`,
    "--areia-success-soft-foreground": `var(--color-emerald-200)`,
    "--areia-info": `var(--color-blue-900)`,
    "--areia-info-soft": `var(--color-blue-900)`,
    "--areia-info-soft-foreground": `var(--color-blue-400)`,
    "--areia-warning": `var(--color-yellow-900)`,
    "--areia-warning-soft": `var(--color-yellow-700)`,
    "--areia-warning-soft-foreground": `var(--color-yellow-400)`,
    "--areia-destructive": `var(--color-red-900)`,
    "--areia-destructive-soft": `var(--color-red-900)`,
    "--areia-destructive-soft-foreground": `var(--color-red-400)`,
    "--areia-control-background": `var(--areia-surface)`,
    "--areia-control-foreground": `var(--areia-text-default)`,
    "--areia-control-border": `var(--areia-border)`,
    "--areia-control-hover": `var(--areia-surface-muted)`,
    "--areia-control-active": `var(--color-neutral-700)`,
    "--areia-control-disabled": `oklch(17% 0 0 / 0.5)`,
    "--areia-control-disabled-foreground": `var(--areia-text-disabled)`,
  },
  cs = {
    "--font-sans": `var(--areia-font-sans)`,
    "--font-mono": `var(--areia-font-mono)`,
    "--color-areia-background": `var(--areia-background)`,
    "--color-areia-foreground": `var(--areia-foreground)`,
    "--color-areia-surface": `var(--areia-surface)`,
    "--color-areia-surface-foreground": `var(--areia-surface-foreground)`,
    "--color-areia-surface-muted": `var(--areia-surface-muted)`,
    "--color-areia-surface-muted-foreground": `var(--areia-surface-muted-foreground)`,
    "--color-areia-surface-elevated": `var(--areia-surface-elevated)`,
    "--color-areia-surface-elevated-foreground": `var(--areia-surface-elevated-foreground)`,
    "--color-areia-overlay": `var(--areia-overlay)`,
    "--color-areia-border": `var(--areia-border)`,
    "--color-areia-input": `var(--areia-input)`,
    "--color-areia-ring": `var(--areia-ring)`,
    "--color-areia-divider": `var(--areia-divider)`,
    "--color-areia-primary": `var(--areia-primary)`,
    "--color-areia-primary-foreground": `var(--areia-primary-foreground)`,
    "--color-areia-primary-soft": `var(--areia-primary-soft)`,
    "--color-areia-primary-soft-foreground": `var(--areia-primary-soft-foreground)`,
    "--color-areia-accent": `var(--areia-accent)`,
    "--color-areia-accent-foreground": `var(--areia-accent-foreground)`,
    "--color-areia-accent-soft": `var(--areia-accent-soft)`,
    "--color-areia-accent-soft-foreground": `var(--areia-accent-soft-foreground)`,
    "--color-areia-badge-neutral": `var(--areia-badge-neutral)`,
    "--color-areia-badge-neutral-foreground": `var(--areia-badge-neutral-foreground)`,
    "--color-areia-badge-purple": `var(--areia-badge-purple)`,
    "--color-areia-badge-purple-foreground": `var(--areia-badge-purple-foreground)`,
    "--color-areia-badge-teal": `var(--areia-badge-teal)`,
    "--color-areia-badge-teal-foreground": `var(--areia-badge-teal-foreground)`,
    "--color-areia-badge-teal-soft": `var(--areia-badge-teal-soft)`,
    "--color-areia-badge-teal-soft-foreground": `var(--areia-badge-teal-soft-foreground)`,
    "--color-areia-success": `var(--areia-success)`,
    "--color-areia-success-foreground": `var(--areia-success-foreground)`,
    "--color-areia-success-soft": `var(--areia-success-soft)`,
    "--color-areia-success-soft-foreground": `var(--areia-success-soft-foreground)`,
    "--color-areia-info": `var(--areia-info)`,
    "--color-areia-info-foreground": `var(--areia-info-foreground)`,
    "--color-areia-info-soft": `var(--areia-info-soft)`,
    "--color-areia-info-soft-foreground": `var(--areia-info-soft-foreground)`,
    "--color-areia-warning": `var(--areia-warning)`,
    "--color-areia-warning-foreground": `var(--areia-warning-foreground)`,
    "--color-areia-warning-soft": `var(--areia-warning-soft)`,
    "--color-areia-warning-soft-foreground": `var(--areia-warning-soft-foreground)`,
    "--color-areia-destructive": `var(--areia-destructive)`,
    "--color-areia-destructive-foreground": `var(--areia-destructive-foreground)`,
    "--color-areia-destructive-soft": `var(--areia-destructive-soft)`,
    "--color-areia-destructive-soft-foreground": `var(--areia-destructive-soft-foreground)`,
    "--color-areia-control-background": `var(--areia-control-background)`,
    "--color-areia-control-foreground": `var(--areia-control-foreground)`,
    "--color-areia-control-border": `var(--areia-control-border)`,
    "--color-areia-control-hover": `var(--areia-control-hover)`,
    "--color-areia-control-active": `var(--areia-control-active)`,
    "--color-areia-control-disabled": `var(--areia-control-disabled)`,
    "--color-areia-control-disabled-foreground": `var(--areia-control-disabled-foreground)`,
    "--text-color-areia-default": `var(--areia-text-default)`,
    "--text-color-areia-strong": `var(--areia-text-strong)`,
    "--text-color-areia-subtle": `var(--areia-text-subtle)`,
    "--text-color-areia-muted": `var(--areia-text-muted)`,
    "--text-color-areia-placeholder": `var(--areia-text-placeholder)`,
    "--text-color-areia-inverse": `var(--areia-text-inverse)`,
    "--text-color-areia-disabled": `var(--areia-text-disabled)`,
    "--text-xs": `var(--areia-text-xs)`,
    "--text-xs--line-height": `var(--areia-text-xs-line-height)`,
    "--text-sm": `var(--areia-text-sm)`,
    "--text-sm--line-height": `var(--areia-text-sm-line-height)`,
    "--text-base": `var(--areia-text-md)`,
    "--text-base--line-height": `var(--areia-text-md-line-height)`,
    "--text-lg": `var(--areia-text-lg)`,
    "--text-lg--line-height": `var(--areia-text-lg-line-height)`,
    "--text-xl": `var(--areia-text-xl)`,
    "--text-xl--line-height": `var(--areia-text-xl-line-height)`,
  };
function ls(e, t) {
  return Object.fromEntries(
    e.filter(([e]) => e.startsWith(t)).map(([e, n]) => [e.slice(t.length), n]),
  );
}
var us = Object.entries(cs),
  ds = {
    extend: {
      colors: ls(us, `--color-`),
      textColor: ls(us, `--text-color-`),
      fontFamily: { sans: [`var(--areia-font-sans)`], mono: [`var(--areia-font-mono)`] },
      fontSize: {
        xs: [`var(--areia-text-xs)`, { lineHeight: `var(--areia-text-xs-line-height)` }],
        sm: [`var(--areia-text-sm)`, { lineHeight: `var(--areia-text-sm-line-height)` }],
        base: [`var(--areia-text-md)`, { lineHeight: `var(--areia-text-md-line-height)` }],
        lg: [`var(--areia-text-lg)`, { lineHeight: `var(--areia-text-lg-line-height)` }],
        xl: [`var(--areia-text-xl)`, { lineHeight: `var(--areia-text-xl-line-height)` }],
      },
    },
  },
  fs = as.withOptions(
    (e = {}) =>
      ({ addBase: t, addVariant: n }) => {
        let r = e.darkModeSelector || `.dark`;
        (t({ ":root": os, [r]: ss }), n(`dark`, `&:where(${r}, ${r} *)`));
      },
    (e = {}) => ({
      theme: ds,
      content: [`${import.meta.dirname}/**/*.js`, `./node_modules/areia/dist/**/*.js`],
    }),
  );
(fs().handler, fs().config);
var ps = Object.defineProperty,
  ms = (e, t) => {
    let n = {};
    for (var r in e) ps(n, r, { get: e[r], enumerable: !0 });
    return (t || ps(n, Symbol.toStringTag, { value: `Module` }), n);
  },
  Y = (e, t) => e.querySelector(`[data-slot="${t}"]`),
  hs = (e, t) => [...e.querySelectorAll(`[data-slot="${t}"]`)],
  gs = (e, t) => [...e.querySelectorAll(`[data-slot="${t}"]`)],
  _s = Symbol.for(`data-slot.root-bindings`),
  vs = Symbol.for(`data-slot.root-binding-warnings`),
  ys = (e, t = !1) => {
    let n = e,
      r = n[_s];
    return (!r && t && ((r = new Map()), (n[_s] = r)), r);
  },
  bs = (e, t = !1) => {
    let n = e,
      r = n[vs];
    return (!r && t && ((r = new Set()), (n[vs] = r)), r);
  };
function xs(e, t) {
  return ys(e)?.get(t);
}
function Ss(e, t) {
  return ys(e)?.has(t) ?? !1;
}
function Cs(e, t, n) {
  return (ys(e, !0).set(t, n), n);
}
function ws(e, t, n) {
  let r = ys(e);
  return !r?.has(t) || (arguments.length >= 3 && r.get(t) !== n)
    ? !1
    : (r.delete(t), r.size === 0 && delete e[_s], !0);
}
function Ts(e, t, n) {
  let r = bs(e, !0);
  r.has(t) || (r.add(t), console.warn(n));
}
function Es(e, t, n) {
  let r = xs(e, t);
  return (r !== void 0 && Ts(e, t, n), r);
}
var Ds = new WeakMap();
function Os(e, t, n) {
  let r = Ds.get(e);
  (r || ((r = new Set()), Ds.set(e, r)), !r.has(t) && (r.add(t), console.warn(n)));
}
function ks(e) {
  let t = `data-${e.replace(/([A-Z])/g, `-$1`).toLowerCase()}`,
    n = `data-${e}`;
  return t === n ? [t] : [t, n];
}
function As(e, t) {
  for (let n of ks(t)) if (e.hasAttribute(n)) return e.getAttribute(n);
  return null;
}
function js(e, t) {
  return ks(t).some((t) => e.hasAttribute(t));
}
var Ms = new Set([``, `true`, `1`, `yes`]),
  Ns = new Set([`false`, `0`, `no`]);
function X(e, t) {
  if (!js(e, t)) return;
  let n = As(e, t);
  if (n === null) return;
  let r = n.toLowerCase();
  if (Ms.has(r)) return !0;
  if (Ns.has(r)) return !1;
  Os(e, t, `Invalid boolean value "${n}" for data-${t}. Expected: true/false/1/0/yes/no or empty.`);
}
function Ps(e, t) {
  let n = As(e, t);
  if (n === null || n === ``) return;
  let r = Number(n);
  if (Number.isNaN(r) || !Number.isFinite(r)) {
    Os(e, t, `Invalid number value "${n}" for data-${t}.`);
    return;
  }
  return r;
}
function Fs(e, t) {
  if (js(e, t)) return As(e, t) ?? void 0;
}
function Is(e, t, n) {
  let r = As(e, t);
  if (r !== null) {
    if (n.includes(r)) return r;
    Os(e, t, `Invalid value "${r}" for data-${t}. Expected one of: ${n.join(`, `)}.`);
  }
}
var Ls = new WeakMap(),
  Rs = Symbol.for(`data-slot.portal-owner`),
  zs = (e) => e[Rs] ?? Ls.get(e),
  Bs = (e, t) => {
    (Ls.set(e, t), (e[Rs] = t));
  },
  Vs = (e) => {
    (Ls.delete(e), delete e[Rs]);
  };
function Hs(e, t) {
  return Us(e, t, new Set());
}
function Us(e, t, n) {
  if (!t) return !1;
  let r = t instanceof Element ? t : t.parentElement;
  if (!r) return !1;
  if (e.contains(r)) return !0;
  let i = r;
  for (; i; ) {
    let t = zs(i);
    if (t && !n.has(t) && (n.add(t), Us(e, t, n))) return !0;
    i = i.parentElement;
  }
  return !1;
}
function Ws(e, t, n) {
  if (n.portaled) return;
  let r = (t.ownerDocument ?? document)?.body;
  r &&
    ((n.originalParent = e.parentNode),
    (n.originalNextSibling = e.nextSibling),
    Bs(e, t),
    r.appendChild(e),
    (n.portaled = !0));
}
function Gs(e, t) {
  if (!t.portaled) return;
  Vs(e);
  let n = t.originalParent,
    r = t.originalNextSibling;
  (n && n.isConnected
    ? r && r.parentNode === n
      ? n.insertBefore(e, r)
      : n.appendChild(e)
    : e.remove(),
    (t.portaled = !1),
    (t.originalParent = null),
    (t.originalNextSibling = null));
}
var Ks = 0,
  qs = (e, t) => (e.id ||= `${t}-${++Ks}`),
  Z = (e, t, n) => {
    n === null ? e.removeAttribute(`aria-${t}`) : e.setAttribute(`aria-${t}`, String(n));
  },
  Js = (e, t, n) => {
    (t && e.setAttribute(`aria-labelledby`, qs(t, `title`)),
      n && e.setAttribute(`aria-describedby`, qs(n, `desc`)));
  };
function Q(e, t, n, r) {
  return (e.addEventListener(t, n, r), () => e.removeEventListener(t, n, r));
}
var Ys = (e, t, n) => e.dispatchEvent(new CustomEvent(t, { bubbles: !0, detail: n })),
  Xs = 0,
  Zs = ``,
  Qs = ``;
function $s() {
  if (Xs === 0) {
    let e = document.documentElement;
    ((Zs = e.style.overflow),
      (Qs = e.style.scrollbarGutter),
      (e.style.overflow = `hidden`),
      (e.style.scrollbarGutter = `stable`));
  }
  Xs++;
}
function ec() {
  if (((Xs = Math.max(0, Xs - 1)), Xs === 0)) {
    let e = document.documentElement;
    ((e.style.overflow = Zs), (e.style.scrollbarGutter = Qs));
  }
}
var tc = (e, t) =>
    e === `inline-start`
      ? t === `rtl`
        ? `right`
        : `left`
      : e === `inline-end`
        ? t === `rtl`
          ? `left`
          : `right`
        : e,
  nc = (e) => {
    switch (e) {
      case `top`:
        return [`top`, `right`, `bottom`, `left`];
      case `bottom`:
        return [`bottom`, `top`, `right`, `left`];
      case `left`:
        return [`left`, `top`, `right`, `bottom`];
      case `right`:
        return [`right`, `top`, `bottom`, `left`];
      case `inline-start`:
        return [`inline-start`, `inline-end`, `top`, `bottom`];
      case `inline-end`:
        return [`inline-end`, `inline-start`, `top`, `bottom`];
    }
  },
  rc = (e) => {
    let t = window.visualViewport,
      n = window.document.documentElement,
      r = e.viewportWidth ?? t?.width ?? window.innerWidth ?? n.clientWidth,
      i = e.viewportHeight ?? t?.height ?? window.innerHeight ?? n.clientHeight;
    return { x: t?.offsetLeft ?? 0, y: t?.offsetTop ?? 0, width: r, height: i };
  },
  ic = (e, t, n, r, i, a) => {
    let o = 0,
      s = 0;
    return (
      e === `top`
        ? (s = n.top - r.height - i)
        : e === `bottom`
          ? (s = n.bottom + i)
          : (o = e === `left` ? n.left - r.width - i : n.right + i),
      e === `top` || e === `bottom`
        ? (o =
            t === `start`
              ? n.left + a
              : t === `center`
                ? n.left + n.width / 2 - r.width / 2 + a
                : n.right - r.width - a)
        : (s =
            t === `start`
              ? n.top + a
              : t === `center`
                ? n.top + n.height / 2 - r.height / 2 + a
                : n.bottom - r.height - a),
      { x: o, y: s }
    );
  },
  ac = (e, t) =>
    t === `start`
      ? { x: e.left, y: e.top }
      : t === `end`
        ? { x: e.right, y: e.bottom }
        : { x: e.left + e.width / 2, y: e.top + e.height / 2 },
  oc = (e, t, n, r = `ltr`) => {
    let i = tc(e, r),
      a = ac(n, t);
    return i === `top`
      ? { x: a.x, y: n.top }
      : i === `bottom`
        ? { x: a.x, y: n.bottom }
        : i === `left`
          ? { x: n.left, y: a.y }
          : { x: n.right, y: a.y };
  },
  sc = (e) => {
    let t = oc(e.side, e.align, e.anchorRect, e.direction);
    return `${t.x - e.popupX}px ${t.y - e.popupY}px`;
  };
function cc(e) {
  let t = e.getBoundingClientRect(),
    n = e.offsetWidth > 0 ? e.offsetWidth : t.width,
    r = e.offsetHeight > 0 ? e.offsetHeight : t.height;
  return { top: t.top, left: t.left, right: t.left + n, bottom: t.top + r, width: n, height: r };
}
var lc = (e) => {
    if (e)
      try {
        e.focus({ preventScroll: !0 });
      } catch {
        e.focus();
      }
  },
  uc = new WeakMap(),
  dc = (e, t) => {
    let n = String(t);
    (e.overlay &&
      (e.overlay.setAttribute(`data-stack-index`, n),
      e.overlay.style.setProperty(`--${e.cssVarPrefix}-stack-index`, n),
      e.overlay.style.setProperty(`--${e.cssVarPrefix}-overlay-stack-index`, n)),
      e.content.setAttribute(`data-stack-index`, n),
      e.content.style.setProperty(`--${e.cssVarPrefix}-stack-index`, n),
      e.content.style.setProperty(`--${e.cssVarPrefix}-content-stack-index`, n));
  },
  fc = (e) => {
    (e.overlay &&
      (e.overlay.removeAttribute(`data-stack-index`),
      e.overlay.style.removeProperty(`--${e.cssVarPrefix}-stack-index`),
      e.overlay.style.removeProperty(`--${e.cssVarPrefix}-overlay-stack-index`)),
      e.content.removeAttribute(`data-stack-index`),
      e.content.style.removeProperty(`--${e.cssVarPrefix}-stack-index`),
      e.content.style.removeProperty(`--${e.cssVarPrefix}-content-stack-index`));
  },
  pc = (e) => {
    e.entries.forEach((e, t) => dc(e, t));
  },
  mc = (e) => {
    let t = { entries: [], cleanup: () => {} },
      n = Q(e, `keydown`, (e) => {
        if (e.key !== `Tab`) return;
        let n = t.entries[t.entries.length - 1];
        n && n.onTabKeydown?.(e);
      });
    return (
      (t.cleanup = () => {
        (n(), (t.entries.length = 0));
      }),
      t
    );
  },
  hc = (e) => {
    let t = uc.get(e);
    if (t) return t;
    let n = mc(e);
    return (uc.set(e, n), n);
  };
function gc(e) {
  let t = e.content.ownerDocument ?? document,
    n = {
      content: e.content,
      overlay: e.overlay ?? null,
      onTabKeydown: e.onTabKeydown,
      cssVarPrefix: e.cssVarPrefix,
    },
    r = !1,
    i = null,
    a = () => {
      if (i?.entries.includes(n)) return i;
      let e = uc.get(t) ?? null;
      return e?.entries.includes(n) ? ((i = e), e) : ((i = null), null);
    },
    o = () => {
      let e = a();
      if (!e) return;
      let r = e.entries.indexOf(n);
      if (r === -1) {
        i === e && (i = null);
        return;
      }
      (e.entries.splice(r, 1),
        fc(n),
        pc(e),
        i === e && (i = null),
        e.entries.length === 0 && (e.cleanup(), uc.delete(t)));
    };
  return {
    open: () => {
      if (r) return;
      let e = a() ?? hc(t);
      e.entries.includes(n) || (e.entries.push(n), (i = e), pc(e));
    },
    close: o,
    destroy: () => {
      r || ((r = !0), o());
    },
  };
}
var _c = (e, t, n, r, i) => {
    let a = r.x + i,
      o = r.x + r.width - i,
      s = r.y + i,
      c = r.y + r.height - i;
    return e === `top`
      ? Math.max(0, s - t.y)
      : e === `bottom`
        ? Math.max(0, t.y + n.height - c)
        : e === `left`
          ? Math.max(0, a - t.x)
          : Math.max(0, t.x + n.width - o);
  },
  vc = (e, t, n) => (n < t ? t : Math.min(Math.max(e, t), n)),
  yc = (e, t, n, r) => t > n && e < r,
  bc = (e) => e === `top` || e === `bottom`;
function xc(e) {
  let t = rc(e),
    n = e.direction ?? `ltr`,
    r = e.allowedSides?.length ? [...new Set(e.allowedSides)] : [...nc(e.side)],
    i = r.includes(e.side) ? e.side : r[0],
    a = i,
    o = tc(i, n),
    s = ic(o, e.align, e.anchorRect, e.contentRect, e.sideOffset, e.alignOffset);
  if (e.avoidCollisions) {
    let c = t.x + e.collisionPadding,
      l = t.y + e.collisionPadding,
      u = yc(e.anchorRect.left, e.anchorRect.right, t.x, t.x + t.width),
      d = yc(e.anchorRect.top, e.anchorRect.bottom, t.y, t.y + t.height);
    if (bc(o) ? d : u) {
      let c = [i, ...r.filter((e) => e !== i)],
        l = a,
        u = s,
        d = 1 / 0,
        f = o;
      for (let r of c) {
        let i = tc(r, n),
          a = ic(i, e.align, e.anchorRect, e.contentRect, e.sideOffset, e.alignOffset),
          o = _c(i, a, e.contentRect, t, e.collisionPadding);
        if (o <= 0) {
          ((l = r), (u = a), (d = o), (f = i));
          break;
        }
        o < d && ((l = r), (u = a), (d = o), (f = i));
      }
      ((a = l), (o = f), (s = u));
    }
    let f = t.x + t.width - e.contentRect.width - e.collisionPadding,
      p = t.y + t.height - e.contentRect.height - e.collisionPadding;
    (u && (s.x = vc(s.x, c, f)), d && (s.y = vc(s.y, l, p)));
  }
  return { x: s.x, y: s.y, side: a, align: e.align };
}
function Sc(e, t, n = 4) {
  if (t.clientHeight <= 0) return;
  let r = Math.max(0, t.scrollHeight - t.clientHeight);
  if (r <= 0) return;
  let i = e.getBoundingClientRect(),
    a = t.getBoundingClientRect(),
    o = i.top - a.top + t.scrollTop,
    s = o + i.height,
    c = t.scrollTop + n,
    l = t.scrollTop + t.clientHeight - n,
    u = t.scrollTop;
  (o < c ? (u = o - n) : s > l && (u = s - t.clientHeight + n),
    (u = Math.min(Math.max(u, 0), r)),
    u !== t.scrollTop && (t.scrollTop = u));
}
var Cc = (e) => ({ x: e.x, y: e.y, width: e.width, height: e.height }),
  wc = (e, t) => e.x === t.x && e.y === t.y && e.width === t.width && e.height === t.height,
  Tc = (e) => {
    let t = getComputedStyle(e),
      n = `${t.overflow}${t.overflowX}${t.overflowY}`;
    return /(auto|scroll|overlay)/.test(n);
  },
  Ec = (e, t) => {
    let n = new Set([e]),
      r = e.parentNode;
    for (; r; ) {
      if (r instanceof Element) {
        (Tc(r) && n.add(r), (r = r.parentNode));
        continue;
      }
      if (r instanceof Document) {
        (r.scrollingElement && n.add(r.scrollingElement),
          n.add(r),
          r.defaultView &&
            (n.add(r.defaultView),
            r.defaultView.visualViewport && n.add(r.defaultView.visualViewport)));
        break;
      }
      r = null;
    }
    return (n.add(t), t.visualViewport && n.add(t.visualViewport), [...n]);
  },
  Dc = (e, t, n) => {
    let r = null,
      i = null,
      a = () => {
        (i !== null && (n.clearTimeout(i), (i = null)), r?.disconnect(), (r = null));
      },
      o = (s = !1, c = 1) => {
        a();
        let l = e.getBoundingClientRect();
        if ((s || t(), !l.width || !l.height)) return;
        let u = e.ownerDocument.documentElement,
          d = Math.floor(l.top),
          f = Math.floor(u.clientWidth - (l.left + l.width)),
          p = Math.floor(u.clientHeight - (l.top + l.height)),
          m = Math.floor(l.left),
          h = `${-d}px ${-f}px ${-p}px ${-m}px`,
          g = Math.max(0, Math.min(1, c)) || 1,
          _ = !0;
        ((r = new IntersectionObserver(
          (t) => {
            let r = t[0]?.intersectionRatio ?? 1;
            if (r !== g) {
              if (!_) {
                o();
                return;
              }
              r
                ? o(!1, r)
                : (i = n.setTimeout(() => {
                    o(!1, 1e-7);
                  }, 1e3));
            }
            if (r === 1 && !wc(Cc(l), Cc(e.getBoundingClientRect()))) {
              o();
              return;
            }
            _ = !1;
          },
          { rootMargin: h, threshold: g },
        )),
          r.observe(e));
      };
    return (o(!0), a);
  };
function Oc(e) {
  let t = e.win ?? window,
    n = e.isActive ?? (() => !0),
    r = e.observedElements ?? [],
    i = e.ancestorScroll ?? !0,
    a = e.syncOnScroll ?? !1,
    o = e.ancestorResize ?? !0,
    s = e.elementResize ?? typeof ResizeObserver < `u`,
    c = e.layoutShift ?? !1,
    l = e.animationFrame ?? !1,
    u = null,
    d = null,
    f = !1,
    p = null,
    m = null,
    h = [],
    g = () => {
      u === null &&
        (u = t.requestAnimationFrame(() => {
          ((u = null), n() && e.onUpdate());
        }));
    },
    _ = () => {
      u !== null && (t.cancelAnimationFrame(u), (u = null));
    },
    v = () => g(),
    y = (t) => {
      if (!e.ignoreScrollTarget?.(t.target)) {
        if (a) {
          (_(), n() && e.onUpdate());
          return;
        }
        g();
      }
    },
    b = () => {
      let e = new Set(),
        n = r.length ? r : [];
      if (n.length === 0) return (e.add(t), t.visualViewport && e.add(t.visualViewport), [...e]);
      for (let r of n) for (let n of Ec(r, t)) e.add(n);
      return [...e];
    },
    x = (e) => {
      let n = new Set([t]);
      t.visualViewport && n.add(t.visualViewport);
      for (let r of e) (r === t || r === t.visualViewport) && n.add(r);
      return [...n];
    };
  return {
    start: () => {
      if (f) return;
      f = !0;
      let e = b(),
        n = x(e);
      if (i)
        for (let t of e)
          (t.addEventListener(`scroll`, y, { passive: !0 }),
            h.push(() => t.removeEventListener(`scroll`, y)));
      if (o)
        for (let e of n)
          (e.addEventListener(`resize`, v), h.push(() => e.removeEventListener(`resize`, v)));
      if (s && typeof ResizeObserver < `u`) {
        p = new ResizeObserver(v);
        for (let e of r) p.observe(e);
      }
      let a = r[0] ?? null;
      if ((c && a && typeof IntersectionObserver < `u` && (m = Dc(a, g, t)), l && a)) {
        let e = Cc(a.getBoundingClientRect()),
          n = () => {
            if (!f) return;
            let r = Cc(a.getBoundingClientRect());
            (wc(e, r) || g(), (e = r), (d = t.requestAnimationFrame(n)));
          };
        d = t.requestAnimationFrame(n);
      }
    },
    stop: () => {
      f &&
        ((f = !1),
        u !== null && _(),
        d !== null && (t.cancelAnimationFrame(d), (d = null)),
        h.forEach((e) => e()),
        (h = []),
        p?.disconnect(),
        (p = null),
        m?.(),
        (m = null));
    },
    update: g,
  };
}
var kc = new WeakMap(),
  Ac = (e, t) => {
    let n = t.isOpen();
    return (
      n && !t.wasOpen && ((e.openSequence += 1), (t.openOrder = e.openSequence)), (t.wasOpen = n), n
    );
  },
  jc = (e, t) => {
    let n = null;
    for (let r of e.layers)
      Ac(e, r) && ((t && !t(r)) || ((!n || r.openOrder > n.openOrder) && (n = r)));
    return n;
  },
  Mc = (e) => {
    let t = e.defaultView ?? window,
      n = {
        layers: [],
        openSequence: 0,
        pendingTouchOutside: !1,
        pendingIframeBlur: null,
        cleanup: () => {},
      },
      r = () => {
        n.pendingIframeBlur != null &&
          (t.clearTimeout(n.pendingIframeBlur), (n.pendingIframeBlur = null));
      },
      i = Q(e, `pointerdown`, (e) => {
        let t = e.target,
          r = jc(n);
        if (!r || !r.closeOnClickOutside || r.isInside(t)) {
          n.pendingTouchOutside = !1;
          return;
        }
        if (e.pointerType === `touch`) {
          n.pendingTouchOutside = !0;
          return;
        }
        ((n.pendingTouchOutside = !1), r.onDismiss());
      }),
      a = Q(e, `click`, (e) => {
        if (!n.pendingTouchOutside) return;
        n.pendingTouchOutside = !1;
        let t = e.target,
          r = jc(n);
        !r || !r.closeOnClickOutside || r.isInside(t) || r.onDismiss();
      }),
      o = Q(e, `pointercancel`, () => {
        n.pendingTouchOutside = !1;
      }),
      s = Q(t, `blur`, () => {
        jc(n, (e) => e.closeOnClickOutside) &&
          ((n.pendingTouchOutside = !1),
          r(),
          (n.pendingIframeBlur = t.setTimeout(() => {
            n.pendingIframeBlur = null;
            let r = jc(n, (e) => e.closeOnClickOutside);
            if (!r) return;
            let i = t.HTMLIFrameElement,
              a = e.activeElement;
            !i || !(a instanceof i) || r.isInside(a) || r.onDismiss();
          }, 0)));
      }),
      c = Q(e, `keydown`, (e) => {
        if (e.key !== `Escape` || e.defaultPrevented) return;
        let t = e.target,
          r = jc(n, (e) => e.closeOnEscape && e.isInside(t)) ?? jc(n, (e) => e.closeOnEscape);
        r && (r.preventEscapeDefault && e.preventDefault(), r.onDismiss());
      });
    return (
      (n.cleanup = () => {
        (i(), a(), o(), s(), c(), r(), (n.pendingTouchOutside = !1), (n.layers.length = 0));
      }),
      n
    );
  },
  Nc = (e) => {
    let t = kc.get(e);
    if (t) return t;
    let n = Mc(e);
    return (kc.set(e, n), n);
  };
function Pc(e) {
  let t = e.root.ownerDocument ?? document,
    n = Nc(t),
    r = {
      isOpen: e.isOpen,
      onDismiss: e.onDismiss,
      isInside: e.isInside ?? ((t) => Hs(e.root, t)),
      closeOnClickOutside: e.closeOnClickOutside ?? !0,
      closeOnEscape: e.closeOnEscape ?? !0,
      preventEscapeDefault: e.preventEscapeDefault ?? !0,
      wasOpen: !1,
      openOrder: 0,
    };
  return (
    Ac(n, r) && (r.wasOpen = !0),
    n.layers.push(r),
    () => {
      let e = n.layers.indexOf(r);
      (e !== -1 && n.layers.splice(e, 1), n.layers.length === 0 && (n.cleanup(), kc.delete(t)));
    }
  );
}
function Fc(e) {
  let t = e.enabled ?? !0,
    n = e.wrapperSlot,
    r = e.container,
    i = e.mountTarget ?? r ?? e.content,
    a = e.state ?? { originalParent: null, originalNextSibling: null, portaled: !1 },
    o = e.root.ownerDocument ?? document,
    s = null,
    c = () => {
      if (s) return s;
      let e = o.createElement(`div`);
      return (
        n &&
          (e.setAttribute(`data-slot`, n),
          (e.style.isolation = `isolate`),
          (e.style.zIndex = `50`)),
        (s = e),
        e
      );
    },
    l = () => {
      if (a.portaled) return;
      let t = e.content.parentNode;
      if (!t) return;
      let n = c();
      (t.insertBefore(n, e.content), n.appendChild(e.content), Ws(n, e.root, a));
    },
    u = () => {
      a.portaled || (i.isConnected && Ws(i, e.root, a));
    },
    d = () => {
      if (!a.portaled) return;
      let t = s;
      if (!t) return;
      Gs(t, a);
      let n = t.parentNode;
      n && n.isConnected ? (n.insertBefore(e.content, t), t.remove()) : e.content.remove();
    },
    f = () => {
      a.portaled && Gs(i, a);
    };
  return {
    state: a,
    get container() {
      return r || (t && n && a.portaled && s ? s : e.content);
    },
    mount: () => {
      if (t) {
        if (r || e.mountTarget) {
          u();
          return;
        }
        n ? l() : Ws(e.content, e.root, a);
      }
    },
    restore: () => {
      if (t) {
        if (r || e.mountTarget) {
          f();
          return;
        }
        n ? d() : Gs(e.content, a);
      }
    },
    cleanup: () => {
      if (t) {
        if (r || e.mountTarget) {
          f();
          return;
        }
        n ? d() : Gs(e.content, a);
      }
    },
  };
}
var Ic = (e) => {
    let t = e.trim().toLowerCase();
    if (!t) return 0;
    if (t.endsWith(`ms`)) {
      let e = Number(t.slice(0, -2).trim());
      return Number.isFinite(e) ? e : 0;
    }
    if (t.endsWith(`s`)) {
      let e = Number(t.slice(0, -1).trim());
      return Number.isFinite(e) ? e * 1e3 : 0;
    }
    let n = Number(t);
    return Number.isFinite(n) ? n : 0;
  },
  Lc = (e, t) => {
    let n = e.split(`,`),
      r = t.split(`,`),
      i = Math.max(n.length, r.length),
      a = 0;
    for (let e = 0; e < i; e++) {
      let t = Ic(n[e] ?? n[n.length - 1] ?? `0`),
        i = Ic(r[e] ?? r[r.length - 1] ?? `0`);
      a = Math.max(a, t + i);
    }
    return a;
  },
  Rc = (e) => {
    let t = getComputedStyle(e),
      n = Lc(t.transitionDuration, t.transitionDelay),
      r = Lc(t.animationDuration, t.animationDelay);
    return Math.max(n, r);
  };
function zc(e) {
  let t = e.win ?? window,
    n = !1,
    r = null,
    i = null,
    a = null,
    o = null,
    s = [],
    c = () => {
      (a !== null && (t.cancelAnimationFrame(a), (a = null)),
        o !== null && (t.clearTimeout(o), (o = null)),
        s.forEach((e) => e()),
        (s = []));
    },
    l = () => {
      (c(), (n = !1), e.element.removeAttribute(`data-ending-style`));
    },
    u = () => {
      (r !== null && (t.cancelAnimationFrame(r), (r = null)),
        i !== null && (t.cancelAnimationFrame(i), (i = null)),
        e.element.removeAttribute(`data-starting-style`));
    },
    d = () => {
      n && (c(), (n = !1), e.element.removeAttribute(`data-ending-style`), e.onExitComplete());
    };
  return {
    get isExiting() {
      return n;
    },
    enter: () => {
      (l(),
        u(),
        e.element.setAttribute(`data-starting-style`, ``),
        (r = t.requestAnimationFrame(() => {
          ((r = null),
            (i = t.requestAnimationFrame(() => {
              ((i = null), e.element.removeAttribute(`data-starting-style`));
            })));
        })));
    },
    exit: () => {
      (l(), u(), (n = !0), e.element.setAttribute(`data-ending-style`, ``));
      let r = Rc(e.element);
      if (r > 0) {
        let n = (t) => {
          t.target === e.element && d();
        };
        (e.element.addEventListener(`transitionend`, n),
          e.element.addEventListener(`animationend`, n),
          s.push(() => e.element.removeEventListener(`transitionend`, n)),
          s.push(() => e.element.removeEventListener(`animationend`, n)),
          (o = t.setTimeout(
            () => {
              ((o = null), d());
            },
            Math.ceil(r) + 50,
          )));
      } else
        a = t.requestAnimationFrame(() => {
          ((a = null), d());
        });
    },
    cleanup: () => {
      (l(), u());
    },
  };
}
var Bc = ms({ create: () => il, createAccordion: () => rl }),
  Vc = [`horizontal`, `vertical`],
  Hc = new Set([`all`, `height`, `width`, `block-size`, `inline-size`]),
  Uc = 5,
  Wc = new Set([`Enter`, ` `]),
  Gc = (e) =>
    !!e &&
    (e.hasAttribute(`disabled`) ||
      e.hasAttribute(`data-disabled`) ||
      e.getAttribute(`aria-disabled`) === `true`),
  Kc = (e, t, n) => {
    n ? e.setAttribute(t, ``) : e.removeAttribute(t);
  },
  qc = (e, t) => {
    (e.setAttribute(`data-state`, t ? `open` : `closed`),
      t
        ? (e.setAttribute(`data-open`, ``), e.removeAttribute(`data-closed`))
        : (e.setAttribute(`data-closed`, ``), e.removeAttribute(`data-open`)));
  },
  Jc = (e) => {
    let t = e.trim();
    return t
      ? t.endsWith(`ms`)
        ? Number.parseFloat(t.slice(0, -2)) || 0
        : t.endsWith(`s`)
          ? (Number.parseFloat(t.slice(0, -1)) || 0) * 1e3
          : Number.parseFloat(t) || 0
      : 0;
  },
  Yc = (e, t) => {
    let n = e.split(`,`),
      r = t.split(`,`),
      i = Math.max(n.length, r.length),
      a = 0;
    for (let e = 0; e < i; e += 1) {
      let t = Jc(n[e] ?? n[n.length - 1] ?? `0`),
        i = Jc(r[e] ?? r[r.length - 1] ?? `0`);
      a = Math.max(a, t + i);
    }
    return a;
  },
  Xc = (e) => {
    let t = getComputedStyle(e),
      n = Yc(t.transitionDuration, t.transitionDelay),
      r = Yc(t.animationDuration, t.animationDelay);
    return Math.max(n, r);
  },
  Zc = (e) =>
    Yc(e.animationDuration, e.animationDelay) <= 0
      ? !1
      : e.animationName
          .split(`,`)
          .map((e) => e.trim())
          .some((e) => e !== `` && e !== `none`),
  Qc = (e, t) => {
    let n = getComputedStyle(e),
      r = n.transitionProperty.split(`,`).map((e) => e.trim()),
      i = n.transitionDuration.split(`,`),
      a = n.transitionDelay.split(`,`),
      o = Math.max(r.length, i.length, a.length),
      s = 0;
    for (let e = 0; e < o; e += 1) {
      if (!t(r[e] ?? r[r.length - 1] ?? `all`)) continue;
      let n = Jc(i[e] ?? i[i.length - 1] ?? `0`),
        o = Jc(a[e] ?? a[a.length - 1] ?? `0`);
      s = Math.max(s, n + o);
    }
    return s;
  },
  $c = (e) => Qc(e, (e) => Hc.has(e)),
  el = (e) => {
    if (e === void 0) return;
    let t = e.trim();
    if (!t.startsWith(`[`) || !t.endsWith(`]`)) return e;
    try {
      let n = JSON.parse(t);
      return Array.isArray(n) ? n.filter((e) => typeof e == `string`) : e;
    } catch {
      return e;
    }
  },
  tl = `@areia/slots:Accordion`,
  nl = `[@areia/slots:Accordion] createAccordion() called more than once for the same root. Returning the existing controller. Destroy it before rebinding with new options.`;
function rl(e, t = {}) {
  let n = Es(e, tl, nl);
  if (n) return n;
  let r = e,
    i = hs(e, `accordion-item`);
  if (i.length === 0) throw Error(`Accordion requires at least one accordion-item`);
  let a = e.ownerDocument?.defaultView ?? window,
    o = t.multiple ?? X(e, `multiple`) ?? !1,
    s = t.onValueChange,
    c = t.disabled ?? X(e, `disabled`) ?? Gc(e),
    l = t.orientation ?? Is(e, `orientation`, Vc) ?? `vertical`,
    u = t.loopFocus ?? X(e, `loopFocus`) ?? !0,
    d = t.hiddenUntilFound ?? X(e, `hiddenUntilFound`) ?? !1,
    f = t.collapsible ?? X(e, `collapsible`) ?? !0,
    p = [],
    m = [],
    h = (e, t, n) => {
      (e.content.style.setProperty(`--accordion-panel-height`, t),
        e.content.style.setProperty(`--accordion-panel-width`, n),
        e.content.style.setProperty(`--radix-accordion-content-height`, t),
        e.content.style.setProperty(`--radix-accordion-content-width`, n));
    },
    g = (e, t, n) => {
      h(e, `${t}px`, `${n}px`);
    },
    _ = (e) => {
      h(e, `auto`, `auto`);
    },
    v = (e) => {
      g(e, 0, 0);
    },
    y = (e, { resetVarsToAuto: t = !1 } = {}) => {
      (t && _(e), g(e, e.content.scrollHeight, e.content.scrollWidth));
    },
    b = (e) => {
      let t = e.content.style.getPropertyValue(`--accordion-panel-height`).trim(),
        n = e.content.style.getPropertyValue(`--accordion-panel-width`).trim();
      return t === `auto` && n === `auto`;
    },
    x = (e) => {
      ((e.suppressClick = !1),
        e.suppressClickTimeoutId !== null &&
          (a.clearTimeout(e.suppressClickTimeoutId), (e.suppressClickTimeoutId = null)));
    },
    S = (e) => {
      (e.openSettleRafId !== null &&
        (a.cancelAnimationFrame(e.openSettleRafId), (e.openSettleRafId = null)),
        e.openSettleTimeoutId !== null &&
          (a.clearTimeout(e.openSettleTimeoutId), (e.openSettleTimeoutId = null)),
        e.openSettleCleanups.forEach((e) => e()),
        (e.openSettleCleanups = []));
    },
    C = (e) => {
      e.closeZeroRafId !== null &&
        (a.cancelAnimationFrame(e.closeZeroRafId), (e.closeZeroRafId = null));
    },
    w = (e) => {
      (S(e), C(e));
    },
    T = (e) => {
      let t = getComputedStyle(e.content),
        n = $c(e.content) > 0,
        r = Zc(t);
      return r && !n ? `css-animation` : n ? `css-transition` : r ? `css-animation` : `none`;
    },
    E = (e, t) => {
      let n = e.content.style.getPropertyValue(`animation-name`);
      e.content.style.setProperty(`animation-name`, `none`);
      try {
        t();
      } finally {
        n
          ? e.content.style.setProperty(`animation-name`, n)
          : e.content.style.removeProperty(`animation-name`);
      }
    },
    D = (e) => {
      e.idleAnimationSuppressed ||
        ((e.idleAnimationName = e.content.style.getPropertyValue(`animation-name`) || null),
        (e.idleAnimationSuppressed = !0),
        e.content.style.setProperty(`animation-name`, `none`));
    },
    O = (e) => {
      e.idleAnimationSuppressed &&=
        (e.idleAnimationName
          ? e.content.style.setProperty(`animation-name`, e.idleAnimationName)
          : e.content.style.removeProperty(`animation-name`),
        (e.idleAnimationName = null),
        !1);
    },
    k = (e) => {
      e.content.removeAttribute(`hidden`);
    },
    A = (e) => {
      (d ? e.content.setAttribute(`hidden`, `until-found`) : (e.content.hidden = !0), v(e));
    },
    j = new Set(),
    M = (e, t) => {
      (S(e), !(!j.has(e.value) || e.presence.isExiting) && (_(e), t === `css-animation` && D(e)));
    },
    N = (e, t) => {
      S(e);
      let n = Xc(e.content),
        r = $c(e.content),
        i = r || n;
      if (i > 0) {
        let n = typeof a.performance?.now == `function` ? a.performance.now() : Date.now(),
          o = (e) =>
            (typeof a.performance?.now == `function` ? a.performance.now() : Date.now()) - n >=
            Math.max(0, e - Uc),
          s = (n) => {
            if (n.target !== e.content) return;
            let a = `propertyName` in n ? String(n.propertyName) : ``;
            if (r > 0) {
              if (!Hc.has(a) || !o(r)) return;
            } else if (!o(i)) return;
            M(e, t);
          },
          c = (n) => {
            n.target === e.content && (r > 0 || (o(i) && M(e, t)));
          };
        (e.content.addEventListener(`transitionend`, s),
          e.content.addEventListener(`animationend`, c),
          e.openSettleCleanups.push(() => e.content.removeEventListener(`transitionend`, s)),
          e.openSettleCleanups.push(() => e.content.removeEventListener(`animationend`, c)),
          (e.openSettleTimeoutId = a.setTimeout(
            () => {
              ((e.openSettleTimeoutId = null), M(e, t));
            },
            Math.ceil(i) + 50,
          )));
        return;
      }
      e.openSettleRafId = a.requestAnimationFrame(() => {
        ((e.openSettleRafId = null), M(e, t));
      });
    },
    ee = (e) => {
      (C(e),
        (e.closeZeroRafId = a.requestAnimationFrame(() => {
          ((e.closeZeroRafId = null), !j.has(e.value) && e.presence.isExiting && v(e));
        })));
    },
    P = (e) => {
      (e.el.setAttribute(`data-index`, String(e.index)),
        e.content.setAttribute(`data-index`, String(e.index)),
        e.content.setAttribute(`data-orientation`, l),
        Kc(e.el, `data-disabled`, e.disabled),
        Kc(e.trigger, `data-disabled`, e.disabled),
        Kc(e.content, `data-disabled`, e.disabled),
        e.disabled
          ? (e.trigger.setAttribute(`aria-disabled`, `true`),
            e.trigger instanceof HTMLButtonElement && (e.trigger.disabled = !0))
          : (e.trigger.removeAttribute(`aria-disabled`),
            e.trigger instanceof HTMLButtonElement && (e.trigger.disabled = !1)));
    },
    F = (e, t) => {
      (e.trigger.setAttribute(`data-state`, t ? `open` : `closed`),
        Kc(e.trigger, `data-panel-open`, t));
    },
    I = (e) => {
      let t = j.has(e.value);
      (P(e),
        Z(e.trigger, `expanded`, t),
        qc(e.el, t),
        qc(e.content, t),
        F(e, t),
        e.content.removeAttribute(`data-starting-style`),
        e.content.removeAttribute(`data-ending-style`));
      let n = T(e);
      t
        ? (k(e),
          n === `css-animation`
            ? E(e, () => {
                y(e, { resetVarsToAuto: !0 });
              })
            : y(e),
          N(e, n))
        : A(e);
    },
    L = (e) => {
      let t = j.has(e.value),
        n = e.trigger.getAttribute(`aria-expanded`) === `true`;
      (P(e), Z(e.trigger, `expanded`, t), qc(e.el, t), qc(e.content, t), F(e, t));
      let r = T(e);
      if (t) {
        if ((C(e), k(e), n && !e.presence.isExiting && b(e))) return;
        (r === `css-animation`
          ? E(e, () => {
              (y(e, { resetVarsToAuto: !0 }), n || e.presence.enter());
            })
          : (y(e), n || e.presence.enter()),
          N(e, r));
        return;
      }
      if (n) {
        (S(e),
          r === `css-animation`
            ? E(e, () => {
                (y(e, { resetVarsToAuto: !0 }), e.presence.exit());
              })
            : (y(e), e.presence.exit(), ee(e)));
        return;
      }
      (w(e),
        e.content.removeAttribute(`data-starting-style`),
        e.content.removeAttribute(`data-ending-style`),
        A(e));
    },
    te = (e) => {
      let t = [],
        n = new Set();
      for (let r of e)
        if (
          !(n.has(r) || !i.some((e) => e.dataset.value === r)) &&
          (n.add(r), t.push(r), !o && t.length === 1)
        )
          break;
      return t;
    },
    R = (e) => e.size !== j.size || [...e].some((e) => !j.has(e)),
    z = () => {
      m.forEach(L);
    },
    B = () => {
      let t = [...j];
      (Ys(e, `accordion:change`, { value: t }), s?.(t));
    },
    V = (e) => {
      let t = te(e);
      if (!o && !f && t.length === 0 && j.size > 0) return !1;
      let n = new Set(t);
      return R(n)
        ? (m.forEach((e) => {
            j.has(e.value) !== n.has(e.value) && O(e);
          }),
          (j = n),
          z(),
          B(),
          !0)
        : !1;
    },
    ne = (t) =>
      (t.getAttribute(`dir`) ?? r.getAttribute(`dir`)) === `rtl` ||
      (getComputedStyle(t).direction ||
        getComputedStyle(r).direction ||
        e.ownerDocument?.documentElement.getAttribute(`dir`) ||
        ``) === `rtl`
        ? `rtl`
        : `ltr`;
  (r.setAttribute(`data-orientation`, l),
    Kc(r, `data-disabled`, !!c),
    i.forEach((e, t) => {
      let n = e.dataset.value;
      if (!n) return;
      let r = Y(e, `accordion-trigger`),
        i = Y(e, `accordion-content`);
      if (!r || !i) return;
      let s = qs(i, `accordion-content`),
        l = qs(r, `accordion-trigger`);
      (r.setAttribute(`aria-controls`, s),
        i.setAttribute(`aria-labelledby`, l),
        i.setAttribute(`role`, `region`));
      let u = !!c || Gc(e) || Gc(r),
        f;
      ((f = {
        el: e,
        value: n,
        index: t,
        disabled: u,
        trigger: r,
        content: i,
        presence: zc({
          element: i,
          onExitComplete: () => {
            (C(f), A(f));
          },
        }),
        sizeObserver: null,
        idleAnimationName: null,
        idleAnimationSuppressed: !1,
        openSettleRafId: null,
        openSettleTimeoutId: null,
        closeZeroRafId: null,
        openSettleCleanups: [],
        suppressClick: !1,
        suppressClickTimeoutId: null,
      }),
        typeof ResizeObserver < `u` &&
          ((f.sizeObserver = new ResizeObserver(() => {
            !j.has(f.value) || f.presence.isExiting || b(f) || y(f);
          })),
          f.sizeObserver.observe(i)),
        p.push(
          Q(r, `click`, () => {
            if (f.suppressClick) {
              x(f);
              return;
            }
            f.disabled ||
              (j.has(f.value)
                ? V([...j].filter((e) => e !== f.value))
                : V(o ? [...j, f.value] : [f.value]));
          }),
        ),
        p.push(
          Q(r, `keydown`, (e) => {
            if (Wc.has(e.key)) {
              if (f.disabled) {
                e.preventDefault();
                return;
              }
              (e.preventDefault(),
                x(f),
                (f.suppressClick = !0),
                (f.suppressClickTimeoutId = a.setTimeout(() => {
                  ((f.suppressClick = !1), (f.suppressClickTimeoutId = null));
                }, 0)),
                j.has(f.value)
                  ? V([...j].filter((e) => e !== f.value))
                  : V(o ? [...j, f.value] : [f.value]));
            }
          }),
        ),
        d &&
          p.push(
            Q(i, `beforematch`, () => {
              V(o ? [...j, f.value] : [f.value]);
            }),
          ),
        m.push(f));
    }));
  let H = new Set(m.map((e) => e.value)),
    re = t.defaultValue ?? el(Fs(e, `defaultValue`)),
    ie = te((re ? (Array.isArray(re) ? re : [re]) : []).filter((e) => H.has(e)));
  ((j = new Set(ie)),
    m.forEach(I),
    p.push(
      Q(r, `keydown`, (e) => {
        let t = e.target;
        if (!t) return;
        let n = m.find((e) => e.trigger === t);
        if (!n) return;
        let r = m.filter((e) => !e.disabled),
          i = r.findIndex((e) => e.trigger === t);
        if (i === -1) return;
        let a = r.length - 1,
          o = -1,
          s = () => {
            o = u ? (i + 1 > a ? 0 : i + 1) : Math.min(i + 1, a);
          },
          c = () => {
            o = u ? (i === 0 ? a : i - 1) : Math.max(i - 1, 0);
          };
        switch (e.key) {
          case `ArrowDown`:
            l === `vertical` && s();
            break;
          case `ArrowUp`:
            l === `vertical` && c();
            break;
          case `ArrowRight`:
            l === `horizontal` && (ne(n.trigger) === `rtl` ? c() : s());
            break;
          case `ArrowLeft`:
            l === `horizontal` && (ne(n.trigger) === `rtl` ? s() : c());
            break;
          case `Home`:
            o = 0;
            break;
          case `End`:
            o = a;
            break;
          default:
            return;
        }
        o < 0 || (e.preventDefault(), r[o]?.trigger.focus());
      }),
    ),
    p.push(
      Q(e, `accordion:set`, (e) => {
        let t = e.detail?.value;
        t !== void 0 && V(Array.isArray(t) ? t : [t]);
      }),
    ));
  let ae = {
    expand: (e) => {
      !H.has(e) || j.has(e) || V(o ? [...j, e] : [e]);
    },
    collapse: (e) => {
      !H.has(e) || !j.has(e) || V([...j].filter((t) => t !== e));
    },
    toggle: (e) => {
      H.has(e) && (j.has(e) ? ae.collapse(e) : ae.expand(e));
    },
    get value() {
      return [...j];
    },
    destroy: () => {
      (m.forEach((e) => {
        (x(e), e.presence.cleanup(), w(e), e.sizeObserver?.disconnect(), (e.sizeObserver = null));
      }),
        p.forEach((e) => e()),
        (p.length = 0),
        ws(e, tl, ae));
    },
  };
  return (Cs(e, tl, ae), ae);
}
function il(e = document) {
  let t = [];
  for (let n of gs(e, `accordion`)) Ss(n, tl) || t.push(rl(n));
  return t;
}
var al = ms({ create: () => yl, createCheckbox: () => vl }),
  ol = `@areia/slots:Checkbox`,
  sl = `[@areia/slots:Checkbox] createCheckbox() called more than once for the same root. Returning the existing controller. Destroy it before rebinding with new options.`,
  cl = [
    `position:absolute`,
    `width:1px`,
    `height:1px`,
    `padding:0`,
    `margin:-1px`,
    `overflow:hidden`,
    `clip:rect(0, 0, 0, 0)`,
    `white-space:nowrap`,
    `border:0`,
    `pointer-events:none`,
  ].join(`;`);
function ll(e, t, n) {
  n ? e.setAttribute(t, ``) : e.removeAttribute(t);
}
function ul(e, t, n) {
  (ll(e, `data-checked`, t), ll(e, `data-unchecked`, !t && !n), ll(e, `data-indeterminate`, n));
}
function dl(e, t, n, r) {
  (ll(e, `data-disabled`, t), ll(e, `data-readonly`, n), ll(e, `data-required`, r));
}
function fl(e, t) {
  let n = new Set();
  if (e) for (let t of e.split(/\s+/)) t && n.add(t);
  for (let e of t) e && n.add(e);
  return n.size > 0 ? [...n].join(` `) : null;
}
function pl(e, t) {
  let n = e.parentNode;
  if (!n) {
    e.appendChild(t);
    return;
  }
  n.insertBefore(t, e.nextSibling);
}
function ml(e) {
  return e.tagName === `BUTTON`;
}
function hl(e) {
  let t = e.tagName;
  return (
    t === `BUTTON` ||
    t === `INPUT` ||
    t === `SELECT` ||
    t === `TEXTAREA` ||
    (t === `A` && e.hasAttribute(`href`))
  );
}
function gl(e, t) {
  let n = [],
    r = e.closest(`label`);
  r instanceof HTMLLabelElement && n.push(r);
  let i = t?.id || e.id;
  if (!i) return n;
  let a = e.ownerDocument ?? document,
    o = `label[for="${CSS.escape(i)}"]`;
  for (let e of a.querySelectorAll(o)) n.includes(e) || n.push(e);
  return n;
}
function _l(e) {
  return (
    e.querySelector(`:scope > input[type="checkbox"][data-slot="checkbox-input"]`) ||
    e.querySelector(`:scope > input[type="checkbox"]`)
  );
}
function vl(e, t = {}) {
  let n = Es(e, ol, sl);
  if (n) return n;
  let r = e,
    i = _l(r),
    a =
      t.disabled ??
      X(r, `disabled`) ??
      i?.disabled ??
      (r.hasAttribute(`disabled`) || r.getAttribute(`aria-disabled`) === `true`),
    o = t.readOnly ?? X(r, `readOnly`) ?? r.getAttribute(`aria-readonly`) === `true`,
    s = t.required ?? X(r, `required`) ?? i?.required ?? r.getAttribute(`aria-required`) === `true`,
    c =
      t.defaultChecked ??
      X(r, `defaultChecked`) ??
      i?.checked ??
      r.getAttribute(`aria-checked`) === `true`,
    l = t.indeterminate ?? X(r, `indeterminate`) ?? r.getAttribute(`aria-checked`) === `mixed`,
    u = t.name ?? Fs(r, `name`) ?? i?.name,
    d = t.form ?? Fs(r, `form`) ?? i?.getAttribute(`form`) ?? void 0,
    f = t.value ?? Fs(r, `value`) ?? i?.value,
    p = t.uncheckedValue ?? Fs(r, `uncheckedValue`),
    m = t.onCheckedChange,
    h = [],
    g = e.ownerDocument ?? document,
    _ = i ?? g.createElement(`input`);
  i
    ? _.hasAttribute(`data-checkbox-generated`) ||
      _.setAttribute(`data-checkbox-generated`, `input`)
    : ((_.type = `checkbox`),
      (_.tabIndex = -1),
      _.setAttribute(`aria-hidden`, `true`),
      _.setAttribute(`data-checkbox-generated`, `input`),
      (_.style.cssText = cl),
      pl(r, _));
  let v = null,
    y = !!c,
    b = !!l;
  _.defaultChecked = y;
  let x = () => hs(r, `checkbox-indicator`),
    S = () => {
      if (
        ((_.checked = y),
        (_.indeterminate = b),
        (_.disabled = a),
        (_.required = s),
        d ? _.setAttribute(`form`, d) : _.removeAttribute(`form`),
        u ? (_.name = u) : _.removeAttribute(`name`),
        f === void 0 ? _.removeAttribute(`value`) : (_.value = f),
        !(!a && !y && u !== void 0 && p !== void 0))
      ) {
        (v?.remove(), (v = null));
        return;
      }
      (v ||
        ((v = g.createElement(`input`)),
        (v.type = `hidden`),
        v.setAttribute(`data-checkbox-generated`, `unchecked`),
        pl(_, v)),
        (v.name = u),
        (v.value = p),
        (v.disabled = a),
        d ? v.setAttribute(`form`, d) : v.removeAttribute(`form`));
    },
    C = () => {
      (ml(r)
        ? (r.hasAttribute(`type`) || r.setAttribute(`type`, `button`), (r.disabled = a))
        : hl(r) || (a ? (r.tabIndex = -1) : r.hasAttribute(`tabindex`) || (r.tabIndex = 0)),
        r.setAttribute(`role`, `checkbox`),
        Z(r, `checked`, b ? `mixed` : y),
        Z(r, `disabled`, a ? !0 : null),
        Z(r, `readonly`, o ? !0 : null),
        Z(r, `required`, s ? !0 : null),
        ul(r, y, b),
        dl(r, a, o, s));
      for (let e of x())
        (!(y || b) && !e.hasAttribute(`data-keep-mounted`) ? (e.hidden = !0) : (e.hidden = !1),
          ul(e, y, b),
          dl(e, a, o, s));
    },
    w = (e, t = !1, n = !0) => {
      let i = !!e,
        a = !!t;
      if (y === i && b === a) {
        (S(), C());
        return;
      }
      let o = y !== i;
      ((y = i),
        (b = a),
        S(),
        C(),
        !(!n || !o) && (Ys(r, `checkbox:change`, { checked: y }), m?.(y)));
    },
    T = () => {
      a || o || ((b = !1), _.click());
    },
    E = gl(r, i);
  if (E.length > 0) {
    let e = E.map((e) => qs(e, `checkbox-label`)),
      t = fl(r.getAttribute(`aria-labelledby`), e);
    t && r.setAttribute(`aria-labelledby`, t);
  }
  (S(), C());
  let D = _.form ?? (r.closest(`form`) instanceof HTMLFormElement ? r.closest(`form`) : null);
  (D &&
    h.push(
      Q(D, `reset`, () => {
        queueMicrotask(() => {
          w(_.checked, _.indeterminate, !1);
        });
      }),
    ),
    h.push(
      Q(_, `click`, (e) => {
        (a || o) && e.preventDefault();
      }),
    ),
    h.push(
      Q(_, `change`, () => {
        w(_.checked, !1);
      }),
    ),
    h.push(
      Q(r, `click`, (e) => {
        if (e.target !== _ && e.target !== v) {
          if (a || o) {
            e.preventDefault();
            return;
          }
          (e.preventDefault(), T());
        }
      }),
    ),
    h.push(
      Q(r, `keydown`, (e) => {
        let t = e;
        if (!t.repeat) {
          if (t.key === `Enter`) {
            t.preventDefault();
            return;
          }
          (t.key === ` ` || t.key === `Spacebar`) && (t.preventDefault(), T());
        }
      }),
    ));
  for (let e of E)
    e.contains(r) ||
      h.push(
        Q(e, `click`, (e) => {
          (e.preventDefault(), T());
        }),
      );
  h.push(
    Q(r, `checkbox:set`, (e) => {
      let t = e.detail,
        n =
          typeof t == `boolean`
            ? t
            : typeof t?.checked == `boolean`
              ? t.checked
              : typeof t?.value == `boolean`
                ? t.value
                : void 0,
        r = typeof t?.indeterminate == `boolean` && t.indeterminate;
      typeof n == `boolean`
        ? w(n, r)
        : typeof t?.indeterminate == `boolean` && w(y, t.indeterminate, !1);
    }),
  );
  let O = {
    get checked() {
      return y;
    },
    get indeterminate() {
      return b;
    },
    toggle: () => w(!y, !1),
    check: () => w(!0, !1),
    uncheck: () => w(!1, !1),
    setChecked: (e, t = !1) => w(!!e, !!t),
    setIndeterminate: (e) => w(y, !!e, !1),
    destroy: () => {
      (h.forEach((e) => e()), (h.length = 0), i || _.remove(), v?.remove(), ws(r, ol, O));
    },
  };
  return (Cs(r, ol, O), O);
}
function yl(e = document) {
  let t = [];
  for (let n of gs(e, `checkbox`)) Ss(n, ol) || t.push(vl(n));
  return t;
}
var bl = ms({ create: () => Dl, createCollapsible: () => El }),
  xl = `@areia/slots:Collapsible`,
  Sl = `[@areia/slots:Collapsible] createCollapsible() called more than once for the same root. Returning the existing controller. Destroy it before rebinding with new options.`,
  Cl = (e) => {
    let t = e.trim();
    return t
      ? t.endsWith(`ms`)
        ? Number.parseFloat(t.slice(0, -2)) || 0
        : t.endsWith(`s`)
          ? (Number.parseFloat(t.slice(0, -1)) || 0) * 1e3
          : Number.parseFloat(t) || 0
      : 0;
  },
  wl = (e, t) => {
    let n = e.split(`,`),
      r = t.split(`,`),
      i = Math.max(n.length, r.length),
      a = 0;
    for (let e = 0; e < i; e += 1) {
      let t = Cl(n[e] ?? n[n.length - 1] ?? `0`),
        i = Cl(r[e] ?? r[r.length - 1] ?? `0`);
      a = Math.max(a, t + i);
    }
    return a;
  },
  Tl = (e) => {
    let t = getComputedStyle(e),
      n = wl(t.transitionDuration, t.transitionDelay),
      r = wl(t.animationDuration, t.animationDelay);
    return Math.max(n, r);
  };
function El(e, t = {}) {
  let n = Es(e, xl, Sl);
  if (n) return n;
  let r = t.defaultOpen ?? X(e, `defaultOpen`) ?? !1,
    i = t.hiddenUntilFound ?? X(e, `hiddenUntilFound`) ?? !1,
    a = t.onOpenChange,
    o = Y(e, `collapsible-trigger`),
    s = Y(e, `collapsible-content`);
  if (!o || !s) throw Error(`Collapsible requires trigger and content slots`);
  let c = e.ownerDocument?.defaultView ?? window,
    l = r,
    u = [],
    d = null,
    f = null,
    p = null,
    m = null,
    h = [],
    g = qs(s, `collapsible-content`),
    _ = qs(o, `collapsible-trigger`);
  (o.setAttribute(`aria-controls`, g),
    s.setAttribute(`role`, `region`),
    s.setAttribute(`aria-labelledby`, _));
  let v = (t) => {
      (e.setAttribute(`data-state`, t), s.setAttribute(`data-state`, t));
    },
    y = (e, t) => {
      (s.style.setProperty(`--collapsible-panel-height`, e),
        s.style.setProperty(`--collapsible-panel-width`, t));
    },
    b = (e, t) => {
      y(`${e}px`, `${t}px`);
    },
    x = () => {
      y(`auto`, `auto`);
    },
    S = () => {
      b(0, 0);
    },
    C = () => {
      b(s.scrollHeight, s.scrollWidth);
    },
    w = () => {
      let e = s.style.getPropertyValue(`--collapsible-panel-height`).trim(),
        t = s.style.getPropertyValue(`--collapsible-panel-width`).trim();
      return e === `auto` && t === `auto`;
    },
    T = () => {
      (f !== null && (c.cancelAnimationFrame(f), (f = null)),
        p !== null && (c.clearTimeout(p), (p = null)),
        h.forEach((e) => e()),
        (h = []));
    },
    E = () => {
      m !== null && (c.cancelAnimationFrame(m), (m = null));
    },
    D = () => {
      (T(), E());
    },
    O = () => {
      s.removeAttribute(`hidden`);
    },
    k = () => {
      (i ? s.setAttribute(`hidden`, `until-found`) : (s.hidden = !0), S());
    },
    A = () => {
      (T(), !(!l || N.isExiting) && x());
    },
    j = () => {
      T();
      let e = Tl(s);
      if (e > 0) {
        let t = (e) => {
          e.target === s && A();
        };
        (s.addEventListener(`transitionend`, t),
          s.addEventListener(`animationend`, t),
          h.push(() => s.removeEventListener(`transitionend`, t)),
          h.push(() => s.removeEventListener(`animationend`, t)),
          (p = c.setTimeout(
            () => {
              ((p = null), A());
            },
            Math.ceil(e) + 50,
          )));
        return;
      }
      f = c.requestAnimationFrame(() => {
        ((f = null), A());
      });
    },
    M = () => {
      (E(),
        (m = c.requestAnimationFrame(() => {
          ((m = null), !l && N.isExiting && S());
        })));
    },
    N = zc({
      element: s,
      onExitComplete: () => {
        (E(), k());
      },
    }),
    ee = (t) => {
      l !== t &&
        ((l = t),
        Z(o, `expanded`, l),
        v(l ? `open` : `closed`),
        l ? (E(), O(), C(), N.enter(), j()) : (T(), C(), N.exit(), M()),
        Ys(e, `collapsible:change`, { open: l }),
        a?.(l));
    };
  (Z(o, `expanded`, l),
    l ? (O(), C(), j()) : k(),
    v(l ? `open` : `closed`),
    typeof ResizeObserver < `u` &&
      ((d = new ResizeObserver(() => {
        !l || N.isExiting || w() || C();
      })),
      d.observe(s)),
    u.push(
      Q(o, `click`, () => {
        o.hasAttribute(`disabled`) || o.getAttribute(`aria-disabled`) === `true` || ee(!l);
      }),
    ),
    i &&
      u.push(
        Q(s, `beforematch`, () => {
          l || ee(!0);
        }),
      ),
    u.push(
      Q(e, `collapsible:set`, (e) => {
        if (o.hasAttribute(`disabled`) || o.getAttribute(`aria-disabled`) === `true`) return;
        let t = e.detail,
          n;
        (t?.open === void 0 ? t?.value !== void 0 && (n = t.value) : (n = t.open),
          typeof n == `boolean` && ee(n));
      }),
    ));
  let P = {
    open: () => ee(!0),
    close: () => ee(!1),
    toggle: () => ee(!l),
    get isOpen() {
      return l;
    },
    destroy: () => {
      (N.cleanup(),
        D(),
        d?.disconnect(),
        (d = null),
        u.forEach((e) => e()),
        (u.length = 0),
        ws(e, xl, P));
    },
  };
  return (Cs(e, xl, P), P);
}
function Dl(e = document) {
  let t = [];
  for (let n of gs(e, `collapsible`)) Ss(n, xl) || t.push(El(n));
  return t;
}
var Ol = ms({ create: () => Fl, createCombobox: () => Pl }),
  kl = [`top`, `bottom`],
  Al = [`start`, `center`, `end`],
  jl = (e) => {
    if (e === void 0) return;
    let t = e.trim();
    if (!t.startsWith(`[`) || !t.endsWith(`]`)) return e;
    try {
      let n = JSON.parse(t);
      return Array.isArray(n) ? n.filter((e) => typeof e == `string`) : e;
    } catch {
      return e;
    }
  },
  Ml = `@areia/slots:Combobox`,
  Nl = `[@areia/slots:Combobox] createCombobox() called more than once for the same root. Returning the existing controller. Destroy it before rebinding with new options.`;
function Pl(e, t = {}) {
  let n = Es(e, Ml, Nl);
  if (n) return n;
  let r = Y(e, `combobox-input`),
    i = Y(e, `combobox-content`),
    a = Y(e, `combobox-list`) ?? Y(i ?? e, `combobox-list`),
    o = Y(e, `combobox-trigger`),
    s = Y(e, `combobox-clear`),
    c = Y(e, `combobox-value`),
    l = Y(a ?? i ?? e, `combobox-empty`),
    u = Y(e, `combobox-positioner`),
    d = u && i && u.contains(i) ? u : null,
    f = Y(e, `combobox-portal`),
    p = f && d && f.contains(d) ? f : null;
  if (!r || !i) throw Error(`Combobox requires combobox-input and combobox-content slots`);
  let m = i.contains(r),
    h = c?.textContent?.trim() ?? ``,
    g = t.multiple ?? X(e, `multiple`) ?? !1,
    _ = t.defaultValue ?? jl(Fs(e, `defaultValue`)),
    v = (_ == null ? [] : Array.isArray(_) ? _ : [_]).filter((e, t, n) => n.indexOf(e) === t);
  !g && v.length > 1 && (v.length = 1);
  let y = t.defaultOpen ?? X(e, `defaultOpen`) ?? !1,
    b = t.placeholder ?? Fs(e, `placeholder`) ?? ``,
    x = t.disabled ?? X(e, `disabled`) ?? !1,
    S = t.required ?? X(e, `required`) ?? !1,
    C = t.name ?? Fs(e, `name`) ?? null,
    w = t.openOnFocus ?? X(e, `openOnFocus`) ?? !0,
    T = t.autoHighlight ?? X(e, `autoHighlight`) ?? !1,
    E = t.filter ?? null,
    D = t.onValueChange,
    O = t.onOpenChange,
    k = t.onPortalMounted,
    A = t.onInputValueChange,
    j = t.itemToStringValue ?? null,
    M = (t, n) => Is(i, t, n) ?? (d ? Is(d, t, n) : void 0) ?? Is(e, t, n),
    N = (t) => Ps(i, t) ?? (d ? Ps(d, t) : void 0) ?? Ps(e, t),
    ee = (t) => X(i, t) ?? (d ? X(d, t) : void 0) ?? X(e, t),
    P = t.side ?? M(`side`, kl) ?? `bottom`,
    F = t.align ?? M(`align`, Al) ?? `start`,
    I = t.sideOffset ?? N(`sideOffset`) ?? 4,
    L = t.alignOffset ?? N(`alignOffset`) ?? 0,
    te = t.avoidCollisions ?? ee(`avoidCollisions`) ?? !0,
    R = t.collisionPadding ?? N(`collisionPadding`) ?? 8,
    z = !1,
    B = v,
    V = -1,
    ne = !1,
    H = null,
    re = [],
    ie = e.ownerDocument ?? document,
    ae = ie.defaultView ?? window,
    oe = e,
    se = -1 / 0,
    ce = !1,
    le = !1,
    ue = [],
    de = [],
    fe = [],
    pe = new Map(),
    me = [],
    he = Fc({
      content: i,
      root: e,
      wrapperSlot: d ? void 0 : `combobox-positioner`,
      container: d ?? void 0,
      mountTarget: d ? (p ?? d) : void 0,
    }),
    ge = !1,
    _e = (e) => typeof ae.matchMedia == `function` && ae.matchMedia(e).matches,
    ve = (() => {
      let e = typeof ae.navigator.maxTouchPoints == `number` ? ae.navigator.maxTouchPoints : 0,
        t = _e(`(pointer: coarse)`),
        n = _e(`(hover: none)`);
      return t || (e > 0 && n);
    })(),
    ye = (e) =>
      e.hasAttribute(`disabled`) ||
      e.hasAttribute(`data-disabled`) ||
      e.getAttribute(`aria-disabled`) === `true`,
    be = (e) => {
      if (e.dataset.label) return e.dataset.label;
      let t = ``;
      for (let n of e.childNodes) n.nodeType === Node.TEXT_NODE && (t += n.textContent);
      return t.trim() || (e.textContent?.trim() ?? ``);
    },
    xe = (e) => (e.hasAttribute(`data-value`) ? e.getAttribute(`data-value`) : void 0),
    Se = (e) =>
      e === null ? null : (hs(a ?? i, `combobox-item`).find((t) => xe(t) === e) ?? null),
    Ce = (e) => {
      let t = Se(e);
      return j ? j(t, e) : t ? be(t) : ``;
    },
    we = (e) => e != null && B.includes(e),
    Te = g ? Y(e, `combobox-chips`) : null,
    Ee = g ? e.querySelector(`template[data-slot="combobox-chip-template"]`) : null,
    De = (e, t) => {
      let n = Ee?.content.firstElementChild,
        r;
      if (n instanceof HTMLElement) r = n.cloneNode(!0);
      else {
        ((r = ie.createElement(`span`)),
          r.appendChild(ie.createElement(`span`)).setAttribute(`data-slot`, `combobox-chip-label`));
        let e = r.appendChild(ie.createElement(`button`));
        (e.setAttribute(`data-slot`, `combobox-chip-remove`), (e.textContent = `×`));
      }
      (r.setAttribute(`data-slot`, `combobox-chip`), r.setAttribute(`data-value`, e));
      let i = r.querySelector(`[data-slot="combobox-chip-label"]`);
      i ? (i.textContent = t) : r.prepend(t);
      let a = r.querySelector(`[data-slot="combobox-chip-remove"]`);
      return (
        a &&
          (a.hasAttribute(`type`) || a.setAttribute(`type`, `button`),
          a.hasAttribute(`tabindex`) || (a.tabIndex = -1),
          a.hasAttribute(`aria-label`) || a.setAttribute(`aria-label`, `Remove ${t}`),
          x && a.setAttribute(`data-disabled`, ``)),
        r
      );
    },
    Oe = () => {
      if (Te) {
        Te.textContent = ``;
        for (let e of B) Te.appendChild(De(e, Ce(e) || e));
      }
    },
    ke = () =>
      B.length === 0
        ? ``
        : B.map((e) => Ce(e))
            .filter(Boolean)
            .join(`, `),
    Ae = qs(r, `combobox-input`),
    je = a ?? i,
    Me = qs(je, `combobox-list`);
  (r.setAttribute(`role`, `combobox`),
    r.setAttribute(`aria-autocomplete`, `list`),
    r.setAttribute(`autocomplete`, `off`),
    r.setAttribute(`aria-controls`, Me),
    a ? a.setAttribute(`role`, `listbox`) : i.setAttribute(`role`, `listbox`),
    o &&
      (o.hasAttribute(`type`) || o.setAttribute(`type`, `button`),
      o.hasAttribute(`tabindex`) || (o.tabIndex = -1),
      o.setAttribute(`aria-label`, `Toggle`)),
    s instanceof HTMLButtonElement && !s.hasAttribute(`type`) && s.setAttribute(`type`, `button`),
    s && !s.hasAttribute(`tabindex`) && (s.tabIndex = -1));
  let Ne = document.querySelector(`label[for="${CSS.escape(Ae)}"]`);
  if (Ne) {
    let e = qs(Ne, `combobox-label`),
      t = r.getAttribute(`aria-labelledby`);
    (r.setAttribute(`aria-labelledby`, t ? `${t} ${e}` : e), je.setAttribute(`aria-labelledby`, e));
  }
  (x &&
    (r.setAttribute(`aria-disabled`, `true`),
    (r.disabled = !0),
    o && (o.setAttribute(`aria-disabled`, `true`), o.setAttribute(`data-disabled`, ``))),
    S && (r.setAttribute(`aria-required`, `true`), (r.required = !0)));
  let Pe = () => {
    S && r.setCustomValidity(B.length === 0 ? `Please select a value` : ``);
  };
  (b && (r.placeholder = b),
    c &&
      ((c.textContent = h || b),
      c.textContent.trim().length > 0 &&
        (c.setAttribute(`data-placeholder`, ``), o?.setAttribute(`data-placeholder`, ``))));
  let Fe = () => {
    if (!C) return;
    let t = g ? B : [B[0] ?? ``];
    for (; me.length > t.length; ) me.pop()?.remove();
    for (; me.length < t.length; ) {
      let t = document.createElement(`input`);
      ((t.type = `hidden`), (t.name = C), e.appendChild(t), me.push(t));
    }
    t.forEach((e, t) => {
      me[t].value = e;
    });
  };
  (C && r.name && r.removeAttribute(`name`), Fe());
  let Ie = E ?? ((e, t, n) => n.toLowerCase().includes(e.toLowerCase())),
    Le = (e, t) => {
      (Z(e, `selected`, t),
        t ? e.setAttribute(`data-selected`, ``) : e.removeAttribute(`data-selected`));
      let n = hs(e, `combobox-item-indicator`);
      for (let e of n) e.hidden = !t;
    },
    Re = () => {
      let e = a ?? i;
      ue = hs(e, `combobox-item`);
      for (let e of ue)
        (e.setAttribute(`role`, `option`),
          qs(e, `combobox-item`),
          ye(e) ? e.setAttribute(`aria-disabled`, `true`) : e.removeAttribute(`aria-disabled`),
          Le(e, we(xe(e))));
      let t = hs(e, `combobox-group`);
      for (let e of t) {
        e.setAttribute(`role`, `group`);
        let t = Y(e, `combobox-label`);
        if (t) {
          let n = qs(t, `combobox-label`);
          e.setAttribute(`aria-labelledby`, n);
        }
      }
      ze();
    },
    ze = () => {
      ((de = ue.filter((e) => !e.hidden)),
        (fe = de.filter((e) => !ye(e))),
        (pe = new Map(fe.map((e, t) => [e, t]))));
    },
    Be = (e) => {
      let t = hs(e, `combobox-separator`);
      for (let e of t) e.hidden = !0;
      let n = Array.from(e.children).filter((e) => e instanceof HTMLElement);
      for (let e = 0; e < n.length; e++) {
        let t = n[e];
        if (t.dataset.slot === `combobox-separator` || t.hidden) continue;
        let r = e + 1,
          i = null;
        for (; r < n.length; ) {
          let e = n[r];
          if (e.dataset.slot === `combobox-separator`) {
            ((i ??= e), (r += 1));
            continue;
          }
          if (e.hidden) {
            r += 1;
            continue;
          }
          i && (i.hidden = !1);
          break;
        }
      }
    },
    Ve = (e) => {
      let t = a ?? i,
        n = e.trim(),
        r = 0;
      for (let e of ue) {
        let t = xe(e) ?? ``,
          i = be(e),
          a = n === `` || Ie(n, t, i);
        ((e.hidden = !a), a && r++);
      }
      let o = hs(t, `combobox-group`);
      for (let e of o) e.hidden = !hs(e, `combobox-item`).some((e) => !e.hidden);
      (Be(t),
        l && (l.hidden = r > 0),
        r === 0 ? i.setAttribute(`data-empty`, ``) : i.removeAttribute(`data-empty`),
        ze());
    },
    He = (e, t, n) => {
      let r = ae.visualViewport,
        a = r?.offsetTop ?? 0,
        o = r?.width ?? ae.innerWidth,
        s = r?.height ?? ae.innerHeight,
        c = Math.max(0, o - R * 2),
        l = n === `top` ? Math.max(0, t.top - a - R - I) : Math.max(0, a + s - t.bottom - R - I),
        u = ae.devicePixelRatio || 1,
        d = (Math.round((t.x + t.width) * u) - Math.round(t.x * u)) / u,
        f = (Math.round((t.y + t.height) * u) - Math.round(t.y * u)) / u,
        p = (e) => {
          (e.style.setProperty(`--available-width`, `${c}px`),
            e.style.setProperty(`--available-height`, `${l}px`),
            e.style.setProperty(`--anchor-width`, `${d}px`),
            e.style.setProperty(`--anchor-height`, `${f}px`));
        };
      (p(i), e !== i && p(e));
    },
    Ue = () => {
      let e = he.container,
        t = ve ? `bottom` : (H ?? P),
        n = !ve && te,
        r = oe.getBoundingClientRect();
      i.style.minWidth = `${r.width}px`;
      let a = xc({
          anchorRect: r,
          contentRect: cc(i),
          side: t,
          align: F,
          sideOffset: I,
          alignOffset: L,
          avoidCollisions: n,
          collisionPadding: R,
          allowedSides: kl,
        }),
        o = sc({ side: a.side, align: a.align, anchorRect: r, popupX: a.x, popupY: a.y });
      ((e.style.position = `absolute`),
        (e.style.top = `0px`),
        (e.style.left = `0px`),
        (e.style.transform = `translate3d(${a.x + ae.scrollX}px, ${a.y + ae.scrollY}px, 0)`),
        e.style.setProperty(`--transform-origin`, o),
        (e.style.willChange = `transform`),
        (e.style.margin = `0`),
        He(e, r, a.side),
        !ve && n && (H = a.side),
        i.setAttribute(`data-side`, a.side),
        i.setAttribute(`data-align`, a.align),
        e !== i && (e.setAttribute(`data-side`, a.side), e.setAttribute(`data-align`, a.align)));
    },
    We = Oc({
      observedElements: [e, i],
      isActive: () => z,
      ancestorScroll: !0,
      onUpdate: Ue,
      ignoreScrollTarget: (e) => e instanceof Node && i.contains(e),
    }),
    Ge = (e) => (a && a.contains(e) && a.scrollHeight > a.clientHeight ? a : i),
    Ke = (e) => {
      for (let e of ue) e.removeAttribute(`data-highlighted`);
      let t = fe[e];
      if (!t) {
        ((V = -1), r.removeAttribute(`aria-activedescendant`));
        return;
      }
      (t.setAttribute(`data-highlighted`, ``),
        r.setAttribute(`aria-activedescendant`, t.id),
        Sc(t, Ge(t)),
        (V = e));
    },
    qe = () => {
      for (let e of ue) e.removeAttribute(`data-highlighted`);
      ((V = -1), r.removeAttribute(`aria-activedescendant`));
    },
    Je = (t) => {
      (e.setAttribute(`data-state`, t),
        i.setAttribute(`data-state`, t),
        o && o.setAttribute(`data-state`, t),
        t === `open`
          ? (e.setAttribute(`data-open`, ``),
            i.setAttribute(`data-open`, ``),
            o && o.setAttribute(`data-open`, ``),
            e.removeAttribute(`data-closed`),
            i.removeAttribute(`data-closed`),
            o && o.removeAttribute(`data-closed`))
          : (e.setAttribute(`data-closed`, ``),
            i.setAttribute(`data-closed`, ``),
            o && o.setAttribute(`data-closed`, ``),
            e.removeAttribute(`data-open`),
            i.removeAttribute(`data-open`),
            o && o.removeAttribute(`data-open`)));
    },
    Ye = zc({
      element: i,
      onExitComplete: () => {
        ge || (he.restore(), (i.hidden = !0));
      },
    }),
    Xe = (t, n = !1) => {
      if (z !== t && !(x && t)) {
        if (t) {
          ((z = !0),
            (H = null),
            Z(r, `expanded`, !0),
            he.mount(),
            k && requestAnimationFrame(() => k(he.container)),
            (i.hidden = !1),
            Je(`open`),
            Ye.enter(),
            Re(),
            (ne = !1),
            m && (r.value = ``));
          let e = !m && !g ? Ce(B[0] ?? null) : ``,
            t = !m && !g && r.value === e ? `` : r.value;
          Ve(t);
          let n = fe.findIndex((e) => we(xe(e)));
          (n >= 0 ? Ke(n) : qe(),
            We.start(),
            Ue(),
            We.update(),
            requestAnimationFrame(() => {
              z && We.update();
            }));
        } else if (
          ((z = !1),
          (H = null),
          Z(r, `expanded`, !1),
          Je(`closed`),
          qe(),
          (ne = !1),
          We.stop(),
          Ye.exit(),
          m || g)
        )
          r.value = ``;
        else {
          let e = Ce(B[0] ?? null);
          r.value = e;
        }
        (Ys(e, `combobox:open-change`, { open: z }), O?.(z));
      }
    },
    Ze = (e) => {
      let t = e.filter((e, t, n) => n.indexOf(e) === t);
      return g ? t : t.slice(0, 1);
    },
    Qe = (e, t) => e.length === t.length && e.every((e, n) => e === t[n]),
    $e = (t, n = !1) => {
      let s = Ze(t);
      if (Qe(B, s) && !n) return;
      let l = !Qe(B, s);
      ((B = s),
        Pe(),
        Fe(),
        s.length > 0 ? e.setAttribute(`data-value`, s.join(`,`)) : e.removeAttribute(`data-value`));
      let u = a ?? i,
        d = ue.length > 0 ? ue : hs(u, `combobox-item`);
      for (let e of d) Le(e, we(xe(e)));
      (Oe(), g && (r.placeholder = s.length > 0 ? `` : b));
      let f = ke();
      if (
        (!m && !g && (r.value = f),
        !n && s.length === 0 && (ue.length === 0 && Re(), Ve(``)),
        c
          ? s.length === 0
            ? ((c.textContent = h || b),
              (c.textContent ?? ``).trim().length > 0
                ? (c.setAttribute(`data-placeholder`, ``), o?.setAttribute(`data-placeholder`, ``))
                : (c.removeAttribute(`data-placeholder`), o?.removeAttribute(`data-placeholder`)))
            : ((c.textContent = f),
              c.removeAttribute(`data-placeholder`),
              o?.removeAttribute(`data-placeholder`))
          : o &&
            (s.length === 0
              ? o.setAttribute(`data-placeholder`, ``)
              : o.removeAttribute(`data-placeholder`)),
        !n && l)
      ) {
        let t = g ? [...s] : (s[0] ?? null);
        (Ys(e, `combobox:change`, { value: t }), D?.(t));
      }
    },
    et = (e, t = !1) => {
      $e(e == null ? [] : Array.isArray(e) ? e : [e], t);
    },
    tt = (e) => {
      if (ye(e)) return;
      let t = xe(e);
      if (t !== void 0) {
        if (g) {
          if (
            ($e(we(t) ? B.filter((e) => e !== t) : [...B, t]),
            r.value !== `` && ((r.value = ``), z && Ve(``)),
            z)
          ) {
            let t = pe.get(e);
            (t !== void 0 && Ke(t), We.update());
          }
          return;
        }
        (et(t), Xe(!1));
      }
    },
    nt = () => {
      if (
        x ||
        r.readOnly ||
        (s && (s.hasAttribute(`disabled`) || s.getAttribute(`aria-disabled`) === `true`))
      )
        return;
      (et(null), (r.value = ``), qe(), ue.length === 0 && Re(), Ve(``), z && We.update());
      let e = ie.activeElement !== r;
      ((le = e), r.focus(), e || (le = !1));
    },
    rt = (e) => {
      if (!x)
        switch (e.key) {
          case `ArrowDown`: {
            if ((e.preventDefault(), !z)) {
              (Xe(!0), T && fe.length > 0 && Ke(0));
              return;
            }
            ne = !0;
            let t = fe.length;
            if (t === 0) return;
            Ke(V === -1 ? 0 : (V + 1) % t);
            break;
          }
          case `ArrowUp`: {
            if ((e.preventDefault(), !z)) {
              (Xe(!0), T && fe.length > 0 && Ke(fe.length - 1));
              return;
            }
            ne = !0;
            let t = fe.length;
            if (t === 0) return;
            Ke(V === -1 ? t - 1 : (V - 1 + t) % t);
            break;
          }
          case `Home`:
            if (!z) return;
            (e.preventDefault(), (ne = !0), fe.length > 0 && Ke(0));
            break;
          case `End`:
            if (!z) return;
            (e.preventDefault(), (ne = !0), fe.length > 0 && Ke(fe.length - 1));
            break;
          case `Enter`:
            if (!z) return;
            (e.preventDefault(), V >= 0 && V < fe.length && tt(fe[V]));
            break;
          case `Escape`:
            z ? (e.preventDefault(), Xe(!1)) : B.length > 0 && (e.preventDefault(), et(null));
            break;
          case `Backspace`:
            g && r.value === `` && B.length > 0 && $e(B.slice(0, -1));
            break;
          case `Tab`:
            z && Xe(!1, !0);
            break;
        }
    },
    it = () => {
      let t = r.value,
        n = t.trim() !== ``;
      (Ys(e, `combobox:input-change`, { inputValue: t }),
        A?.(t),
        z
          ? (Ve(t), T && n && fe.length > 0 ? Ke(0) : qe(), We.update())
          : (Xe(!0), T && n && fe.length > 0 ? Ke(0) : V !== -1 && qe()));
    },
    at = () => {
      if (x) return;
      if (le) {
        ((le = !1), (ce = !1));
        return;
      }
      ve || r.select();
      let e = ce || Date.now() - se <= 750;
      ((ce = !1), w && !z && e && Xe(!0));
    };
  (Z(r, `expanded`, !1),
    (i.hidden = !0),
    Je(`closed`),
    g && (oe.dataset.multiple = ``),
    $e(B, !0),
    re.push(
      Q(
        ie,
        `keydown`,
        (e) => {
          e.key === `Tab` && (se = Date.now());
        },
        { capture: !0 },
      ),
      Q(r, `pointerdown`, () => {
        ((ce = !0), w && !z && !x && ie.activeElement === r && Xe(!0));
      }),
      Q(r, `input`, it),
      Q(r, `keydown`, rt),
      Q(r, `focus`, at),
    ),
    o &&
      re.push(
        Q(o, `click`, () => {
          x || (z ? Xe(!1) : (Xe(!0), r.focus()));
        }),
      ),
    Te &&
      re.push(
        Q(Te, `mousedown`, (e) => {
          e.preventDefault();
        }),
        Q(Te, `click`, (e) => {
          if (x || r.readOnly) return;
          let t = e.target.closest?.(`[data-slot="combobox-chip-remove"]`);
          if (!t || !Te.contains(t)) return;
          let n = t.closest(`[data-slot="combobox-chip"]`)?.getAttribute(`data-value`);
          n != null && ($e(B.filter((e) => e !== n)), z && We.update());
        }),
      ),
    s &&
      re.push(
        Q(s, `mousedown`, (e) => {
          e.preventDefault();
        }),
        Q(s, `click`, () => {
          nt();
        }),
      ),
    re.push(
      Q(i, `click`, (e) => {
        let t = e.target.closest?.(`[data-slot="combobox-item"]`);
        t && !t.hidden && tt(t);
      }),
      Q(i, `pointermove`, (e) => {
        let t = e.target.closest?.(`[data-slot="combobox-item"]`);
        if (!(ne && ((ne = !1), t && pe.get(t) === V)))
          if (t && !ye(t) && !t.hidden) {
            let e = pe.get(t);
            e !== void 0 && e !== V && Ke(e);
          } else qe();
      }),
      Q(i, `pointerleave`, () => {
        ne || qe();
      }),
      Q(i, `mousedown`, (e) => {
        e.preventDefault();
      }),
    ),
    re.push(
      Pc({
        root: e,
        isOpen: () => z,
        onDismiss: () => Xe(!1),
        closeOnClickOutside: !ve,
        closeOnEscape: !1,
      }),
    ),
    ve &&
      re.push(
        Q(
          ie,
          `click`,
          (t) => {
            if (!z) return;
            let n = t.target;
            Hs(e, n) || Xe(!1);
          },
          { capture: !0 },
        ),
      ),
    re.push(
      Q(e, `combobox:set`, (e) => {
        let t = e.detail;
        (t?.value !== void 0 && et(t.value),
          t?.open !== void 0 && Xe(t.open),
          t?.inputValue !== void 0 && (r.value = t.inputValue),
          t?.itemToStringValue !== void 0 && ((j = t.itemToStringValue), $e(B, !0)));
      }),
    ));
  let ot = {
    get value() {
      return B[0] ?? null;
    },
    get values() {
      return [...B];
    },
    get inputValue() {
      return r.value;
    },
    get isOpen() {
      return z;
    },
    select: (e) => $e(g ? [...B, e] : [e]),
    deselect: (e) => $e(B.filter((t) => t !== e)),
    setValues: (e) => $e(e),
    clear: () => $e([]),
    open: () => Xe(!0),
    close: () => Xe(!1),
    setItemToStringValue: (e) => {
      ((j = e), $e(B, !0));
    },
    destroy: () => {
      ((ge = !0), We.stop(), Ye.cleanup(), he.cleanup(), re.forEach((e) => e()), (re.length = 0));
      for (let e of me) e.remove();
      ((me = []), Te?.replaceChildren(), ws(e, Ml, ot));
    },
  };
  return (Cs(e, Ml, ot), y && Xe(!0), ot);
}
function Fl(e = document) {
  let t = [];
  for (let n of gs(e, `combobox`)) Ss(n, Ml) || t.push(Pl(n));
  return t;
}
[
  `input:not([type="hidden"])`,
  `textarea`,
  `select`,
  `button`,
  `a[href]`,
  `summary`,
  `audio[controls]`,
  `video[controls]`,
  `[contenteditable=""]`,
  `[contenteditable="true"]`,
  `[contenteditable="plaintext-only"]`,
  `[tabindex]:not([tabindex="-1"])`,
].join(`, `);
var Il = ms({ create: () => ql, createContextMenu: () => Kl }),
  Ll = `@areia/slots:ContextMenu`,
  Rl = `[@areia/slots:ContextMenu] createContextMenu() called more than once for the same root. Returning the existing controller. Destroy it before rebinding with new options.`,
  zl = `[data-slot="context-menu-item"], [data-slot="context-menu-radio-item"], [data-slot="context-menu-checkbox-item"]`,
  Bl = 500;
function Vl(e, t, n) {
  n ? e.setAttribute(t, ``) : e.removeAttribute(t);
}
function Hl(e) {
  switch (e.getAttribute(`data-slot`)) {
    case `context-menu-radio-item`:
      return `radio`;
    case `context-menu-checkbox-item`:
      return `checkbox`;
    default:
      return `item`;
  }
}
function Ul(e) {
  return (
    e.hasAttribute(`disabled`) ||
    e.hasAttribute(`data-disabled`) ||
    e.getAttribute(`aria-disabled`) === `true`
  );
}
function Wl(e) {
  return e.dataset.value ?? e.getAttribute(`value`) ?? e.textContent?.trim() ?? null;
}
function Gl(e, t, n = 0) {
  return typeof DOMRect < `u` && `fromRect` in DOMRect
    ? DOMRect.fromRect({ x: e, y: t, width: n, height: n })
    : {
        x: e,
        y: t,
        width: n,
        height: n,
        top: t,
        left: e,
        right: e + n,
        bottom: t + n,
        toJSON: () => ({}),
      };
}
function Kl(e, t = {}) {
  let n = Es(e, Ll, Rl);
  if (n) return n;
  let r = e,
    i = Y(r, `context-menu-trigger`) ?? r,
    a = Y(r, `context-menu-content`);
  if (!a) throw Error(`ContextMenu requires a context-menu-content element`);
  let o = t.closeOnClickOutside ?? X(r, `closeOnClickOutside`) ?? !0,
    s = t.closeOnEscape ?? X(r, `closeOnEscape`) ?? !0,
    c = t.closeOnSelect ?? X(r, `closeOnSelect`) ?? !0,
    l = t.disabled ?? X(r, `disabled`) ?? !1,
    u = t.longPressDelay ?? Ps(r, `longPressDelay`) ?? Bl,
    d = t.sideOffset ?? Ps(r, `sideOffset`) ?? 2,
    f = t.collisionPadding ?? Ps(r, `collisionPadding`) ?? 8,
    p = t.onOpenChange,
    m = t.onPortalMounted,
    h = t.onSelect,
    g = [],
    _ = r.ownerDocument ?? document,
    v = Fc({ content: a, root: r, enabled: !0 }),
    y = !1,
    b = null,
    x = [],
    S = [],
    C = { x: 0, y: 0 },
    w = null,
    T = null,
    E = () => {
      ((x = [...a.querySelectorAll(zl)].map((e) => ({ el: e, type: Hl(e), value: Wl(e) }))),
        (S = x.filter((e) => !Ul(e.el))));
    },
    D = (e) => {
      ((r.dataset.state = e),
        (i.dataset.state = e),
        (a.dataset.state = e),
        Vl(r, `data-open`, e === `open`),
        Vl(r, `data-closed`, e === `closed`),
        Vl(i, `data-open`, e === `open`),
        Vl(i, `data-closed`, e === `closed`),
        Vl(a, `data-open`, e === `open`),
        Vl(a, `data-closed`, e === `closed`));
    },
    O = () => {
      ((a.style.position = `fixed`),
        (a.style.left = `0px`),
        (a.style.top = `0px`),
        (a.style.transform = `translate3d(0px, 0px, 0)`));
      let e = Gl(C.x, C.y),
        t = xc({
          anchorRect: e,
          contentRect: cc(a),
          side: `bottom`,
          align: `start`,
          sideOffset: d,
          alignOffset: 0,
          avoidCollisions: !0,
          collisionPadding: f,
        }),
        n = sc({ side: t.side, align: t.align, anchorRect: e, popupX: t.x, popupY: t.y });
      ((a.style.transform = `translate3d(${t.x}px, ${t.y}px, 0)`),
        (a.style.transformOrigin = n),
        (a.dataset.side = t.side),
        (a.dataset.align = t.align));
    },
    k = () => {
      b &&= (b.removeAttribute(`data-highlighted`), null);
    },
    A = (e, t = !0) => {
      b !== e &&
        (k(), (b = e), e && (e.setAttribute(`data-highlighted`, ``), t && lc(e), Sc(e, a)));
    },
    j = () => {
      E();
      for (let e of x) {
        let t = Ul(e.el);
        if (
          (e.el.setAttribute(`role`, e.type === `item` ? `menuitem` : `menuitem${e.type}`),
          (e.el.tabIndex = -1),
          Z(e.el, `disabled`, t ? !0 : null),
          e.type === `checkbox`)
        ) {
          let t = e.el.hasAttribute(`data-checked`) || e.el.getAttribute(`aria-checked`) === `true`;
          Z(e.el, `checked`, t);
        }
        if (e.type === `radio`) {
          let t = e.el.hasAttribute(`data-checked`) || e.el.getAttribute(`aria-checked`) === `true`;
          Z(e.el, `checked`, t);
        }
      }
    },
    M = (e, t, n, i) => {
      let a = { open: e, previousOpen: t, source: n, reason: i };
      (Ys(r, `context-menu:open-change`, a), Ys(r, `context-menu:change`, a), p?.(e));
    },
    N = (e, t, n) => {
      if (l) return;
      C = e;
      let r = y;
      ((y = !0),
        v.mount(),
        m && requestAnimationFrame(() => m(v.container)),
        (a.hidden = !1),
        Z(i, `expanded`, !0),
        D(`open`),
        j(),
        O(),
        lc(a),
        r || M(!0, r, t, n));
    },
    ee = (e, t) => {
      if (!y) return;
      let n = y;
      ((y = !1),
        k(),
        (a.hidden = !0),
        v.restore(),
        Z(i, `expanded`, !1),
        D(`closed`),
        M(!1, n, e, t));
    },
    P = (e, t) => {
      if (Ul(e.el) || !e.value) return;
      let n = { value: e.value, item: e.el, itemType: e.type, source: t };
      if (e.type === `checkbox`) {
        let t = !(
          e.el.hasAttribute(`data-checked`) || e.el.getAttribute(`aria-checked`) === `true`
        );
        ((n.checked = t),
          Vl(e.el, `data-checked`, t),
          Vl(e.el, `data-unchecked`, !t),
          Z(e.el, `checked`, t));
      }
      (Ys(r, `context-menu:select`, n), h?.(e.value), c && ee(t, `select`));
    },
    F = () => {
      ((T &&= (clearTimeout(T), null)), (w = null));
    },
    I = qs(i, `context-menu-trigger`),
    L = qs(a, `context-menu-content`);
  (i.setAttribute(`aria-haspopup`, `menu`),
    i.setAttribute(`aria-controls`, L),
    Z(i, `expanded`, !1),
    a.setAttribute(`role`, `menu`),
    a.setAttribute(`aria-labelledby`, I),
    (a.tabIndex = -1),
    (a.hidden = !0),
    D(`closed`),
    l && (i.setAttribute(`aria-disabled`, `true`), r.setAttribute(`data-disabled`, ``)),
    (t.defaultOpen ?? X(r, `defaultOpen`) ?? !1) &&
      queueMicrotask(() => N(C, `programmatic`, `programmatic`)),
    g.push(
      Q(i, `contextmenu`, (e) => {
        let t = e;
        l ||
          (t.preventDefault(),
          t.stopPropagation(),
          N({ x: t.clientX, y: t.clientY }, `pointer`, `trigger`));
      }),
      Q(i, `touchstart`, (e) => {
        let t = e;
        if (l || t.touches.length !== 1) return;
        let n = t.touches[0];
        n &&
          ((w = { x: n.clientX, y: n.clientY }),
          (T = setTimeout(() => {
            w && (N(w, `pointer`, `trigger`), F());
          }, u)));
      }),
      Q(i, `touchmove`, (e) => {
        if (!w) return;
        let t = e.touches[0];
        t && (Math.abs(t.clientX - w.x) > 10 || Math.abs(t.clientY - w.y) > 10) && F();
      }),
      Q(i, `touchend`, F),
      Q(i, `touchcancel`, F),
    ),
    g.push(
      Q(a, `keydown`, (e) => {
        let t = e;
        if (t.key === `Tab`) {
          ee(`keyboard`, `tab`);
          return;
        }
        if (t.key === `Escape` && s) {
          (t.preventDefault(), ee(`keyboard`, `escape`));
          return;
        }
        if (S.length === 0) return;
        let n = b ? S.findIndex((e) => e.el === b) : -1;
        switch (t.key) {
          case `ArrowDown`:
            (t.preventDefault(), A(S[(n + 1 + S.length) % S.length]?.el ?? null));
            break;
          case `ArrowUp`:
            (t.preventDefault(), A(S[(n - 1 + S.length) % S.length]?.el ?? null));
            break;
          case `Home`:
            (t.preventDefault(), A(S[0]?.el ?? null));
            break;
          case `End`:
            (t.preventDefault(), A(S[S.length - 1]?.el ?? null));
            break;
          case `Enter`:
          case ` `:
          case `Spacebar`: {
            t.preventDefault();
            let e = S.find((e) => e.el === b);
            e && P(e, `keyboard`);
            break;
          }
        }
      }),
    ),
    g.push(
      Q(a, `pointermove`, (e) => {
        let t = e;
        if (t.pointerType === `touch`) return;
        let n = t.target?.closest(zl);
        !n || !a.contains(n) || Ul(n) || A(n, !0);
      }),
      Q(a, `pointerleave`, () => A(null, !1)),
      Q(a, `click`, (e) => {
        let t = e.target?.closest(zl);
        if (!t || !a.contains(t)) return;
        let n = x.find((e) => e.el === t);
        n && P(n, `pointer`);
      }),
    ),
    g.push(
      Q(_, `pointerdown`, (e) => {
        if (!y || !o) return;
        let t = e.target;
        t && (Hs(r, t) || Hs(a, t) || ee(`pointer`, `outside`));
      }),
      Q(_, `keydown`, (e) => {
        !y || !s || e.key !== `Escape` || ee(`keyboard`, `escape`);
      }),
    ),
    g.push(
      Q(r, `context-menu:set`, (e) => {
        let t = e.detail,
          n = typeof t == `boolean` ? t : t?.open,
          r = typeof t?.x == `number` ? t.x : C.x,
          i = typeof t?.y == `number` ? t.y : C.y;
        (n === !0 && N({ x: r, y: i }, `programmatic`, `programmatic`),
          n === !1 && ee(`programmatic`, `programmatic`));
      }),
    ));
  let te = {
    get isOpen() {
      return y;
    },
    get highlightedValue() {
      return x.find((e) => e.el === b)?.value ?? null;
    },
    open: (e) => N(e ?? C, `programmatic`, `programmatic`),
    close: () => ee(`programmatic`, `programmatic`),
    setOpen: (e, t) => {
      e ? N(t ?? C, `programmatic`, `programmatic`) : ee(`programmatic`, `programmatic`);
    },
    destroy: () => {
      (F(), g.forEach((e) => e()), (g.length = 0), y && v.restore(), ws(r, Ll, te));
    },
  };
  return (Cs(r, Ll, te), te);
}
function ql(e = document) {
  let t = [];
  for (let n of gs(e, `context-menu`)) Ss(n, Ll) || t.push(Kl(n));
  return t;
}
var Jl = ms({ create: () => $l, createDialog: () => Ql }),
  Yl = `@areia/slots:Dialog`,
  Xl = `[@areia/slots:Dialog] createDialog() called more than once for the same root. Returning the existing controller. Destroy it before rebinding with new options.`,
  Zl = `a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])`;
function Ql(e, t = {}) {
  let n = Es(e, Yl, Xl);
  if (n) return n;
  let r = t.defaultOpen ?? X(e, `defaultOpen`) ?? !1,
    i = t.onOpenChange,
    a = t.closeOnClickOutside ?? X(e, `closeOnClickOutside`) ?? !0,
    o = t.closeOnEscape ?? X(e, `closeOnEscape`) ?? !0,
    s = t.lockScroll ?? X(e, `lockScroll`) ?? !0,
    c = t.alertDialog ?? X(e, `alertDialog`) ?? !1,
    l = t.onPortalMounted,
    u = Y(e, `dialog-trigger`),
    d = Y(e, `dialog-portal`),
    f = Y(e, `dialog-overlay`),
    p = Y(e, `dialog-content`),
    m = Y(e, `dialog-title`),
    h = Y(e, `dialog-description`);
  if (!p) throw Error(`Dialog requires dialog-content slot`);
  if (!f) throw Error(`Dialog requires dialog-overlay slot`);
  let g = !1,
    _ = !1,
    v = null,
    y = [],
    b = d ? Fc({ content: d, root: e }) : null,
    x = !1;
  (qs(p, `dialog-content`),
    p.setAttribute(`role`, c ? `alertdialog` : `dialog`),
    Z(p, `modal`, !0),
    Js(p, m, h),
    f.setAttribute(`role`, `presentation`),
    f.setAttribute(`aria-hidden`, `true`),
    (f.tabIndex = -1),
    u &&
      (u.setAttribute(`aria-haspopup`, `dialog`),
      u.setAttribute(`aria-controls`, p.id),
      Z(u, `expanded`, !1)));
  let S = !1,
    C = () => {
      p.hasAttribute(`tabindex`) || ((p.tabIndex = -1), (S = !0));
    },
    w = () => {
      S &&= (p.removeAttribute(`tabindex`), !1);
    },
    T = () => {
      let e = p.querySelector(`[autofocus]`);
      if (e) return e.focus();
      let t = p.querySelector(Zl);
      if (t) return t.focus();
      (C(), p.focus());
    },
    E = () => {
      b?.mount();
    },
    D = () => {
      requestAnimationFrame(() => {
        (v && document.contains(v) && typeof v.focus == `function`
          ? lc(v)
          : u && document.contains(u) && lc(u),
          (v = null));
      });
    },
    O = (t) => {
      if (
        (e.setAttribute(`data-state`, t),
        d && d.setAttribute(`data-state`, t),
        f.setAttribute(`data-state`, t),
        p.setAttribute(`data-state`, t),
        t === `open`)
      ) {
        (e.setAttribute(`data-open`, ``),
          d?.setAttribute(`data-open`, ``),
          f.setAttribute(`data-open`, ``),
          p.setAttribute(`data-open`, ``),
          e.removeAttribute(`data-closed`),
          d?.removeAttribute(`data-closed`),
          f.removeAttribute(`data-closed`),
          p.removeAttribute(`data-closed`));
        return;
      }
      (e.setAttribute(`data-closed`, ``),
        d?.setAttribute(`data-closed`, ``),
        f.setAttribute(`data-closed`, ``),
        p.setAttribute(`data-closed`, ``),
        e.removeAttribute(`data-open`),
        d?.removeAttribute(`data-open`),
        f.removeAttribute(`data-open`),
        p.removeAttribute(`data-open`));
    },
    k = 0,
    A = 0,
    j = 0,
    M = 0,
    N = (e, t) => {
      _ || g || t !== k || ((e.hidden = !0), (A = Math.max(0, A - 1)), A === 0 && (w(), D()));
    },
    ee = zc({ element: f, onExitComplete: () => N(f, j) }),
    P = zc({ element: p, onExitComplete: () => N(p, M) }),
    F = (t, n = !1) => {
      if (!(g === t && !n)) {
        if (t) {
          if (((k += 1), (A = 0), E(), l)) {
            let e = d ?? p;
            requestAnimationFrame(() => l(e));
          }
          ((v = document.activeElement), L.open(), s && !x && ($s(), (x = !0)));
        } else ((k += 1), (A = 2), (j = k), (M = k), L.close(), (x &&= (ec(), !1)));
        ((g = t),
          u && Z(u, `expanded`, g),
          t
            ? ((f.hidden = !1), (p.hidden = !1), O(`open`), ee.enter(), P.enter())
            : (O(`closed`), ee.exit(), P.exit()),
          Ys(e, `dialog:change`, { open: g }),
          i?.(g),
          t && requestAnimationFrame(T));
      }
    },
    I = (e) => {
      if (e.key !== `Tab`) return;
      let t = p.querySelectorAll(Zl);
      if (t.length === 0) {
        (e.preventDefault(), C(), p.focus());
        return;
      }
      let n = t[0],
        r = t[t.length - 1],
        i = document.activeElement;
      if (!p.contains(i)) {
        (e.preventDefault(), n.focus());
        return;
      }
      if (n === r) {
        e.preventDefault();
        return;
      }
      e.shiftKey
        ? i === n && (e.preventDefault(), r.focus())
        : i === r && (e.preventDefault(), n.focus());
    },
    L = gc({ content: p, overlay: f, onTabKeydown: I, cssVarPrefix: `dialog` });
  ((p.hidden = !0),
    (f.hidden = !0),
    O(`closed`),
    u && y.push(Q(u, `click`, () => F(!g))),
    y.push(
      Q(p, `click`, (e) => {
        let t = e.target;
        if (!t) return;
        let n = t.closest?.(`[data-slot="dialog-close"]`);
        n && p.contains(n) && F(!1);
      }),
    ),
    a &&
      y.push(
        Q(f, `click`, (e) => {
          e.button === 0 && e.target === f && g && F(!1);
        }),
      ),
    y.push(
      Pc({
        root: e,
        isOpen: () => g,
        onDismiss: () => F(!1),
        closeOnClickOutside: !1,
        closeOnEscape: o,
      }),
    ));
  let te = {
    open: () => F(!0),
    close: () => F(!1),
    toggle: () => F(!g),
    get isOpen() {
      return g;
    },
    destroy: () => {
      ((_ = !0),
        L.destroy(),
        (k += 1),
        (A = 0),
        ee.cleanup(),
        P.cleanup(),
        (g = !1),
        O(`closed`),
        (f.hidden = !0),
        (p.hidden = !0),
        u && Z(u, `expanded`, !1),
        (x &&= (ec(), !1)),
        w(),
        v !== null && D(),
        y.forEach((e) => e()),
        (y.length = 0),
        b?.cleanup(),
        ws(e, Yl, te));
    },
    _handleKeydown: I,
    _content: p,
    _overlay: f,
  };
  return (
    y.push(
      Q(e, `dialog:set`, (e) => {
        let t = e.detail,
          n;
        (t?.open === void 0 ? t?.value !== void 0 && (n = t.value) : (n = t.open),
          typeof n == `boolean` && F(n));
      }),
    ),
    Cs(e, Yl, te),
    r && F(!0),
    te
  );
}
function $l(e = document) {
  let t = [];
  for (let n of gs(e, `dialog`)) Ss(n, Yl) || t.push(Ql(n));
  return t;
}
var eu = ms({ create: () => gu, createDropdownMenu: () => hu }),
  tu = [`top`, `right`, `bottom`, `left`],
  nu = [`start`, `center`, `end`],
  ru = `@areia/slots:DropdownMenu`,
  iu = `[@areia/slots:DropdownMenu] createDropdownMenu() called more than once for the same root. Returning the existing controller. Destroy it before rebinding with new options.`,
  au = `[data-slot="dropdown-menu-item"], [data-slot="dropdown-menu-radio-item"], [data-slot="dropdown-menu-checkbox-item"]`,
  ou = (e, t) => Object.prototype.hasOwnProperty.call(e, t),
  su = (e, t, n) => {
    n ? e.setAttribute(t, ``) : e.removeAttribute(t);
  },
  cu = (e, t) => {
    if (e.length !== t.length) return !1;
    for (let n = 0; n < e.length; n++) if (e[n] !== t[n]) return !1;
    return !0;
  },
  lu = (e, t, n, r = !1) =>
    e.dispatchEvent(new CustomEvent(t, { bubbles: !0, cancelable: r, detail: n })),
  uu = (e) => {
    switch (e) {
      case `radio`:
        return `menuitemradio`;
      case `checkbox`:
        return `menuitemcheckbox`;
      default:
        return `menuitem`;
    }
  },
  du = (e) => {
    let t = e.getAttribute(`data-slot`);
    return t === `dropdown-menu-radio-item`
      ? `radio`
      : t === `dropdown-menu-checkbox-item`
        ? `checkbox`
        : `item`;
  },
  fu = (e) => {
    let t = e.dataset.value;
    if (t === void 0) return null;
    let n = t.trim();
    return n.length > 0 ? n : null;
  },
  pu = (e) =>
    e.type === `item` ? (e.value ? e.value : (e.el.textContent?.trim() ?? ``)) : (e.value ?? ``),
  mu = (e) => {
    if (e === void 0) return [];
    let t = e.trim();
    if (t.length === 0) return [];
    try {
      let e = JSON.parse(t);
      return Array.isArray(e)
        ? e
            .filter((e) => typeof e == `string`)
            .map((e) => e.trim())
            .filter((e) => e.length > 0)
        : [];
    } catch {
      return [];
    }
  };
function hu(e, t = {}) {
  let n = Es(e, ru, iu);
  if (n) return n;
  let r = Y(e, `dropdown-menu-trigger`),
    i = Y(e, `dropdown-menu-content`),
    a = Y(e, `dropdown-menu-positioner`),
    o = a && i && a.contains(i) ? a : null,
    s = Y(e, `dropdown-menu-portal`),
    c = s && o && s.contains(o) ? s : null;
  if (!r || !i) throw Error(`DropdownMenu requires trigger and content slots`);
  let l = t.defaultOpen ?? X(e, `defaultOpen`) ?? !1,
    u = t.onOpenChange,
    d = t.onPortalMounted,
    f = t.onSelect,
    p = t.onValueChange,
    m = t.onValuesChange,
    h = t.closeOnClickOutside ?? X(e, `closeOnClickOutside`) ?? !0,
    g = t.closeOnEscape ?? X(e, `closeOnEscape`) ?? !0,
    _ = t.closeOnSelect ?? X(e, `closeOnSelect`) ?? !0,
    v = (t, n) => Is(i, t, n) ?? (o ? Is(o, t, n) : void 0) ?? Is(e, t, n),
    y = (t) => Ps(i, t) ?? (o ? Ps(o, t) : void 0) ?? Ps(e, t),
    b = (t) => X(i, t) ?? (o ? X(o, t) : void 0) ?? X(e, t),
    x = t.side ?? v(`side`, tu) ?? `bottom`,
    S = t.align ?? v(`align`, nu) ?? `start`,
    C = t.sideOffset ?? y(`sideOffset`) ?? 4,
    w = t.alignOffset ?? y(`alignOffset`) ?? 0,
    T = t.avoidCollisions ?? b(`avoidCollisions`) ?? !0,
    E = t.collisionPadding ?? y(`collisionPadding`) ?? 8,
    D = t.lockScroll ?? X(e, `lockScroll`) ?? !0,
    O = t.highlightItemOnHover ?? X(e, `highlightItemOnHover`) ?? !0,
    k = ou(t, `defaultValue`),
    A = ou(t, `defaultValues`),
    j = e.hasAttribute(`data-default-value`),
    M = e.hasAttribute(`data-default-values`),
    N = k ? (t.defaultValue ?? null) : j ? (Fs(e, `defaultValue`) ?? null) : null,
    ee = A ? (t.defaultValues ?? []) : M ? mu(Fs(e, `defaultValues`)) : [],
    P = !1,
    F = null,
    I = [],
    L = null,
    te = null,
    R = ``,
    z = null,
    B = !1,
    V = !1,
    ne = !1,
    H = null,
    re = [],
    ie = Fc({
      content: i,
      root: e,
      wrapperSlot: o ? void 0 : `dropdown-menu-positioner`,
      container: o ?? void 0,
      mountTarget: o ? (c ?? o) : void 0,
    }),
    ae = [],
    oe = [],
    se = new Map(),
    ce = (e) =>
      e.hasAttribute(`disabled`) ||
      e.hasAttribute(`data-disabled`) ||
      e.getAttribute(`aria-disabled`) === `true`,
    le = (e) => e.pointerType !== `touch`,
    ue = (e) => (e instanceof Element ? e.closest(au) : null),
    de = (e) => (e ? (ae.find((t) => t.el === e) ?? null) : null),
    fe = () => ae.filter((e) => e.type === `radio`),
    pe = () => ae.filter((e) => e.type === `checkbox`),
    me = (e, t) => e.find((e) => e.type === `radio` && e.value === t) ?? null,
    he = (e) => (e ? (e.type === `item` ? pu(e) : e.value) : null),
    ge = (e) => (e.type === `radio` || e.type === `checkbox`) && e.value === null,
    _e = (e) => ce(e.el) || ge(e),
    ve = (e) => fe().find((t) => t.value === e) ?? null,
    ye = (e) => oe.find((t) => he(t) === e) ?? null,
    be = (e, t, n = pe()) => {
      let r = new Set(e),
        i = new Set(t),
        a = null,
        o = null,
        s = null;
      for (let e of n) {
        if (e.type !== `checkbox`) continue;
        let t = e.value;
        if (!t) continue;
        let n = r.has(t),
          c = i.has(t);
        if (n !== c) {
          if (a !== null) return { changedValue: null, checked: null, item: null };
          ((a = t), (o = c), (s = e.el));
        }
      }
      return { changedValue: a, checked: o, item: s };
    },
    xe = (e, t) => {
      let n = pe().filter((e) => e.value !== null);
      if (n.length === 0) return null;
      if (e.length === 0) return [];
      let r = new Set(
        e
          .filter((e) => typeof e == `string`)
          .map((e) => e.trim())
          .filter((e) => e.length > 0),
      );
      if (r.size === 0) return t === `init` ? [] : null;
      let i = [];
      for (let e of n) e.value && r.has(e.value) && i.push(e.value);
      return i.length === 0 ? (t === `init` ? [] : null) : i;
    },
    Se = () => {
      for (let e of ae) {
        let t = _e(e);
        if (
          (e.el.setAttribute(`role`, uu(e.type)),
          (e.el.tabIndex = -1),
          t ? e.el.setAttribute(`aria-disabled`, `true`) : e.el.removeAttribute(`aria-disabled`),
          e.type === `radio`)
        ) {
          let t = e.value !== null && F === e.value;
          (su(e.el, `data-checked`, t), Z(e.el, `checked`, e.value === null ? null : t));
        } else if (e.type === `checkbox`) {
          let t = e.value !== null && I.includes(e.value);
          (su(e.el, `data-checked`, t), Z(e.el, `checked`, e.value === null ? null : t));
        } else (e.el.removeAttribute(`data-checked`), e.el.removeAttribute(`aria-checked`));
      }
      fe().length > 0 && F !== null
        ? e.setAttribute(`data-value`, F)
        : e.removeAttribute(`data-value`);
    },
    Ce = () => {
      for (let e of ae) su(e.el, `data-highlighted`, e.el === L);
    },
    we = ({ source: e = `programmatic`, emitSelectionInvalidation: t = !1 } = {}) => {
      let n = ae,
        r = F,
        a = [...I];
      ae = Array.from(i.querySelectorAll(au)).map((e) => ({ el: e, type: du(e), value: fu(e) }));
      let o = r !== null && ve(r) ? r : null,
        s = a.length > 0 ? (xe(a, `init`) ?? []) : [];
      if (
        ((F = o),
        (I = s),
        (oe = ae.filter((e) => !_e(e))),
        (se = new Map(oe.map((e, t) => [e.el, t]))),
        L && !se.has(L) && (L = null),
        Se(),
        Ce(),
        t &&
          (r !== F &&
            De({
              value: F,
              previousValue: r,
              item: F === null ? null : (ve(F)?.el ?? null),
              previousItem: r === null ? null : (me(n, r)?.el ?? null),
              source: e,
            }),
          !cu(a, I)))
      ) {
        let t = be(
          a,
          I,
          n.filter((e) => e.type === `checkbox`),
        );
        Oe({
          values: [...I],
          previousValues: a,
          changedValue: t.changedValue,
          checked: t.checked,
          item: t.item,
          source: e,
        });
      }
    },
    Te = (t) => {
      (Ys(e, `dropdown-menu:open-change`, t), Ys(e, `dropdown-menu:change`, t), u?.(t.open));
    },
    Ee = (t) => {
      Ys(e, `dropdown-menu:highlight-change`, t);
    },
    De = (t) => {
      (Ys(e, `dropdown-menu:value-change`, t), p?.(t.value));
    },
    Oe = (t) => {
      (Ys(e, `dropdown-menu:values-change`, t), m?.([...t.values]));
    },
    ke = () => {
      let t = ie.container,
        n = e.ownerDocument.defaultView ?? window,
        a = r.getBoundingClientRect(),
        o = xc({
          anchorRect: a,
          contentRect: cc(i),
          side: x,
          align: S,
          sideOffset: C,
          alignOffset: w,
          avoidCollisions: T,
          collisionPadding: E,
        }),
        s = sc({ side: o.side, align: o.align, anchorRect: a, popupX: o.x, popupY: o.y });
      (D
        ? ((t.style.position = `fixed`),
          (t.style.top = `0px`),
          (t.style.left = `0px`),
          (t.style.transform = `translate3d(${o.x}px, ${o.y}px, 0)`))
        : ((t.style.position = `absolute`),
          (t.style.top = `0px`),
          (t.style.left = `0px`),
          (t.style.transform = `translate3d(${o.x + n.scrollX}px, ${o.y + n.scrollY}px, 0)`)),
        t.style.setProperty(`--transform-origin`, s),
        (t.style.willChange = `transform`),
        (t.style.margin = `0`),
        i.setAttribute(`data-side`, o.side),
        i.setAttribute(`data-align`, o.align),
        t !== i && (t.setAttribute(`data-side`, o.side), t.setAttribute(`data-align`, o.align)));
    },
    Ae = Oc({ observedElements: [r, i], isActive: () => P, ancestorScroll: D, onUpdate: ke }),
    je = () => {
      requestAnimationFrame(() => {
        (te && document.contains(te) ? lc(te) : document.contains(r) && lc(r), (te = null));
      });
    },
    Me = zc({
      element: i,
      onExitComplete: () => {
        ne || (ie.restore(), (i.hidden = !0), je());
      },
    }),
    Ne = (t) => {
      (e.setAttribute(`data-state`, t),
        i.setAttribute(`data-state`, t),
        t === `open`
          ? (e.setAttribute(`data-open`, ``),
            i.setAttribute(`data-open`, ``),
            e.removeAttribute(`data-closed`),
            i.removeAttribute(`data-closed`))
          : (e.setAttribute(`data-closed`, ``),
            i.setAttribute(`data-closed`, ``),
            e.removeAttribute(`data-open`),
            i.removeAttribute(`data-open`)));
    },
    Pe = (e, { source: t, focus: n = !0, focusContentOnClear: r = !1 }) => {
      if (e && !se.has(e)) return !1;
      let a = L;
      return a === e
        ? (e && n ? (Sc(e, i), lc(e)) : !e && r && lc(i), !1)
        : ((L = e),
          Ce(),
          e ? (Sc(e, i), n && lc(e)) : r && lc(i),
          Ee({ value: he(de(e)), previousValue: he(de(a)), item: e, previousItem: a, source: t }),
          !0);
    },
    Fe = (e, t, n = !0) => {
      if ((we({ source: t, emitSelectionInvalidation: n }), fe().length === 0)) return !1;
      let r = e === null ? null : ve(e);
      if ((e !== null && !r) || F === e) return !1;
      let i = F,
        a = i === null ? null : ve(i);
      return (
        (F = e),
        Se(),
        n &&
          De({
            value: F,
            previousValue: i,
            item: r?.el ?? null,
            previousItem: a?.el ?? null,
            source: t,
          }),
        !0
      );
    },
    Ie = (e, t, n = !0) => {
      we({ source: t, emitSelectionInvalidation: n });
      let r = xe(e, n ? `set` : `init`);
      if (r === null || cu(I, r)) return !1;
      let i = [...I],
        a = be(i, r);
      return (
        (I = r),
        Se(),
        n &&
          Oe({
            values: [...I],
            previousValues: i,
            changedValue: a.changedValue,
            checked: a.checked,
            item: a.item,
            source: t,
          }),
        !0
      );
    },
    Le = () => {
      if ((we(), k || j)) N === null ? (F = null) : Fe(N, `programmatic`, !1);
      else
        for (let e of fe())
          if (e.value !== null && X(e.el, `defaultChecked`)) {
            F = e.value;
            break;
          }
      if (A || M) I = xe(ee, `init`) ?? [];
      else {
        let e = pe()
          .filter((e) => e.value !== null && X(e.el, `defaultChecked`))
          .map((e) => e.value);
        I = xe(e, `init`) ?? [];
      }
      Se();
    },
    Re = (e, { source: t, reason: n }) => {
      if (P === e) return;
      H = null;
      let a = P;
      (e
        ? ((te = document.activeElement),
          (P = !0),
          Z(r, `expanded`, !0),
          ie.mount(),
          d && requestAnimationFrame(() => d(ie.container)),
          (i.hidden = !1),
          Ne(`open`),
          Me.enter(),
          D && !V && ($s(), (V = !0)),
          we({
            source: t === `restore` ? `restore` : `programmatic`,
            emitSelectionInvalidation: t !== `init`,
          }),
          (B = !1),
          (R = ``),
          Ae.start(),
          ke(),
          Ae.update(),
          lc(i))
        : ((P = !1),
          Z(r, `expanded`, !1),
          Ne(`closed`),
          L &&
            Pe(null, {
              source: t === `init` ? `programmatic` : t,
              focus: !1,
              focusContentOnClear: !1,
            }),
          (R = ``),
          (B = !1),
          (V &&= (ec(), !1)),
          Ae.stop(),
          Me.exit()),
        Te({ open: P, previousOpen: a, source: t, reason: n }));
    },
    ze = (e, t) => {
      let n = { source: e, reason: t };
      ((H = n),
        queueMicrotask(() => {
          H === n && (H = null);
        }));
    },
    Be = (t, n) => {
      if (_e(t)) return;
      let r = he(t);
      if (r === null) return;
      let i;
      if (
        (t.type === `radio`
          ? (i = !0)
          : t.type === `checkbox` && t.value !== null && (i = !I.includes(t.value)),
        lu(
          e,
          `dropdown-menu:select`,
          { value: r, item: t.el, itemType: t.type, source: n, checked: i },
          !0,
        ))
      ) {
        if ((f?.(r), t.type === `radio`)) Fe(t.value, n, !0);
        else if (t.type === `checkbox` && t.value !== null) {
          let e = new Set(I);
          (e.has(t.value) ? e.delete(t.value) : e.add(t.value), Ie([...e], n, !0));
        }
        _ && Re(!1, { source: n, reason: `select` });
      }
    },
    Ve = (e) => {
      (z && clearTimeout(z),
        (z = setTimeout(() => {
          R = ``;
        }, 500)),
        (R += e));
      let t = oe.findIndex((e) => (e.el.textContent?.trim().toLowerCase() ?? ``).startsWith(R));
      if (t === -1 && R.length === 1) {
        let n = L ? (se.get(L) ?? -1) + 1 : 0;
        for (let r = 0; r < oe.length; r++) {
          let i = (n + r) % oe.length;
          if ((oe[i]?.el.textContent?.trim().toLowerCase() ?? ``).startsWith(e)) {
            t = i;
            break;
          }
        }
      }
      t !== -1 && ((B = !0), Pe(oe[t]?.el ?? null, { source: `keyboard`, focus: !0 }));
    },
    He = (e) => {
      let t = e.source ?? `programmatic`;
      if (
        (e.value !== void 0 && Fe(e.value, t, !0),
        e.values !== void 0 && Ie(e.values, t, !0),
        e.open !== void 0 && Re(e.open, { source: t, reason: `programmatic` }),
        e.highlightedValue !== void 0)
      ) {
        if (!P) return;
        if (e.highlightedValue === null)
          Pe(null, { source: t, focus: !1, focusContentOnClear: !0 });
        else {
          let n = ye(e.highlightedValue);
          n && Pe(n.el, { source: t, focus: !0 });
        }
      }
    },
    Ue = qs(r, `dropdown-menu-trigger`),
    We = qs(i, `dropdown-menu-content`);
  (r.setAttribute(`aria-haspopup`, `menu`),
    r.setAttribute(`aria-controls`, We),
    i.setAttribute(`role`, `menu`),
    i.setAttribute(`aria-labelledby`, Ue),
    (i.tabIndex = -1),
    Z(r, `expanded`, !1),
    (i.hidden = !0),
    Ne(`closed`),
    Le(),
    re.push(
      Q(r, `click`, () => {
        Re(!P, { source: `pointer`, reason: `trigger` });
      }),
      Q(r, `keydown`, (e) => {
        (e.key === `Enter` || e.key === ` ` || e.key === `ArrowDown`) &&
          !P &&
          (e.preventDefault(), Re(!0, { source: `keyboard`, reason: `trigger` }));
      }),
    ),
    re.push(
      Q(i, `keydown`, (e) => {
        if (e.key === `Tab`) {
          Re(!1, { source: `keyboard`, reason: `tab` });
          return;
        }
        let t = oe.length;
        if (t !== 0)
          switch (e.key) {
            case `ArrowDown`:
              (e.preventDefault(),
                (B = !0),
                Pe(oe[L ? ((se.get(L) ?? -1) + 1) % t : 0]?.el ?? null, {
                  source: `keyboard`,
                  focus: !0,
                }));
              break;
            case `ArrowUp`:
              (e.preventDefault(),
                (B = !0),
                Pe(oe[L ? (se.get(L) - 1 + t) % t : t - 1]?.el ?? null, {
                  source: `keyboard`,
                  focus: !0,
                }));
              break;
            case `Home`:
              (e.preventDefault(),
                (B = !0),
                Pe(oe[0]?.el ?? null, { source: `keyboard`, focus: !0 }));
              break;
            case `End`:
              (e.preventDefault(),
                (B = !0),
                Pe(oe[t - 1]?.el ?? null, { source: `keyboard`, focus: !0 }));
              break;
            case `Enter`:
            case ` `:
              if ((e.preventDefault(), L)) {
                let e = de(L);
                e && Be(e, `keyboard`);
              }
              break;
            default:
              e.key.length === 1 &&
                !e.ctrlKey &&
                !e.metaKey &&
                !e.altKey &&
                (e.preventDefault(), Ve(e.key.toLowerCase()));
          }
      }),
      Q(i, `click`, (e) => {
        let t = ue(e.target),
          n = de(t);
        n && Be(n, `pointer`);
      }),
      Q(i, `pointermove`, (e) => {
        if (!O || !le(e)) return;
        let t = ue(e.target);
        (B && ((B = !1), t && t === L)) ||
          (t && se.has(t)
            ? Pe(t, { source: `pointer`, focus: !0 })
            : L && Pe(null, { source: `pointer`, focus: !1, focusContentOnClear: !0 }));
      }),
      Q(i, `pointerleave`, (e) => {
        !O ||
          !le(e) ||
          B ||
          !L ||
          Pe(null, { source: `pointer`, focus: !1, focusContentOnClear: !0 });
      }),
    ));
  let Ge = e.ownerDocument ?? document;
  (re.push(
    Q(
      Ge,
      `pointerdown`,
      (t) => {
        if (!P || !h || t.pointerType === `touch`) return;
        let n = t.target;
        Hs(e, n) || ze(`pointer`, `outside`);
      },
      { capture: !0 },
    ),
    Q(
      Ge,
      `click`,
      (t) => {
        if (!P || !h) return;
        let n = t.target;
        Hs(e, n) || ze(`pointer`, `outside`);
      },
      { capture: !0 },
    ),
    Q(
      Ge,
      `keydown`,
      (e) => {
        !P || !g || e.key !== `Escape` || e.defaultPrevented || ze(`keyboard`, `escape`);
      },
      { capture: !0 },
    ),
  ),
    re.push(
      Pc({
        root: e,
        isOpen: () => P,
        onDismiss: () => {
          let e = H;
          if (((H = null), e?.reason === `escape`)) {
            Re(!1, { source: e.source, reason: `escape` });
            return;
          }
          Re(!1, { source: e?.source ?? `pointer`, reason: e?.reason ?? `outside` });
        },
        closeOnClickOutside: h,
        closeOnEscape: g,
      }),
    ),
    re.push(
      Q(e, `dropdown-menu:set`, (e) => {
        let t = e.detail;
        if (!t || typeof t != `object`) return;
        let n = {
          source: t.source === `restore` || t.source === `programmatic` ? t.source : void 0,
        };
        (t.open !== void 0 && (n.open = t.open),
          t.values !== void 0 &&
            (n.values = Array.isArray(t.values)
              ? t.values.filter((e) => typeof e == `string`)
              : void 0),
          t.highlightedValue !== void 0 &&
            (n.highlightedValue =
              t.highlightedValue === null || typeof t.highlightedValue == `string`
                ? t.highlightedValue
                : void 0),
          t.value !== void 0 &&
            (typeof t.value == `boolean` && t.open === void 0
              ? (n.open = t.value)
              : (t.value === null || typeof t.value == `string`) && (n.value = t.value)),
          He(n));
      }),
    ));
  let Ke = {
    open: () => Re(!0, { source: `programmatic`, reason: `programmatic` }),
    close: () => Re(!1, { source: `programmatic`, reason: `programmatic` }),
    toggle: () => Re(!P, { source: `programmatic`, reason: `programmatic` }),
    set: (e) => {
      He(e);
    },
    get isOpen() {
      return P;
    },
    get value() {
      return F;
    },
    get values() {
      return [...I];
    },
    get highlightedValue() {
      return he(de(L));
    },
    destroy: () => {
      ((ne = !0),
        z && clearTimeout(z),
        Ae.stop(),
        Me.cleanup(),
        ie.cleanup(),
        (V &&= (ec(), !1)),
        re.forEach((e) => e()),
        (re.length = 0),
        ws(e, ru, Ke));
    },
  };
  return (Cs(e, ru, Ke), l && Re(!0, { source: `init`, reason: `init` }), Ke);
}
function gu(e = document) {
  let t = [];
  for (let n of gs(e, `dropdown-menu`)) Ss(n, ru) || t.push(hu(n));
  return t;
}
var _u = ms({ create: () => ju, createField: () => Au }),
  vu = `@areia/slots:Field`,
  yu = `[@areia/slots:Field] createField() called more than once for the same root. Returning the existing controller. Destroy it before rebinding with new options.`,
  bu = `input, textarea, select, button, [contenteditable], [tabindex]`,
  xu = {
    valid: !0,
    valueMissing: !1,
    typeMismatch: !1,
    patternMismatch: !1,
    tooLong: !1,
    tooShort: !1,
    rangeUnderflow: !1,
    rangeOverflow: !1,
    stepMismatch: !1,
    badInput: !1,
    customError: !1,
    error: ``,
    errors: [],
  };
function Su(e, t, n) {
  n ? e.setAttribute(t, ``) : e.removeAttribute(t);
}
function Cu(...e) {
  let t = new Set();
  for (let n of e) if (n) for (let e of n.split(/\s+/)) e && t.add(e);
  return t.size ? [...t].join(` `) : null;
}
function wu(e) {
  return Y(e, `field-control`) ?? e.querySelector(bu);
}
function Tu(e) {
  return e
    ? e instanceof HTMLInputElement ||
      e instanceof HTMLTextAreaElement ||
      e instanceof HTMLSelectElement
      ? e.value
      : (e.textContent ?? ``)
    : ``;
}
function Eu(e) {
  if (!e || !(`validity` in e)) return { ...xu };
  let t = e.validity,
    n = [],
    r = `validationMessage` in e ? e.validationMessage : ``;
  return (
    !t.valid && r && n.push(r),
    {
      valid: t.valid,
      valueMissing: t.valueMissing,
      typeMismatch: t.typeMismatch,
      patternMismatch: t.patternMismatch,
      tooLong: t.tooLong,
      tooShort: t.tooShort,
      rangeUnderflow: t.rangeUnderflow,
      rangeOverflow: t.rangeOverflow,
      stepMismatch: t.stepMismatch,
      badInput: t.badInput,
      customError: t.customError,
      error: n[0] ?? ``,
      errors: n,
    }
  );
}
function Du(e) {
  return e === !1 || e == null ? [] : Array.isArray(e) ? e.filter(Boolean) : e ? [e] : [];
}
function Ou(e, t) {
  (Su(e, `data-disabled`, t.disabled),
    Su(e, `data-touched`, t.touched),
    Su(e, `data-dirty`, t.dirty),
    Su(e, `data-valid`, t.valid),
    Su(e, `data-invalid`, t.invalid),
    Su(e, `data-filled`, t.filled),
    Su(e, `data-focused`, t.focused));
}
function ku(e, t) {
  Array.isArray(t) ? (e.textContent = t.join(` `)) : (e.textContent = t);
}
function Au(e, t = {}) {
  let n = Es(e, vu, yu);
  if (n) return n;
  let r = e,
    i = wu(r),
    a = hs(r, `field-label`),
    o = hs(r, `field-description`),
    s = hs(r, `field-error`),
    c = hs(r, `field-item`),
    l = hs(r, `field-validity`),
    u = t.disabled ?? X(r, `disabled`) ?? !1,
    d = t.validationMode ?? Fs(r, `validationMode`) ?? `onBlur`,
    f = t.validationDebounceTime ?? 0,
    p = t.validate,
    m = t.onValidityChange,
    h = [],
    g =
      t.name ??
      Fs(r, `name`) ??
      (((i instanceof HTMLInputElement ||
        i instanceof HTMLTextAreaElement ||
        i instanceof HTMLSelectElement) &&
        i.name) ||
        void 0),
    _ = t.dirty ?? X(r, `dirty`) ?? !1,
    v = t.touched ?? X(r, `touched`) ?? !1,
    y = !1,
    b = Tu(i) !== ``,
    x = t.invalid ?? X(r, `invalid`) ?? !1,
    S = [],
    C = { ...xu },
    w = null,
    T = 0,
    E = () => [r, ...a, ...o, ...s, ...c, ...l],
    D = () => {
      for (let e of l)
        ((e.dataset.valid = String(C.valid && !x)),
          (e.dataset.error = C.error),
          (e.dataset.errors = JSON.stringify(C.errors)));
    },
    O = () => {
      let e = x || !C.valid,
        t = !e;
      for (let n of E())
        Ou(n, { disabled: u, touched: v, dirty: _, valid: t, invalid: e, filled: b, focused: y });
      if (i) {
        (u && `disabled` in i && (i.disabled = !0),
          g &&
            (i instanceof HTMLInputElement ||
              i instanceof HTMLTextAreaElement ||
              i instanceof HTMLSelectElement) &&
            (i.name = g));
        let t = a.map((e) => qs(e, `field-label`)),
          n = [...o, ...(e ? s : [])].map((e) => qs(e, `field-message`)),
          r = Cu(i.getAttribute(`aria-labelledby`), t.join(` `)),
          c = Cu(i.getAttribute(`aria-describedby`), n.join(` `));
        if (
          (r && i.setAttribute(`aria-labelledby`, r),
          c ? i.setAttribute(`aria-describedby`, c) : i.removeAttribute(`aria-describedby`),
          i.setAttribute(`aria-invalid`, e ? `true` : `false`),
          a.length > 0)
        ) {
          let e = qs(i, `field-control`);
          for (let t of a) t instanceof HTMLLabelElement && (t.htmlFor = e);
        }
      }
      for (let t of s) {
        let n = t.dataset.match,
          r = n ? !!C[n] : e;
        ((t.hidden = !r),
          r && t.textContent?.trim() === `` && C.errors.length > 0 && ku(t, C.errors));
      }
      D();
    },
    k = (e) => {
      let t = C.valid && !x;
      C = e;
      let n = C.valid && !x;
      (O(), t !== n && (Ys(r, `field:validity-change`, { valid: n, validity: C }), m?.(n)));
    },
    A = async () => {
      let e = ++T,
        t = Eu(i),
        n = p ? Du(await p(Tu(i), i ?? r)) : [];
      if (e !== T) return C;
      let a = {
        ...t,
        customError: t.customError || n.length > 0 || S.length > 0,
        valid: t.valid && n.length === 0 && S.length === 0,
        errors: [...t.errors, ...n, ...S],
        error: [...t.errors, ...n, ...S][0] ?? ``,
      };
      return (k(a), a);
    },
    j = () => {
      (w && clearTimeout(w), f > 0 ? (w = setTimeout(() => void A(), f)) : A());
    };
  if (i) {
    h.push(
      Q(i, `input`, () => {
        ((_ = !0),
          (b = Tu(i) !== ``),
          O(),
          Ys(r, `field:change`, { value: Tu(i), dirty: _, filled: b }),
          d === `onChange` && j());
      }),
      Q(i, `change`, () => {
        ((_ = !0), (b = Tu(i) !== ``), O(), d === `onChange` && j());
      }),
      Q(i, `focus`, () => {
        ((y = !0), O());
      }),
      Q(i, `blur`, () => {
        ((y = !1), (v = !0), O(), d === `onBlur` && j());
      }),
    );
    let e = i.closest(`form`);
    e &&
      h.push(
        Q(e, `submit`, () => {
          ((v = !0), O(), d === `onSubmit` && j());
        }),
        Q(e, `reset`, () => {
          queueMicrotask(() => {
            ((_ = !1),
              (v = !1),
              (b = Tu(i) !== ``),
              (x = t.invalid ?? X(r, `invalid`) ?? !1),
              (S = []),
              k({ ...xu }));
          });
        }),
      );
  }
  (h.push(
    Q(r, `field:validate`, () => {
      A();
    }),
    Q(r, `field:set-invalid`, (e) => {
      let t = e.detail;
      ((x = !0),
        (S = Array.isArray(t?.error) ? t.error : t?.error ? [String(t.error)] : []),
        k({ ...C, valid: !1, customError: !0, errors: S, error: S[0] ?? `` }));
    }),
    Q(r, `field:clear-invalid`, () => {
      ((x = !1), (S = []), A());
    }),
  ),
    O());
  let M = {
    get name() {
      return g;
    },
    get valid() {
      return C.valid && !x;
    },
    get invalid() {
      return x || !C.valid;
    },
    get dirty() {
      return _;
    },
    get touched() {
      return v;
    },
    get filled() {
      return b;
    },
    get focused() {
      return y;
    },
    get validity() {
      return C;
    },
    validate: A,
    setInvalid: (e, t) => {
      ((x = e),
        (S = e ? (Array.isArray(t) ? t : t ? [t] : []) : []),
        k({
          ...C,
          valid: !e && C.valid,
          customError: e || C.customError,
          errors: S.length ? S : C.errors,
          error: S[0] ?? C.error,
        }));
    },
    clearInvalid: () => {
      ((x = !1), (S = []), A());
    },
    destroy: () => {
      (w && clearTimeout(w), h.forEach((e) => e()), (h.length = 0), ws(r, vu, M));
    },
  };
  return (Cs(r, vu, M), M);
}
function ju(e = document) {
  let t = [];
  for (let n of gs(e, `field`)) Ss(n, vu) || t.push(Au(n));
  return t;
}
var Mu = ms({ create: () => Gu, createHoverCard: () => Wu }),
  Nu = [`top`, `right`, `bottom`, `left`],
  Pu = [`start`, `center`, `end`],
  Fu = 0,
  Iu = 750,
  Lu = 250,
  Ru = new Set(),
  zu = new Set(),
  Bu = (e, t) => {
    if (!e) return !1;
    for (let n of Ru) if (n !== t && n.contains(e)) return !0;
    return !1;
  },
  Vu = (e, t) => {
    for (let n of zu) n(e, t);
  },
  Hu = `@areia/slots:HoverCard`,
  Uu = `[@areia/slots:HoverCard] createHoverCard() called more than once for the same root. Returning the existing controller. Destroy it before rebinding with new options.`;
function Wu(e, t = {}) {
  let n = Es(e, Hu, Uu);
  if (n) return n;
  let r = Y(e, `hover-card-trigger`),
    i = Y(e, `hover-card-content`),
    a = Y(e, `hover-card-positioner`),
    o = a && i && a.contains(i) ? a : null,
    s = Y(e, `hover-card-portal`),
    c = s && o && s.contains(o) ? s : null;
  if (!r || !i) throw Error(`Hover-card requires trigger and content slots`);
  let l = t.open !== void 0,
    u = t.defaultOpen ?? X(e, `defaultOpen`) ?? !1,
    d = t.delay ?? Ps(e, `delay`) ?? 700,
    f = t.skipDelayDuration ?? Ps(e, `skipDelayDuration`) ?? 300,
    p = t.closeDelay ?? Ps(e, `closeDelay`) ?? 300,
    m = t.onOpenChange,
    h = t.onPortalMounted,
    g = t.closeOnClickOutside ?? X(e, `closeOnClickOutside`) ?? !0,
    _ = t.closeOnEscape ?? X(e, `closeOnEscape`) ?? !0,
    v = t.portal ?? X(i, `portal`) ?? X(e, `portal`) ?? !0,
    y = (t, n) => Is(i, t, n) ?? (o ? Is(o, t, n) : void 0) ?? Is(e, t, n),
    b = (t) => Ps(i, t) ?? (o ? Ps(o, t) : void 0) ?? Ps(e, t),
    x = (t) => X(i, t) ?? (o ? X(o, t) : void 0) ?? X(e, t),
    S = t.side ?? y(`side`, Nu) ?? `bottom`,
    C = t.align ?? y(`align`, Pu) ?? `center`,
    w = t.sideOffset ?? b(`sideOffset`) ?? 4,
    T = t.alignOffset ?? b(`alignOffset`) ?? 0,
    E = t.avoidCollisions ?? x(`avoidCollisions`) ?? !0,
    D = t.collisionPadding ?? b(`collisionPadding`) ?? 8,
    O = t.open ?? u,
    k = !1,
    A = !1,
    j = !1,
    M = !1,
    N = !1,
    ee = null,
    P = null,
    F = -1 / 0,
    I = -1 / 0,
    L = [],
    te = Fc({
      content: i,
      root: e,
      enabled: v,
      wrapperSlot: o ? void 0 : `hover-card-positioner`,
      container: o ?? void 0,
      mountTarget: o ? (c ?? o) : void 0,
    }),
    R = qs(i, `hover-card-content`);
  (r.setAttribute(`aria-haspopup`, `dialog`),
    r.setAttribute(`aria-controls`, R),
    i.setAttribute(`data-side`, S),
    i.setAttribute(`data-align`, C));
  let z = () => r.hasAttribute(`disabled`) || r.getAttribute(`aria-disabled`) === `true`,
    B = () => {
      ee &&= (clearTimeout(ee), null);
    },
    V = () => {
      P &&= (clearTimeout(P), null);
    },
    ne = () => {
      (B(), V());
    },
    H = () => {
      (ne(), (j = !1), (M = !1), (N = !1));
    },
    re = (t, n) => {
      (Ys(e, `hover-card:change`, { open: t, reason: n, trigger: r, content: i }), m?.(t));
    },
    ie = () => {
      let t = te.container,
        n = e.ownerDocument.defaultView ?? window,
        a = r.getBoundingClientRect(),
        o = xc({
          anchorRect: a,
          contentRect: cc(i),
          side: S,
          align: C,
          sideOffset: w,
          alignOffset: T,
          avoidCollisions: E,
          collisionPadding: D,
        }),
        s = sc({ side: o.side, align: o.align, anchorRect: a, popupX: o.x, popupY: o.y });
      ((t.style.position = `absolute`),
        (t.style.top = `0px`),
        (t.style.left = `0px`),
        (t.style.transform = `translate3d(${o.x + n.scrollX}px, ${o.y + n.scrollY}px, 0)`),
        t.style.setProperty(`--transform-origin`, s),
        (t.style.willChange = `transform`),
        (t.style.margin = `0`),
        i.setAttribute(`data-side`, o.side),
        i.setAttribute(`data-align`, o.align),
        t !== i && (t.setAttribute(`data-side`, o.side), t.setAttribute(`data-align`, o.align)));
    },
    ae = (t) => {
      let n = te.container;
      if (
        (e.setAttribute(`data-state`, t),
        i.setAttribute(`data-state`, t),
        n !== i && n.setAttribute(`data-state`, t),
        t === `open`)
      ) {
        (e.setAttribute(`data-open`, ``),
          i.setAttribute(`data-open`, ``),
          n !== i && n.setAttribute(`data-open`, ``),
          k
            ? (e.setAttribute(`data-instant`, ``),
              i.setAttribute(`data-instant`, ``),
              n !== i && n.setAttribute(`data-instant`, ``))
            : (e.removeAttribute(`data-instant`),
              i.removeAttribute(`data-instant`),
              n !== i && n.removeAttribute(`data-instant`)),
          e.removeAttribute(`data-closed`),
          i.removeAttribute(`data-closed`),
          n !== i && n.removeAttribute(`data-closed`));
        return;
      }
      (e.setAttribute(`data-closed`, ``),
        i.setAttribute(`data-closed`, ``),
        n !== i && n.setAttribute(`data-closed`, ``),
        k
          ? (e.setAttribute(`data-instant`, ``),
            i.setAttribute(`data-instant`, ``),
            n !== i && n.setAttribute(`data-instant`, ``))
          : (e.removeAttribute(`data-instant`),
            i.removeAttribute(`data-instant`),
            n !== i && n.removeAttribute(`data-instant`)),
        e.removeAttribute(`data-open`),
        i.removeAttribute(`data-open`),
        n !== i && n.removeAttribute(`data-open`));
    },
    oe = zc({
      element: i,
      onExitComplete: () => {
        A || (te.restore(), (i.hidden = !0));
      },
    }),
    se = Oc({ observedElements: [r, i], isActive: () => O, ancestorScroll: !1, onUpdate: ie }),
    ce = (e, t, n = !1) => {
      O !== e &&
        (!e && O && f > 0 && (Fu = Date.now() + f),
        (k = n),
        (O = e),
        Z(r, `expanded`, O),
        e
          ? (te.mount(),
            h && requestAnimationFrame(() => h(te.container)),
            (i.hidden = !1),
            ae(`open`),
            oe.enter(),
            ie(),
            se.start(),
            se.update())
          : (ae(`closed`), oe.exit(), se.stop()),
        re(O, t));
    },
    le = (e, t, n = !1) => {
      if (O !== e) {
        if (l) {
          re(e, t);
          return;
        }
        ce(e, t, n);
      }
    },
    ue = (e, t, n = !1) => {
      ce(e, t, n);
    },
    de = (e, t = !1) => {
      (H(), le(!1, e, t));
    },
    fe = (e, t = !1) => {
      (H(), ue(!1, e, t));
    },
    pe = (e, t) => {
      e === r || !O || de(t, !0);
    };
  (Ru.add(r),
    zu.add(pe),
    L.push(() => {
      (zu.delete(pe), Ru.delete(r));
    }));
  let me = (e) => {
      if ((V(), B(), f > 0 && Date.now() < Fu)) {
        le(!0, e, !0);
        return;
      }
      if (d <= 0) {
        le(!0, e);
        return;
      }
      ee = setTimeout(() => {
        ((ee = null), le(!0, e));
      }, d);
    },
    he = (e) => {
      if ((B(), V(), p <= 0)) {
        le(!1, e);
        return;
      }
      P = setTimeout(() => {
        ((P = null), le(!1, e));
      }, p);
    },
    ge = (e) => {
      j || M || N || he(e);
    };
  (Z(r, `expanded`, O),
    ae(O ? `open` : `closed`),
    (i.hidden = !O),
    O &&
      (te.mount(),
      h && requestAnimationFrame(() => h(te.container)),
      oe.enter(),
      (i.hidden = !1),
      ie(),
      se.start(),
      se.update()),
    L.push(
      Q(
        e.ownerDocument,
        `keydown`,
        (e) => {
          e.key === `Tab` && (F = Date.now());
        },
        { capture: !0 },
      ),
      Q(
        e.ownerDocument,
        `pointerdown`,
        () => {
          ((F = -1 / 0), (I = -1 / 0));
        },
        { capture: !0 },
      ),
      Q(
        e.ownerDocument,
        `pointermove`,
        (e) => {
          e.pointerType !== `touch` && (I = Date.now());
        },
        { capture: !0 },
      ),
      Q(r, `pointerenter`, (e) => {
        e.pointerType !== `touch` &&
          ((j = !0), !z() && (Date.now() - I > Lu || (Vu(r, `pointer`), me(`pointer`))));
      }),
      Q(r, `pointermove`, (e) => {
        e.pointerType !== `touch` && (!j || z() || O || ee || (Vu(r, `pointer`), me(`pointer`)));
      }),
      Q(r, `pointerleave`, (e) => {
        if (e.pointerType === `touch`) return;
        j = !1;
        let t = e.relatedTarget;
        if (!(t && i.contains(t))) {
          if (Bu(t, r)) {
            de(`pointer`, !0);
            return;
          }
          ge(`pointer`);
        }
      }),
    ),
    L.push(
      Q(i, `pointerenter`, (e) => {
        e.pointerType !== `touch` && ((M = !0), V());
      }),
      Q(i, `pointerleave`, (e) => {
        if (e.pointerType === `touch`) return;
        M = !1;
        let t = e.relatedTarget;
        if (!(t && r.contains(t))) {
          if (Bu(t, r)) {
            de(`pointer`, !0);
            return;
          }
          ge(`pointer`);
        }
      }),
    ),
    L.push(
      Q(r, `focusin`, () => {
        z() || Date.now() - F > Iu || ((N = !0), Vu(r, `focus`), me(`focus`));
      }),
      Q(r, `focusout`, (e) => {
        let t = e.relatedTarget;
        if (!(t && (r.contains(t) || i.contains(t)))) {
          if (((N = !1), Bu(t, r))) {
            de(`blur`, !0);
            return;
          }
          ge(`blur`);
        }
      }),
      Q(i, `focusin`, () => {
        ((N = !0), V());
      }),
      Q(i, `focusout`, (e) => {
        let t = e.relatedTarget;
        if (!(t && (r.contains(t) || i.contains(t)))) {
          if (((N = !1), Bu(t, r))) {
            de(`blur`, !0);
            return;
          }
          ge(`blur`);
        }
      }),
    ),
    L.push(
      Pc({
        root: e,
        isOpen: () => O,
        onDismiss: () => de(`dismiss`),
        closeOnClickOutside: g,
        closeOnEscape: _,
      }),
    ),
    L.push(
      Q(e, `hover-card:set`, (e) => {
        let t = e.detail,
          n;
        (t?.open === void 0 ? t?.value !== void 0 && (n = t.value) : (n = t.open),
          typeof n == `boolean` && (n ? (ne(), ue(!0, `api`)) : fe(`api`)));
      }),
    ));
  let _e = {
    open: () => {
      z() || (ne(), le(!0, `api`));
    },
    close: () => {
      de(`api`);
    },
    toggle: () => {
      (!O && z()) || (O ? de(`api`) : (ne(), le(!0, `api`)));
    },
    setOpen: (e) => {
      e ? (ne(), ue(!0, `api`)) : fe(`api`);
    },
    get isOpen() {
      return O;
    },
    destroy: () => {
      ((A = !0),
        H(),
        se.stop(),
        oe.cleanup(),
        te.cleanup(),
        L.forEach((e) => e()),
        (L.length = 0),
        ws(e, Hu, _e));
    },
  };
  return (Cs(e, Hu, _e), _e);
}
function Gu(e = document) {
  let t = [];
  for (let n of gs(e, `hover-card`)) Ss(n, Hu) || t.push(Wu(n));
  return t;
}
var Ku = ms({ create: () => $u, createPopover: () => Qu }),
  qu = [`top`, `right`, `bottom`, `left`],
  Ju = [`start`, `center`, `end`],
  Yu = `a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])`,
  Xu = `@areia/slots:Popover`,
  Zu = `[@areia/slots:Popover] createPopover() called more than once for the same root. Returning the existing controller. Destroy it before rebinding with new options.`;
function Qu(e, t = {}) {
  let n = Es(e, Xu, Zu);
  if (n) return n;
  let r = Y(e, `popover-trigger`),
    i = Y(e, `popover-content`),
    a = Y(e, `popover-close`),
    o = Y(e, `popover-positioner`),
    s = o && i && o.contains(i) ? o : null,
    c = Y(e, `popover-portal`),
    l = c && s && c.contains(s) ? c : null;
  if (!r || !i) throw Error(`Popover requires trigger and content slots`);
  let u = t.defaultOpen ?? X(e, `defaultOpen`) ?? !1,
    d = t.onOpenChange,
    f = t.onPortalMounted,
    p = t.closeOnClickOutside ?? X(e, `closeOnClickOutside`) ?? !0,
    m = t.closeOnEscape ?? X(e, `closeOnEscape`) ?? !0,
    h = t.portal ?? X(i, `portal`) ?? X(e, `portal`) ?? !0,
    g = (t, n) => Is(i, t, n) ?? (s ? Is(s, t, n) : void 0) ?? Is(e, t, n),
    _ = (t) => Ps(i, t) ?? (s ? Ps(s, t) : void 0) ?? Ps(e, t),
    v = (t) => X(i, t) ?? (s ? X(s, t) : void 0) ?? X(e, t),
    y = t.position ?? g(`position`, qu),
    b = t.side ?? g(`side`, qu) ?? y ?? `bottom`,
    x = t.align ?? g(`align`, Ju) ?? `center`,
    S = t.sideOffset ?? _(`sideOffset`) ?? 4,
    C = t.alignOffset ?? _(`alignOffset`) ?? 0,
    w = t.avoidCollisions ?? v(`avoidCollisions`) ?? !0,
    T = t.collisionPadding ?? _(`collisionPadding`) ?? 8,
    E = u,
    D = [],
    O = Fc({
      content: i,
      root: e,
      enabled: h,
      wrapperSlot: s ? void 0 : `popover-positioner`,
      container: s ?? void 0,
      mountTarget: s ? (l ?? s) : void 0,
    }),
    k = !1,
    A = null,
    j = !1,
    M = () => {
      j &&= (i.removeAttribute(`tabindex`), !1);
    },
    N = () => {
      let e = i.querySelector(`[autofocus]`);
      if (e) return e.focus();
      let t = i.querySelector(Yu);
      if (t) return t.focus();
      (i.getAttribute(`tabindex`) || (i.setAttribute(`tabindex`, `-1`), (j = !0)), i.focus());
    },
    ee = qs(i, `popover-content`);
  (r.setAttribute(`aria-haspopup`, `dialog`),
    r.setAttribute(`aria-controls`, ee),
    i.setAttribute(`data-side`, b),
    i.setAttribute(`data-align`, x),
    i.setAttribute(`data-position`, b));
  let P = () => {
      let t = O.container,
        n = e.ownerDocument.defaultView ?? window,
        a = r.getBoundingClientRect(),
        o = xc({
          anchorRect: a,
          contentRect: cc(i),
          side: b,
          align: x,
          sideOffset: S,
          alignOffset: C,
          avoidCollisions: w,
          collisionPadding: T,
        }),
        s = sc({ side: o.side, align: o.align, anchorRect: a, popupX: o.x, popupY: o.y });
      ((t.style.position = `absolute`),
        (t.style.top = `0px`),
        (t.style.left = `0px`),
        (t.style.transform = `translate3d(${o.x + n.scrollX}px, ${o.y + n.scrollY}px, 0)`),
        t.style.setProperty(`--transform-origin`, s),
        (t.style.willChange = `transform`),
        (t.style.margin = `0`),
        i.setAttribute(`data-side`, o.side),
        i.setAttribute(`data-align`, o.align),
        t !== i && (t.setAttribute(`data-side`, o.side), t.setAttribute(`data-align`, o.align)),
        i.setAttribute(`data-position`, o.side));
    },
    F = (t) => {
      let n = O.container;
      (e.setAttribute(`data-state`, t),
        i.setAttribute(`data-state`, t),
        n !== i && n.setAttribute(`data-state`, t),
        t === `open`
          ? (e.setAttribute(`data-open`, ``),
            i.setAttribute(`data-open`, ``),
            n !== i && n.setAttribute(`data-open`, ``),
            e.removeAttribute(`data-closed`),
            i.removeAttribute(`data-closed`),
            n !== i && n.removeAttribute(`data-closed`))
          : (e.setAttribute(`data-closed`, ``),
            i.setAttribute(`data-closed`, ``),
            n !== i && n.setAttribute(`data-closed`, ``),
            e.removeAttribute(`data-open`),
            i.removeAttribute(`data-open`),
            n !== i && n.removeAttribute(`data-open`)));
    },
    I = () => {
      requestAnimationFrame(() => {
        (A && A.isConnected ? lc(A) : lc(r), (A = null));
      });
    },
    L = zc({
      element: i,
      onExitComplete: () => {
        k || (O.restore(), (i.hidden = !0), M(), I());
      },
    }),
    te = Oc({ observedElements: [r, i], isActive: () => E, ancestorScroll: !1, onUpdate: P }),
    R = (t) => {
      E !== t &&
        (t && (A = document.activeElement),
        (E = t),
        Z(r, `expanded`, E),
        t
          ? (O.mount(),
            f && requestAnimationFrame(() => f(O.container)),
            (i.hidden = !1),
            F(`open`),
            L.enter(),
            P(),
            te.start(),
            te.update(),
            requestAnimationFrame(N))
          : (F(`closed`), L.exit(), te.stop()),
        Ys(e, `popover:change`, { open: E }),
        d?.(E));
    };
  (Z(r, `expanded`, E),
    F(E ? `open` : `closed`),
    (i.hidden = !E),
    u &&
      (O.mount(),
      f && requestAnimationFrame(() => f(O.container)),
      L.enter(),
      (i.hidden = !1),
      P(),
      te.start(),
      te.update(),
      requestAnimationFrame(N)),
    D.push(Q(r, `click`, () => R(!E))),
    a && D.push(Q(a, `click`, () => R(!1))),
    D.push(
      Q(i, `click`, (e) => {
        e.target?.closest?.(`[data-slot="popover-close"]`) && R(!1);
      }),
    ),
    D.push(
      Pc({
        root: e,
        isOpen: () => E,
        onDismiss: () => R(!1),
        closeOnClickOutside: p,
        closeOnEscape: m,
      }),
    ),
    D.push(
      Q(e, `popover:set`, (e) => {
        let t = e.detail,
          n;
        (t?.open === void 0 ? t?.value !== void 0 && (n = t.value) : (n = t.open),
          typeof n == `boolean` && R(n));
      }),
    ));
  let z = {
    open: () => R(!0),
    close: () => R(!1),
    toggle: () => R(!E),
    get isOpen() {
      return E;
    },
    destroy: () => {
      ((k = !0),
        te.stop(),
        L.cleanup(),
        O.cleanup(),
        D.forEach((e) => e()),
        (D.length = 0),
        M(),
        ws(e, Xu, z));
    },
  };
  return (Cs(e, Xu, z), z);
}
function $u(e = document) {
  let t = [];
  for (let n of gs(e, `popover`)) Ss(n, Xu) || t.push(Qu(n));
  return t;
}
var ed = ms({ create: () => dd, createProgress: () => ud }),
  td = `@areia/slots:Progress`,
  nd = `[@areia/slots:Progress] createProgress() called more than once for the same root. Returning the existing controller. Destroy it before rebinding with new options.`;
function rd(e, t, n) {
  n ? e.setAttribute(t, ``) : e.removeAttribute(t);
}
function id(e, t, n) {
  return Math.min(n, Math.max(t, e));
}
function ad(e, t, n) {
  return n === t ? 100 : ((e - t) / (n - t)) * 100;
}
function od(e) {
  if (e == null || e === ``) return null;
  let t = Number(e);
  return Number.isFinite(t) ? t : null;
}
function sd(e, t, n) {
  return e == null ? null : new Intl.NumberFormat(t, n).format(e);
}
function cd(e, t) {
  return t == null ? `indeterminate progress` : e || `${t}%`;
}
function ld(e, t) {
  (rd(e, `data-indeterminate`, t === `indeterminate`),
    rd(e, `data-progressing`, t === `progressing`),
    rd(e, `data-complete`, t === `complete`),
    (e.dataset.state = t));
}
function ud(e, t = {}) {
  let n = Es(e, td, nd);
  if (n) return n;
  let r = e,
    i = hs(r, `progress-label`),
    a = hs(r, `progress-track`),
    o = hs(r, `progress-indicator`),
    s = hs(r, `progress-value`),
    c = [],
    l = t.min ?? Ps(r, `min`) ?? 0,
    u = t.max ?? Ps(r, `max`) ?? 100;
  u < l && ([l, u] = [u, l]);
  let d = t.locale ?? Fs(r, `locale`),
    f = t.format,
    p = t.getAriaValueText ?? cd,
    m = t.onValueChange,
    h = t.value === void 0 ? od(r.dataset.value ?? r.getAttribute(`aria-valuenow`)) : t.value,
    g = h == null ? null : id(h, l, u),
    _ = () =>
      g == null || !Number.isFinite(g) ? `indeterminate` : g >= u ? `complete` : `progressing`,
    v = () => (g == null || !Number.isFinite(g) ? null : id(ad(g, l, u), 0, 100)),
    y = () => [r, ...i, ...a, ...o, ...s],
    b = () => {
      let e = _(),
        t = v(),
        n = sd(g, d, f);
      if (
        (r.setAttribute(`role`, `progressbar`),
        r.setAttribute(`aria-valuemin`, String(l)),
        r.setAttribute(`aria-valuemax`, String(u)),
        g == null ? r.removeAttribute(`aria-valuenow`) : r.setAttribute(`aria-valuenow`, String(g)),
        r.setAttribute(`aria-valuetext`, p(n, g)),
        i.length > 0)
      ) {
        let e = qs(i[0], `progress-label`);
        r.setAttribute(`aria-labelledby`, e);
        for (let e of i) e.setAttribute(`role`, `presentation`);
      }
      ((r.dataset.value = g == null ? `` : String(g)),
        (r.dataset.min = String(l)),
        (r.dataset.max = String(u)),
        t == null ? delete r.dataset.percent : (r.dataset.percent = String(t)));
      for (let t of y()) ld(t, e);
      for (let e of a) e.setAttribute(`aria-hidden`, `true`);
      for (let e of o)
        t == null
          ? (e.style.removeProperty(`inset-inline-start`),
            e.style.removeProperty(`height`),
            e.style.removeProperty(`width`),
            delete e.dataset.percent)
          : ((e.style.insetInlineStart = `0px`),
            (e.style.height = `inherit`),
            (e.style.width = `${t}%`),
            (e.dataset.percent = String(t)));
      for (let e of s) (e.setAttribute(`aria-hidden`, `true`), (e.textContent = n ?? ``));
    },
    x = (e, t = !0) => {
      let n = g;
      (typeof e.min == `number` && Number.isFinite(e.min) && (l = e.min),
        typeof e.max == `number` && Number.isFinite(e.max) && (u = e.max),
        u < l && ([l, u] = [u, l]),
        `value` in e
          ? (g = e.value == null || !Number.isFinite(e.value) ? null : id(e.value, l, u))
          : g != null && (g = id(g, l, u)),
        b(),
        t &&
          n !== g &&
          (Ys(r, `progress:value-change`, {
            value: g,
            previousValue: n,
            percent: v(),
            status: _(),
          }),
          m?.(g)));
    };
  (c.push(
    Q(r, `progress:set`, (e) => {
      let t = e.detail;
      x(typeof t == `number` || t == null ? { value: t } : t);
    }),
  ),
    b());
  let S = {
    get value() {
      return g;
    },
    get min() {
      return l;
    },
    get max() {
      return u;
    },
    get status() {
      return _();
    },
    get percent() {
      return v();
    },
    setValue: (e) => x({ value: e }),
    set: (e) => x(e),
    destroy: () => {
      (c.forEach((e) => e()), (c.length = 0), ws(r, td, S));
    },
  };
  return (Cs(r, td, S), S);
}
function dd(e = document) {
  let t = [];
  for (let n of gs(e, `progress`)) Ss(n, td) || t.push(ud(n));
  return t;
}
[
  `position:absolute`,
  `width:1px`,
  `height:1px`,
  `padding:0`,
  `margin:-1px`,
  `overflow:hidden`,
  `clip:rect(0, 0, 0, 0)`,
  `white-space:nowrap`,
  `border:0`,
  `pointer-events:none`,
].join(`;`);
var fd = ms({
    create: () => Hd,
    createResizable: () => Rd,
    getBinding: () => Vd,
    hasBinding: () => Bd,
    reconnectResizable: () => zd,
  }),
  pd = (e, t) =>
    Array.from(e.querySelectorAll(`[data-slot="${t}"]`)).filter(
      (t) => t.closest(`[data-slot="resizable"]`) === e,
    ),
  md = (e, t) => {
    let n = e.dataset?.[t];
    if (n == null || n === ``) return null;
    let r = Number.parseFloat(n);
    return Number.isFinite(r) ? r : null;
  },
  hd = `@areia/slots:Resizable`,
  gd = `[@areia/slots:Resizable] createResizable() called more than once for the same root. Returning the existing controller. Destroy it before rebinding with new options.`,
  _d = 10,
  vd = [`ArrowDown`, `ArrowLeft`, `ArrowRight`, `ArrowUp`, `End`, `Home`],
  yd = (e, t) => Number.parseFloat(e.toFixed(t)),
  bd = (e, t, n = _d) => Math.sign(yd(e, n) - yd(t, n)),
  xd = (e, t, n = _d) => bd(e, t, n) === 0,
  Sd = (e, t) => {
    if (e.length !== t.length) return !1;
    for (let n = 0; n < e.length; n += 1) if (e[n] !== t[n]) return !1;
    return !0;
  },
  Cd = (e, t = `Assertion failed`) => {
    if (!e) throw Error(`[@data-slot/resizable] ${t}`);
  },
  wd = (e, t, n, r) => (t && bd(e, (n + r) / 2) < 0 ? n : r),
  Td = (e, t, n) => {
    let r = e[t];
    Cd(r != null, `Pane constraints should not be null.`);
    let { collapsedSize: i = 0, collapsible: a, maxSize: o = 100, minSize: s = 0 } = r,
      c = n;
    return (
      bd(c, s) < 0 && (c = wd(c, a, i, s)), (c = Math.min(o, c)), Number.parseFloat(c.toFixed(_d))
    );
  },
  Ed = (e, t, n, r, i) => {
    if (xd(e, 0)) return t;
    let a = [...t],
      [o, s] = r,
      c = 0;
    if (i === `keyboard`) {
      {
        let r = e < 0 ? s : o,
          i = n[r];
        if ((Cd(i), i.collapsible)) {
          let n = t[r];
          Cd(n != null);
          let { collapsedSize: a = 0, minSize: o = 0 } = i;
          if (xd(n, a)) {
            let t = o - n;
            bd(t, Math.abs(e)) > 0 && (e = e < 0 ? 0 - t : t);
          }
        }
      }
      {
        let r = e < 0 ? o : s,
          i = n[r];
        if ((Cd(i), i.collapsible)) {
          let n = t[r];
          Cd(n != null);
          let { collapsedSize: a = 0, minSize: o = 0 } = i;
          if (xd(n, o)) {
            let t = n - a;
            bd(t, Math.abs(e)) > 0 && (e = e < 0 ? 0 - t : t);
          }
        }
      }
    }
    {
      let r = e < 0 ? 1 : -1,
        i = e < 0 ? s : o,
        a = 0;
      for (;;) {
        let e = t[i];
        Cd(e != null);
        let o = Td(n, i, 100);
        if (((a += o - e), (i += r), i < 0 || i >= n.length)) break;
      }
      let c = Math.min(Math.abs(e), Math.abs(a));
      e = e < 0 ? 0 - c : c;
    }
    {
      let r = e < 0 ? o : s;
      for (; r >= 0 && r < n.length; ) {
        let i = Math.abs(e) - Math.abs(c),
          o = t[r];
        Cd(o != null);
        let s = o - i,
          l = Td(n, r, s);
        if (
          !xd(o, l) &&
          ((c += o - l),
          (a[r] = l),
          c.toPrecision(3).localeCompare(Math.abs(e).toPrecision(3), void 0, { numeric: !0 }) >= 0)
        )
          break;
        e < 0 ? --r : (r += 1);
      }
    }
    if (xd(c, 0)) return t;
    {
      let r = e < 0 ? s : o,
        i = t[r];
      Cd(i != null);
      let l = i + c,
        u = Td(n, r, l);
      if (((a[r] = u), !xd(u, l))) {
        let t = l - u,
          r = e < 0 ? s : o;
        for (; r >= 0 && r < n.length; ) {
          let i = a[r];
          Cd(i != null);
          let o = i + t,
            s = Td(n, r, o);
          if ((xd(i, s) || ((t -= s - i), (a[r] = s)), xd(t, 0))) break;
          e > 0 ? --r : (r += 1);
        }
      }
    }
    return xd(
      a.reduce((e, t) => e + t, 0),
      100,
    )
      ? a
      : t;
  },
  Dd = (e) => {
    let t = Array(e.length),
      n = 0,
      r = 100;
    for (let i = 0; i < e.length; i += 1) {
      let { defaultSize: a } = e[i];
      a != null && ((n += 1), (t[i] = a), (r -= a));
    }
    for (let i = 0; i < e.length; i += 1) {
      let { defaultSize: a } = e[i];
      if (a != null) continue;
      let o = e.length - n,
        s = r / o;
      ((n += 1), (t[i] = s), (r -= s));
    }
    return t;
  },
  Od = (e, t) => {
    let n = [...e],
      r = n.reduce((e, t) => e + t, 0);
    if (n.length !== t.length)
      throw Error(
        `[@data-slot/resizable] Invalid ${t.length} pane layout: ${n.map((e) => `${e}%`).join(`, `)}`,
      );
    if (!xd(r, 100)) for (let e = 0; e < t.length; e += 1) n[e] = (100 / r) * n[e];
    let i = 0;
    for (let e = 0; e < t.length; e += 1) {
      let r = n[e],
        a = Td(t, e, r);
      r !== a && ((i += r - a), (n[e] = a));
    }
    if (!xd(i, 0))
      for (let e = 0; e < t.length; e += 1) {
        let r = n[e],
          a = r + i,
          o = Td(t, e, a);
        if (r !== o && ((i -= o - r), (n[e] = o), xd(i, 0))) break;
      }
    return n;
  },
  kd = (e, t, n) => {
    let r = 0,
      i = 100,
      a = 0,
      o = 0,
      s = n[0];
    for (let e = 0; e < t.length; e += 1) {
      let { maxSize: n = 100, minSize: c = 0 } = t[e];
      e === s ? ((r = c), (i = n)) : ((a += c), (o += n));
    }
    return { valueMax: Math.min(i, 100 - a), valueMin: Math.max(r, 100 - o), valueNow: e[s] };
  },
  Ad = null,
  jd = null,
  Md = (e) => {
    switch (e) {
      case `horizontal`:
        return `ew-resize`;
      case `horizontal-max`:
        return `w-resize`;
      case `horizontal-min`:
        return `e-resize`;
      case `vertical`:
        return `ns-resize`;
      case `vertical-max`:
        return `n-resize`;
      case `vertical-min`:
        return `s-resize`;
    }
  },
  Nd = (e, t) => {
    jd !== e &&
      ((jd = e),
      Ad === null && ((Ad = t.createElement(`style`)), t.head.appendChild(Ad)),
      (Ad.innerHTML = `*{cursor: ${Md(e)}!important;}`));
  },
  Pd = () => {
    Ad !== null && (Ad.parentNode?.removeChild(Ad), (Ad = null), (jd = null));
  },
  Fd = (e, t) => {
    let n = e === `horizontal`;
    if (t.type.startsWith(`mouse`) || t.type.startsWith(`pointer`)) {
      let e = t;
      return n ? e.clientX : e.clientY;
    }
    if (t.type.startsWith(`touch`)) {
      let e = t.touches[0];
      return (Cd(e, `Expected a touch point`), n ? e.clientX : e.clientY);
    }
    throw Error(`[@data-slot/resizable] Unsupported event type "${t.type}"`);
  },
  Id = (e) => typeof PointerEvent < `u` && e instanceof PointerEvent,
  Ld = (e) => {
    let t = {},
      n = md(e, `defaultSize`),
      r = md(e, `minSize`),
      i = md(e, `maxSize`),
      a = md(e, `collapsedSize`),
      o = X(e, `collapsible`);
    return (
      n != null && (t.defaultSize = n),
      r != null && (t.minSize = r),
      i != null && (t.maxSize = i),
      a != null && (t.collapsedSize = a),
      o != null && (t.collapsible = o),
      t
    );
  };
function Rd(e, t = {}) {
  let n = Es(e, hd, gd);
  if (n) return n;
  let r = t.direction ?? e.getAttribute(`data-direction`) ?? `horizontal`,
    i = t.keyboardResizeBy ?? md(e, `keyboardResizeBy`) ?? 10,
    a = t.onLayoutChange,
    o = pd(e, `resizable-panel`),
    s = pd(e, `resizable-handle`);
  if (!o || o.length === 0) throw Error(`Resizable requires at least one resizable-panel slot`);
  if (s.length !== o.length - 1)
    throw Error(
      `Resizable expects exactly ${o.length - 1} handle(s) for ${o.length} panes, got ${s.length}`,
    );
  let c = e.ownerDocument?.defaultView ?? window,
    l = e.ownerDocument ?? document,
    u = r === `horizontal`,
    d = o.map(Ld),
    f = Od(Dd(d), d),
    p = new Map(),
    m = null,
    h = 0,
    g = [];
  (qs(e, `resizable`),
    (e.style.display = `flex`),
    (e.style.flexDirection = u ? `row` : `column`),
    (e.style.overflow = `hidden`),
    e.setAttribute(`data-slot`, `resizable`),
    e.setAttribute(`data-direction`, r),
    o.forEach((e) => {
      (qs(e, `resizable-panel`),
        e.setAttribute(`data-direction`, r),
        (e.style.flexBasis = `0`),
        (e.style.flexShrink = `1`),
        (e.style.overflow = `hidden`));
    }),
    s.forEach((e, t) => {
      (qs(e, `resizable-handle`),
        e.setAttribute(`role`, `separator`),
        e.setAttribute(`data-direction`, r),
        e.setAttribute(`aria-orientation`, u ? `vertical` : `horizontal`),
        e.hasAttribute(`tabindex`) || e.setAttribute(`tabindex`, `0`),
        (e.style.touchAction = `none`),
        (e.style.userSelect = `none`),
        (e.style.webkitUserSelect = `none`),
        e.setAttribute(`aria-controls`, o[t].id));
    }));
  let _ = () => {
      o.forEach((e, t) => {
        let n = b(t);
        (e.setAttribute(`data-state`, n ? `collapsed` : `expanded`),
          n
            ? (e.setAttribute(`data-collapsed`, ``), e.removeAttribute(`data-expanded`))
            : (e.setAttribute(`data-expanded`, ``), e.removeAttribute(`data-collapsed`)));
      });
    },
    v = () => {
      (o.forEach((e, t) => {
        ((e.style.flexGrow = o.length === 1 ? `1` : f[t].toPrecision(3)),
          (e.style.pointerEvents = m === null ? `` : `none`));
      }),
        s.forEach((e, t) => {
          let { valueMax: n, valueMin: r, valueNow: i } = kd(f, d, [t, t + 1]);
          (e.setAttribute(`aria-valuemax`, `${Math.round(n)}`),
            e.setAttribute(`aria-valuemin`, `${Math.round(r)}`),
            e.setAttribute(`aria-valuenow`, i == null ? `` : `${Math.round(i)}`));
        }),
        _());
    },
    y = (t) => {
      let n = !Sd(f, t);
      (n && (f = t), v(), n && (Ys(e, `resizable:change`, { layout: [...f] }), a?.([...f])));
    };
  function b(e) {
    let t = d[e],
      n = f[e];
    if (typeof n != `number`) return !1;
    let { collapsedSize: r = 0, collapsible: i } = t;
    return i === !0 && xd(n, r);
  }
  function x(e) {
    let { collapsedSize: t = 0, collapsible: n } = d[e];
    return !n || f[e] > t;
  }
  let S = (e) => [e, e + 1],
    C = (e) => {
      let t = 10;
      switch ((e.shiftKey ? (t = 100) : i != null && (t = i), e.key)) {
        case `ArrowDown`:
          return u ? 0 : t;
        case `ArrowLeft`:
          return u ? -t : 0;
        case `ArrowRight`:
          return u ? t : 0;
        case `ArrowUp`:
          return u ? 0 : -t;
        case `End`:
          return 100;
        case `Home`:
          return -100;
        default:
          return 0;
      }
    },
    w = (t, n) => {
      let i = f,
        a = S(t),
        o = n.type === `keydown`,
        s;
      if (o) s = C(n);
      else if (m != null) {
        let t = e.getBoundingClientRect(),
          i = u ? t.width : t.height,
          a = Fd(r, n) - m.initialCursorPosition;
        s = i === 0 ? 0 : (a / i) * 100;
      } else return;
      if (s === 0) return;
      l.dir === `rtl` && u && (s = -s);
      let c = m?.initialLayout ?? i,
        p = Ed(s, c, d, a, o ? `keyboard` : `mouse-or-touch`),
        g = !Sd(i, p);
      ((n.type.startsWith(`mouse`) || n.type.startsWith(`pointer`) || n.type.startsWith(`touch`)) &&
        h !== s &&
        ((h = s),
        Nd(
          g
            ? u
              ? `horizontal`
              : `vertical`
            : u
              ? s < 0
                ? `horizontal-min`
                : `horizontal-max`
              : s < 0
                ? `vertical-min`
                : `vertical-max`,
          l,
        )),
        g && y(p));
    },
    T = (e) => {
      m != null &&
        ((Id(e) && m.pointerId != null && e.pointerId !== m.pointerId) ||
          (e.preventDefault(), w(m.handleIndex, e)));
    },
    E = () => {
      if ((Pd(), m != null)) {
        let e = s[m.handleIndex];
        (m.pointerId != null &&
          e.hasPointerCapture?.(m.pointerId) &&
          e.releasePointerCapture(m.pointerId),
          e.removeAttribute(`data-active`),
          e.blur());
      }
      ((m = null), v(), Ys(e, `resizable:dragging`, { dragging: !1 }));
    },
    D = (t, n) => {
      if ((n.preventDefault(), m != null)) return;
      let i = s[t];
      if (i.getAttribute(`data-disabled`) === `true`) return;
      let a = Id(n) ? n.pointerId : void 0;
      (a != null && i.setPointerCapture?.(a),
        (m = {
          handleIndex: t,
          initialCursorPosition: Fd(r, n),
          initialLayout: [...f],
          pointerId: a,
        }),
        i.setAttribute(`data-active`, `pointer`),
        v(),
        Ys(e, `resizable:dragging`, { dragging: !0 }));
    };
  s.forEach((e, t) => {
    (g.push(Q(e, `pointerdown`, (e) => D(t, e))),
      g.push(Q(e, `pointermove`, T)),
      g.push(Q(e, `pointerup`, E)),
      g.push(Q(e, `pointercancel`, E)),
      g.push(Q(e, `mousedown`, (e) => D(t, e))),
      g.push(Q(e, `touchstart`, (e) => D(t, e), { passive: !1 })),
      g.push(Q(e, `mouseup`, E)),
      g.push(Q(e, `touchend`, E)),
      g.push(Q(e, `touchcancel`, E)),
      g.push(Q(e, `focus`, () => e.setAttribute(`data-active`, `keyboard`))),
      g.push(
        Q(e, `blur`, () => {
          m?.handleIndex !== t && e.removeAttribute(`data-active`);
        }),
      ),
      g.push(
        Q(e, `keydown`, (n) => {
          let r = n;
          if (!(e.getAttribute(`data-disabled`) === `true` || r.defaultPrevented)) {
            if (vd.includes(r.key)) {
              (r.preventDefault(), w(t, r));
              return;
            }
            if (r.key === `Enter`) {
              r.preventDefault();
              let e = d[t],
                n = f[t],
                { collapsedSize: i = 0, collapsible: a, minSize: o = 0 } = e;
              if (n == null || !a) return;
              let s = xd(n, i) ? o - n : i - n;
              y(Ed(s, f, d, S(t), `keyboard`));
              return;
            }
            if (r.key === `F6`) {
              r.preventDefault();
              let e = r.shiftKey ? (t - 1 + s.length) % s.length : (t + 1) % s.length;
              s[e].focus();
            }
          }
        }),
      ));
  });
  let O = l.body;
  (g.push(Q(O, `pointermove`, T)),
    g.push(Q(O, `mousemove`, T)),
    g.push(Q(O, `touchmove`, T, { passive: !1 })),
    g.push(Q(O, `mouseleave`, T)),
    g.push(Q(O, `contextmenu`, E)),
    g.push(Q(c, `pointerup`, E)),
    g.push(Q(c, `pointercancel`, E)),
    g.push(Q(c, `mouseup`, E)),
    g.push(Q(c, `touchend`, E)));
  let k = (e, t) => {
      let n = e === o.length - 1,
        r = n ? [e - 1, e] : [e, e + 1],
        i = f[e],
        a = n ? i - t : t - i;
      y(Ed(a, f, d, r, `imperative-api`));
    },
    A = (e) => {
      let t = d[e];
      if (!t.collapsible) return;
      let { collapsedSize: n = 0 } = t,
        r = f[e];
      if (xd(r, n)) return;
      p.set(e, r);
      let i = e === o.length - 1,
        a = i ? [e - 1, e] : [e, e + 1],
        s = i ? r - n : n - r;
      y(Ed(s, f, d, a, `imperative-api`));
    },
    j = (e) => {
      let t = d[e];
      if (!t.collapsible) return;
      let { collapsedSize: n = 0, minSize: r = 0 } = t,
        i = f[e];
      if (!xd(i, n)) return;
      let a = p.get(e),
        s = a != null && a >= r ? a : r,
        c = e === o.length - 1,
        l = c ? [e - 1, e] : [e, e + 1],
        u = c ? i - s : s - i;
      y(Ed(u, f, d, l, `imperative-api`));
    };
  (v(),
    Ys(e, `resizable:change`, { layout: [...f] }),
    g.push(
      Q(e, `resizable:set`, (e) => {
        let t = e.detail;
        t?.layout && Array.isArray(t.layout) && y(Od(t.layout, d));
      }),
    ));
  let M = {
    get layout() {
      return [...f];
    },
    setLayout: (e) => y(Od(e, d)),
    resizePane: k,
    collapse: A,
    expand: j,
    isCollapsed: b,
    isExpanded: x,
    getSize: (e) => f[e],
    destroy: () => {
      (E(), g.forEach((e) => e()), (g.length = 0), ws(e, hd, M));
    },
  };
  return (Cs(e, hd, M), M);
}
function zd(e, t = {}) {
  return (xs(e, hd)?.destroy(), Rd(e, t));
}
function Bd(e) {
  return Ss(e, hd);
}
function Vd(e) {
  return xs(e, hd);
}
function Hd(e = document) {
  let t = [];
  for (let n of gs(e, `resizable`)) Ss(n, hd) || t.push(Rd(n));
  return t;
}
var Ud = ms({ create: () => tf, createSlider: () => ef }),
  Wd = [`horizontal`, `vertical`],
  Gd = [`center`, `edge`, `edge-client-only`],
  Kd = `@areia/slots:Slider`,
  qd = `[@areia/slots:Slider] createSlider() called more than once for the same root. Returning the existing controller. Destroy it before rebinding with new options.`;
function Jd(e) {
  if (!e) return;
  let t = e.split(`,`).map((e) => parseFloat(e.trim()));
  if (!t.some((e) => isNaN(e))) {
    if (t.length === 2) return [t[0], t[1]];
    if (t.length === 1) return t[0];
  }
}
function Yd(e) {
  return Array.isArray(e);
}
function Xd(e, t, n, r) {
  let i = Math.round((e - t) / r) * r + t,
    a = r.toString().split(`.`)[1]?.length ?? 0,
    o = parseFloat(i.toFixed(a));
  return Math.min(n, Math.max(t, o));
}
function Zd(e, t, n) {
  return n === t ? 0 : ((e - t) / (n - t)) * 100;
}
function Qd(e, t, n) {
  return (e / 100) * (n - t) + t;
}
function $d(e) {
  return Math.max(0, Math.min(100, e));
}
function ef(e, t = {}) {
  let n = Es(e, Kd, qd);
  if (n) return n;
  let r = e,
    i = Y(e, `slider-track`),
    a = hs(e, `slider-thumb`),
    o = Y(e, `slider-range`),
    s = Y(e, `slider-control`);
  if (!i || a.length === 0)
    throw Error(`Slider requires slider-track and at least one slider-thumb`);
  let c = s ?? (i.parentElement instanceof HTMLElement ? i.parentElement : null) ?? r,
    l = t.min ?? Ps(e, `min`) ?? 0,
    u = t.max ?? Ps(e, `max`) ?? 100;
  l > u && ([l, u] = [u, l]);
  let d = t.step ?? Ps(e, `step`) ?? 1;
  d <= 0 && (d = 1);
  let f = t.largeStep ?? Ps(e, `largeStep`) ?? d * 10,
    p = t.orientation ?? Is(e, `orientation`, Wd) ?? `horizontal`,
    m = t.thumbAlignment ?? Is(e, `thumbAlignment`, Gd) ?? `center`,
    h = t.disabled ?? X(e, `disabled`) ?? !1,
    g = t.onValueChange,
    _ = t.onValueCommit,
    v = Jd(Fs(e, `defaultValue`)),
    y = t.defaultValue ?? v ?? l,
    b = a.length >= 2;
  b && !Yd(y) ? (y = [l, y]) : !b && Yd(y) && (y = y[1]);
  let x = Yd(y) ? [Xd(y[0], l, u, d), Xd(y[1], l, u, d)] : Xd(y, l, u, d),
    S = [],
    C = null,
    w = 0,
    T = null,
    E = null,
    D = 0,
    O = null,
    k = Array.from(new Set([r, c, i, o, ...a].filter((e) => e instanceof HTMLElement)));
  ((() => {
    for (let e of k) e.setAttribute(`data-orientation`, p);
  })(),
    ((e) => {
      for (let t of k) e ? t.setAttribute(`data-disabled`, ``) : t.removeAttribute(`data-disabled`);
      for (let t of a) (Z(t, `disabled`, e), (t.tabIndex = e ? -1 : 0));
    })(h));
  let A = (e, t) => {
    (e.setAttribute(`role`, `slider`),
      (e.tabIndex = h ? -1 : 0),
      qs(e, `slider-thumb`),
      Z(e, `orientation`, p),
      b ? e.setAttribute(`data-index`, String(t)) : e.removeAttribute(`data-index`));
    let n = e.hasAttribute(`aria-label`) || e.hasAttribute(`aria-labelledby`),
      r = e.dataset.label;
    r ? Z(e, `label`, r) : !n && b && Z(e, `label`, t === 0 ? `Minimum` : `Maximum`);
  };
  for (let e = 0; e < a.length; e++) A(a[e], e);
  let j = p === `horizontal`,
    M = m !== `center`,
    N = Array.from(new Set([r, c, i, ...a].filter((e) => e instanceof HTMLElement))),
    ee = () => {
      i.style.position = `relative`;
    },
    P = (e, t) => {
      ((e.style.position = `absolute`),
        e.style.setProperty(`--position`, `${t}%`),
        j
          ? (e.style.setProperty(`inset-inline-start`, `var(--position)`),
            (e.style.top = `50%`),
            (e.style.bottom = ``),
            (e.style.left = ``),
            e.style.setProperty(`translate`, `-50% -50%`))
          : (e.style.removeProperty(`inset-inline-start`),
            (e.style.bottom = `var(--position)`),
            (e.style.left = `50%`),
            (e.style.top = ``),
            e.style.setProperty(`translate`, `-50% 50%`)));
    },
    F = (e, t, n) => {
      if (!o) return;
      let r = n ? e : t;
      (o.style.setProperty(`--start-position`, `${r}%`),
        (o.style.position = j ? `relative` : `absolute`),
        j
          ? (o.style.setProperty(`inset-inline-start`, n ? `var(--start-position)` : `0%`),
            (o.style.width = n ? `var(--relative-size)` : `var(--start-position)`),
            (o.style.height = `inherit`),
            (o.style.bottom = ``),
            (o.style.left = ``))
          : (o.style.removeProperty(`inset-inline-start`),
            (o.style.bottom = n ? `var(--start-position)` : `0%`),
            (o.style.height = n ? `var(--relative-size)` : `var(--start-position)`),
            (o.style.width = `inherit`),
            (o.style.left = ``)),
        n
          ? o.style.setProperty(`--relative-size`, `${t}%`)
          : o.style.removeProperty(`--relative-size`));
    };
  ee();
  let I = (e) => (j ? e.width : e.height),
    L = (e, t) => (j ? t.left - e.left : e.bottom - t.bottom),
    te = (e) => (e.offsetParent instanceof HTMLElement ? e.offsetParent : c),
    R = (e, t, n) => {
      if (!Number.isFinite(t) || !Number.isFinite(n) || t <= 0) return;
      let r = Math.min(t, n),
        i = Math.max(0, t - r),
        a = $d(((r / 2 + (i * e) / 100) / t) * 100);
      return Number.isFinite(a) ? a : void 0;
    },
    z = (e, t) => {
      let n = { thumbPercent: t, trackPercent: t };
      if (!e || !M) return n;
      let r = i.getBoundingClientRect(),
        a = e.getBoundingClientRect(),
        o = te(e).getBoundingClientRect(),
        s = I(r),
        c = I(a),
        l = I(o);
      if (!Number.isFinite(s) || !Number.isFinite(c) || !Number.isFinite(l) || s <= 0 || l <= 0)
        return n;
      let u = R(t, s, c);
      if (u === void 0) return n;
      let d = Math.min(s, c),
        f = Math.max(0, s - d),
        p = d / 2 + (f * t) / 100,
        m = $d(((L(o, r) + p) / l) * 100);
      return !Number.isFinite(u) || !Number.isFinite(m) ? n : { thumbPercent: m, trackPercent: u };
    },
    B = (e, t) => {
      let n = { startPercent: e, sizePercent: Math.max(0, t - e) };
      if (!M) return n;
      let r = i.getBoundingClientRect(),
        o = I(r);
      if (!Number.isFinite(o) || o <= 0) return n;
      let s = a
        .slice(0, 2)
        .map((e) => (e instanceof HTMLElement ? I(e.getBoundingClientRect()) : NaN));
      if (s.length < 2 || s.some((e) => !Number.isFinite(e) || e <= 0)) return n;
      let c = Math.max(...s),
        l = R(e, o, c),
        u = R(t, o, c);
      return l === void 0 || u === void 0
        ? n
        : { startPercent: l, sizePercent: Math.max(0, u - l) };
    },
    V = () => {
      if (Yd(x)) {
        let [e, t] = x,
          n = Zd(e, l, u),
          r = Zd(t, l, u),
          i = z(a[0], n),
          o = z(a[1], r),
          s = B(n, r);
        (a[0] &&
          (Z(a[0], `valuenow`, String(e)),
          Z(a[0], `valuemin`, String(l)),
          Z(a[0], `valuemax`, String(t)),
          P(a[0], i.thumbPercent)),
          a[1] &&
            (Z(a[1], `valuenow`, String(t)),
            Z(a[1], `valuemin`, String(e)),
            Z(a[1], `valuemax`, String(u)),
            P(a[1], o.thumbPercent)),
          F(s.startPercent, s.sizePercent, !0));
      } else {
        let e = Zd(x, l, u),
          t = z(a[0], e);
        (a[0] &&
          (Z(a[0], `valuenow`, String(x)),
          Z(a[0], `valuemin`, String(l)),
          Z(a[0], `valuemax`, String(u)),
          P(a[0], t.thumbPercent)),
          F(0, t.trackPercent, !1));
      }
      Yd(x)
        ? e.setAttribute(`data-value`, `${x[0]},${x[1]}`)
        : e.setAttribute(`data-value`, String(x));
    },
    ne = (e, t) => (Yd(e) && Yd(t) ? e[0] === t[0] && e[1] === t[1] : e === t),
    H = (t, n = !0) => {
      let r;
      if (Yd(t)) {
        let [e, n] = t;
        ((e = Xd(e, l, u, d)), (n = Xd(n, l, u, d)), e > n && ([e, n] = [n, e]), (r = [e, n]));
      } else r = Xd(t, l, u, d);
      return ne(r, x)
        ? !1
        : ((x = r), V(), n && (Ys(e, `slider:change`, { value: x }), g?.(x)), !0);
    };
  (V(),
    (() => {
      if ((O?.disconnect(), (O = null), !(!M || typeof ResizeObserver != `function`))) {
        O = new ResizeObserver(() => {
          V();
        });
        for (let e of N) O.observe(e);
      }
    })(),
    S.push(() => {
      (O?.disconnect(), (O = null));
    }));
  let re = (e, t = null) => {
      let n = i.getBoundingClientRect(),
        r = I(n);
      if (r === 0) return null;
      let o = (j ? e.clientX : e.clientY) - D,
        s = j ? o - n.left : n.bottom - o,
        c = (s / r) * 100;
      if (M && t !== null) {
        let e = a[t]?.getBoundingClientRect(),
          n = e ? I(e) : 0,
          i = r - n;
        Number.isFinite(n) && n > 0 && i > 0 && (c = ((s - n / 2) / i) * 100);
      }
      return ((c = $d(c)), Qd(c, l, u));
    },
    ie = (e, t) => {
      if (!M || e === null) return 0;
      let n = a[e],
        r = n?.getBoundingClientRect(),
        i = r ? I(r) : 0;
      if (!n || !Number.isFinite(i) || i <= 0) return 0;
      let o = j ? r.left + r.width / 2 : r.top + r.height / 2;
      return (j ? t.clientX : t.clientY) - o;
    },
    ae = (e) => {
      if (!e || !(e instanceof HTMLElement)) return null;
      let t = a.indexOf(e);
      if (t !== -1) return t;
      for (let t = 0; t < a.length; t++) if (a[t].contains(e)) return t;
      return null;
    },
    oe = (e) => {
      if (!Yd(x)) return 0;
      let [t, n] = x,
        r = Math.abs(e - t),
        i = Math.abs(e - n);
      return r === i ? w : r < i ? 0 : 1;
    },
    se = (e, t) => {
      if (Yd(x)) {
        let [n, r] = x;
        if (e === 0) {
          let e = Xd(t, l, r, d);
          return H([e, r]);
        } else {
          let e = Xd(t, n, u, d);
          return H([n, e]);
        }
      } else return H(t);
    },
    ce = (t) => {
      if (h) return;
      t.preventDefault();
      let n = ae(t.target);
      D = ie(n, t);
      let r = re(t, n);
      if (r === null) {
        D = 0;
        return;
      }
      if (n === null) {
        n = oe(r);
        let e = re(t, n);
        e !== null && (r = e);
      }
      ((C = n),
        (w = n),
        e.setAttribute(`data-dragging`, ``),
        a[n]?.setAttribute(`data-dragging`, ``),
        a[n]?.focus(),
        (E = c.style.touchAction),
        (c.style.touchAction = `none`),
        se(n, r),
        c.setPointerCapture(t.pointerId));
    },
    le = (e) => {
      if (C === null || h) return;
      e.preventDefault();
      let t = re(e, C);
      t !== null && se(C, t);
    },
    ue = (t) => {
      if (C !== null) {
        e.removeAttribute(`data-dragging`);
        for (let e of a) e.removeAttribute(`data-dragging`);
        ((c.style.touchAction = E ?? ``),
          (E = null),
          Ys(e, `slider:commit`, { value: x }),
          _?.(x),
          (C = null),
          (D = 0));
        try {
          c.releasePointerCapture(t.pointerId);
        } catch {}
      }
    };
  (S.push(Q(c, `pointerdown`, ce)),
    S.push(Q(c, `pointermove`, le)),
    S.push(Q(c, `pointerup`, ue)),
    S.push(Q(c, `pointercancel`, ue)));
  let de = (e) => {
      if (h) return;
      let t = e.target,
        n = a.indexOf(t);
      if (n === -1) return;
      let r = 0,
        i = null;
      switch (e.key) {
        case `ArrowRight`:
          if (!j) return;
          r = d;
          break;
        case `ArrowLeft`:
          if (!j) return;
          r = -d;
          break;
        case `ArrowUp`:
          if (j) return;
          r = d;
          break;
        case `ArrowDown`:
          if (j) return;
          r = -d;
          break;
        case `PageUp`:
          r = f;
          break;
        case `PageDown`:
          r = -f;
          break;
        case `Home`:
          i = l;
          break;
        case `End`:
          i = u;
          break;
        default:
          return;
      }
      (e.shiftKey && e.key.startsWith(`Arrow`) && (r = r > 0 ? f : r < 0 ? -f : 0),
        e.preventDefault(),
        (w = n),
        T === null && (T = Yd(x) ? [x[0], x[1]] : x));
      let o = Yd(x) ? (x[n] ?? x[0]) : x,
        s = i === null ? o + r : i;
      se(n, s);
    },
    fe = () => {
      T !== null && (ne(T, x) || (Ys(e, `slider:commit`, { value: x }), _?.(x)), (T = null));
    };
  for (let e of a) (S.push(Q(e, `keydown`, de)), S.push(Q(e, `blur`, fe)));
  S.push(
    Q(e, `slider:set`, (t) => {
      if (h) return;
      let n = t.detail,
        r;
      (typeof n == `number` || Array.isArray(n)
        ? (r = n)
        : n && typeof n == `object` && `value` in n && (r = n.value),
        r !== void 0 && H(r) && (Ys(e, `slider:commit`, { value: x }), _?.(x)));
    }),
  );
  let pe = {
    setValue: (e) => {
      H(e);
    },
    get value() {
      return x;
    },
    get min() {
      return l;
    },
    get max() {
      return u;
    },
    get disabled() {
      return h;
    },
    destroy: () => {
      ((D = 0), S.forEach((e) => e()), (S.length = 0), ws(e, Kd, pe));
    },
  };
  return (Cs(e, Kd, pe), pe);
}
function tf(e = document) {
  let t = [];
  for (let n of gs(e, `slider`)) Ss(n, Kd) || t.push(ef(n));
  return t;
}
var nf = ms({ create: () => _f, createSwitch: () => gf }),
  rf = `@areia/slots:Switch`,
  af = `[@areia/slots:Switch] createSwitch() called more than once for the same root. Returning the existing controller. Destroy it before rebinding with new options.`,
  of = [
    `position:absolute`,
    `width:1px`,
    `height:1px`,
    `padding:0`,
    `margin:-1px`,
    `overflow:hidden`,
    `clip:rect(0, 0, 0, 0)`,
    `white-space:nowrap`,
    `border:0`,
    `pointer-events:none`,
  ].join(`;`);
function sf(e, t, n) {
  n ? e.setAttribute(t, ``) : e.removeAttribute(t);
}
function cf(e, t) {
  (sf(e, `data-checked`, t), sf(e, `data-unchecked`, !t));
}
function lf(e, t, n, r) {
  (sf(e, `data-disabled`, t), sf(e, `data-readonly`, n), sf(e, `data-required`, r));
}
function uf(e, t) {
  let n = new Set();
  if (e) for (let t of e.split(/\s+/)) t && n.add(t);
  for (let e of t) e && n.add(e);
  return n.size > 0 ? [...n].join(` `) : null;
}
function df(e, t) {
  let n = e.parentNode;
  if (!n) {
    e.appendChild(t);
    return;
  }
  n.insertBefore(t, e.nextSibling);
}
function ff(e) {
  return e.tagName === `BUTTON`;
}
function pf(e) {
  let t = e.tagName;
  return (
    t === `BUTTON` ||
    t === `INPUT` ||
    t === `SELECT` ||
    t === `TEXTAREA` ||
    (t === `A` && e.hasAttribute(`href`))
  );
}
function mf(e, t) {
  let n = [],
    r = e.closest(`label`);
  r instanceof HTMLLabelElement && n.push(r);
  let i = t?.id || e.id;
  if (!i) return n;
  let a = e.ownerDocument ?? document,
    o = `label[for="${CSS.escape(i)}"]`;
  for (let e of a.querySelectorAll(o)) n.includes(e) || n.push(e);
  return n;
}
function hf(e) {
  return (
    e.querySelector(`:scope > input[type="checkbox"][data-slot="switch-input"]`) ||
    e.querySelector(`:scope > input[type="checkbox"]`)
  );
}
function gf(e, t = {}) {
  let n = Es(e, rf, af);
  if (n) return n;
  let r = e,
    i = hf(r),
    a =
      t.disabled ??
      X(r, `disabled`) ??
      i?.disabled ??
      (r.hasAttribute(`disabled`) || r.getAttribute(`aria-disabled`) === `true`),
    o = t.readOnly ?? X(r, `readOnly`) ?? r.getAttribute(`aria-readonly`) === `true`,
    s = t.required ?? X(r, `required`) ?? i?.required ?? r.getAttribute(`aria-required`) === `true`,
    c =
      t.defaultChecked ??
      X(r, `defaultChecked`) ??
      i?.checked ??
      r.getAttribute(`aria-checked`) === `true`,
    l = t.name ?? Fs(r, `name`) ?? i?.name,
    u = t.value ?? Fs(r, `value`) ?? i?.value,
    d = t.uncheckedValue ?? Fs(r, `uncheckedValue`),
    f = t.onCheckedChange,
    p = [],
    m = e.ownerDocument ?? document,
    h = i ?? m.createElement(`input`);
  i
    ? h.hasAttribute(`data-switch-generated`) || h.setAttribute(`data-switch-generated`, `input`)
    : ((h.type = `checkbox`),
      (h.tabIndex = -1),
      h.setAttribute(`aria-hidden`, `true`),
      h.setAttribute(`data-switch-generated`, `input`),
      (h.style.cssText = of),
      df(r, h));
  let g = null,
    _ = !!c;
  h.defaultChecked = _;
  let v = () => hs(r, `switch-thumb`),
    y = () => {
      if (
        ((h.checked = _),
        (h.disabled = a),
        (h.required = s),
        l ? (h.name = l) : h.removeAttribute(`name`),
        u === void 0 ? h.removeAttribute(`value`) : (h.value = u),
        !(!a && !_ && l !== void 0 && d !== void 0))
      ) {
        (g?.remove(), (g = null));
        return;
      }
      (g ||
        ((g = m.createElement(`input`)),
        (g.type = `hidden`),
        g.setAttribute(`data-switch-generated`, `unchecked`),
        df(h, g)),
        (g.name = l),
        (g.value = d),
        (g.disabled = a));
    },
    b = () => {
      (ff(r)
        ? (r.hasAttribute(`type`) || r.setAttribute(`type`, `button`), (r.disabled = a))
        : pf(r) || (a ? (r.tabIndex = -1) : r.hasAttribute(`tabindex`) || (r.tabIndex = 0)),
        r.setAttribute(`role`, `switch`),
        Z(r, `checked`, _),
        Z(r, `disabled`, a ? !0 : null),
        Z(r, `readonly`, o ? !0 : null),
        Z(r, `required`, s ? !0 : null),
        cf(r, _),
        lf(r, a, o, s));
      for (let e of v()) (cf(e, _), lf(e, a, o, s));
    },
    x = (e, t = !0) => {
      if (_ === e) {
        (y(), b());
        return;
      }
      ((_ = e), y(), b(), t && (Ys(r, `switch:change`, { checked: _ }), f?.(_)));
    },
    S = () => {
      a || o || h.click();
    },
    C = mf(r, i);
  if (C.length > 0) {
    let e = C.map((e) => qs(e, `switch-label`)),
      t = uf(r.getAttribute(`aria-labelledby`), e);
    t && r.setAttribute(`aria-labelledby`, t);
  }
  (y(), b());
  let w = h.form ?? (r.closest(`form`) instanceof HTMLFormElement ? r.closest(`form`) : null);
  (w &&
    p.push(
      Q(w, `reset`, () => {
        queueMicrotask(() => {
          x(h.checked, !1);
        });
      }),
    ),
    p.push(
      Q(h, `click`, (e) => {
        (a || o) && e.preventDefault();
      }),
    ),
    p.push(
      Q(h, `change`, () => {
        x(h.checked);
      }),
    ),
    p.push(
      Q(r, `click`, (e) => {
        if (e.target !== h && e.target !== g) {
          if (a || o) {
            e.preventDefault();
            return;
          }
          (e.preventDefault(), h.click());
        }
      }),
    ),
    ff(r) ||
      p.push(
        Q(r, `keydown`, (e) => {
          let t = e;
          t.repeat ||
            ((t.key === `Enter` || t.key === ` ` || t.key === `Spacebar`) &&
              (t.preventDefault(), S()));
        }),
      ));
  for (let e of C)
    e.contains(r) ||
      p.push(
        Q(e, `click`, (e) => {
          (e.preventDefault(), S());
        }),
      );
  p.push(
    Q(r, `switch:set`, (e) => {
      let t = e.detail,
        n =
          typeof t == `boolean`
            ? t
            : typeof t?.checked == `boolean`
              ? t.checked
              : typeof t?.value == `boolean`
                ? t.value
                : void 0;
      typeof n == `boolean` && x(n);
    }),
  );
  let T = {
    get checked() {
      return _;
    },
    toggle: () => x(!_),
    check: () => x(!0),
    uncheck: () => x(!1),
    setChecked: (e) => x(!!e),
    destroy: () => {
      (p.forEach((e) => e()), (p.length = 0), i || h.remove(), g?.remove(), ws(r, rf, T));
    },
  };
  return (Cs(r, rf, T), T);
}
function _f(e = document) {
  let t = [];
  for (let n of gs(e, `switch`)) Ss(n, rf) || t.push(gf(n));
  return t;
}
var vf = ms({ create: () => Tf, createTabs: () => wf }),
  yf = [`horizontal`, `vertical`],
  bf = [`auto`, `manual`],
  xf = `@areia/slots:Tabs`,
  Sf = `[@areia/slots:Tabs] createTabs() called more than once for the same root. Returning the existing controller. Destroy it before rebinding with new options.`,
  Cf = `a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])`;
function wf(e, t = {}) {
  let n = Es(e, xf, Sf);
  if (n) return n;
  let r = Y(e, `tabs-list`),
    i = hs(e, `tabs-trigger`),
    a = hs(e, `tabs-content`),
    o = Y(e, `tabs-indicator`);
  if (!r || i.length === 0) throw Error(`Tabs requires tabs-list and at least one tabs-trigger`);
  let s = t.onValueChange,
    c = t.orientation ?? Is(e, `orientation`, yf) ?? `horizontal`,
    l = t.activationMode ?? Is(e, `activationMode`, bf) ?? `auto`,
    u = new Map();
  for (let e of a) {
    let t = (e.dataset.value || ``).trim();
    t && u.set(t, e);
  }
  let d = [],
    f = new Map(),
    p = new Map();
  for (let e of i) {
    let t = (e.dataset.value || ``).trim();
    if (!t) continue;
    let n = {
      el: e,
      value: t,
      disabled:
        e.hasAttribute(`disabled`) ||
        e.dataset.disabled !== void 0 ||
        e.getAttribute(`aria-disabled`) === `true`,
      panel: u.get(t),
    };
    (d.push(n), f.set(t, n), p.set(e, n));
  }
  let m = d.filter((e) => !e.disabled),
    h = new Map();
  m.forEach((e, t) => h.set(e.value, t));
  let g = m[0]?.value || ``,
    _ = (t.defaultValue ?? Fs(e, `defaultValue`) ?? ``).trim(),
    v = f.get(_),
    y = v && !v.disabled ? _ : g,
    b = [],
    x = null;
  (r.setAttribute(`role`, `tablist`), c === `vertical` && Z(r, `orientation`, `vertical`));
  for (let e of d) {
    let { el: t, disabled: n, panel: r } = e;
    t.setAttribute(`role`, `tab`);
    let i = qs(t, `tab`);
    if (
      (t.tagName === `BUTTON` && !t.hasAttribute(`type`) && (t.type = `button`),
      n && (t.setAttribute(`aria-disabled`, `true`), t.tagName === `BUTTON` && (t.disabled = !0)),
      r)
    ) {
      (r.setAttribute(`role`, `tabpanel`), (r.tabIndex = -1));
      let e = qs(r, `tabpanel`);
      (t.setAttribute(`aria-controls`, e), r.setAttribute(`aria-labelledby`, i));
    }
  }
  let S = () => {
      o &&
        (o.style.setProperty(`--active-tab-left`, `0px`),
        o.style.setProperty(`--active-tab-width`, `0px`),
        o.style.setProperty(`--active-tab-top`, `0px`),
        o.style.setProperty(`--active-tab-height`, `0px`));
    },
    C = (e) => {
      let t = 0,
        n = 0,
        i = e;
      for (; i && i !== r; ) {
        ((t += i.offsetLeft), (n += i.offsetTop));
        let e = i.offsetParent;
        if (!(e instanceof HTMLElement)) return null;
        (e !== r && ((t -= e.scrollLeft), (n -= e.scrollTop)), (i = e));
      }
      if (i !== r) return null;
      let a = {
          left: t - r.clientLeft,
          top: n - r.clientTop,
          width: e.offsetWidth,
          height: e.offsetHeight,
        },
        o = w(e);
      return (
        o && (c === `horizontal` ? (a.top = Math.floor(o.top)) : (a.left = Math.floor(o.left))), a
      );
    },
    w = (e) => {
      let t = r.getBoundingClientRect(),
        n = e.getBoundingClientRect();
      if ((t.width === 0 && t.height === 0) || (n.width === 0 && n.height === 0)) return null;
      let i = (e, t) => {
          if (t <= 0) return 1;
          let n = e / t;
          return Math.abs(n - 1) < 0.05 ? 1 : n;
        },
        a = i(n.width, e.offsetWidth),
        o = i(n.height, e.offsetHeight);
      return {
        left: (n.left - t.left - r.clientLeft + r.scrollLeft) / a,
        top: (n.top - t.top - r.clientTop + r.scrollTop) / o,
        width: e.offsetWidth,
        height: e.offsetHeight,
      };
    },
    T = () => {
      if (!o) return;
      let e = f.get(y);
      if (!e) {
        S();
        return;
      }
      let t = C(e.el) ?? w(e.el);
      if (!t) {
        S();
        return;
      }
      (o.style.setProperty(`--active-tab-left`, `${t.left}px`),
        o.style.setProperty(`--active-tab-width`, `${t.width}px`),
        o.style.setProperty(`--active-tab-top`, `${t.top}px`),
        o.style.setProperty(`--active-tab-height`, `${t.height}px`));
    },
    E = () => {
      !o ||
        x !== null ||
        (x = requestAnimationFrame(() => {
          ((x = null), T());
        }));
    },
    D = (e, t) => {
      let n = d.findIndex((t) => t.value === e),
        r = d.findIndex((e) => e.value === t);
      return n < 0 || r < 0 || n === r
        ? null
        : c === `vertical`
          ? r > n
            ? `down`
            : `up`
          : r > n
            ? `right`
            : `left`;
    },
    O = (t, n = !1) => {
      if (((t = t.trim()), y === t && !n)) return;
      let r = f.get(t);
      if (!r || r.disabled)
        if (n) {
          if (((t = g), !t)) return;
        } else return;
      let i = y,
        o = i !== t,
        c = !n && o ? D(i, t) : null;
      y = t;
      for (let e of d) {
        let n = e.value === t;
        (Z(e.el, `selected`, n),
          (e.el.tabIndex = n && !e.disabled ? 0 : -1),
          (e.el.dataset.state = n ? `active` : `inactive`));
      }
      for (let e of a) {
        let n = (e.dataset.value || ``).trim();
        if (!n) continue;
        let r = n === t;
        ((e.hidden = !r),
          (e.dataset.state = r ? `active` : `inactive`),
          c ? (e.dataset.activationDirection = c) : delete e.dataset.activationDirection);
      }
      (e.setAttribute(`data-value`, t),
        E(),
        o && !n && (Ys(e, `tabs:change`, { value: t }), s?.(t)));
    };
  if ((O(y, !0), o)) {
    let e = () => E();
    (b.push(Q(window, `resize`, e)), b.push(Q(r, `scroll`, e)));
    let t = new ResizeObserver(e);
    (t.observe(r),
      b.push(() => t.disconnect()),
      b.push(() => {
        x !== null && (cancelAnimationFrame(x), (x = null));
      }));
  }
  b.push(
    Q(r, `click`, (e) => {
      let t = e.target.closest?.(`[data-slot="tabs-trigger"]`);
      if (!t) return;
      let n = p.get(t);
      n && !n.disabled && O(n.value);
    }),
  );
  let k = c === `horizontal`,
    A = k ? `ArrowLeft` : `ArrowUp`,
    j = k ? `ArrowRight` : `ArrowDown`;
  b.push(
    Q(r, `keydown`, (e) => {
      let t = e.target.closest?.(`[data-slot="tabs-trigger"]`);
      if (!t) return;
      let n = p.get(t);
      if (!n || m.length === 0) return;
      if (e.key === `Enter` || e.key === ` `) {
        (e.preventDefault(), n.disabled || O(n.value));
        return;
      }
      if (k && e.key === `ArrowDown` && n.value === y) {
        let t = n.panel;
        if (t) {
          (e.preventDefault(), (t.querySelector(Cf) || t).focus());
          return;
        }
      }
      let r = h.get(n.value) ?? -1;
      r === -1 && (r = h.get(y) ?? 0);
      let i = r;
      switch (e.key) {
        case A:
          ((i = r - 1), i < 0 && (i = m.length - 1));
          break;
        case j:
          ((i = r + 1), i >= m.length && (i = 0));
          break;
        case `Home`:
          i = 0;
          break;
        case `End`:
          i = m.length - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      let a = m[i];
      a && (a.el.focus(), l === `auto` && O(a.value));
    }),
  );
  let M = (e) => {
    let t = e,
      n = e.currentTarget,
      r = t.detail,
      i = (typeof r == `string` ? r : (r?.value ?? n?.dataset?.value))?.trim();
    i && O(i);
  };
  (b.push(Q(e, `tabs:set`, M)), b.push(Q(e, `tabs:select`, M)));
  let N = {
    select: (e) => O(e),
    get value() {
      return y;
    },
    updateIndicator: T,
    destroy: () => {
      (b.forEach((e) => e()), (b.length = 0), ws(e, xf, N));
    },
  };
  return (Cs(e, xf, N), N);
}
function Tf(e = document) {
  let t = [];
  for (let n of gs(e, `tabs`)) Ss(n, xf) || t.push(wf(n));
  return t;
}
var Ef = ms({ create: () => Af, createToggle: () => kf }),
  Df = `@areia/slots:Toggle`,
  Of = `[@areia/slots:Toggle] createToggle() called more than once for the same root. Returning the existing controller. Destroy it before rebinding with new options.`;
function kf(e, t = {}) {
  let n = Es(e, Df, Of);
  if (n) return n;
  let r = t.defaultPressed ?? X(e, `defaultPressed`) ?? !1,
    i = t.disabled ?? X(e, `disabled`) ?? !1,
    a = t.onPressedChange,
    o = r,
    s = [],
    c = () => e.hasAttribute(`disabled`) || e.getAttribute(`aria-disabled`) === `true`,
    l = (t, n = !1) => {
      (o === t && !n) ||
        ((o = t),
        Z(e, `pressed`, o),
        (e.dataset.state = o ? `on` : `off`),
        n || (Ys(e, `toggle:change`, { pressed: o }), a?.(o)));
    };
  (i &&
    (e.tagName === `BUTTON` && e.setAttribute(`disabled`, ``),
    e.setAttribute(`aria-disabled`, `true`)),
    e.tagName === `BUTTON` && !e.hasAttribute(`type`) && e.setAttribute(`type`, `button`),
    l(o, !0),
    s.push(
      Q(e, `click`, () => {
        c() || l(!o);
      }),
    ),
    s.push(
      Q(e, `toggle:set`, (e) => {
        if (c()) return;
        let t = e.detail,
          n;
        (typeof t == `boolean`
          ? (n = t)
          : t?.value === void 0
            ? t?.pressed !== void 0 && (n = t.pressed)
            : (n = t.value),
          typeof n == `boolean` && l(n));
      }),
    ));
  let u = {
    toggle: () => l(!o),
    press: () => l(!0),
    release: () => l(!1),
    get pressed() {
      return o;
    },
    destroy: () => {
      (s.forEach((e) => e()), (s.length = 0), ws(e, Df, u));
    },
  };
  return (Cs(e, Df, u), u);
}
function Af(e = document) {
  let t = [];
  for (let n of gs(e, `toggle`)) Ss(n, Df) || t.push(kf(n));
  return t;
}
var jf = ms({ create: () => If, createToggleGroup: () => Ff }),
  Mf = [`horizontal`, `vertical`],
  Nf = `@areia/slots:ToggleGroup`,
  Pf = `[@areia/slots:ToggleGroup] createToggleGroup() called more than once for the same root. Returning the existing controller. Destroy it before rebinding with new options.`;
function Ff(e, t = {}) {
  let n = Es(e, Nf, Pf);
  if (n) return n;
  let r = hs(e, `toggle-group-item`);
  if (r.length === 0) throw Error(`ToggleGroup requires at least one toggle-group-item`);
  let i = t.multiple ?? X(e, `multiple`) ?? !1,
    a = t.orientation ?? Is(e, `orientation`, Mf) ?? `horizontal`,
    o = t.loop ?? X(e, `loop`) ?? !0,
    s = t.disabled ?? X(e, `disabled`) ?? !1,
    c = t.onValueChange,
    l = (() => {
      if (t.defaultValue !== void 0)
        return Array.isArray(t.defaultValue)
          ? t.defaultValue
          : t.defaultValue.split(/\s+/).filter(Boolean);
      let n = Fs(e, `defaultValue`);
      return n ? n.split(/\s+/).filter(Boolean) : [];
    })(),
    u = [],
    d = new Map(),
    f = new Map(),
    p = [];
  for (let e of r) {
    let t = (e.dataset.value || ``).trim();
    if (!t) {
      p.push(e);
      continue;
    }
    let n = {
      el: e,
      value: t,
      disabled:
        e.hasAttribute(`disabled`) ||
        e.hasAttribute(`data-disabled`) ||
        e.getAttribute(`aria-disabled`) === `true`,
    };
    (u.push(n), d.set(t, n), f.set(e, n));
  }
  for (let e of p) ((e.tabIndex = -1), e.setAttribute(`aria-disabled`, `true`));
  if (u.length === 0)
    throw Error(`ToggleGroup requires at least one toggle-group-item with a data-value attribute`);
  let m = new Set();
  for (let e of l) if (d.has(e) && (m.add(e), !i)) break;
  let h = [],
    g = () =>
      e.hasAttribute(`disabled`) ||
      e.hasAttribute(`data-disabled`) ||
      e.getAttribute(`aria-disabled`) === `true`,
    _ = (e) =>
      e.el.hasAttribute(`disabled`) ||
      e.el.hasAttribute(`data-disabled`) ||
      e.el.getAttribute(`aria-disabled`) === `true`,
    v = () => u.filter((e) => !_(e));
  (e.setAttribute(`role`, `group`),
    s && e.setAttribute(`aria-disabled`, `true`),
    a === `vertical` && Z(e, `orientation`, `vertical`),
    i && (e.dataset.multiple = ``));
  for (let e of u) {
    let { el: t, disabled: n } = e;
    (qs(t, `toggle-group-item`),
      t.tagName === `BUTTON` && !t.hasAttribute(`type`) && (t.type = `button`),
      n && (t.setAttribute(`aria-disabled`, `true`), t.tagName === `BUTTON` && (t.disabled = !0)));
  }
  let y = (t, n = !1) => {
      let r = !n && (t.size !== m.size || [...t].some((e) => !m.has(e)));
      m = t;
      for (let e of u) {
        let t = m.has(e.value);
        (Z(e.el, `pressed`, t), (e.el.dataset.state = t ? `on` : `off`));
      }
      b();
      let i = [...m];
      (e.setAttribute(`data-value`, i.join(` `)),
        r && (Ys(e, `toggle-group:change`, { value: i }), c?.(i)));
    },
    b = () => {
      let e = v(),
        t;
      for (let n of e)
        if (m.has(n.value)) {
          t = n;
          break;
        }
      !t && e.length > 0 && (t = e[0]);
      for (let e of u) e.el.tabIndex = e === t ? 0 : -1;
    };
  y(m, !0);
  let x = (e) => {
      let t = new Set(m);
      (i ? (t.has(e) ? t.delete(e) : t.add(e)) : t.has(e) ? t.clear() : (t.clear(), t.add(e)),
        y(t));
    },
    S = (e) => {
      let t = Array.isArray(e) ? e : e.split(/\s+/).filter(Boolean),
        n = new Set();
      for (let e of t) if (d.has(e) && (n.add(e), !i)) break;
      y(n);
    };
  h.push(
    Q(e, `click`, (e) => {
      if (g()) return;
      let t = e.target.closest?.(`[data-slot="toggle-group-item"]`);
      if (!t) return;
      let n = f.get(t);
      !n || _(n) || x(n.value);
    }),
  );
  let C = a === `horizontal`,
    w = C ? `ArrowLeft` : `ArrowUp`,
    T = C ? `ArrowRight` : `ArrowDown`;
  (h.push(
    Q(e, `keydown`, (e) => {
      if (g()) return;
      let t = e.target.closest?.(`[data-slot="toggle-group-item"]`);
      if (!t) return;
      let n = f.get(t);
      if (!n) return;
      if (e.key === `Enter` || e.key === ` `) {
        _(n) && e.preventDefault();
        return;
      }
      let r = v();
      if (r.length === 0) return;
      let i = r.findIndex((e) => e.el === t);
      i === -1 && (i = 0);
      let a = i;
      switch (e.key) {
        case w:
          ((a = i - 1), a < 0 && (a = o ? r.length - 1 : 0));
          break;
        case T:
          ((a = i + 1), a >= r.length && (a = o ? 0 : r.length - 1));
          break;
        case `Home`:
          a = 0;
          break;
        case `End`:
          a = r.length - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      let s = r[a];
      if (s) {
        for (let e of u) e.el.tabIndex = e === s ? 0 : -1;
        s.el.focus();
      }
    }),
  ),
    h.push(
      Q(e, `toggle-group:set`, (e) => {
        if (g()) return;
        let t = e.detail,
          n;
        (typeof t == `string` || Array.isArray(t)
          ? (n = t)
          : t && typeof t == `object` && `value` in t && (n = t.value),
          n !== void 0 && S(n));
      }),
    ));
  let E = {
    setValue: (e) => S(e),
    toggle: (e) => x(e),
    get value() {
      return [...m];
    },
    destroy: () => {
      (h.forEach((e) => e()), (h.length = 0), ws(e, Nf, E));
    },
  };
  return (Cs(e, Nf, E), E);
}
function If(e = document) {
  let t = [];
  for (let n of gs(e, `toggle-group`)) Ss(n, Nf) || t.push(Ff(n));
  return t;
}
var Lf = ms({ create: () => Xf, createTooltip: () => Yf }),
  Rf = `@areia/slots:Tooltip`,
  zf = `[@areia/slots:Tooltip] createTooltip() called more than once for the same root. Returning the existing controller. Destroy it before rebinding with new options.`,
  Bf = 0,
  Vf = new Set(),
  Hf = new Set(),
  Uf = (e, t) => {
    if (!e) return !1;
    for (let n of Vf) if (n !== t && n.contains(e)) return !0;
    return !1;
  },
  Wf = (e, t) => {
    for (let n of Hf) n(e, t);
  },
  Gf = [`top`, `right`, `bottom`, `left`, `inline-start`, `inline-end`],
  Kf = [`start`, `center`, `end`],
  qf = (e, t) =>
    e === `inline-start`
      ? t === `rtl`
        ? `right`
        : `left`
      : e === `inline-end`
        ? t === `rtl`
          ? `left`
          : `right`
        : e,
  Jf = (...e) => [...new Set(e.filter((e) => e != null))];
function Yf(e, t = {}) {
  let n = Es(e, Rf, zf);
  if (n) return n;
  let r = Y(e, `tooltip-trigger`),
    i = Y(e, `tooltip-content`),
    a = i?.querySelector(`[data-slot="tooltip-arrow"]`) ?? null,
    o = Y(e, `tooltip-positioner`),
    s = o && i && o.contains(i) ? o : null,
    c = Y(e, `tooltip-portal`),
    l = c && s && c.contains(s) ? c : null;
  if (!r || !i) throw Error(`Tooltip requires trigger and content slots`);
  a && (a.setAttribute(`aria-hidden`, `true`), (a.style.position = `absolute`));
  let u = t.delay ?? Ps(e, `delay`) ?? 300,
    d = t.skipDelayDuration ?? Ps(e, `skipDelayDuration`) ?? 300,
    f = t.onOpenChange,
    p = t.onPortalMounted,
    m = t.portal ?? X(i, `portal`) ?? X(e, `portal`) ?? !0,
    h = (t, n) => Is(i, t, n) ?? (s ? Is(s, t, n) : void 0) ?? Is(e, t, n),
    g = (t) => Ps(i, t) ?? (s ? Ps(s, t) : void 0) ?? Ps(e, t),
    _ = (t) => X(i, t) ?? (s ? X(s, t) : void 0) ?? X(e, t),
    v = t.side ?? h(`side`, Gf) ?? `top`,
    y = t.align ?? h(`align`, Kf) ?? `center`,
    b = t.sideOffset ?? g(`sideOffset`) ?? 4,
    x = t.alignOffset ?? g(`alignOffset`) ?? 0,
    S = t.avoidCollisions ?? _(`avoidCollisions`) ?? !0,
    C = t.collisionPadding ?? g(`collisionPadding`) ?? 8,
    w = !1,
    T = null,
    E = !1,
    D = !1,
    O = null,
    k = [],
    A = Fc({
      content: i,
      root: e,
      enabled: m,
      wrapperSlot: s ? void 0 : `tooltip-positioner`,
      container: s ?? void 0,
      mountTarget: s ? (l ?? s) : void 0,
    }),
    j = qs(i, `tooltip-content`);
  i.setAttribute(`role`, `tooltip`);
  let M = () => {
      let t = e instanceof HTMLElement ? e : null;
      return (t?.getAttribute(`dir`) ?? r.getAttribute(`dir`)) === `rtl` ||
        (getComputedStyle(r).direction ||
          (t ? getComputedStyle(t).direction : ``) ||
          e.ownerDocument.documentElement.getAttribute(`dir`) ||
          ``) === `rtl`
        ? `rtl`
        : `ltr`;
    },
    N = (e, t) => {
      let n = A.container;
      for (let r of Jf(i, n, a)) (r.setAttribute(`data-side`, e), r.setAttribute(`data-align`, t));
    },
    ee = (t) => {
      let n = A.container;
      for (let r of Jf(e, i, n, a))
        t ? r.setAttribute(`data-instant`, t) : r.removeAttribute(`data-instant`);
    },
    P = (e, t, n, r) => {
      if (!a) return;
      a.style.position = `absolute`;
      let i = a.getBoundingClientRect(),
        o = a.offsetWidth > 0 ? a.offsetWidth : i.width,
        s = a.offsetHeight > 0 ? a.offsetHeight : i.height;
      if (o <= 0 || s <= 0) {
        (a.style.removeProperty(`left`),
          a.style.removeProperty(`top`),
          a.removeAttribute(`data-uncentered`));
        return;
      }
      let c = qf(e, t);
      if (c === `top` || c === `bottom`) {
        let e = n.left + n.width / 2 - r.left - o / 2,
          t = Math.max(5, r.width - o - 5),
          i = Math.min(Math.max(e, 5), t);
        ((a.style.left = `${i}px`),
          a.style.removeProperty(`top`),
          Math.abs(i - e) > 0.5
            ? a.setAttribute(`data-uncentered`, ``)
            : a.removeAttribute(`data-uncentered`));
        return;
      }
      let l = n.top + n.height / 2 - r.top - s / 2,
        u = Math.max(5, r.height - s - 5),
        d = Math.min(Math.max(l, 5), u);
      ((a.style.top = `${d}px`),
        a.style.removeProperty(`left`),
        Math.abs(d - l) > 0.5
          ? a.setAttribute(`data-uncentered`, ``)
          : a.removeAttribute(`data-uncentered`));
    },
    F = (t) => {
      let n = A.container;
      if ((e.setAttribute(`data-state`, t), i.setAttribute(`data-state`, t), ee(T), t === `open`)) {
        for (let t of Jf(e, i, n, a))
          (t.setAttribute(`data-open`, ``), t.removeAttribute(`data-closed`));
        return;
      }
      for (let t of Jf(e, i, n, a))
        (t.setAttribute(`data-closed`, ``), t.removeAttribute(`data-open`));
    },
    I = () => {
      let t = A.container,
        n = e.ownerDocument.defaultView ?? window,
        a = M(),
        o = r.getBoundingClientRect(),
        s = cc(i),
        c = xc({
          anchorRect: o,
          contentRect: s,
          side: v,
          align: y,
          sideOffset: b,
          alignOffset: x,
          avoidCollisions: S,
          collisionPadding: C,
          direction: a,
        }),
        l = sc({
          side: c.side,
          align: c.align,
          anchorRect: o,
          popupX: c.x,
          popupY: c.y,
          direction: a,
        });
      ((t.style.position = `absolute`),
        (t.style.top = `0px`),
        (t.style.left = `0px`),
        (t.style.transform = `translate3d(${c.x + n.scrollX}px, ${c.y + n.scrollY}px, 0)`),
        t.style.setProperty(`--transform-origin`, l),
        (t.style.willChange = `transform`),
        (t.style.margin = `0`),
        N(c.side, c.align),
        P(c.side, a, o, {
          top: c.y,
          left: c.x,
          right: c.x + s.width,
          bottom: c.y + s.height,
          width: s.width,
          height: s.height,
        }));
    },
    L = zc({
      element: i,
      onExitComplete: () => {
        D || (A.restore(), (i.hidden = !0));
      },
    }),
    te = Oc({ observedElements: [r, i], isActive: () => w, ancestorScroll: !1, onUpdate: I }),
    R = () => r.hasAttribute(`disabled`) || r.getAttribute(`aria-disabled`) === `true`,
    z = (t, n, a = null) => {
      w !== t &&
        (!t && w && d > 0 && (Bf = Date.now() + d),
        (T = a),
        (w = t),
        w
          ? (r.setAttribute(`aria-describedby`, j),
            i.setAttribute(`aria-hidden`, `false`),
            A.mount(),
            p && requestAnimationFrame(() => p(A.container)),
            (i.hidden = !1),
            F(`open`),
            L.enter(),
            I(),
            te.start(),
            te.update())
          : (F(`closed`),
            r.removeAttribute(`aria-describedby`),
            i.setAttribute(`aria-hidden`, `true`),
            L.exit(),
            te.stop()),
        Ys(e, `tooltip:change`, { open: w, trigger: r, content: i, reason: n }),
        f?.(w));
    },
    B = (e) => {
      if (((O &&= (clearTimeout(O), null)), Date.now() < Bf)) {
        z(!0, e, `delay`);
        return;
      }
      O = setTimeout(() => {
        (z(!0, e, e === `focus` ? `focus` : null), (O = null));
      }, u);
    },
    V = (e, t = null) => {
      ((O &&= (clearTimeout(O), null)), z(!1, e, t));
    },
    ne = (e, t) => {
      e === r || !w || ((E = !1), V(t, `delay`));
    };
  (Vf.add(r),
    Hf.add(ne),
    k.push(() => {
      (Hf.delete(ne), Vf.delete(r));
    }),
    (i.hidden = !0),
    i.setAttribute(`aria-hidden`, `true`),
    N(v, y),
    F(`closed`),
    k.push(
      Q(r, `pointerenter`, (e) => {
        e.pointerType !== `touch` && (R() || (Wf(r, `pointer`), B(`pointer`)));
      }),
      Q(r, `pointerleave`, (e) => {
        if (e.pointerType === `touch` || E) return;
        let t = e.relatedTarget;
        if (!(t && i.contains(t))) {
          if (Uf(t, r)) {
            V(`pointer`, `delay`);
            return;
          }
          V(`pointer`);
        }
      }),
      Q(r, `click`, () => {
        if (!R()) {
          if (O) {
            (clearTimeout(O), (O = null));
            return;
          }
          w && V(`pointer`, `dismiss`);
        }
      }),
      Q(r, `focus`, () => {
        ((E = !0), !R() && (Wf(r, `focus`), B(`focus`)));
      }),
      Q(r, `blur`, (e) => {
        E = !1;
        let t = e.relatedTarget;
        if (Uf(t, r)) {
          V(`blur`, `delay`);
          return;
        }
        V(`blur`);
      }),
    ),
    k.push(
      Q(i, `pointerleave`, (e) => {
        if (e.pointerType === `touch` || E) return;
        let t = e.relatedTarget;
        if (!(t && r.contains(t))) {
          if (Uf(t, r)) {
            V(`pointer`, `delay`);
            return;
          }
          V(`pointer`);
        }
      }),
    ),
    k.push(
      Q(e, `tooltip:set`, (e) => {
        let t = e.detail,
          n;
        if (
          (t?.open === void 0 ? t?.value !== void 0 && (n = t.value) : (n = t.open),
          typeof n == `boolean`)
        )
          if (n) {
            if (R()) return;
            ((O &&= (clearTimeout(O), null)), z(!0, `api`));
          } else V(`api`);
      }),
    ),
    k.push(
      Pc({
        root: e,
        isOpen: () => w,
        onDismiss: () => V(`escape`, `dismiss`),
        closeOnClickOutside: !1,
        closeOnEscape: !0,
        preventEscapeDefault: !1,
      }),
    ));
  let H = {
    show: () => {
      R() || ((O &&= (clearTimeout(O), null)), z(!0, `api`));
    },
    hide: () => V(`api`),
    get isOpen() {
      return w;
    },
    destroy: () => {
      ((D = !0),
        O && clearTimeout(O),
        te.stop(),
        L.cleanup(),
        A.cleanup(),
        k.forEach((e) => e()),
        (k.length = 0),
        ws(e, Rf, H));
    },
  };
  return (Cs(e, Rf, H), H);
}
function Xf(e = document) {
  let t = [];
  for (let n of gs(e, `tooltip`)) Ss(n, Rf) || t.push(Yf(n));
  return t;
}
var Zf = 365.2425,
  Qf = 6048e5,
  $f = 864e5,
  ep = 6e4,
  tp = 36e5,
  np = 3600 * 24;
(np * 7, ((np * Zf) / 12) * 3);
var rp = Symbol.for(`constructDateFrom`);
function ip(e, t) {
  return typeof e == `function`
    ? e(t)
    : e && typeof e == `object` && rp in e
      ? e[rp](t)
      : e instanceof Date
        ? new e.constructor(t)
        : new Date(t);
}
function ap(e, t) {
  return ip(t || e, e);
}
function op(e, t, n) {
  let r = ap(e, n?.in);
  if (isNaN(t)) return ip(n?.in || e, NaN);
  if (!t) return r;
  let i = r.getDate(),
    a = ip(n?.in || e, r.getTime());
  return (
    a.setMonth(r.getMonth() + t + 1, 0),
    i >= a.getDate() ? a : (r.setFullYear(a.getFullYear(), a.getMonth(), i), r)
  );
}
var sp = {};
function cp() {
  return sp;
}
function lp(e, t) {
  let n = cp(),
    r =
      t?.weekStartsOn ??
      t?.locale?.options?.weekStartsOn ??
      n.weekStartsOn ??
      n.locale?.options?.weekStartsOn ??
      0,
    i = ap(e, t?.in),
    a = i.getDay(),
    o = (a < r ? 7 : 0) + a - r;
  return (i.setDate(i.getDate() - o), i.setHours(0, 0, 0, 0), i);
}
function up(e, t) {
  return lp(e, { ...t, weekStartsOn: 1 });
}
function dp(e, t) {
  let n = ap(e, t?.in),
    r = n.getFullYear(),
    i = ip(n, 0);
  (i.setFullYear(r + 1, 0, 4), i.setHours(0, 0, 0, 0));
  let a = up(i),
    o = ip(n, 0);
  (o.setFullYear(r, 0, 4), o.setHours(0, 0, 0, 0));
  let s = up(o);
  return n.getTime() >= a.getTime() ? r + 1 : n.getTime() >= s.getTime() ? r : r - 1;
}
function fp(e) {
  let t = ap(e),
    n = new Date(
      Date.UTC(
        t.getFullYear(),
        t.getMonth(),
        t.getDate(),
        t.getHours(),
        t.getMinutes(),
        t.getSeconds(),
        t.getMilliseconds(),
      ),
    );
  return (n.setUTCFullYear(t.getFullYear()), e - +n);
}
function pp(e, ...t) {
  let n = ip.bind(null, e || t.find((e) => typeof e == `object`));
  return t.map(n);
}
function mp(e, t) {
  let n = ap(e, t?.in);
  return (n.setHours(0, 0, 0, 0), n);
}
function hp(e, t, n) {
  let [r, i] = pp(n?.in, e, t),
    a = mp(r),
    o = mp(i),
    s = +a - fp(a),
    c = +o - fp(o);
  return Math.round((s - c) / $f);
}
function gp(e, t) {
  let n = dp(e, t),
    r = ip(t?.in || e, 0);
  return (r.setFullYear(n, 0, 4), r.setHours(0, 0, 0, 0), up(r));
}
function _p(e, t, n) {
  let [r, i] = pp(n?.in, e, t);
  return +mp(r) == +mp(i);
}
function vp(e) {
  return (
    e instanceof Date ||
    (typeof e == `object` && Object.prototype.toString.call(e) === `[object Date]`)
  );
}
function yp(e) {
  return !((!vp(e) && typeof e != `number`) || isNaN(+ap(e)));
}
function bp(e, t) {
  let n = ap(e, t?.in),
    r = n.getMonth();
  return (n.setFullYear(n.getFullYear(), r + 1, 0), n.setHours(23, 59, 59, 999), n);
}
function xp(e, t) {
  let [n, r] = pp(e, t.start, t.end);
  return { start: n, end: r };
}
function Sp(e, t) {
  let { start: n, end: r } = xp(t?.in, e),
    i = +n > +r,
    a = i ? +n : +r,
    o = i ? r : n;
  o.setHours(0, 0, 0, 0);
  let s = t?.step ?? 1;
  if (!s) return [];
  s < 0 && ((s = -s), (i = !i));
  let c = [];
  for (; +o <= a; ) (c.push(ip(n, o)), o.setDate(o.getDate() + s), o.setHours(0, 0, 0, 0));
  return i ? c.reverse() : c;
}
function Cp(e, t) {
  let n = ap(e, t?.in);
  return (n.setDate(1), n.setHours(0, 0, 0, 0), n);
}
function wp(e, t) {
  let n = ap(e, t?.in);
  return (n.setFullYear(n.getFullYear(), 0, 1), n.setHours(0, 0, 0, 0), n);
}
function Tp(e, t) {
  let n = cp(),
    r =
      t?.weekStartsOn ??
      t?.locale?.options?.weekStartsOn ??
      n.weekStartsOn ??
      n.locale?.options?.weekStartsOn ??
      0,
    i = ap(e, t?.in),
    a = i.getDay(),
    o = (a < r ? -7 : 0) + 6 - (a - r);
  return (i.setDate(i.getDate() + o), i.setHours(23, 59, 59, 999), i);
}
var Ep = {
    lessThanXSeconds: { one: `less than a second`, other: `less than {{count}} seconds` },
    xSeconds: { one: `1 second`, other: `{{count}} seconds` },
    halfAMinute: `half a minute`,
    lessThanXMinutes: { one: `less than a minute`, other: `less than {{count}} minutes` },
    xMinutes: { one: `1 minute`, other: `{{count}} minutes` },
    aboutXHours: { one: `about 1 hour`, other: `about {{count}} hours` },
    xHours: { one: `1 hour`, other: `{{count}} hours` },
    xDays: { one: `1 day`, other: `{{count}} days` },
    aboutXWeeks: { one: `about 1 week`, other: `about {{count}} weeks` },
    xWeeks: { one: `1 week`, other: `{{count}} weeks` },
    aboutXMonths: { one: `about 1 month`, other: `about {{count}} months` },
    xMonths: { one: `1 month`, other: `{{count}} months` },
    aboutXYears: { one: `about 1 year`, other: `about {{count}} years` },
    xYears: { one: `1 year`, other: `{{count}} years` },
    overXYears: { one: `over 1 year`, other: `over {{count}} years` },
    almostXYears: { one: `almost 1 year`, other: `almost {{count}} years` },
  },
  Dp = (e, t, n) => {
    let r,
      i = Ep[e];
    return (
      (r = typeof i == `string` ? i : t === 1 ? i.one : i.other.replace(`{{count}}`, t.toString())),
      n?.addSuffix ? (n.comparison && n.comparison > 0 ? `in ` + r : r + ` ago`) : r
    );
  };
function Op(e) {
  return (t = {}) => {
    let n = t.width ? String(t.width) : e.defaultWidth;
    return e.formats[n] || e.formats[e.defaultWidth];
  };
}
var kp = {
    date: Op({
      formats: {
        full: `EEEE, MMMM do, y`,
        long: `MMMM do, y`,
        medium: `MMM d, y`,
        short: `MM/dd/yyyy`,
      },
      defaultWidth: `full`,
    }),
    time: Op({
      formats: {
        full: `h:mm:ss a zzzz`,
        long: `h:mm:ss a z`,
        medium: `h:mm:ss a`,
        short: `h:mm a`,
      },
      defaultWidth: `full`,
    }),
    dateTime: Op({
      formats: {
        full: `{{date}} 'at' {{time}}`,
        long: `{{date}} 'at' {{time}}`,
        medium: `{{date}}, {{time}}`,
        short: `{{date}}, {{time}}`,
      },
      defaultWidth: `full`,
    }),
  },
  Ap = {
    lastWeek: `'last' eeee 'at' p`,
    yesterday: `'yesterday at' p`,
    today: `'today at' p`,
    tomorrow: `'tomorrow at' p`,
    nextWeek: `eeee 'at' p`,
    other: `P`,
  },
  jp = (e, t, n, r) => Ap[e];
function Mp(e) {
  return (t, n) => {
    let r = n?.context ? String(n.context) : `standalone`,
      i;
    if (r === `formatting` && e.formattingValues) {
      let t = e.defaultFormattingWidth || e.defaultWidth,
        r = n?.width ? String(n.width) : t;
      i = e.formattingValues[r] || e.formattingValues[t];
    } else {
      let t = e.defaultWidth,
        r = n?.width ? String(n.width) : e.defaultWidth;
      i = e.values[r] || e.values[t];
    }
    let a = e.argumentCallback ? e.argumentCallback(t) : t;
    return i[a];
  };
}
var Np = {
  ordinalNumber: (e, t) => {
    let n = Number(e),
      r = n % 100;
    if (r > 20 || r < 10)
      switch (r % 10) {
        case 1:
          return n + `st`;
        case 2:
          return n + `nd`;
        case 3:
          return n + `rd`;
      }
    return n + `th`;
  },
  era: Mp({
    values: {
      narrow: [`B`, `A`],
      abbreviated: [`BC`, `AD`],
      wide: [`Before Christ`, `Anno Domini`],
    },
    defaultWidth: `wide`,
  }),
  quarter: Mp({
    values: {
      narrow: [`1`, `2`, `3`, `4`],
      abbreviated: [`Q1`, `Q2`, `Q3`, `Q4`],
      wide: [`1st quarter`, `2nd quarter`, `3rd quarter`, `4th quarter`],
    },
    defaultWidth: `wide`,
    argumentCallback: (e) => e - 1,
  }),
  month: Mp({
    values: {
      narrow: [`J`, `F`, `M`, `A`, `M`, `J`, `J`, `A`, `S`, `O`, `N`, `D`],
      abbreviated: [
        `Jan`,
        `Feb`,
        `Mar`,
        `Apr`,
        `May`,
        `Jun`,
        `Jul`,
        `Aug`,
        `Sep`,
        `Oct`,
        `Nov`,
        `Dec`,
      ],
      wide: [
        `January`,
        `February`,
        `March`,
        `April`,
        `May`,
        `June`,
        `July`,
        `August`,
        `September`,
        `October`,
        `November`,
        `December`,
      ],
    },
    defaultWidth: `wide`,
  }),
  day: Mp({
    values: {
      narrow: [`S`, `M`, `T`, `W`, `T`, `F`, `S`],
      short: [`Su`, `Mo`, `Tu`, `We`, `Th`, `Fr`, `Sa`],
      abbreviated: [`Sun`, `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`],
      wide: [`Sunday`, `Monday`, `Tuesday`, `Wednesday`, `Thursday`, `Friday`, `Saturday`],
    },
    defaultWidth: `wide`,
  }),
  dayPeriod: Mp({
    values: {
      narrow: {
        am: `a`,
        pm: `p`,
        midnight: `mi`,
        noon: `n`,
        morning: `morning`,
        afternoon: `afternoon`,
        evening: `evening`,
        night: `night`,
      },
      abbreviated: {
        am: `AM`,
        pm: `PM`,
        midnight: `midnight`,
        noon: `noon`,
        morning: `morning`,
        afternoon: `afternoon`,
        evening: `evening`,
        night: `night`,
      },
      wide: {
        am: `a.m.`,
        pm: `p.m.`,
        midnight: `midnight`,
        noon: `noon`,
        morning: `morning`,
        afternoon: `afternoon`,
        evening: `evening`,
        night: `night`,
      },
    },
    defaultWidth: `wide`,
    formattingValues: {
      narrow: {
        am: `a`,
        pm: `p`,
        midnight: `mi`,
        noon: `n`,
        morning: `in the morning`,
        afternoon: `in the afternoon`,
        evening: `in the evening`,
        night: `at night`,
      },
      abbreviated: {
        am: `AM`,
        pm: `PM`,
        midnight: `midnight`,
        noon: `noon`,
        morning: `in the morning`,
        afternoon: `in the afternoon`,
        evening: `in the evening`,
        night: `at night`,
      },
      wide: {
        am: `a.m.`,
        pm: `p.m.`,
        midnight: `midnight`,
        noon: `noon`,
        morning: `in the morning`,
        afternoon: `in the afternoon`,
        evening: `in the evening`,
        night: `at night`,
      },
    },
    defaultFormattingWidth: `wide`,
  }),
};
function Pp(e) {
  return (t, n = {}) => {
    let r = n.width,
      i = (r && e.matchPatterns[r]) || e.matchPatterns[e.defaultMatchWidth],
      a = t.match(i);
    if (!a) return null;
    let o = a[0],
      s = (r && e.parsePatterns[r]) || e.parsePatterns[e.defaultParseWidth],
      c = Array.isArray(s) ? Ip(s, (e) => e.test(o)) : Fp(s, (e) => e.test(o)),
      l;
    ((l = e.valueCallback ? e.valueCallback(c) : c),
      (l = n.valueCallback ? n.valueCallback(l) : l));
    let u = t.slice(o.length);
    return { value: l, rest: u };
  };
}
function Fp(e, t) {
  for (let n in e) if (Object.prototype.hasOwnProperty.call(e, n) && t(e[n])) return n;
}
function Ip(e, t) {
  for (let n = 0; n < e.length; n++) if (t(e[n])) return n;
}
function Lp(e) {
  return (t, n = {}) => {
    let r = t.match(e.matchPattern);
    if (!r) return null;
    let i = r[0],
      a = t.match(e.parsePattern);
    if (!a) return null;
    let o = e.valueCallback ? e.valueCallback(a[0]) : a[0];
    o = n.valueCallback ? n.valueCallback(o) : o;
    let s = t.slice(i.length);
    return { value: o, rest: s };
  };
}
var Rp = {
  code: `en-US`,
  formatDistance: Dp,
  formatLong: kp,
  formatRelative: jp,
  localize: Np,
  match: {
    ordinalNumber: Lp({
      matchPattern: /^(\d+)(th|st|nd|rd)?/i,
      parsePattern: /\d+/i,
      valueCallback: (e) => parseInt(e, 10),
    }),
    era: Pp({
      matchPatterns: {
        narrow: /^(b|a)/i,
        abbreviated: /^(b\.?\s?c\.?|b\.?\s?c\.?\s?e\.?|a\.?\s?d\.?|c\.?\s?e\.?)/i,
        wide: /^(before christ|before common era|anno domini|common era)/i,
      },
      defaultMatchWidth: `wide`,
      parsePatterns: { any: [/^b/i, /^(a|c)/i] },
      defaultParseWidth: `any`,
    }),
    quarter: Pp({
      matchPatterns: {
        narrow: /^[1234]/i,
        abbreviated: /^q[1234]/i,
        wide: /^[1234](th|st|nd|rd)? quarter/i,
      },
      defaultMatchWidth: `wide`,
      parsePatterns: { any: [/1/i, /2/i, /3/i, /4/i] },
      defaultParseWidth: `any`,
      valueCallback: (e) => e + 1,
    }),
    month: Pp({
      matchPatterns: {
        narrow: /^[jfmasond]/i,
        abbreviated: /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
        wide: /^(january|february|march|april|may|june|july|august|september|october|november|december)/i,
      },
      defaultMatchWidth: `wide`,
      parsePatterns: {
        narrow: [
          /^j/i,
          /^f/i,
          /^m/i,
          /^a/i,
          /^m/i,
          /^j/i,
          /^j/i,
          /^a/i,
          /^s/i,
          /^o/i,
          /^n/i,
          /^d/i,
        ],
        any: [
          /^ja/i,
          /^f/i,
          /^mar/i,
          /^ap/i,
          /^may/i,
          /^jun/i,
          /^jul/i,
          /^au/i,
          /^s/i,
          /^o/i,
          /^n/i,
          /^d/i,
        ],
      },
      defaultParseWidth: `any`,
    }),
    day: Pp({
      matchPatterns: {
        narrow: /^[smtwf]/i,
        short: /^(su|mo|tu|we|th|fr|sa)/i,
        abbreviated: /^(sun|mon|tue|wed|thu|fri|sat)/i,
        wide: /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i,
      },
      defaultMatchWidth: `wide`,
      parsePatterns: {
        narrow: [/^s/i, /^m/i, /^t/i, /^w/i, /^t/i, /^f/i, /^s/i],
        any: [/^su/i, /^m/i, /^tu/i, /^w/i, /^th/i, /^f/i, /^sa/i],
      },
      defaultParseWidth: `any`,
    }),
    dayPeriod: Pp({
      matchPatterns: {
        narrow: /^(a|p|mi|n|(in the|at) (morning|afternoon|evening|night))/i,
        any: /^([ap]\.?\s?m\.?|midnight|noon|(in the|at) (morning|afternoon|evening|night))/i,
      },
      defaultMatchWidth: `any`,
      parsePatterns: {
        any: {
          am: /^a/i,
          pm: /^p/i,
          midnight: /^mi/i,
          noon: /^no/i,
          morning: /morning/i,
          afternoon: /afternoon/i,
          evening: /evening/i,
          night: /night/i,
        },
      },
      defaultParseWidth: `any`,
    }),
  },
  options: { weekStartsOn: 0, firstWeekContainsDate: 1 },
};
function zp(e, t) {
  let n = ap(e, t?.in);
  return hp(n, wp(n)) + 1;
}
function Bp(e, t) {
  let n = ap(e, t?.in),
    r = up(n) - +gp(n);
  return Math.round(r / Qf) + 1;
}
function Vp(e, t) {
  let n = ap(e, t?.in),
    r = n.getFullYear(),
    i = cp(),
    a =
      t?.firstWeekContainsDate ??
      t?.locale?.options?.firstWeekContainsDate ??
      i.firstWeekContainsDate ??
      i.locale?.options?.firstWeekContainsDate ??
      1,
    o = ip(t?.in || e, 0);
  (o.setFullYear(r + 1, 0, a), o.setHours(0, 0, 0, 0));
  let s = lp(o, t),
    c = ip(t?.in || e, 0);
  (c.setFullYear(r, 0, a), c.setHours(0, 0, 0, 0));
  let l = lp(c, t);
  return +n >= +s ? r + 1 : +n >= +l ? r : r - 1;
}
function Hp(e, t) {
  let n = cp(),
    r =
      t?.firstWeekContainsDate ??
      t?.locale?.options?.firstWeekContainsDate ??
      n.firstWeekContainsDate ??
      n.locale?.options?.firstWeekContainsDate ??
      1,
    i = Vp(e, t),
    a = ip(t?.in || e, 0);
  return (a.setFullYear(i, 0, r), a.setHours(0, 0, 0, 0), lp(a, t));
}
function Up(e, t) {
  let n = ap(e, t?.in),
    r = lp(n, t) - +Hp(n, t);
  return Math.round(r / Qf) + 1;
}
function Wp(e, t) {
  return (e < 0 ? `-` : ``) + Math.abs(e).toString().padStart(t, `0`);
}
var Gp = {
    y(e, t) {
      let n = e.getFullYear(),
        r = n > 0 ? n : 1 - n;
      return Wp(t === `yy` ? r % 100 : r, t.length);
    },
    M(e, t) {
      let n = e.getMonth();
      return t === `M` ? String(n + 1) : Wp(n + 1, 2);
    },
    d(e, t) {
      return Wp(e.getDate(), t.length);
    },
    a(e, t) {
      let n = e.getHours() / 12 >= 1 ? `pm` : `am`;
      switch (t) {
        case `a`:
        case `aa`:
          return n.toUpperCase();
        case `aaa`:
          return n;
        case `aaaaa`:
          return n[0];
        default:
          return n === `am` ? `a.m.` : `p.m.`;
      }
    },
    h(e, t) {
      return Wp(e.getHours() % 12 || 12, t.length);
    },
    H(e, t) {
      return Wp(e.getHours(), t.length);
    },
    m(e, t) {
      return Wp(e.getMinutes(), t.length);
    },
    s(e, t) {
      return Wp(e.getSeconds(), t.length);
    },
    S(e, t) {
      let n = t.length,
        r = e.getMilliseconds();
      return Wp(Math.trunc(r * 10 ** (n - 3)), t.length);
    },
  },
  Kp = {
    am: `am`,
    pm: `pm`,
    midnight: `midnight`,
    noon: `noon`,
    morning: `morning`,
    afternoon: `afternoon`,
    evening: `evening`,
    night: `night`,
  },
  qp = {
    G: function (e, t, n) {
      let r = +(e.getFullYear() > 0);
      switch (t) {
        case `G`:
        case `GG`:
        case `GGG`:
          return n.era(r, { width: `abbreviated` });
        case `GGGGG`:
          return n.era(r, { width: `narrow` });
        default:
          return n.era(r, { width: `wide` });
      }
    },
    y: function (e, t, n) {
      if (t === `yo`) {
        let t = e.getFullYear(),
          r = t > 0 ? t : 1 - t;
        return n.ordinalNumber(r, { unit: `year` });
      }
      return Gp.y(e, t);
    },
    Y: function (e, t, n, r) {
      let i = Vp(e, r),
        a = i > 0 ? i : 1 - i;
      return t === `YY`
        ? Wp(a % 100, 2)
        : t === `Yo`
          ? n.ordinalNumber(a, { unit: `year` })
          : Wp(a, t.length);
    },
    R: function (e, t) {
      return Wp(dp(e), t.length);
    },
    u: function (e, t) {
      return Wp(e.getFullYear(), t.length);
    },
    Q: function (e, t, n) {
      let r = Math.ceil((e.getMonth() + 1) / 3);
      switch (t) {
        case `Q`:
          return String(r);
        case `QQ`:
          return Wp(r, 2);
        case `Qo`:
          return n.ordinalNumber(r, { unit: `quarter` });
        case `QQQ`:
          return n.quarter(r, { width: `abbreviated`, context: `formatting` });
        case `QQQQQ`:
          return n.quarter(r, { width: `narrow`, context: `formatting` });
        default:
          return n.quarter(r, { width: `wide`, context: `formatting` });
      }
    },
    q: function (e, t, n) {
      let r = Math.ceil((e.getMonth() + 1) / 3);
      switch (t) {
        case `q`:
          return String(r);
        case `qq`:
          return Wp(r, 2);
        case `qo`:
          return n.ordinalNumber(r, { unit: `quarter` });
        case `qqq`:
          return n.quarter(r, { width: `abbreviated`, context: `standalone` });
        case `qqqqq`:
          return n.quarter(r, { width: `narrow`, context: `standalone` });
        default:
          return n.quarter(r, { width: `wide`, context: `standalone` });
      }
    },
    M: function (e, t, n) {
      let r = e.getMonth();
      switch (t) {
        case `M`:
        case `MM`:
          return Gp.M(e, t);
        case `Mo`:
          return n.ordinalNumber(r + 1, { unit: `month` });
        case `MMM`:
          return n.month(r, { width: `abbreviated`, context: `formatting` });
        case `MMMMM`:
          return n.month(r, { width: `narrow`, context: `formatting` });
        default:
          return n.month(r, { width: `wide`, context: `formatting` });
      }
    },
    L: function (e, t, n) {
      let r = e.getMonth();
      switch (t) {
        case `L`:
          return String(r + 1);
        case `LL`:
          return Wp(r + 1, 2);
        case `Lo`:
          return n.ordinalNumber(r + 1, { unit: `month` });
        case `LLL`:
          return n.month(r, { width: `abbreviated`, context: `standalone` });
        case `LLLLL`:
          return n.month(r, { width: `narrow`, context: `standalone` });
        default:
          return n.month(r, { width: `wide`, context: `standalone` });
      }
    },
    w: function (e, t, n, r) {
      let i = Up(e, r);
      return t === `wo` ? n.ordinalNumber(i, { unit: `week` }) : Wp(i, t.length);
    },
    I: function (e, t, n) {
      let r = Bp(e);
      return t === `Io` ? n.ordinalNumber(r, { unit: `week` }) : Wp(r, t.length);
    },
    d: function (e, t, n) {
      return t === `do` ? n.ordinalNumber(e.getDate(), { unit: `date` }) : Gp.d(e, t);
    },
    D: function (e, t, n) {
      let r = zp(e);
      return t === `Do` ? n.ordinalNumber(r, { unit: `dayOfYear` }) : Wp(r, t.length);
    },
    E: function (e, t, n) {
      let r = e.getDay();
      switch (t) {
        case `E`:
        case `EE`:
        case `EEE`:
          return n.day(r, { width: `abbreviated`, context: `formatting` });
        case `EEEEE`:
          return n.day(r, { width: `narrow`, context: `formatting` });
        case `EEEEEE`:
          return n.day(r, { width: `short`, context: `formatting` });
        default:
          return n.day(r, { width: `wide`, context: `formatting` });
      }
    },
    e: function (e, t, n, r) {
      let i = e.getDay(),
        a = (i - r.weekStartsOn + 8) % 7 || 7;
      switch (t) {
        case `e`:
          return String(a);
        case `ee`:
          return Wp(a, 2);
        case `eo`:
          return n.ordinalNumber(a, { unit: `day` });
        case `eee`:
          return n.day(i, { width: `abbreviated`, context: `formatting` });
        case `eeeee`:
          return n.day(i, { width: `narrow`, context: `formatting` });
        case `eeeeee`:
          return n.day(i, { width: `short`, context: `formatting` });
        default:
          return n.day(i, { width: `wide`, context: `formatting` });
      }
    },
    c: function (e, t, n, r) {
      let i = e.getDay(),
        a = (i - r.weekStartsOn + 8) % 7 || 7;
      switch (t) {
        case `c`:
          return String(a);
        case `cc`:
          return Wp(a, t.length);
        case `co`:
          return n.ordinalNumber(a, { unit: `day` });
        case `ccc`:
          return n.day(i, { width: `abbreviated`, context: `standalone` });
        case `ccccc`:
          return n.day(i, { width: `narrow`, context: `standalone` });
        case `cccccc`:
          return n.day(i, { width: `short`, context: `standalone` });
        default:
          return n.day(i, { width: `wide`, context: `standalone` });
      }
    },
    i: function (e, t, n) {
      let r = e.getDay(),
        i = r === 0 ? 7 : r;
      switch (t) {
        case `i`:
          return String(i);
        case `ii`:
          return Wp(i, t.length);
        case `io`:
          return n.ordinalNumber(i, { unit: `day` });
        case `iii`:
          return n.day(r, { width: `abbreviated`, context: `formatting` });
        case `iiiii`:
          return n.day(r, { width: `narrow`, context: `formatting` });
        case `iiiiii`:
          return n.day(r, { width: `short`, context: `formatting` });
        default:
          return n.day(r, { width: `wide`, context: `formatting` });
      }
    },
    a: function (e, t, n) {
      let r = e.getHours() / 12 >= 1 ? `pm` : `am`;
      switch (t) {
        case `a`:
        case `aa`:
          return n.dayPeriod(r, { width: `abbreviated`, context: `formatting` });
        case `aaa`:
          return n.dayPeriod(r, { width: `abbreviated`, context: `formatting` }).toLowerCase();
        case `aaaaa`:
          return n.dayPeriod(r, { width: `narrow`, context: `formatting` });
        default:
          return n.dayPeriod(r, { width: `wide`, context: `formatting` });
      }
    },
    b: function (e, t, n) {
      let r = e.getHours(),
        i;
      switch (((i = r === 12 ? Kp.noon : r === 0 ? Kp.midnight : r / 12 >= 1 ? `pm` : `am`), t)) {
        case `b`:
        case `bb`:
          return n.dayPeriod(i, { width: `abbreviated`, context: `formatting` });
        case `bbb`:
          return n.dayPeriod(i, { width: `abbreviated`, context: `formatting` }).toLowerCase();
        case `bbbbb`:
          return n.dayPeriod(i, { width: `narrow`, context: `formatting` });
        default:
          return n.dayPeriod(i, { width: `wide`, context: `formatting` });
      }
    },
    B: function (e, t, n) {
      let r = e.getHours(),
        i;
      switch (
        ((i = r >= 17 ? Kp.evening : r >= 12 ? Kp.afternoon : r >= 4 ? Kp.morning : Kp.night), t)
      ) {
        case `B`:
        case `BB`:
        case `BBB`:
          return n.dayPeriod(i, { width: `abbreviated`, context: `formatting` });
        case `BBBBB`:
          return n.dayPeriod(i, { width: `narrow`, context: `formatting` });
        default:
          return n.dayPeriod(i, { width: `wide`, context: `formatting` });
      }
    },
    h: function (e, t, n) {
      if (t === `ho`) {
        let t = e.getHours() % 12;
        return (t === 0 && (t = 12), n.ordinalNumber(t, { unit: `hour` }));
      }
      return Gp.h(e, t);
    },
    H: function (e, t, n) {
      return t === `Ho` ? n.ordinalNumber(e.getHours(), { unit: `hour` }) : Gp.H(e, t);
    },
    K: function (e, t, n) {
      let r = e.getHours() % 12;
      return t === `Ko` ? n.ordinalNumber(r, { unit: `hour` }) : Wp(r, t.length);
    },
    k: function (e, t, n) {
      let r = e.getHours();
      return (
        r === 0 && (r = 24), t === `ko` ? n.ordinalNumber(r, { unit: `hour` }) : Wp(r, t.length)
      );
    },
    m: function (e, t, n) {
      return t === `mo` ? n.ordinalNumber(e.getMinutes(), { unit: `minute` }) : Gp.m(e, t);
    },
    s: function (e, t, n) {
      return t === `so` ? n.ordinalNumber(e.getSeconds(), { unit: `second` }) : Gp.s(e, t);
    },
    S: function (e, t) {
      return Gp.S(e, t);
    },
    X: function (e, t, n) {
      let r = e.getTimezoneOffset();
      if (r === 0) return `Z`;
      switch (t) {
        case `X`:
          return Yp(r);
        case `XXXX`:
        case `XX`:
          return Xp(r);
        default:
          return Xp(r, `:`);
      }
    },
    x: function (e, t, n) {
      let r = e.getTimezoneOffset();
      switch (t) {
        case `x`:
          return Yp(r);
        case `xxxx`:
        case `xx`:
          return Xp(r);
        default:
          return Xp(r, `:`);
      }
    },
    O: function (e, t, n) {
      let r = e.getTimezoneOffset();
      switch (t) {
        case `O`:
        case `OO`:
        case `OOO`:
          return `GMT` + Jp(r, `:`);
        default:
          return `GMT` + Xp(r, `:`);
      }
    },
    z: function (e, t, n) {
      let r = e.getTimezoneOffset();
      switch (t) {
        case `z`:
        case `zz`:
        case `zzz`:
          return `GMT` + Jp(r, `:`);
        default:
          return `GMT` + Xp(r, `:`);
      }
    },
    t: function (e, t, n) {
      return Wp(Math.trunc(e / 1e3), t.length);
    },
    T: function (e, t, n) {
      return Wp(+e, t.length);
    },
  };
function Jp(e, t = ``) {
  let n = e > 0 ? `-` : `+`,
    r = Math.abs(e),
    i = Math.trunc(r / 60),
    a = r % 60;
  return a === 0 ? n + String(i) : n + String(i) + t + Wp(a, 2);
}
function Yp(e, t) {
  return e % 60 == 0 ? (e > 0 ? `-` : `+`) + Wp(Math.abs(e) / 60, 2) : Xp(e, t);
}
function Xp(e, t = ``) {
  let n = e > 0 ? `-` : `+`,
    r = Math.abs(e),
    i = Wp(Math.trunc(r / 60), 2),
    a = Wp(r % 60, 2);
  return n + i + t + a;
}
var Zp = (e, t) => {
    switch (e) {
      case `P`:
        return t.date({ width: `short` });
      case `PP`:
        return t.date({ width: `medium` });
      case `PPP`:
        return t.date({ width: `long` });
      default:
        return t.date({ width: `full` });
    }
  },
  Qp = (e, t) => {
    switch (e) {
      case `p`:
        return t.time({ width: `short` });
      case `pp`:
        return t.time({ width: `medium` });
      case `ppp`:
        return t.time({ width: `long` });
      default:
        return t.time({ width: `full` });
    }
  },
  $p = {
    p: Qp,
    P: (e, t) => {
      let n = e.match(/(P+)(p+)?/) || [],
        r = n[1],
        i = n[2];
      if (!i) return Zp(e, t);
      let a;
      switch (r) {
        case `P`:
          a = t.dateTime({ width: `short` });
          break;
        case `PP`:
          a = t.dateTime({ width: `medium` });
          break;
        case `PPP`:
          a = t.dateTime({ width: `long` });
          break;
        default:
          a = t.dateTime({ width: `full` });
          break;
      }
      return a.replace(`{{date}}`, Zp(r, t)).replace(`{{time}}`, Qp(i, t));
    },
  },
  em = /^D+$/,
  tm = /^Y+$/,
  nm = [`D`, `DD`, `YY`, `YYYY`];
function rm(e) {
  return em.test(e);
}
function im(e) {
  return tm.test(e);
}
function am(e, t, n) {
  let r = om(e, t, n);
  if ((console.warn(r), nm.includes(e))) throw RangeError(r);
}
function om(e, t, n) {
  let r = e[0] === `Y` ? `years` : `days of the month`;
  return `Use \`${e.toLowerCase()}\` instead of \`${e}\` (in \`${t}\`) for formatting ${r} to the input \`${n}\`; see: https://github.com/date-fns/date-fns/blob/master/docs/unicodeTokens.md`;
}
var sm = /[yYQqMLwIdDecihHKkms]o|(\w)\1*|''|'(''|[^'])+('|$)|./g,
  cm = /P+p+|P+|p+|''|'(''|[^'])+('|$)|./g,
  lm = /^'([^]*?)'?$/,
  um = /''/g,
  dm = /[a-zA-Z]/;
function fm(e, t, n) {
  let r = cp(),
    i = n?.locale ?? r.locale ?? Rp,
    a =
      n?.firstWeekContainsDate ??
      n?.locale?.options?.firstWeekContainsDate ??
      r.firstWeekContainsDate ??
      r.locale?.options?.firstWeekContainsDate ??
      1,
    o =
      n?.weekStartsOn ??
      n?.locale?.options?.weekStartsOn ??
      r.weekStartsOn ??
      r.locale?.options?.weekStartsOn ??
      0,
    s = ap(e, n?.in);
  if (!yp(s)) throw RangeError(`Invalid time value`);
  let c = t
    .match(cm)
    .map((e) => {
      let t = e[0];
      if (t === `p` || t === `P`) {
        let n = $p[t];
        return n(e, i.formatLong);
      }
      return e;
    })
    .join(``)
    .match(sm)
    .map((e) => {
      if (e === `''`) return { isToken: !1, value: `'` };
      let t = e[0];
      if (t === `'`) return { isToken: !1, value: pm(e) };
      if (qp[t]) return { isToken: !0, value: e };
      if (t.match(dm))
        throw RangeError(
          "Format string contains an unescaped latin alphabet character `" + t + "`",
        );
      return { isToken: !1, value: e };
    });
  i.localize.preprocessor && (c = i.localize.preprocessor(s, c));
  let l = { firstWeekContainsDate: a, weekStartsOn: o, locale: i };
  return c
    .map((r) => {
      if (!r.isToken) return r.value;
      let a = r.value;
      ((!n?.useAdditionalWeekYearTokens && im(a)) || (!n?.useAdditionalDayOfYearTokens && rm(a))) &&
        am(a, t, String(e));
      let o = qp[a[0]];
      return o(s, a, i.localize, l);
    })
    .join(``);
}
function pm(e) {
  let t = e.match(lm);
  return t ? t[1].replace(um, `'`) : e;
}
function mm(e, t) {
  return +ap(e) > +ap(t);
}
function hm(e, t) {
  return +ap(e) < +ap(t);
}
function gm(e, t, n) {
  let [r, i] = pp(n?.in, e, t);
  return r.getFullYear() === i.getFullYear() && r.getMonth() === i.getMonth();
}
function _m(e, t, n) {
  let r = +ap(e, n?.in),
    [i, a] = [+ap(t.start, n?.in), +ap(t.end, n?.in)].sort((e, t) => e - t);
  return r >= i && r <= a;
}
function vm(e, t) {
  let n = () => ip(t?.in, NaN),
    r = t?.additionalDigits ?? 2,
    i = Cm(e),
    a;
  if (i.date) {
    let e = wm(i.date, r);
    a = Tm(e.restDateString, e.year);
  }
  if (!a || isNaN(+a)) return n();
  let o = +a,
    s = 0,
    c;
  if (i.time && ((s = Dm(i.time)), isNaN(s))) return n();
  if (i.timezone) {
    if (((c = km(i.timezone)), isNaN(c))) return n();
  } else {
    let e = new Date(o + s),
      n = ap(0, t?.in);
    return (
      n.setFullYear(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()),
      n.setHours(e.getUTCHours(), e.getUTCMinutes(), e.getUTCSeconds(), e.getUTCMilliseconds()),
      n
    );
  }
  return ap(o + s + c, t?.in);
}
var ym = { dateTimeDelimiter: /[T ]/, timeZoneDelimiter: /[Z ]/i, timezone: /([Z+-].*)$/ },
  bm = /^-?(?:(\d{3})|(\d{2})(?:-?(\d{2}))?|W(\d{2})(?:-?(\d{1}))?|)$/,
  xm = /^(\d{2}(?:[.,]\d*)?)(?::?(\d{2}(?:[.,]\d*)?))?(?::?(\d{2}(?:[.,]\d*)?))?$/,
  Sm = /^([+-])(\d{2})(?::?(\d{2}))?$/;
function Cm(e) {
  let t = {},
    n = e.split(ym.dateTimeDelimiter),
    r;
  if (n.length > 2) return t;
  if (
    (/:/.test(n[0])
      ? (r = n[0])
      : ((t.date = n[0]),
        (r = n[1]),
        ym.timeZoneDelimiter.test(t.date) &&
          ((t.date = e.split(ym.timeZoneDelimiter)[0]), (r = e.substr(t.date.length, e.length)))),
    r)
  ) {
    let e = ym.timezone.exec(r);
    e ? ((t.time = r.replace(e[1], ``)), (t.timezone = e[1])) : (t.time = r);
  }
  return t;
}
function wm(e, t) {
  let n = RegExp(`^(?:(\\d{4}|[+-]\\d{` + (4 + t) + `})|(\\d{2}|[+-]\\d{` + (2 + t) + `})$)`),
    r = e.match(n);
  if (!r) return { year: NaN, restDateString: `` };
  let i = r[1] ? parseInt(r[1]) : null,
    a = r[2] ? parseInt(r[2]) : null;
  return { year: a === null ? i : a * 100, restDateString: e.slice((r[1] || r[2]).length) };
}
function Tm(e, t) {
  if (t === null) return new Date(NaN);
  let n = e.match(bm);
  if (!n) return new Date(NaN);
  let r = !!n[4],
    i = Em(n[1]),
    a = Em(n[2]) - 1,
    o = Em(n[3]),
    s = Em(n[4]),
    c = Em(n[5]) - 1;
  if (r) return Fm(t, s, c) ? Am(t, s, c) : new Date(NaN);
  {
    let e = new Date(0);
    return !Nm(t, a, o) || !Pm(t, i) ? new Date(NaN) : (e.setUTCFullYear(t, a, Math.max(i, o)), e);
  }
}
function Em(e) {
  return e ? parseInt(e) : 1;
}
function Dm(e) {
  let t = e.match(xm);
  if (!t) return NaN;
  let n = Om(t[1]),
    r = Om(t[2]),
    i = Om(t[3]);
  return Im(n, r, i) ? n * tp + r * ep + i * 1e3 : NaN;
}
function Om(e) {
  return (e && parseFloat(e.replace(`,`, `.`))) || 0;
}
function km(e) {
  if (e === `Z`) return 0;
  let t = e.match(Sm);
  if (!t) return 0;
  let n = t[1] === `+` ? -1 : 1,
    r = parseInt(t[2]),
    i = (t[3] && parseInt(t[3])) || 0;
  return Lm(r, i) ? n * (r * tp + i * ep) : NaN;
}
function Am(e, t, n) {
  let r = new Date(0);
  r.setUTCFullYear(e, 0, 4);
  let i = r.getUTCDay() || 7,
    a = (t - 1) * 7 + n + 1 - i;
  return (r.setUTCDate(r.getUTCDate() + a), r);
}
var jm = [31, null, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function Mm(e) {
  return e % 400 == 0 || (e % 4 == 0 && e % 100 != 0);
}
function Nm(e, t, n) {
  return t >= 0 && t <= 11 && n >= 1 && n <= (jm[t] || (Mm(e) ? 29 : 28));
}
function Pm(e, t) {
  return t >= 1 && t <= (Mm(e) ? 366 : 365);
}
function Fm(e, t, n) {
  return t >= 1 && t <= 53 && n >= 0 && n <= 6;
}
function Im(e, t, n) {
  return e === 24 ? t === 0 && n === 0 : n >= 0 && n < 60 && t >= 0 && t < 60 && e >= 0 && e < 25;
}
function Lm(e, t) {
  return t >= 0 && t <= 59;
}
function Rm(e) {
  return e.includes(`<`) || !/&(?:lt|gt|quot|#39|amp);/.test(e)
    ? e
    : e
        .replace(/&lt;/g, `<`)
        .replace(/&gt;/g, `>`)
        .replace(/&quot;/g, `"`)
        .replace(/&#39;/g, `'`)
        .replace(/&amp;/g, `&`);
}
function zm(e) {
  if (typeof e == `string`) return e;
  if (typeof e == `object` && e && `value` in e && typeof e.value == `string`) return e.value;
}
function Bm(e) {
  if (
    !e ||
    (typeof e != `object` && typeof e != `function`) ||
    !Object.getOwnPropertySymbols(e).find((e) => e.description === `ilha.islandCall`)
  )
    return;
  let t = e,
    n = t.island;
  if (!(!n || (typeof n != `object` && typeof n != `function`)))
    return { island: n, props: t.props };
}
function Vm(e) {
  return !e || (typeof e != `object` && typeof e != `function`)
    ? !1
    : Object.getOwnPropertySymbols(e).some(
        (e) => e.description === `ilha.island` || e.description === `ilha.islandMountInternal`,
      );
}
function $(e) {
  if (e == null || e === !1) return ``;
  if (Array.isArray(e)) return e.map($);
  if (typeof e == `string`) return W(Rm(e));
  let t = zm(e);
  return t === void 0 ? (Vm(e) || Bm(e), e) : W(Rm(t));
}
function Hm(e) {
  if (e == null || e === !1) return ``;
  if (Array.isArray(e)) return e.map(Hm).join(``);
  if (Vm(e)) return ``;
  let t = zm(e);
  if (t !== void 0) return t;
  let n = Bm(e);
  return n?.island.toString
    ? n.island.toString(n.props)
    : typeof e == `object` && e && `value` in e
      ? String(e.value)
      : String(e);
}
function Um(e) {
  return e == null || e === !1
    ? ``
    : Array.isArray(e)
      ? e.map(Um).join(``)
      : Vm(e) || Bm(e)
        ? (zm(U`${e}`) ?? ``)
        : Hm(e);
}
function Wm(e) {
  if (e == null || e === !1) return !1;
  if (Array.isArray(e)) return e.some(Wm);
  if (Vm(e) || Bm(e)) return !0;
  let t = zm(e);
  return t === void 0 ? typeof e != `string` || e.trim().length > 0 : t.trim().length > 0;
}
function Gm(e, t) {
  let n = { ...e };
  for (let e of t) {
    let t = n[e];
    t != null && (n[e] = $(t));
  }
  return n;
}
function Km(e, t) {
  return RegExp(`\\sdata-slot=["']${t}["']`).test(Um(e));
}
function qm(e, t, n, r) {
  let i = (Vm(e) ? zm(U`${e}`) : void 0) ?? Hm(e);
  if (!i || !i.trimStart().startsWith(`<`)) return;
  let a = q(n, r),
    o = i;
  return (
    /\sdata-slot=/.test(o) ||
      (o = o.replace(/<([a-zA-Z][^\s/>]*)([^>]*)>/, `<$1$2 data-slot="${t}">`)),
    a &&
      (o = /\sclass=\"/.test(o)
        ? o.replace(/\sclass=\"([^\"]*)\"/, ` class="${a} $1"`)
        : o.replace(/<([a-zA-Z][^\s/>]*)([^>]*)>/, `<$1$2 class="${a}">`)),
    W(o)
  );
}
var Jm = `inline-flex w-fit flex-none shrink-0 items-center justify-self-start rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap`,
  Ym = {
    variant: {
      primary: {
        classes: `bg-areia-primary text-areia-primary-foreground`,
        description: `Primary badge`,
      },
      secondary: {
        classes: `bg-areia-surface-muted text-areia-surface-muted-foreground`,
        description: `Secondary badge`,
      },
      error: {
        classes: `bg-areia-destructive-soft/60 text-areia-destructive-soft-foreground`,
        description: `Error badge`,
      },
      warning: {
        classes: `bg-areia-warning-soft/70 text-areia-warning-soft-foreground`,
        description: `Warning badge`,
      },
      success: {
        classes: `bg-areia-success-soft/70 text-areia-success-soft-foreground`,
        description: `Success badge`,
      },
      destructive: {
        classes: `bg-areia-destructive text-areia-destructive-foreground`,
        description: `Deprecated. Use red instead.`,
      },
      info: {
        classes: `bg-areia-info-soft/70 text-areia-info-soft-foreground`,
        description: `Info badge`,
      },
      beta: {
        classes: `border border-dashed border-areia-primary bg-transparent text-areia-primary`,
        description: `Indicates beta or experimental features`,
      },
      outline: {
        classes: `border border-areia-border bg-transparent text-areia-default`,
        description: `Bordered badge with transparent background`,
      },
      red: {
        classes: `bg-areia-destructive text-areia-destructive-foreground`,
        description: `Red badge`,
      },
      green: {
        classes: `bg-areia-success text-areia-success-foreground`,
        description: `Green badge`,
      },
      neutral: {
        classes: `bg-areia-badge-neutral text-areia-badge-neutral-foreground`,
        description: `Neutral badge`,
      },
      orange: {
        classes: `bg-areia-accent text-areia-accent-foreground`,
        description: `Orange badge`,
      },
      purple: {
        classes: `bg-areia-badge-purple text-areia-badge-purple-foreground`,
        description: `Purple badge`,
      },
      teal: {
        classes: `bg-areia-badge-teal text-areia-badge-teal-foreground`,
        description: `Teal badge`,
      },
      "teal-subtle": {
        classes: `bg-areia-badge-teal-soft text-areia-badge-teal-soft-foreground`,
        description: `Subtle teal badge`,
      },
      blue: { classes: `bg-areia-info text-areia-info-foreground`, description: `Blue badge` },
    },
  },
  Xm = { variant: `primary` };
function Zm(e, t, n) {
  return e[t ?? n] ?? e[n];
}
function Qm({ variant: e = Xm.variant } = {}) {
  return q(Jm, Zm(Ym.variant, e, Xm.variant).classes);
}
function $m(e = {}) {
  let { children: t, class: n, className: r, variant: i = Xm.variant, ...a } = e;
  return U`<span
    class="${q(Qm({ variant: i }), n, r)}"
    ${W(J(a))}
    >${$(t)}</span
  >`;
}
async function eh(e) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(e);
    return;
  }
  let t = document.createElement(`textarea`);
  ((t.value = e),
    t.setAttribute(`readonly`, ``),
    (t.style.position = `absolute`),
    (t.style.left = `-9999px`),
    document.body.appendChild(t));
  let n = document.getSelection(),
    r = n?.rangeCount ? n.getRangeAt(0) : null;
  t.select();
  try {
    document.execCommand(`copy`);
  } finally {
    (document.body.removeChild(t), r && (n?.removeAllRanges(), n?.addRange(r)));
  }
}
var th = `var a=document.createElement('textarea');a.value=t;a.setAttribute('readonly','');a.style.position='absolute';a.style.left='-9999px';document.body.appendChild(a);a.select();try{document.execCommand('copy');w()}finally{document.body.removeChild(a)}`,
  nh = `var b=this,r=b.closest('[data-slot=\\'clipboard-text\\']'),t=b.getAttribute('data-copy-text')||'',w=function(){var c=r&&r.querySelector('[data-slot=\\'clipboard-text-copied-icon\\']'),i=r&&r.querySelector('[data-slot=\\'clipboard-text-copy-icon\\']'),s=r&&r.querySelector('[data-slot=\\'clipboard-text-status\\']');c&&c.classList.remove('translate-y-full','opacity-0');c&&c.classList.add('translate-y-0','opacity-100');i&&i.classList.add('-translate-y-full','opacity-0');i&&i.classList.remove('opacity-100');if(s)s.textContent=b.getAttribute('data-copied-text')||'Copied';clearTimeout(b._clipboardTextTimeout);b._clipboardTextTimeout=setTimeout(function(){c&&c.classList.add('translate-y-full','opacity-0');c&&c.classList.remove('translate-y-0','opacity-100');i&&i.classList.remove('-translate-y-full','opacity-0');i&&i.classList.add('opacity-100');if(s)s.textContent=''},1500)};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(w).catch(function(){${th}})}else{${th}}`,
  rh = `var b=this,t=b.getAttribute('data-copy-text')||'',c=b.querySelector('.bc-copy-icon'),k=b.querySelector('.bc-check-icon'),w=function(){c&&(c.style.display='none');k&&(k.style.display='flex');clearTimeout(b._bcClipboardTimeout);b._bcClipboardTimeout=setTimeout(function(){c&&(c.style.display='flex');k&&(k.style.display='none')},2000)};if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(w).catch(function(){${th}})}else{${th}}`,
  ih = {
    size: {
      sm: { classes: `text-sm h-10 gap-0.5`, description: `Compact breadcrumbs for dense UIs` },
      base: { classes: `text-base h-12 gap-1`, description: `Default breadcrumbs size` },
    },
  },
  ah = { size: `base` };
function oh(e, t, n) {
  return e[t ?? n] ?? e[n];
}
function sh({ size: e = ah.size } = {}) {
  return q(
    `group mr-4 flex min-w-0 grow items-center overflow-hidden whitespace-nowrap`,
    oh(ih.size, e, ah.size).classes,
  );
}
function ch(e) {
  return e.replace(/&/g, `&amp;`).replace(/"/g, `&quot;`);
}
function lh() {
  return W(`<span
    class="flex shrink-0 items-center text-areia-muted"
    aria-hidden="true"
  >
    <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
      <path
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.5"
        d="M10.75 8.75L14.25 12L10.75 15.25"
      />
    </svg>
  </span>`);
}
function uh() {
  return W(
    `<span class="flex shrink-0 items-center text-areia-muted" aria-hidden="true">...</span>`,
  );
}
function dh(e) {
  let { children: t, icon: n, class: r, className: i, ...a } = e;
  return U`<a
    class="${q(`flex min-w-0 max-w-full items-center gap-1 text-areia-subtle no-underline`, r, i)}"
    ${W(J(a))}
  >
    ${n == null ? `` : U`<span class="flex shrink-0 items-center">${n}</span>`}
    <span class="truncate">${t}</span>
  </a>`;
}
function fh(e = {}) {
  let { children: t, icon: n, loading: r, class: i, className: a } = e;
  return r
    ? U`<div
      class="${q(`flex w-[125px] min-w-0 items-center gap-1`, i, a)}"
    >
      ${n == null ? `` : U`<span class="flex shrink-0 items-center">${n}</span>`}
      <span class="h-4 w-full animate-pulse rounded bg-areia-surface-muted"></span>
    </div>`
    : U`<div
    class="${q(`flex min-w-0 max-w-full items-center gap-1 font-medium`, i, a)}"
    aria-current="page"
  >
    ${n == null ? `` : U`<span class="flex shrink-0 items-center">${n}</span>`}
    <span class="truncate">${t}</span>
  </div>`;
}
function ph(e) {
  let { text: t, class: n, className: r } = e,
    i = ch(t);
  return W(`<button
    type="button"
    class="${q(`opacity-0 transition-opacity group-hover:opacity-100`, `inline-flex shrink-0 items-center justify-center`, `size-6.5 rounded-md hover:bg-areia-control-hover`, `cursor-pointer`, n, r)}"
    onclick="${rh}"
    data-copy-text="${i}"
    title="Copy link"
    aria-label="Copy link"
  >
    <span class="bc-copy-icon flex items-center">
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    </span>
    <span class="bc-check-icon flex items-center text-areia-success" style="display:none">
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </span>
  </button>`);
}
function mh(e, t) {
  let n = [],
    r = e.length;
  for (let i = 0; i < r; i++) {
    i > 0 && n.push(lh());
    let a = e[i];
    i === r - 1
      ? n.push(fh({ children: a.children, icon: a.icon, loading: t }))
      : n.push(dh({ href: a.href ?? `#`, children: a.children, icon: a.icon }));
  }
  return n;
}
function hh(e, t) {
  if (e.length <= 2) return mh(e, t);
  let n = e[e.length - 2],
    r = e[e.length - 1];
  return [
    uh(),
    lh(),
    dh({ href: n.href ?? `#`, children: n.children, icon: n.icon }),
    lh(),
    fh({ children: r.children, icon: r.icon, loading: t }),
  ];
}
function gh(e) {
  let {
      items: t = [],
      children: n,
      size: r = ah.size,
      loading: i,
      copyUrl: a,
      class: o,
      className: s,
    } = e,
    c = Wm(n),
    l = c ? [] : mh(t, i),
    u = c ? [] : hh(t, i);
  return U`<nav
    class="${q(sh({ size: r }), o, s)}"
    aria-label="breadcrumb"
  >
    ${
      c
        ? $(n)
        : U`<div class="contents sm:hidden">${$(u)}</div>
          <div class="hidden sm:contents">${$(l)}</div>`
    }
    ${a == null ? `` : ph({ text: a })}
  </nav>`;
}
Object.assign(gh, {
  Root: gh,
  Static: gh,
  Link: dh,
  Current: fh,
  Separator: lh,
  Clipboard: ph,
  MobileEllipsis: uh,
});
var _h = {
    size: {
      sm: { classes: `size-3.5`, pixels: 14 },
      base: { classes: `size-3.5`, pixels: 14 },
      lg: { classes: `size-4`, pixels: 16 },
    },
  },
  vh = { size: `base` };
function yh({ size: e = vh.size } = {}) {
  return q(`animate-spin`, _h.size[e]?.classes);
}
function bh(e = {}) {
  let { class: t, className: n, size: r = vh.size, ...i } = e,
    a = _h.size[r]?.pixels ?? _h.size.base.pixels;
  return U`<svg
    aria-hidden="true"
    data-slot="spinner"
    class="${q(yh({ size: r }), t, n)}"
    width="${a}"
    height="${a}"
    viewBox="0 0 24 24"
    fill="none"
    ${W(J(i))}
  >
    <circle
      class="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      stroke-width="4"
    ></circle>
    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"></path>
  </svg>`;
}
var xh = {
    shape: {
      base: { classes: ``, description: `Default rectangular button shape` },
      square: {
        classes: `items-center justify-center p-0`,
        description: `Square button for icon-only actions`,
      },
      circle: {
        classes: `items-center justify-center p-0 rounded-full`,
        description: `Circular button for icon-only actions`,
      },
    },
    size: {
      xs: {
        classes: `h-5 gap-1 rounded-sm px-1.5 text-xs`,
        description: `Extra small button for compact UIs`,
      },
      sm: {
        classes: `h-6.5 gap-1 rounded-md px-2 text-xs`,
        description: `Small button for secondary actions`,
      },
      base: {
        classes: `h-9 gap-1.5 rounded-lg px-3 text-base`,
        description: `Default button size`,
      },
      lg: {
        classes: `h-10 gap-2 rounded-lg px-4 text-base`,
        description: `Large button for primary CTAs`,
      },
    },
    compactSize: {
      xs: { classes: `size-3.5` },
      sm: { classes: `size-6.5` },
      base: { classes: `size-9` },
      lg: { classes: `size-10` },
    },
    variant: {
      primary: {
        classes: `bg-areia-primary !text-areia-primary-foreground hover:bg-areia-primary/90 disabled:bg-areia-primary/50`,
        description: `High-emphasis button for primary actions`,
      },
      secondary: {
        classes: `bg-areia-control-background !text-areia-control-foreground ring not-disabled:hover:bg-areia-control-hover disabled:bg-areia-control-disabled disabled:!text-areia-control-disabled-foreground ring-areia-control-border data-[state=open]:bg-areia-control-background`,
        description: `Default button style for most actions`,
      },
      ghost: {
        classes: `text-areia-default hover:bg-areia-control-hover shadow-none bg-inherit`,
        description: `Minimal button with no background`,
      },
      destructive: {
        classes: `bg-areia-destructive !text-areia-destructive-foreground hover:bg-areia-destructive/70`,
        description: `Danger button for destructive actions like delete`,
      },
      "secondary-destructive": {
        classes: `bg-areia-control-background !text-areia-destructive-soft-foreground ring not-disabled:hover:bg-areia-control-hover disabled:bg-areia-control-disabled disabled:!text-areia-control-disabled-foreground ring-areia-control-border data-[state=open]:bg-areia-control-background`,
        description: `Secondary button with destructive text for less prominent dangerous actions`,
      },
      outline: {
        classes: `bg-transparent text-areia-default ring ring-areia-border`,
        description: `Bordered button with transparent background`,
      },
    },
  },
  Sh = { shape: `base`, size: `base`, variant: `secondary` };
function Ch(e, t, n) {
  return e[t ?? n] ?? e[n];
}
function wh({ orientation: e = `horizontal` } = {}) {
  return q(
    `flex w-fit items-stretch overflow-hidden rounded-lg border border-areia-control-border *:focus-visible:relative *:focus-visible:z-10`,
    `has-[>[data-slot=button-group]]:gap-2 [&>input]:flex-1`,
    `[&>button:not([class*='w-'])]:w-fit [&>a:not([class*='w-'])]:w-fit`,
    `[&>button]:rounded-none [&>a]:rounded-none [&>[data-slot=button-group-text]]:rounded-none [&>button]:shadow-none [&>a]:shadow-none [&>button]:ring-0 [&>a]:ring-0 [&>[data-slot=button-group-text]]:ring-0`,
    e === `horizontal` && `flex-row`,
    e === `vertical` && `flex-col`,
  );
}
function Th({ variant: e = Sh.variant, size: t = Sh.size, shape: n = Sh.shape } = {}) {
  let r = n === `square` || n === `circle`;
  return q(
    `group flex w-max shrink-0 items-center font-medium select-none`,
    `border-0 shadow-xs`,
    `focus:outline-none focus:ring-areia-ring/50 focus-visible:ring-2 focus-visible:ring-areia-ring`,
    `cursor-pointer`,
    `disabled:cursor-not-allowed disabled:text-areia-disabled`,
    Ch(xh.variant, e, Sh.variant).classes,
    Ch(xh.size, t, Sh.size).classes,
    Ch(xh.shape, n, Sh.shape).classes,
    r && Ch(xh.compactSize, t, Sh.size).classes,
  );
}
function Eh(e = {}) {
  let { children: t, class: n, className: r, orientation: i = `horizontal`, role: a, ...o } = e;
  return U`<div
    role="${a ?? `group`}"
    data-slot="button-group"
    data-orientation="${i}"
    class="${q(wh({ orientation: i }), n, r)}"
    ${W(J(o))}
  >
    ${$(t)}
  </div>`;
}
function Dh(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<div
    data-slot="button-group-text"
    class="${q(`flex items-center gap-2 rounded-lg bg-areia-surface-muted px-2.5 text-sm font-medium text-areia-default ring ring-areia-border [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4`, n, r)}"
    ${W(J(i))}
  >
    ${$(t)}
  </div>`;
}
function Oh(e = {}) {
  let { class: t, className: n, orientation: r = `vertical`, role: i = `separator`, ...a } = e;
  return U`<div
    role="${i}"
    aria-orientation="${r}"
    data-slot="button-group-separator"
    data-orientation="${r}"
    class="${q(`relative shrink-0 self-stretch bg-areia-border`, r === `horizontal` && `mx-px h-px w-auto self-auto`, r === `vertical` && `my-px h-auto w-px`, t, n)}"
    ${W(J(a))}
  ></div>`;
}
Object.assign(Eh, { Root: Eh, Text: Dh, Separator: Oh });
function kh(e = {}) {
  let {
      children: t,
      class: n,
      className: r,
      disabled: i,
      icon: a,
      loading: o,
      shape: s = `base`,
      size: c = `base`,
      title: l,
      type: u,
      variant: d = `secondary`,
      ...f
    } = e,
    p = q(Th({ variant: d, size: c, shape: s }), i && `cursor-not-allowed opacity-50`, n, r),
    m = U`<button
    type="${u ?? `button`}"
    data-variant="${d}"
    class="${p}"
    ${W(J({ ...f, disabled: !!(o || i) }))}
  >
    ${o ? bh({ size: c === `lg` ? `lg` : `base` }) : $(a)}
    ${t == null ? `` : U`<span class="contents">${$(t)}</span>`}
  </button>`;
  return l == null || l === ``
    ? m
    : U`<span class="group/button-title relative inline-flex w-max">
    ${m}
    <span
      role="tooltip"
      class="pointer-events-none invisible absolute bottom-full left-1/2 z-(--areia-z-tooltip) mb-2 w-max max-w-xs -translate-x-1/2 rounded-md bg-areia-background px-2.5 py-1.5 font-sans text-xs font-normal text-areia-default opacity-0 shadow-lg outline outline-1 outline-areia-divider transition-opacity group-hover/button-title:visible group-hover/button-title:opacity-100 group-focus-within/button-title:visible group-focus-within/button-title:opacity-100"
      >${$(l)}</span
    >
  </span>`;
}
function Ah(e = {}) {
  let {
    children: t,
    class: n,
    className: r,
    external: i,
    icon: a,
    shape: o = `base`,
    size: s = `base`,
    variant: c = `ghost`,
    ...l
  } = e;
  return U`<a
    data-variant="${c}"
    class="${q(Th({ variant: c, size: s, shape: o }), `flex items-center no-underline!`, n, r)}"
    ${W(J({ ...l, target: i ? `_blank` : l.target, rel: i ? `noopener noreferrer` : l.rel }))}
  >
    ${$(a)}${$(t)}
  </a>`;
}
var jh = [
  `bind:value`,
  `bind:valueAsNumber`,
  `bind:valueAsDate`,
  `bind:checked`,
  `bind:group`,
  `bind:open`,
  `bind:files`,
  `bind:this`,
];
function Mh(e) {
  return e.startsWith(`bind:`);
}
function Nh(e) {
  let t = {},
    n = {};
  for (let [r, i] of Object.entries(e)) Mh(r) ? (t[r] = i) : (n[r] = i);
  return { binds: t, attrs: n };
}
function Ph(e, t) {
  return U(Object.assign([...e], { raw: [...e] }), ...t);
}
function Fh(e, t, n) {
  for (let [r, i] of Object.entries(n))
    i != null && ((e[e.length - 1] += ` ${r}=`), t.push(i), e.push(``));
}
function Ih(e, t) {
  return !t || !/\/>\s*$/.test(e) ? e : e.replace(/\/>\s*$/, `>`);
}
function Lh(e, t, n) {
  let r = Object.values(t).some((e) => e != null),
    i = [`<${e}`],
    a = [];
  return (Fh(i, a, t), (i[i.length - 1] += Ih(n, r)), Ph(i, a));
}
function Rh(e, t, n, r, i = `</${e}>`) {
  let a = [`<${e}`],
    o = [];
  return (Fh(a, o, t), (a[a.length - 1] += `${n}>`), o.push(r), a.push(i), Ph(a, o));
}
function zh(e, t) {
  let n = e[t];
  if (typeof n == `function`) return n;
}
function Bh(e) {
  for (let t of jh) zh(e, t)?.();
}
function Vh(e, t, n) {
  let r = zh(e, `bind:group`),
    i = zh(e, `bind:checked`);
  return r && n !== void 0
    ? {
        applyFromSignal: () => {
          let e = r(),
            i = Array.isArray(e) ? e.map(String) : e;
          t.setChecked(Array.isArray(i) ? i.includes(n) : String(i) === n);
        },
        onUserChange: (e) => {
          let t = r();
          if (Array.isArray(t)) {
            let i = t.map(String),
              a = i.indexOf(n);
            (e && a === -1 && i.push(n), !e && a !== -1 && i.splice(a, 1), r(i));
            return;
          }
          e && r(n);
        },
      }
    : i
      ? { applyFromSignal: () => t.setChecked(!!i()), onUserChange: (e) => i(e) }
      : null;
}
function Hh(e, t) {
  let n = zh(e, `bind:open`);
  return n ? !!n() : t;
}
function Uh(e, t) {
  let n = zh(e, `bind:open`);
  if (!n) return null;
  let r = !1;
  return {
    applyFromSignal: () => {
      r = !0;
      let e = !!n();
      (e && !t.isOpen ? t.open() : !e && t.isOpen && t.close(), (r = !1));
    },
    onUserChange: (e) => {
      r || (!!n() !== e && n(e));
    },
  };
}
function Wh(e, t) {
  return e == null
    ? t === `multiple`
      ? []
      : null
    : Array.isArray(e)
      ? e.map(String)
      : t === `multiple`
        ? [String(e)]
        : String(e);
}
function Gh(e, t) {
  return e == null
    ? null
    : t === `multiple`
      ? Array.isArray(e)
        ? e
        : [e]
      : Array.isArray(e)
        ? (e[0] ?? null)
        : e;
}
function Kh(e, t) {
  if (e === t) return !0;
  if (e == null || t == null) return !1;
  let n = Array.isArray(e) ? e : [e],
    r = Array.isArray(t) ? t : [t];
  return n.length === r.length && n.every((e, t) => e === r[t]);
}
function qh(e, t) {
  let n = zh(e, `bind:group`);
  return n ? (n() ?? void 0) : t;
}
function Jh(e, t, n = `single`) {
  let r = zh(e, `bind:group`);
  if (!r) return null;
  let i = !1;
  return {
    applyFromSignal: () => {
      i = !0;
      let e = Wh(r(), n);
      (Kh(e, t.getValue()) || t.setValue(e), (i = !1));
    },
    onUserChange: (e) => {
      i || Kh(Wh(r(), n), e) || r(Gh(e, n));
    },
  };
}
function Yh(e, t) {
  let n = zh(e, `bind:valueAsDate`);
  if (!n) return null;
  let r = !1,
    i = (e, t) =>
      e == null && t == null ? !0 : e == null || t == null ? !1 : e.getTime() === t.getTime();
  return {
    applyFromSignal: () => {
      r = !0;
      let e = n();
      (i(e, t.getDate()) || t.setDate(e), (r = !1));
    },
    onUserChange: (e) => {
      if (r) return;
      let t = n();
      i(t, e) || n(e);
    },
  };
}
function Xh(e, t) {
  let n = zh(t, `bind:this`);
  if (n) return (e && n(e), () => n(null));
}
var Zh = [[`path`, { d: `M20 6 9 17l-5-5` }]],
  Qh = [[`path`, { d: `m6 9 6 6 6-6` }]],
  $h = [[`path`, { d: `m15 18-6-6 6-6` }]],
  eg = [[`path`, { d: `m9 18 6-6-6-6` }]],
  tg = [
    [`rect`, { width: `14`, height: `14`, x: `8`, y: `8`, rx: `2`, ry: `2` }],
    [`path`, { d: `M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2` }],
  ],
  ng = [
    [`circle`, { cx: `12`, cy: `12`, r: `10` }],
    [`path`, { d: `M12 16v-4` }],
    [`path`, { d: `M12 8h.01` }],
  ];
function rg(e) {
  return e.replace(/[A-Z]/g, (e) => `-${e.toLowerCase()}`);
}
function ig(e) {
  return e.replace(/&/g, `&amp;`).replace(/"/g, `&quot;`);
}
function ag(e) {
  return Object.entries(e)
    .flatMap(([e, t]) => {
      if (t == null || t === !1) return [];
      let n = e === `className` ? `class` : rg(e);
      return t === !0 ? [n] : `${n}="${ig(String(t))}"`;
    })
    .join(` `);
}
function og({ icon: e, class: t, className: n, label: r, strokeWidth: i = 1.75 }) {
  if (!e || !Array.isArray(e)) return W(``);
  let a = e
      .map(([e, t]) => {
        let n = ag(t);
        return `<${e}${n ? ` ${n}` : ``}></${e}>`;
      })
      .join(``),
    o = r ? `role="img" aria-label="${ig(r)}"` : `aria-hidden="true"`;
  return W(`<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="${ig(String(i))}"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="${ig(q(`h-4 w-4`, t, n))}"
    ${o}
  >${a}</svg>`);
}
function sg(e = {}) {
  return q(`m-0 text-base font-medium text-areia-default`);
}
function cg() {
  return q(`inline-flex items-center gap-1`);
}
function lg(e) {
  return U`<span class="group/label-tooltip relative inline-flex">
    ${kh({ variant: `ghost`, size: `xs`, shape: `square`, icon: og({ icon: ng, class: `size-4` }), "aria-label": `More information` })}
    <span
      role="tooltip"
      class="pointer-events-none invisible absolute bottom-full left-1/2 z-(--areia-z-tooltip) mb-2 w-max max-w-xs -translate-x-1/2 rounded-md bg-areia-background px-2.5 py-1.5 text-xs font-normal text-areia-default opacity-0 shadow-lg outline outline-1 outline-areia-divider transition-opacity group-hover/label-tooltip:visible group-hover/label-tooltip:opacity-100 group-focus-within/label-tooltip:visible group-focus-within/label-tooltip:opacity-100"
      >${$(e)}</span
    >
  </span>`;
}
function ug({ children: e, label: t, showOptional: n = !1 }) {
  return U`${$(e ?? t)}${n ? U`<span class="font-normal text-areia-subtle">(optional)</span>` : ``}`;
}
function dg(e) {
  return U`${ug(e)}${e.tooltip ? lg(e.tooltip) : ``}`;
}
function fg(e = {}) {
  let {
      asContent: t = !1,
      class: n,
      className: r,
      children: i,
      label: a,
      showOptional: o,
      tooltip: s,
      htmlFor: c,
      for: l,
      ...u
    } = e,
    d = dg(e);
  if (t)
    return U`<span
      class="${q(cg(), n, r)}"
      ${W(J(u))}
    >
      ${d}
    </span>`;
  let f = U`<label
    class="${q(sg(), cg(), n, r)}"
    ${W(J({ ...u, for: c ?? l }))}
  >
    ${ug(e)}
  </label>`;
  return s
    ? U`<span class="${cg()}">
    ${f}${lg(s)}
  </span>`
    : f;
}
var pg =
    `data-checked.data-unchecked.data-indeterminate.aria-checked.data-open.data-closed.data-state.aria-expanded.aria-hidden.data-selected.data-panel-open.data-value.data-dragging.data-highlighted.data-orientation.data-disabled.data-side.data-align.data-position.data-collapsed.data-expanded.data-month.data-active.data-align-trigger.aria-valuenow.aria-valuemin.aria-valuemax.aria-valuetext.aria-selected.aria-controls.aria-orientation.aria-disabled.aria-required.aria-haspopup.aria-activedescendant.aria-pressed.hidden.inert.tabindex.role`.split(
      `.`,
    ),
  mg = [`style`],
  hg = `data-morph-preserve`;
function gg(e, t) {
  let n = new Set(
    String(e ?? ``)
      .split(/\s+/)
      .filter(Boolean),
  );
  for (let e of t) n.add(e);
  return [...n].join(` `);
}
function _g(e, t = []) {
  let n = t.length === 0 ? pg : [...pg, ...t],
    r = e.getAttribute(hg);
  if (r === null) {
    e.setAttribute(hg, n.join(` `));
    return;
  }
  let i = new Set(r.split(/\s+/).filter(Boolean));
  for (let e of n) i.add(e);
  e.setAttribute(hg, [...i].join(` `));
}
function vg(e, t = []) {
  e.hasAttribute(`data-slot`) && _g(e, t);
  for (let n of e.querySelectorAll(`[data-slot]`)) _g(n, t);
}
var yg = new WeakMap();
function bg(e, t = []) {
  if (!e) return;
  vg(e, t);
  let n = yg.get(e);
  if (n) {
    let r = !1;
    for (let e of t) n.has(e) || (n.add(e), (r = !0));
    r && vg(e, [...n]);
    return;
  }
  let r = new Set(t);
  (yg.set(e, r),
    !(typeof MutationObserver > `u`) &&
      new MutationObserver((t) => {
        let n = [...(yg.get(e) ?? r)];
        for (let e of t) for (let t of e.addedNodes) t instanceof Element && vg(t, n);
      }).observe(e, { childList: !0, subtree: !0 }));
}
var xg = {
    variant: {
      default: { classes: `ring-areia-control-border`, description: `Default checkbox appearance` },
      error: {
        classes: `ring-areia-destructive`,
        description: `Error state for validation failures`,
      },
    },
  },
  Sg = { variant: `default` };
function Cg(e, t, n) {
  return e[t ?? n] ?? e[n];
}
function wg({ variant: e = Sg.variant } = {}) {
  return q(Cg(xg.variant, e, Sg.variant).classes);
}
function Tg() {
  return U`<svg
    aria-hidden="true"
    class="size-3"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="3"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M20 6 9 17l-5-5"></path>
  </svg>`;
}
function Eg() {
  return U`<svg
    aria-hidden="true"
    class="size-3"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="3"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M5 12h14"></path>
  </svg>`;
}
function Dg(e) {
  return J({
    "data-default-checked": e.checked ?? e.defaultChecked,
    "data-disabled": e.disabled,
    "data-indeterminate": e.indeterminate,
    "data-required": e.required,
    "data-read-only": e.readOnly,
    "data-name": e.name,
    "data-value": e.value,
    "data-unchecked-value": e.uncheckedValue,
  });
}
function Og(e) {
  let { binds: t, attrs: n } = Nh(e),
    {
      class: r,
      className: i,
      checked: a,
      disabled: o,
      indeterminate: s,
      variant: c = Sg.variant,
      id: l,
      name: u,
      value: d,
      required: f,
      readOnly: p,
      defaultChecked: m,
      uncheckedValue: h,
      form: g,
      role: _,
      tabIndex: v,
      tabindex: y,
      "aria-checked": b,
      "aria-disabled": x,
      "aria-readonly": S,
      "aria-required": C,
      "aria-label": w,
      "aria-labelledby": T,
      "aria-describedby": E,
      ...D
    } = n,
    O = t[`bind:checked`] != null || t[`bind:group`] != null;
  return U`<span
    data-slot="checkbox"
    class="${q(`relative inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-areia-control-background ring outline-none`, `data-checked:bg-areia-foreground data-checked:ring-areia-foreground data-indeterminate:bg-areia-foreground data-indeterminate:ring-areia-foreground`, `focus-visible:ring-2 focus-visible:ring-areia-ring`, `data-disabled:cursor-not-allowed data-disabled:opacity-50 data-readonly:cursor-default`, wg({ variant: c }), r, i)}"
    ${W(Dg({ checked: a, disabled: o, indeterminate: s, required: f, readOnly: p, name: u, value: d, defaultChecked: m, uncheckedValue: typeof h == `string` ? h : void 0 }))}
    ${W(J({ role: _ ?? `checkbox`, tabindex: o ? -1 : (y ?? v ?? 0), "aria-checked": b ?? (s ? `mixed` : a ? `true` : `false`), "aria-disabled": x ?? (o ? `true` : void 0), "aria-readonly": S ?? (p ? `true` : void 0), "aria-required": C ?? (f ? `true` : void 0), "aria-label": w, "aria-labelledby": T, "aria-describedby": E }))}
  >
    ${Lh(`input`, t, ` type="checkbox" data-slot="checkbox-input" class="sr-only peer" data-checkbox-generated="input"${J({ ...D, id: l, name: u, value: d, form: g, required: f, disabled: o, ...(O ? {} : { checked: !!(a ?? m) }) })} />`)}
    <span
      data-slot="checkbox-indicator"
      class="pointer-events-none absolute inset-0 flex items-center justify-center text-areia-inverse"
    >
      ${s ? Eg() : Tg()}
    </span>
  </span>`;
}
function kg(e = {}) {
  let { label: t, labelTooltip: n, controlFirst: r = !0, required: i, disabled: a, ...o } = e,
    s = typeof o.id == `string` ? o.id : void 0,
    c = Og({ ...o, id: s, disabled: a, required: i });
  return t == null
    ? c
    : U`<label
    class="${q(`inline-flex items-center gap-2 text-base text-areia-default`, r ? `flex-row` : `flex-row-reverse justify-end`, a ? `cursor-not-allowed opacity-50` : `cursor-pointer`)}"
  >
    ${c}
    ${fg({ label: t, showOptional: i === !1, tooltip: n, asContent: !0, class: a ? `cursor-not-allowed` : `cursor-pointer` })}
  </label>`;
}
function Ag(e = {}) {
  return Ig(e);
}
function jg({ label: e, class: t, className: n }) {
  return U`<legend
    class="${q(`text-base font-medium text-areia-default`, t, n)}"
  >
    ${e}
  </legend>`;
}
function Mg(e = {}, t) {
  let {
      legend: n,
      children: r,
      error: i,
      description: a,
      disabled: o,
      class: s,
      className: c,
      ...l
    } = Array.isArray(e) ? {} : e,
    u = Array.isArray(e) ? e : (t ?? r);
  return U`<fieldset
    class="${q(`flex flex-col gap-4`, s, c)}"
    ${W(J({ ...l, disabled: o }))}
  >
    ${n == null ? `` : jg({ label: n })}
    <div class="flex flex-col gap-2">${u ?? ``}</div>
    ${i == null ? `` : U`<p class="text-sm text-areia-destructive-soft-foreground">${i}</p>`}
    ${a == null ? `` : U`<p class="text-sm text-areia-subtle">${a}</p>`}
  </fieldset>`;
}
var Ng = new WeakMap();
function Pg(e) {
  return e.matches(`[data-slot="checkbox"]`) ? e : e.querySelector(`[data-slot="checkbox"]`);
}
var Fg = nn
    .input()
    .onMount(({ host: e, input: t }) => {
      let n = Pg(e);
      if (!n) return;
      let r = typeof t.value == `string` ? t.value : void 0,
        i = null;
      bg(n);
      let a = al.createCheckbox(n, {
        defaultChecked: typeof t.checked == `boolean` ? t.checked : void 0,
        indeterminate: typeof t.indeterminate == `boolean` ? t.indeterminate : void 0,
        disabled: typeof t.disabled == `boolean` ? t.disabled : void 0,
        required: typeof t.required == `boolean` ? t.required : void 0,
        name: typeof t.name == `string` ? t.name : void 0,
        value: r,
        onCheckedChange: (e) => {
          i?.onUserChange(e);
        },
      });
      return (
        (i = Vh(t, a, r)),
        i?.applyFromSignal(),
        Ng.set(e, { controller: a, bindSync: i }),
        () => {
          (Ng.delete(e), a.destroy());
        }
      );
    })
    .effect(({ host: e, input: t }) => {
      Bh(t);
      let n = Ng.get(e);
      n && n.bindSync?.applyFromSignal();
    })
    .render(({ input: e }) => kg(e)),
  Ig = Object.assign(Fg, { Root: Fg, Static: kg, Control: Og, Item: Ag, Group: Mg, Legend: jg }),
  Lg = 0;
function Rg(e = `areia-field`) {
  return ((Lg += 1), `${e}-${Lg}`);
}
function zg(e = {}) {
  let { label: t, class: n, className: r, htmlFor: i, for: a } = e,
    o = i ?? a;
  return U`<label
    data-slot="field-label"
    class="${q(`text-sm font-medium text-areia-default data-disabled:opacity-50`, n, r)}"
    ${W(J({ for: o }))}
    >${$(t)}</label
  >`;
}
function Bg(e = {}) {
  let { description: t, class: n, className: r } = e;
  return U`<p
    data-slot="field-description"
    class="${q(`text-sm text-areia-subtle data-disabled:opacity-50`, n, r)}"
  >
    ${$(t)}
  </p>`;
}
function Vg(e = {}) {
  let { error: t, class: n, className: r } = e;
  return U`<div
    data-slot="field-error"
    class="${q(`text-sm text-areia-destructive-soft-foreground`, n, r)}"
  >
    ${$(t)}
  </div>`;
}
function Hg(e = {}) {
  let { class: t, className: n } = e;
  return U`<output
    data-slot="field-validity"
    class="${q(`sr-only`, t, n)}"
  ></output>`;
}
function Ug(e = {}) {
  let { children: t, disabled: n, class: r, className: i, ...a } = e;
  return U`<div
    data-slot="field-item"
    class="${q(`flex items-start gap-2 data-disabled:opacity-50`, r, i)}"
    ${W(J({ ...a, "data-disabled": n }))}
  >
    ${$(t)}
  </div>`;
}
function Wg(e = {}) {
  let {
      label: t,
      description: n,
      error: r,
      children: i,
      name: a,
      disabled: o,
      invalid: s,
      validate: c,
      validationMode: l,
      htmlFor: u,
      for: d,
      class: f,
      className: p,
      labelClass: m,
      descriptionClass: h,
      errorClass: g,
      ..._
    } = e,
    v = u ?? d;
  return U`<div
    data-slot="field"
    class="${q(`flex flex-col gap-2 data-disabled:opacity-50`, f, p)}"
    ${W(J({ ..._, "data-name": a, "data-disabled": o, "data-invalid": s, "data-validation-mode": l }))}
  >
    ${t == null ? `` : zg({ label: t, class: m, htmlFor: v })}
    ${$(i)}
    ${n == null ? `` : Bg({ description: n, class: h })}
    ${r == null ? Vg() : Vg({ error: r, class: g })}
  </div>`;
}
var Gg = new WeakMap();
function Kg(e) {
  let t = e;
  return {
    name: t.dataset.name,
    disabled: t.hasAttribute(`data-disabled`),
    invalid: t.hasAttribute(`data-invalid`),
    validationMode: t.dataset.validationMode,
  };
}
function qg(e, t = {}) {
  (bg(e), Gg.get(e)?.destroy());
  let n = _u.createField(e, { ...Kg(e), ...t });
  return (
    Gg.set(e, n),
    () => {
      (n.destroy(), Gg.delete(e));
    }
  );
}
function Jg(e = {}) {
  return Wg(e);
}
var Yg = nn
    .input()
    .onMount(({ host: e, input: t }) => {
      let n = e.matches(`[data-slot="field"]`) ? e : e.querySelector(`[data-slot="field"]`);
      if (n)
        return qg(n, {
          name: t.name,
          disabled: t.disabled,
          invalid: t.invalid,
          validate: t.validate,
          validationMode: t.validationMode,
        });
    })
    .render(({ input: e }) => Wg(e)),
  Xg = Object.assign(Yg, {
    Root: Yg,
    Static: Jg,
    Label: zg,
    Description: Bg,
    Error: Vg,
    Validity: Hg,
    Item: Ug,
  }),
  Zg = {
    size: {
      xs: {
        classes: `h-5 gap-1 rounded-sm px-1.5 text-xs`,
        description: `Extra small input for compact UIs`,
      },
      sm: {
        classes: `h-6.5 gap-1 rounded-md px-2 text-xs`,
        description: `Small input for secondary fields`,
      },
      base: { classes: `h-9 gap-1.5 rounded-lg px-3 text-base`, description: `Default input size` },
      lg: {
        classes: `h-10 gap-2 rounded-lg px-4 text-base`,
        description: `Large input for prominent fields`,
      },
    },
    variant: {
      default: {
        classes: `focus:ring-areia-ring/50 focus:ring-[1.5px]`,
        description: `Default input appearance`,
      },
      error: {
        classes: `!ring-areia-destructive focus:ring-areia-destructive/50 focus:ring-[1.5px]`,
        description: `Error state for validation failures`,
      },
    },
  },
  Qg = { size: `base`, variant: `default` };
function $g(e, t, n) {
  return e[t ?? n] ?? e[n];
}
function e_({
  variant: e = Qg.variant,
  size: t = Qg.size,
  parentFocusIndicator: n = !1,
  focusIndicator: r = !1,
} = {}) {
  return q(
    `border-0 bg-areia-control-background text-areia-default ring ring-areia-divider outline-none focus:outline-none`,
    `placeholder:text-areia-placeholder disabled:cursor-not-allowed disabled:text-areia-disabled disabled:opacity-50`,
    $g(Zg.size, t, Qg.size).classes,
    $g(Zg.variant, e, Qg.variant).classes,
    n &&
      (e === `error`
        ? `focus-within:ring-areia-destructive/50 focus-within:ring-[1.5px]`
        : `focus-within:ring-areia-ring/50 focus-within:ring-[1.5px]`),
    r &&
      (e === `error`
        ? `focus:ring-areia-destructive/50 focus:ring-[1.5px]`
        : `focus:ring-areia-ring/50 focus:ring-[1.5px]`),
  );
}
function t_(e) {
  return e && typeof e == `object` && `message` in e ? e.message : e;
}
function n_(e) {
  let { binds: t, attrs: n } = Nh(e),
    {
      class: r,
      className: i,
      error: a,
      label: o,
      labelTooltip: s,
      description: c,
      passwordManagerIgnore: l,
      size: u = Qg.size,
      variant: d,
      ...f
    } = n,
    p = d ?? (a ? `error` : Qg.variant),
    m = f;
  return Lh(
    `input`,
    t,
    ` class="${q(e_({ size: u, variant: p, focusIndicator: !0 }), l && `keeper-ignore`, r, i)}"${J({ ...m, "aria-invalid": a ? `true` : m[`aria-invalid`], "aria-describedby": typeof m[`aria-describedby`] == `string` ? m[`aria-describedby`] : void 0, ...(l ? { "data-1p-ignore": `true`, "data-bwignore": `true`, "data-form-type": `other`, "data-lpignore": `true` } : {}) })} />`,
  );
}
function r_(e = {}) {
  let { label: t, labelTooltip: n, description: r, error: i, ...a } = e,
    o = t_(i),
    s = t != null || r != null || o != null,
    c = typeof a.id == `string` && a.id ? a.id : s ? Rg(`areia-input`) : void 0,
    l = n_({
      ...a,
      ...(c ? { id: c } : {}),
      error: i,
      "data-slot": a[`data-slot`] ?? `field-control`,
    });
  return s
    ? Xg.Static({ label: t, description: r, error: o, invalid: o != null, htmlFor: c, children: l })
    : n_(e);
}
var i_ = Object.assign(r_, { Static: n_ }),
  a_ = {
    side: {
      top: { classes: ``, description: `Tooltip appears above the trigger` },
      bottom: { classes: ``, description: `Tooltip appears below the trigger` },
      left: { classes: ``, description: `Tooltip appears to the left of the trigger` },
      right: { classes: ``, description: `Tooltip appears to the right of the trigger` },
      "inline-start": {
        classes: ``,
        description: `Tooltip appears at the inline start side of the trigger`,
      },
      "inline-end": {
        classes: ``,
        description: `Tooltip appears at the inline end side of the trigger`,
      },
    },
  },
  o_ = { side: `top` };
function s_(e, t, n) {
  return e[t ?? n] ?? e[n];
}
function c_({ side: e = o_.side } = {}) {
  return q(
    `flex origin-[var(--transform-origin)] flex-col rounded-md bg-areia-background px-2.5 py-1.5 text-sm text-areia-default`,
    `shadow-lg outline outline-1 outline-areia-divider`,
    `transition-[transform,scale,opacity] duration-150`,
    `data-starting-style:scale-90 data-starting-style:opacity-0`,
    `data-ending-style:scale-90 data-ending-style:opacity-0`,
    `data-instant:duration-0`,
    s_(a_.side, e, o_.side).classes,
  );
}
function l_(e) {
  return J({
    "data-align": e.align,
    "data-align-offset": e.alignOffset,
    "data-avoid-collisions": e.avoidCollisions,
    "data-collision-padding": e.collisionPadding,
    "data-delay": e.delay,
    "data-portal": e.portal,
    "data-side": e.side,
    "data-side-offset": e.sideOffset,
    "data-skip-delay-duration": e.skipDelayDuration,
  });
}
function u_() {
  return U`<svg width="20" height="10" viewBox="0 0 20 10" fill="none">
    <path
      d="M9.66437 2.60207L4.80758 6.97318C4.07308 7.63423 3.11989 8 2.13172 8H0V10H20V8H18.5349C17.5468 8 16.5936 7.63423 15.8591 6.97318L11.0023 2.60207C10.622 2.2598 10.0447 2.25979 9.66437 2.60207Z"
      class="fill-areia-background"
    ></path>
    <path
      d="M8.99542 1.85876C9.75604 1.17425 10.9106 1.17422 11.6713 1.85878L16.5281 6.22989C17.0789 6.72568 17.7938 7.00001 18.5349 7.00001L15.89 7L11.0023 2.60207C10.622 2.2598 10.0447 2.2598 9.66436 2.60207L4.77734 7L2.13171 7.00001C2.87284 7.00001 3.58774 6.72568 4.13861 6.22989L8.99542 1.85876Z"
      class="fill-areia-divider"
    ></path>
  </svg>`;
}
function d_(e = {}) {
  let { arrow: t = !0, children: n, class: r, className: i, side: a = o_.side, ...o } = e;
  return U`<div
    data-slot="tooltip-content"
    hidden
    class="${q(c_({ side: a }), r, i)}"
    ${W(l_({ ...o, side: a }))}
    ${W(J(o))}
  >
    ${t ? f_() : ``} ${$(n)}
  </div>`;
}
function f_(e = {}) {
  let { children: t = u_(), class: n, className: r, ...i } = e;
  return U`<div
    data-slot="tooltip-arrow"
    class="${q(`flex`, `data-[side=bottom]:-top-2`, `data-[side=left]:-right-3.25 data-[side=left]:rotate-90`, `data-[side=right]:-left-3.25 data-[side=right]:-rotate-90`, `data-[side=top]:-bottom-2 data-[side=top]:rotate-180`, `data-[side=inline-start]:-right-3.25 data-[side=inline-start]:rotate-90`, `data-[side=inline-end]:-left-3.25 data-[side=inline-end]:-rotate-90`, n, r)}"
    ${W(J(i))}
  >
    ${$(t)}
  </div>`;
}
function p_(e = {}) {
  let { as: t = `span`, children: n, class: r, className: i, type: a, ...o } = e,
    s = t;
  return U`<${W(s)}
    data-slot="tooltip-trigger"
    class="${q(`inline-flex cursor-default items-center bg-transparent p-0 leading-0`, s === `button` && `m-0 h-auto min-h-0 border-0 shadow-none`, r, i)}"
    ${W(J({ ...o, tabindex: s === `span` || s === `div` ? (o.tabindex ?? o.tabIndex ?? 0) : o.tabindex, type: s === `button` ? (a ?? `button`) : a }))}
  >${$(n)}</${W(s)}>`;
}
function m_(e) {
  let {
      align: t,
      alignOffset: n,
      arrow: r,
      avoidCollisions: i,
      children: a,
      class: o,
      className: s,
      collisionPadding: c,
      content: l,
      contentClass: u,
      contentClassName: d,
      delay: f,
      onOpenChange: p,
      onPortalMounted: m,
      portal: h,
      side: g = o_.side,
      sideOffset: _,
      skipDelayDuration: v,
      trigger: y,
      triggerAs: b,
      triggerClass: x,
      triggerClassName: S,
      ...C
    } = e,
    w = $(a),
    T = Km(a, `tooltip-content`),
    E = Km(a, `tooltip-trigger`)
      ? void 0
      : (qm(y, `tooltip-trigger`, x, S) ??
        (y == null ? void 0 : $(y)) ??
        qm(a, `tooltip-trigger`, x, S) ??
        p_({ as: b, class: x, className: S, children: a }));
  return U`<div
    data-slot="tooltip"
    class="${q(`inline-flex`, o, s)}"
    ${W(l_({ align: t, alignOffset: n, avoidCollisions: i, collisionPadding: c, delay: f, portal: h, side: g, sideOffset: _, skipDelayDuration: v }))}
    ${W(J(C))}
  >
    ${T ? w : E}
    ${T ? `` : d_({ align: t, alignOffset: n, arrow: r, avoidCollisions: i, class: u, className: d, collisionPadding: c, children: l, portal: h, side: g, sideOffset: _ })}
  </div>`;
}
var h_ = new WeakMap();
function g_(e, t = {}) {
  (bg(e, mg), h_.get(e)?.destroy());
  let n = Lf.createTooltip(e, t);
  return (
    h_.set(e, n),
    () => {
      (n.destroy(), h_.delete(e));
    }
  );
}
var __ = nn
  .input()
  .onMount(({ host: e, input: t }) => {
    let n = e.matches(`[data-slot="tooltip"]`) ? e : e.querySelector(`[data-slot="tooltip"]`);
    if (n)
      return g_(n, {
        align: t.align,
        alignOffset: t.alignOffset,
        avoidCollisions: t.avoidCollisions,
        collisionPadding: t.collisionPadding,
        delay: t.delay,
        onOpenChange: t.onOpenChange,
        portal: t.portal,
        side: t.side,
        sideOffset: t.sideOffset,
        skipDelayDuration: t.skipDelayDuration,
        onPortalMounted: t.onPortalMounted,
      });
  })
  .render(({ input: e }) => m_(Gm(e, [`content`, `trigger`, `children`])));
function v_(e) {
  return m_(Gm(e, [`content`, `trigger`, `children`]));
}
var y_ = Object.assign(__, { Root: __, Static: v_, Trigger: p_, Content: d_, Arrow: f_ }),
  b_ = {
    size: {
      sm: {
        classes: `text-xs`,
        buttonSize: `sm`,
        description: `Small clipboard text for compact UIs`,
      },
      base: { classes: `text-sm`, buttonSize: `base`, description: `Default clipboard text size` },
      lg: {
        classes: `text-sm`,
        buttonSize: `lg`,
        description: `Large clipboard text for prominent display`,
      },
    },
  },
  x_ = { size: `lg` };
function S_(e, t, n) {
  return e[t ?? n] ?? e[n];
}
function C_(e) {
  return b_.size[e] ?? b_.size[x_.size];
}
function w_({ size: e = x_.size } = {}) {
  return q(
    `flex items-center overflow-hidden bg-areia-control-background px-0 font-mono`,
    S_(b_.size, e, x_.size).classes,
  );
}
var T_ = og({ icon: Zh }),
  E_ = og({ icon: tg });
function D_(e) {
  return U`<span
    data-slot="clipboard-text-status"
    class="sr-only"
    aria-live="polite"
    data-copied-text="${e}"
  ></span>`;
}
function O_(e) {
  let { buttonSize: t, copiedText: n, copyAction: r, textToCopy: i, inlineCopy: a } = e;
  return kh({
    size: t,
    variant: `ghost`,
    class: q(
      `relative isolate overflow-hidden rounded-l-none rounded-r-[inherit] border-l border-areia-divider px-3 transition-all duration-200`,
      `focus:ring-inset focus:ring-areia-ring/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-areia-ring`,
    ),
    "aria-label": r,
    "data-slot": `clipboard-text-button`,
    "data-copy-text": i,
    "data-copied-text": n,
    onclick: a ? nh : void 0,
    children: U`<span
        data-slot="clipboard-text-copied-icon"
        class="pointer-events-none absolute inset-0 flex translate-y-full items-center justify-center opacity-0 transition-all duration-200"
        >${T_}</span
      >
      <span
        data-slot="clipboard-text-copy-icon"
        class="flex items-center justify-center transition-all duration-200"
        >${E_}</span
      >`,
  });
}
function k_(e) {
  let {
      class: t,
      className: n,
      labels: r,
      onCopy: i,
      size: a = x_.size,
      text: o,
      textToCopy: s = o,
      tooltip: c,
      ...l
    } = e,
    u = C_(a),
    d = r?.copyAction ?? `Copy to clipboard`,
    f = c && typeof c == `object` ? c : void 0,
    p = f?.text ?? `Copy`,
    m = f?.copiedText ?? `Copied`,
    h = f?.side ?? `top`,
    g = O_({
      buttonSize: u.buttonSize,
      copiedText: m,
      copyAction: d,
      textToCopy: s,
      inlineCopy: i == null,
    });
  return U`<div
    data-slot="clipboard-text"
    class="${q(e_({ size: u.buttonSize, parentFocusIndicator: !0 }), w_({ size: a }), t, n)}"
    ${W(J(l))}
  >
    <span data-slot="clipboard-text-value" class="grow truncate ps-4 pe-2">${o}</span>
    ${c ? y_.Static({ content: p, side: h, sideOffset: 8, trigger: g, triggerClass: `contents`, contentClass: `font-sans text-xs` }) : g}
    ${D_(m)}
  </div>`;
}
function A_(e, t) {
  let n = e.querySelector(`[data-slot="clipboard-text-copied-icon"]`),
    r = e.querySelector(`[data-slot="clipboard-text-copy-icon"]`),
    i = e.querySelector(`[data-slot="clipboard-text-status"]`);
  (n?.classList.toggle(`translate-y-full`, !t),
    n?.classList.toggle(`translate-y-0`, t),
    n?.classList.toggle(`opacity-0`, !t),
    n?.classList.toggle(`opacity-100`, t),
    r?.classList.toggle(`-translate-y-full`, t),
    r?.classList.toggle(`opacity-0`, t),
    r?.classList.toggle(`opacity-100`, !t),
    i && (i.textContent = t ? (i.getAttribute(`data-copied-text`) ?? `Copied`) : ``));
}
var j_ = nn
  .input()
  .onMount(({ host: e, input: t }) => {
    let n = e.matches(`[data-slot="clipboard-text"]`)
        ? e
        : e.querySelector(`[data-slot="clipboard-text"]`),
      r = n?.querySelector(`[data-slot="clipboard-text-button"]`);
    if (!n || !r || (t.onCopy == null && r.hasAttribute(`onclick`))) return;
    let i,
      a = async () => {
        let e = r.getAttribute(`data-copy-text`) ?? t.textToCopy ?? t.text;
        try {
          (await eh(e),
            A_(n, !0),
            t.onCopy?.(e),
            i && clearTimeout(i),
            (i = setTimeout(() => A_(n, !1), 1500)));
        } catch (e) {
          console.warn(`Clipboard copy failed`, e);
        }
      };
    return (
      r.addEventListener(`click`, a),
      () => {
        (r.removeEventListener(`click`, a), i && clearTimeout(i));
      }
    );
  })
  .render(({ input: e }) => k_(e));
function M_(e) {
  return k_(e);
}
function N_(e) {
  return e.onCopy ? j_(e) : k_(e);
}
Object.assign(N_, { Root: j_, Static: M_ });
var P_ = new WeakMap();
function F_(e = {}) {
  return q();
}
var I_ = og({
  icon: Qh,
  class: `size-4 shrink-0 transition-transform duration-200 group-data-[panel-open]:rotate-180`,
});
function L_(e = {}) {
  let { children: t, label: n, icon: r, disabled: i, class: a, className: o, ...s } = e;
  return U`<button
    type="button"
    data-slot="collapsible-trigger"
    class="${q(`group cursor-pointer`, a, o)}"
    ${W(J({ ...s, "data-disabled": i, disabled: i }))}
  >
    ${$(t ?? n)}${r ?? ``}
  </button>`;
}
function R_(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<div
    data-slot="collapsible-content"
    class="${q(`overflow-hidden transition-[height] duration-200 ease-out data-[state=closed]:h-0 data-[state=open]:h-[var(--collapsible-panel-height)]`, n, r)}"
    ${W(J(i))}
  >
    ${$(t)}
  </div>`;
}
function z_(e = {}) {
  let { children: t, label: n, icon: r = I_, class: i, className: a, ...o } = e;
  return L_({
    ...o,
    icon: r,
    children: U`<span class="min-w-0 flex-1">${$(t ?? n)}</span>`,
    class: q(
      `flex w-full items-center gap-2 bg-transparent py-2 text-left text-sm font-medium text-areia-default select-none hover:text-areia-strong`,
      i,
      a,
    ),
  });
}
function B_(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return R_({
    ...i,
    children: U`<div
      class="${q(`my-2 space-y-4 border-l-2 border-areia-border pl-4`, n, r)}"
    >
      ${$(t)}
    </div>`,
  });
}
function V_(e = {}) {
  let { binds: t, attrs: n } = Nh(e),
    {
      children: r,
      open: i,
      defaultOpen: a,
      hiddenUntilFound: o,
      onOpenChange: s,
      class: c,
      className: l,
      ...u
    } = n;
  return Rh(
    `div`,
    t,
    ` data-slot="collapsible" class="${q(F_(), c, l)}"${J({ ...u, "data-default-open": a, "data-hidden-until-found": o })}`,
    $(r),
  );
}
function H_(e) {
  let { value: t, children: n, disabled: r, class: i, className: a, ...o } = e;
  return U`<div
    data-slot="accordion-item"
    class="${q(`border-b border-areia-border last:border-b-0`, i, a)}"
    ${W(J({ ...o, "data-value": t, "data-disabled": r }))}
  >
    ${$(n)}
  </div>`;
}
function U_(e = {}) {
  return U`${W(Um(z_(e)).replaceAll(`data-slot="collapsible-trigger"`, `data-slot="accordion-trigger"`))}`;
}
function W_(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<div
    data-slot="accordion-content"
    class="${q(`overflow-hidden transition-[height] duration-200 ease-out data-[state=closed]:h-0 data-[state=open]:h-[var(--accordion-panel-height)]`, n, r)}"
    ${W(J(i))}
  >
    ${$(t)}
  </div>`;
}
function G_(e = {}) {
  let {
      items: t = [],
      children: n,
      accordion: r,
      multiple: i,
      value: a,
      defaultValue: o,
      disabled: s,
      orientation: c,
      loopFocus: l,
      hiddenUntilFound: u,
      class: d,
      className: f,
      itemClass: p,
      itemClassName: m,
      triggerClass: h,
      triggerClassName: g,
      panelClass: _,
      panelClassName: v,
      onValueChange: y,
      ...b
    } = e,
    x = o ?? a,
    S =
      n ??
      t.map((e) =>
        H_({
          value: e.value,
          disabled: e.disabled,
          class: q(p, m, e.class, e.className),
          children: [
            U_({
              children: e.trigger ?? e.label ?? e.value,
              class: q(h, g, e.triggerClass, e.triggerClassName),
            }),
            W_({
              class: q(_, v, e.panelClass, e.panelClassName),
              children: U`<div class="pb-3 text-sm text-areia-subtle">
              ${$(e.content ?? e.children)}
            </div>`,
            }),
          ],
        }),
      );
  return U`<div
    data-slot="accordion"
    class="${q(`w-full`, d, f)}"
    ${W(J({ ...b, "data-multiple": i, "data-default-value": Array.isArray(x) ? JSON.stringify(x) : x, "data-disabled": s, "data-orientation": c, "data-loop-focus": l, "data-hidden-until-found": u }))}
  >
    ${$(S)}
  </div>`;
}
function K_(e = {}) {
  let {
    trigger: t,
    panel: n,
    children: r,
    items: i,
    accordion: a,
    multiple: o,
    value: s,
    defaultValue: c,
    defaultOpen: l,
    hiddenUntilFound: u,
    class: d,
    className: f,
    onOpenChange: p,
    onValueChange: m,
    ...h
  } = e;
  return a || i?.length
    ? G_({
        ...h,
        items: i,
        multiple: o,
        value: s,
        defaultValue: c,
        hiddenUntilFound: u,
        onValueChange: m,
        class: q(d, f),
      })
    : V_({
        ...h,
        defaultOpen: Hh(e, l ?? (typeof e.open == `boolean` ? e.open : void 0)),
        hiddenUntilFound: u,
        class: q(d, f),
        children: r ?? [z_({ children: t ?? `Toggle` }), B_({ children: n })],
      });
}
var q_ = new WeakMap(),
  J_ = nn
    .input()
    .onMount(({ host: e, input: t }) => {
      let n = e.matches(`[data-slot="accordion"]`) ? e : e.querySelector(`[data-slot="accordion"]`);
      if (n) {
        bg(n, mg);
        let e = Bc.createAccordion(n, {
          multiple: t.multiple,
          defaultValue: t.defaultValue ?? t.value,
          disabled: t.disabled,
          orientation: t.orientation,
          loopFocus: t.loopFocus,
          hiddenUntilFound: t.hiddenUntilFound,
          onValueChange: t.onValueChange,
        });
        return () => e.destroy();
      }
      let r = e.matches(`[data-slot="collapsible"]`)
        ? e
        : e.querySelector(`[data-slot="collapsible"]`);
      if (!r) return;
      let i = null;
      bg(r, mg);
      let a = bl.createCollapsible(r, {
        defaultOpen: Hh(t, t.defaultOpen ?? t.open),
        hiddenUntilFound: t.hiddenUntilFound,
        onOpenChange: (e) => {
          (i?.onUserChange(e), t.onOpenChange?.(e));
        },
      });
      return (
        (i = Uh(t, a)),
        i?.applyFromSignal(),
        P_.set(r, a),
        q_.set(e, { bindSync: i }),
        () => {
          (q_.delete(e), P_.delete(r), a.destroy());
        }
      );
    })
    .effect(({ host: e, input: t }) => {
      Bh(t);
      let n = q_.get(e);
      n && n.bindSync?.applyFromSignal();
    })
    .render(({ input: e }) => K_(e));
Object.assign(J_, {
  Root: J_,
  RootIsland: J_,
  Static: K_,
  Trigger: L_,
  Panel: R_,
  DefaultTrigger: z_,
  DefaultPanel: B_,
  Accordion: G_,
  AccordionItem: H_,
  AccordionTrigger: U_,
  AccordionPanel: W_,
});
var Y_ = new WeakMap();
function X_(e = {}) {
  let { children: t, class: n, className: r } = e;
  return U`<div
    data-slot="context-menu-trigger"
    class="${q(`contents`, n, r)}"
  >
    ${$(t)}
  </div>`;
}
function Z_(e = {}) {
  let { children: t, class: n, className: r } = e;
  return U`<div
    data-slot="context-menu-content"
    hidden
    class="${q(`z-50 min-w-40 rounded-lg bg-areia-background p-1 text-base shadow-lg ring ring-areia-border outline-none`, n, r)}"
  >
    ${$(t)}
  </div>`;
}
function Q_(e) {
  return e === `checkbox`
    ? `context-menu-checkbox-item`
    : e === `radio`
      ? `context-menu-radio-item`
      : `context-menu-item`;
}
function $_(e = {}, t) {
  let {
    value: n,
    label: r,
    children: i,
    disabled: a,
    checked: o,
    class: s,
    className: c,
    ...l
  } = e;
  return U`<button
    type="button"
    data-slot="${Q_(t)}"
    class="${q(`flex w-full items-center rounded-md px-2 py-1.5 text-left text-base text-areia-default outline-none data-highlighted:bg-areia-control-hover data-disabled:pointer-events-none data-disabled:opacity-50`, s, c)}"
    ${W(J({ ...l, "data-value": n, "data-disabled": a, "data-checked": o, "aria-checked": o }))}
  >
    ${$(i ?? r ?? n)}
  </button>`;
}
function ev(e = {}) {
  return $_(e);
}
function tv(e = {}) {
  return $_(e, `checkbox`);
}
function nv(e = {}) {
  return $_(e, `radio`);
}
function rv(e = {}) {
  let { binds: t, attrs: n } = Nh(e),
    {
      trigger: r,
      children: i,
      disabled: a,
      closeOnSelect: o,
      class: s,
      className: c,
      triggerClass: l,
      triggerClassName: u,
      contentClass: d,
      contentClassName: f,
      onOpenChange: p,
      onSelect: m,
      ...h
    } = n,
    { "bind:open": g, ..._ } = t,
    v = $(i),
    y = U`${
      Km(i, `context-menu-content`)
        ? v
        : U`${X_({ children: r, class: q(l, u) })}
      ${Z_({ children: i, class: q(d, f) })}`
    }`;
  return Rh(
    `div`,
    _,
    ` data-slot="context-menu" class="${q(`contents`, s, c)}"${J({ ...h, "data-disabled": a, "data-close-on-select": o })}`,
    y,
  );
}
var iv = new WeakMap(),
  av = nn
    .input()
    .onMount(({ host: e, input: t }) => {
      let n = e.matches(`[data-slot="context-menu"]`)
        ? e
        : e.querySelector(`[data-slot="context-menu"]`);
      if (!n) return;
      let r = null;
      bg(n, mg);
      let i = Il.createContextMenu(n, {
        disabled: t.disabled,
        closeOnSelect: t.closeOnSelect,
        onOpenChange: (e) => {
          (r?.onUserChange(e), t.onOpenChange?.(e));
        },
        onSelect: t.onSelect,
        onPortalMounted: t.onPortalMounted,
      });
      return (
        (r = Uh(t, i)),
        r?.applyFromSignal(),
        Y_.set(n, i),
        iv.set(e, { controller: i, bindSync: r }),
        () => {
          (iv.delete(e), Y_.delete(n), i.destroy());
        }
      );
    })
    .effect(({ host: e, input: t }) => {
      Bh(t);
      let n = iv.get(e);
      n && n.bindSync?.applyFromSignal();
    })
    .render(({ input: e }) => rv(e));
Object.assign(av, {
  Root: av,
  Static: rv,
  Trigger: X_,
  Content: Z_,
  Item: ev,
  CheckboxItem: tv,
  RadioItem: nv,
});
var ov = { mode: `single`, numberOfMonths: 1, weekStartsOn: 0 };
function sv(e) {
  return fm(e, `yyyy-MM-dd`);
}
function cv(e) {
  if (!e) return;
  let t = vm(e);
  return Number.isNaN(t.getTime()) ? void 0 : t;
}
function lv(e) {
  let t = e.selected;
  return e.month
    ? Cp(e.month)
    : e.defaultMonth
      ? Cp(e.defaultMonth)
      : t instanceof Date
        ? Cp(t)
        : Array.isArray(t) && t[0]
          ? Cp(t[0])
          : t && typeof t == `object` && `from` in t && t.from
            ? Cp(t.from)
            : Cp(new Date());
}
function uv(e) {
  let t = lv(e),
    n = Math.max(1, e.numberOfMonths ?? ov.numberOfMonths),
    r = e.weekStartsOn ?? ov.weekStartsOn;
  return Array.from({ length: n }, (e, n) => {
    let i = op(t, n);
    return {
      month: i,
      days: Sp({ start: lp(Cp(i), { weekStartsOn: r }), end: Tp(bp(i), { weekStartsOn: r }) }),
    };
  });
}
function dv(e, t) {
  return (t.min && hm(e, t.min)) || (t.max && mm(e, t.max))
    ? !0
    : typeof t.disabled == `function`
      ? t.disabled(e)
      : Array.isArray(t.disabled) && t.disabled.some((t) => _p(e, t));
}
function fv(e, t) {
  let { selected: n, mode: r = ov.mode } = t;
  return n
    ? r === `single`
      ? n instanceof Date && _p(e, n)
      : r === `multiple`
        ? Array.isArray(n) && n.some((t) => _p(e, t))
        : typeof n == `object` &&
          `from` in n &&
          !!(
            n.from &&
            (_p(e, n.from) || (n.to && (_p(e, n.to) || _m(e, { start: n.from, end: n.to }))))
          )
    : !1;
}
function pv(e, t) {
  let n = t.selected;
  return !!(n && typeof n == `object` && `from` in n && n.from && _p(e, n.from));
}
function mv(e, t) {
  let n = t.selected;
  return !!(n && typeof n == `object` && `to` in n && n.to && _p(e, n.to));
}
function hv(e = {}) {
  return q(`select-none rounded-xl bg-areia-background text-areia-default`);
}
function gv(e) {
  let t = lp(new Date(2024, 0, 7), { weekStartsOn: e });
  return Array.from(
    { length: 7 },
    (e, n) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + n),
  );
}
function _v(e, t, n) {
  let r = !gm(e, t),
    i = dv(e, n) || (!n.showOutsideDays && r),
    a = fv(e, n),
    o = pv(e, n),
    s = mv(e, n),
    c =
      n.selected &&
      typeof n.selected == `object` &&
      !Array.isArray(n.selected) &&
      !(n.selected instanceof Date) &&
      !!n.selected.to,
    l = n.mode === `range` && a && !o && !s,
    u = _p(e, new Date());
  return U`<button
    type="button"
    data-date-picker-day
    data-date="${sv(e)}"
    class="${q(`relative flex size-9 items-center justify-center border-0 bg-transparent text-sm outline-none transition-colors`, `hover:bg-areia-control-hover focus-visible:ring-2 focus-visible:ring-areia-ring`, !a && `rounded-md`, u && `font-semibold ring-1 ring-areia-divider`, r && `text-areia-subtle opacity-60`, a && `bg-areia-primary text-areia-primary-foreground hover:bg-areia-primary/90`, n.mode !== `range` && a && `rounded-md`, l && `rounded-none`, o && (c ? `rounded-l-md rounded-r-none` : `rounded-md`), s && `rounded-l-none rounded-r-md`, i && `pointer-events-none cursor-not-allowed opacity-35`)}"
    ${W(J({ disabled: i, "aria-pressed": a ? `true` : void 0 }))}
  >
    ${fm(e, `d`)}
  </button>`;
}
function vv({ month: e, days: t }, n, r = { showHeading: !0 }) {
  let i = gv(n.weekStartsOn ?? ov.weekStartsOn);
  return U`<section class="flex flex-col gap-3" data-date-picker-month>
    ${
      r.showHeading
        ? U`<h3 class="text-center text-sm font-medium text-areia-default">
          ${fm(e, `MMMM yyyy`)}
        </h3>`
        : ``
    }
    <div class="grid grid-cols-7 gap-1 text-center text-xs text-areia-subtle">
      ${i.map((e) => U`<div>${fm(e, `EEEEE`)}</div>`)}
    </div>
    <div class="grid grid-cols-7 gap-0 overflow-hidden rounded-md">
      ${t.map((t) => _v(t, e, n))}
    </div>
  </section>`;
}
function yv(e = {}) {
  let {
      class: t,
      className: n,
      defaultMonth: r,
      disabled: i,
      max: a,
      maxSelected: o,
      min: s,
      mode: c = ov.mode,
      month: l,
      numberOfMonths: u = ov.numberOfMonths,
      onChange: d,
      onMonthChange: f,
      selected: p,
      showOutsideDays: m = !0,
      weekStartsOn: h = ov.weekStartsOn,
      ...g
    } = e,
    _ = zh(e, `bind:valueAsDate`),
    v = _ ? (_() ?? void 0) : e.selected,
    y = { ...e, mode: c, numberOfMonths: u, showOutsideDays: m, weekStartsOn: h, selected: v },
    b = lv(y);
  return U`<div
    data-slot="date-picker"
    data-mode="${c}"
    data-month="${sv(b)}"
    data-selected="${bv(v)}"
    class="${q(hv(), `w-max p-3`, t, n)}"
    ${W(J(g))}
  >
    <div class="mb-3 flex items-center justify-between gap-2">
      ${kh({ variant: `ghost`, size: `sm`, shape: `square`, icon: og({ icon: $h, class: `size-4` }), "aria-label": `Previous month`, "data-date-picker-prev": !0 })}
      <div class="min-w-0 flex-1 text-center text-sm font-medium text-areia-default">
        ${u > 1 ? `${fm(b, `MMM yyyy`)} – ${fm(op(b, u - 1), `MMM yyyy`)}` : fm(b, `MMMM yyyy`)}
      </div>
      ${kh({ variant: `ghost`, size: `sm`, shape: `square`, icon: og({ icon: eg, class: `size-4` }), "aria-label": `Next month`, "data-date-picker-next": !0 })}
    </div>
    <div class="grid gap-4 ${u > 1 ? `sm:grid-cols-2` : ``}">
      ${uv(y).map((e) => vv(e, y, { showHeading: u > 1 }))}
    </div>
  </div>`;
}
function bv(e) {
  return e
    ? e instanceof Date
      ? sv(e)
      : Array.isArray(e)
        ? e.map(sv).join(`,`)
        : `${e.from ? sv(e.from) : ``}..${e.to ? sv(e.to) : ``}`
    : ``;
}
function xv(e, t) {
  let n = e.dataset.selected;
  if (!n) return t === `multiple` ? [] : void 0;
  if (t === `single`) return cv(n);
  if (t === `multiple`) return n.split(`,`).flatMap((e) => cv(e) ?? []);
  let [r, i] = n.split(`..`);
  return { from: cv(r), to: cv(i) };
}
function Sv(e, t, n) {
  let r = n.mode ?? ov.mode;
  if (r === `single`) return t;
  if (r === `multiple`) {
    let r = Array.isArray(e) ? e : [];
    return r.some((e) => _p(e, t))
      ? r.filter((e) => !_p(e, t))
      : n.maxSelected && r.length >= n.maxSelected
        ? r
        : [...r, t];
  }
  let i = e && typeof e == `object` && !Array.isArray(e) && !(e instanceof Date) ? e : {};
  return !i.from || (i.from && i.to)
    ? { from: t, to: void 0 }
    : hm(t, i.from)
      ? { from: t, to: i.from }
      : { from: i.from, to: t };
}
function Cv(e, t) {
  ((e.dataset.selected = bv(t)),
    e.dispatchEvent(
      new CustomEvent(`date-picker:change`, { bubbles: !0, detail: { selected: t } }),
    ));
}
function wv(e, t) {
  ((e.dataset.month = sv(t)),
    e.dispatchEvent(
      new CustomEvent(`date-picker:month-change`, { bubbles: !0, detail: { month: t } }),
    ));
}
function Tv(e) {
  return typeof e == `object` && e && `value` in e ? String(e.value) : String(e);
}
function Ev(e, t) {
  let n = document.createElement(`div`);
  n.innerHTML = Tv(yv(t));
  let r = n.firstElementChild;
  if (r) {
    ((e.innerHTML = r.innerHTML), (e.className = r.className));
    for (let { name: t } of Array.from(e.attributes))
      t.startsWith(`data-`) && !r.hasAttribute(t) && e.removeAttribute(t);
    for (let { name: t, value: n } of Array.from(r.attributes))
      t.startsWith(`data-`) && e.setAttribute(t, n);
  }
}
var Dv = new WeakMap(),
  Ov = nn
    .input()
    .onMount(({ host: e, input: t }) => {
      let n = e.matches(`[data-slot="date-picker"]`)
        ? e
        : e.querySelector(`[data-slot="date-picker"]`);
      if (!n) return;
      bg(n);
      let r = {
          ...t,
          month: cv(n.dataset.month) ?? lv(t),
          selected: zh(t, `bind:valueAsDate`)?.() ?? xv(n, t.mode ?? ov.mode),
        },
        i = null;
      ((i = Yh(t, {
        getDate: () => {
          let e = r.selected;
          if (e instanceof Date) return e;
          if (e == null) return null;
        },
        setDate: (e) => {
          ((r = { ...r, selected: e ?? void 0 }),
            Ev(n, r),
            t.onChange?.(r.selected),
            Cv(n, r.selected));
        },
      })),
        i?.applyFromSignal(),
        Dv.set(e, { dateSync: i }));
      let a = Xh(n, t),
        o = (e) => {
          let a = e.target;
          if (!a) return;
          let o = r.month ?? lv(r),
            s = a.closest(`[data-date-picker-prev]`),
            c = a.closest(`[data-date-picker-next]`);
          if (s || c) {
            let e = op(o, s ? -1 : 1);
            ((r = { ...r, month: e }), Ev(n, r), t.onMonthChange?.(e), wv(n, e));
            return;
          }
          let l = a.closest(`[data-date-picker-day]`),
            u = cv(l?.dataset.date);
          if (!l || !u || l.hasAttribute(`disabled`)) return;
          if ((r.mode ?? ov.mode) === `single` && t[`bind:valueAsDate`]) {
            i?.onUserChange(u);
            return;
          }
          let d = Sv(r.selected, u, r);
          ((r = { ...r, selected: d }), Ev(n, r), t.onChange?.(d), Cv(n, d));
        };
      return (
        n.addEventListener(`click`, o),
        () => {
          (Dv.delete(e), a?.(), n.removeEventListener(`click`, o));
        }
      );
    })
    .effect(({ host: e, input: t }) => {
      Bh(t);
      let n = Dv.get(e);
      n && n.dateSync?.applyFromSignal();
    })
    .render(({ input: e }) => yv(e));
function kv(e = {}) {
  return yv(e);
}
Object.assign(Ov, { Root: Ov, Static: kv });
function Av(e) {
  if (e == null || e === !1 || typeof e == `string` || typeof e == `number` || Vm(e) || Bm(e))
    return !1;
  let t = Hm(e).trimStart();
  return t ? t.startsWith(`<svg`) || /^<svg[\s>]/i.test(t) : !1;
}
function jv(e, t) {
  return t !== `button` || !Av(e) ? e : U`<span class="inline-flex">${$(e)}</span>`;
}
function Mv(e) {
  let {
      slot: t,
      as: n = `button`,
      children: r = `Close`,
      class: i,
      className: a,
      type: o,
      props: s = {},
    } = e,
    c = jv(r, n),
    l = qm(c, t, i, a);
  if (l)
    return n === `button` && Av(r)
      ? U`<button
        type="${o ?? `button`}"
        data-slot="${t}"
        class="${q(i, a)}"
        ${W(J(s))}
      >
        ${$(r)}
      </button>`
      : l;
  let u = n;
  return U`<${W(u)}
    data-slot="${t}"
    class="${q(i, a)}"
    ${W(J({ ...s, type: u === `button` ? (o ?? `button`) : o }))}
  >${$(c)}</${W(u)}>`;
}
var Nv = new WeakMap(),
  Pv = {
    size: {
      sm: { classes: `min-w-72`, description: `Small dialog for simple confirmations` },
      base: { classes: `sm:min-w-96`, description: `Default dialog width` },
      lg: { classes: `min-w-[32rem]`, description: `Large dialog for complex content` },
      xl: { classes: `min-w-[48rem]`, description: `Extra large dialog for detailed views` },
    },
    role: {
      dialog: { classes: ``, description: `Standard dialog for general-purpose modals` },
      alertdialog: {
        classes: ``,
        description: `Alert dialog for confirmation flows requiring acknowledgment`,
      },
    },
  },
  Fv = { size: `base`, role: `dialog` };
function Iv(e, t, n) {
  return e[t ?? n] ?? e[n];
}
function Lv({ size: e = Fv.size } = {}) {
  return q(
    `fixed top-1/2 left-1/2 z-[calc(50+var(--dialog-content-stack-index,0))] w-full max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl bg-areia-background text-areia-default shadow-lg outline outline-1 outline-areia-divider sm:w-auto sm:max-w-[calc(100vw-3rem)]`,
    `transition-[transform,scale,opacity] duration-150 data-[starting-style]:scale-90 data-[starting-style]:opacity-0 data-[ending-style]:scale-90 data-[ending-style]:opacity-0`,
    Iv(Pv.size, e, Fv.size).classes,
  );
}
function Rv() {
  return q(
    `fixed inset-0 z-[calc(40+var(--dialog-overlay-stack-index,0))] bg-areia-overlay`,
    `transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0`,
  );
}
function zv(e) {
  return J({
    "data-alert-dialog": e.alertDialog,
    "data-close-on-click-outside": e.closeOnClickOutside,
    "data-close-on-escape": e.closeOnEscape,
    "data-default-open": e.defaultOpen,
    "data-lock-scroll": e.lockScroll,
  });
}
function Bv(e = {}) {
  let { as: t = `button`, children: n = `Open`, class: r, className: i, type: a, ...o } = e,
    s = qm(n, `dialog-trigger`, r, i);
  if (s) return s;
  let c = t;
  return U`<${W(c)}
    data-slot="dialog-trigger"
    class="${q(r, i)}"
    ${W(J({ ...o, tabindex: c === `span` || c === `div` ? (o.tabindex ?? o.tabIndex ?? 0) : o.tabindex, type: c === `button` ? (a ?? `button`) : a }))}
  >${$(n)}</${W(c)}>`;
}
function Vv(e = {}) {
  let { class: t, className: n, ...r } = e;
  return U`<div
    data-slot="dialog-overlay"
    hidden
    class="${q(Rv(), t, n)}"
    ${W(J(r))}
  ></div>`;
}
function Hv(e = {}) {
  let { children: t, class: n, className: r, size: i = Fv.size, ...a } = e;
  return U`<div
    data-slot="dialog-content"
    hidden
    class="${q(Lv({ size: i }), n, r)}"
    ${W(J(a))}
  >
    ${$(t)}
  </div>`;
}
function Uv(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<h2
    data-slot="dialog-title"
    class="${q(`m-0 text-xl leading-7 font-semibold`, n, r)}"
    ${W(J(i))}
  >
    ${t}
  </h2>`;
}
function Wv(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<p
    data-slot="dialog-description"
    class="${q(`m-0 text-base leading-6 text-areia-subtle`, n, r)}"
    ${W(J(i))}
  >
    ${t}
  </p>`;
}
function Gv(e = {}) {
  let { as: t = `button`, children: n = `Close`, class: r, className: i, type: a, ...o } = e;
  return Mv({
    slot: `dialog-close`,
    as: t,
    children: n,
    class: r,
    className: i,
    type: a,
    props: o,
  });
}
function Kv(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<div
    data-slot="dialog-portal"
    class="${q(n, r)}"
    ${W(J(i))}
  >
    ${$(t)}
  </div>`;
}
function qv(e = {}) {
  let { binds: t, attrs: n } = Nh(e),
    {
      alertDialog: r,
      children: i,
      class: a,
      className: o,
      closeOnClickOutside: s,
      closeOnEscape: c,
      content: l,
      contentClass: u,
      contentClassName: d,
      defaultOpen: f,
      lockScroll: p,
      onOpenChange: m,
      overlayClass: h,
      overlayClassName: g,
      portalClass: _,
      portalClassName: v,
      role: y = Fv.role,
      size: b = Fv.size,
      trigger: x,
      triggerAs: S,
      triggerClass: C,
      triggerClassName: w,
      ...T
    } = n,
    E = r ?? y === `alertdialog`,
    D = Nt(() => Hh(e, f)),
    { "bind:open": O, ...k } = t,
    A = $(i),
    j = Km(i, `dialog-content`),
    M = Km(i, `dialog-trigger`)
      ? void 0
      : (qm(x, `dialog-trigger`, C, w) ??
        qm(i, `dialog-trigger`, C, w) ??
        Bv({ as: S, class: C, className: w, children: x ?? i })),
    N = U`${j ? A : M}
  ${
    j
      ? ``
      : Kv({
          class: _,
          className: v,
          children: U`${Vv({ class: h, className: g })}
        ${Hv({ class: u, className: d, children: l, size: b })}`,
        })
  }`;
  return Rh(
    `div`,
    k,
    ` data-slot="dialog" class="${q(`inline-flex`, a, o)}"${zv({ alertDialog: E, closeOnClickOutside: s ?? (!E && void 0), closeOnEscape: c, defaultOpen: D, lockScroll: p })}${J(T)}`,
    N,
  );
}
var Jv = new WeakMap(),
  Yv = nn
    .input()
    .onMount(({ host: e, input: t }) => {
      let n = e.matches(`[data-slot="dialog"]`) ? e : e.querySelector(`[data-slot="dialog"]`);
      if (!n) return;
      let r = t.alertDialog ?? t.role === `alertdialog`,
        i = null;
      bg(n, mg);
      let a = Jl.createDialog(n, {
        alertDialog: r,
        closeOnClickOutside: t.closeOnClickOutside ?? (!r && void 0),
        closeOnEscape: t.closeOnEscape,
        defaultOpen: Hh(t, t.defaultOpen),
        lockScroll: t.lockScroll,
        onOpenChange: (e) => {
          (i?.onUserChange(e), t.onOpenChange?.(e));
        },
        onPortalMounted: t.onPortalMounted,
      });
      return (
        (i = Uh(t, a)),
        i?.applyFromSignal(),
        Nv.set(n, a),
        Jv.set(e, { controller: a, bindSync: i }),
        () => {
          (Jv.delete(e), Nv.delete(n), a.destroy());
        }
      );
    })
    .effect(({ host: e, input: t }) => {
      Bh(t);
      let n = Jv.get(e);
      n && n.bindSync?.applyFromSignal();
    })
    .render(({ input: e }) => qv(Gm(e, [`content`, `trigger`, `children`])));
function Xv(e = {}) {
  return qv(Gm(e, [`content`, `trigger`, `children`]));
}
Object.assign(Yv, {
  Root: Yv,
  Static: Xv,
  Trigger: Bv,
  Portal: Kv,
  Overlay: Vv,
  Content: Hv,
  Title: Uv,
  Description: Wv,
  Close: Gv,
});
var Zv = new WeakMap(),
  Qv = {
    variant: {
      default: { item: `text-areia-default data-highlighted:bg-areia-control-hover` },
      danger: {
        item: `text-areia-danger data-highlighted:bg-areia-danger/10 data-highlighted:text-areia-danger`,
      },
    },
  };
function $v({ variant: e = `default` } = {}) {
  return Qv.variant[e];
}
var ey = og({ icon: Zh, class: `size-3.5` });
function ty(e) {
  return e === `checkbox`
    ? `dropdown-menu-checkbox-item`
    : e === `radio`
      ? `dropdown-menu-radio-item`
      : `dropdown-menu-item`;
}
function ny({ checked: e, selected: t }) {
  return U`<span
    aria-hidden="true"
    class="${q(`absolute left-2 flex size-4 items-center justify-center opacity-0 group-data-[checked]:opacity-100`, (e || t) && `opacity-100`)}"
  >
    ${ey}
  </span>`;
}
function ry(e = {}) {
  let { as: t = `span`, children: n, class: r, className: i, type: a, ...o } = e,
    s = t;
  return U`<${W(s)}
    data-slot="dropdown-menu-trigger"
    class="${q(`inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-md text-base font-medium outline-none ring-offset-areia-background transition-colors focus-visible:ring-2 focus-visible:ring-areia-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50`, s === `button` && `m-0 h-auto min-h-0 border-0 shadow-none`, r, i)}"
    ${W(J({ ...o, tabindex: s === `span` || s === `div` ? (o.tabIndex ?? 0) : o.tabIndex === void 0 ? void 0 : o.tabIndex, type: s === `button` ? (a ?? `button`) : a }))}
  >${$(n)}</${W(s)}>`;
}
function iy(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<div
    data-slot="dropdown-menu-content"
    hidden
    class="${q(`z-50 min-w-36 rounded-lg bg-areia-background p-1.5 text-base text-areia-default shadow-lg ring ring-areia-border outline-none data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95`, n, r)}"
    ${W(J(i))}
  >
    ${$(t)}
  </div>`;
}
function ay(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<div
    data-slot="dropdown-menu-group"
    class="${q(`py-1`, n, r)}"
    ${W(J(i))}
  >
    ${$(t)}
  </div>`;
}
function oy(e = {}) {
  let { children: t, inset: n, class: r, className: i, ...a } = e;
  return U`<div
    data-slot="dropdown-menu-label"
    class="${q(`px-2 py-1.5 text-base font-medium text-areia-default`, n && `pl-8`, r, i)}"
    ${W(J(a))}
  >
    ${$(t)}
  </div>`;
}
function sy(e = {}) {
  let { class: t, className: n, ...r } = e;
  return U`<div
    data-slot="dropdown-menu-separator"
    class="${q(`-mx-1 my-1 h-px bg-areia-border`, t, n)}"
    ${W(J(r))}
  ></div>`;
}
function cy(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<span
    data-slot="dropdown-menu-shortcut"
    class="${q(`ml-auto pl-6 text-xs tracking-normal text-areia-subtle`, n, r)}"
    ${W(J(i))}
  >
    ${$(t)}
  </span>`;
}
function ly(e = {}, t = `item`) {
  let {
    value: n,
    label: r,
    children: i,
    icon: a,
    shortcut: o,
    disabled: s,
    checked: c,
    selected: l,
    inset: u,
    href: d,
    external: f,
    variant: p = `default`,
    class: m,
    className: h,
    ...g
  } = e;
  if (t === `separator`) return sy({ class: m, className: h });
  if (t === `label`) return oy({ children: i ?? r ?? n, inset: u, class: m, className: h });
  let _ = ty(t),
    v = q(
      `group relative flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-base outline-none transition-colors data-disabled:pointer-events-none data-disabled:opacity-50`,
      (t === `checkbox` || t === `radio` || u) && `pl-8`,
      $v({ variant: p }).item,
      m,
      h,
    ),
    y = i ?? r ?? n,
    b = t === `checkbox` || t === `radio`,
    x = {
      ...g,
      "data-slot": _,
      "data-value": n,
      "data-disabled": s,
      "data-default-checked": c ?? l,
      "data-checked": c ?? l,
      "aria-checked": b && (c || l) ? `true` : void 0,
      href: d,
      target: f ? `_blank` : void 0,
      rel: f ? `noreferrer` : void 0,
    };
  return d
    ? U`<a class="${v}" ${W(J(x))}>
      ${b ? ny({ checked: c, selected: l }) : ``}
      ${a == null ? `` : U`<span class="flex size-4 shrink-0 items-center justify-center">${a}</span>`}
      <span class="min-w-0 flex-1">${y}</span>
      ${o == null ? `` : cy({ children: o })}
    </a>`
    : U`<button type="button" class="${v}" ${W(J(x))}>
    ${b ? ny({ checked: c, selected: l }) : ``}
    ${a == null ? `` : U`<span class="flex size-4 shrink-0 items-center justify-center">${a}</span>`}
    <span class="min-w-0 flex-1">${y}</span>
    ${o == null ? `` : cy({ children: o })}
  </button>`;
}
function uy(e = {}) {
  return ly(e, e.type ?? `item`);
}
function dy(e = {}) {
  return ly(e);
}
function fy(e = {}) {
  return ly(e, `checkbox`);
}
function py(e = {}) {
  return ly(e, `radio`);
}
function my(e) {
  return e?.map((e) => uy(e)) ?? ``;
}
function hy(e = {}) {
  let { binds: t, attrs: n } = Nh(e),
    {
      trigger: r,
      children: i,
      items: a,
      class: o,
      className: s,
      triggerClass: c,
      triggerClassName: l,
      contentClass: u,
      contentClassName: d,
      defaultOpen: f,
      defaultValue: p,
      defaultValues: m,
      closeOnClickOutside: h,
      closeOnEscape: g,
      closeOnSelect: _,
      side: v,
      align: y,
      sideOffset: b,
      alignOffset: x,
      avoidCollisions: S,
      collisionPadding: C,
      lockScroll: w,
      highlightItemOnHover: T,
      onOpenChange: E,
      onSelect: D,
      onValueChange: O,
      onValuesChange: k,
      variant: A,
      ...j
    } = n,
    M = Nt(() => Hh(e, f)),
    { "bind:open": N, ...ee } = t,
    P = $(i),
    F = U`${
      Km(i, `dropdown-menu-content`)
        ? P
        : U`${ry({ children: r, class: q(c, l) })}
      ${iy({ children: i ?? my(a), class: q(u, d) })}`
    }`;
  return Rh(
    `div`,
    ee,
    ` data-slot="dropdown-menu" class="${q(`contents`, o, s)}"${J({ ...j, "data-default-open": M, "data-default-value": p, "data-default-values": m ? JSON.stringify(m) : void 0, "data-close-on-click-outside": h, "data-close-on-escape": g, "data-close-on-select": _, "data-side": v, "data-align": y, "data-side-offset": b, "data-align-offset": x, "data-avoid-collisions": S, "data-collision-padding": C, "data-lock-scroll": w, "data-highlight-item-on-hover": T })}`,
    F,
  );
}
var gy = new WeakMap(),
  _y = nn
    .input()
    .onMount(({ host: e, input: t }) => {
      let n = e.matches(`[data-slot="dropdown-menu"]`)
        ? e
        : e.querySelector(`[data-slot="dropdown-menu"]`);
      if (!n) return;
      let r = null;
      bg(n, mg);
      let i = eu.createDropdownMenu(n, {
        defaultOpen: Hh(t, t.defaultOpen),
        defaultValue: t.defaultValue,
        defaultValues: t.defaultValues,
        onOpenChange: (e) => {
          (r?.onUserChange(e), t.onOpenChange?.(e));
        },
        onSelect: t.onSelect,
        onValueChange: t.onValueChange,
        onValuesChange: t.onValuesChange,
        closeOnClickOutside: t.closeOnClickOutside,
        closeOnEscape: t.closeOnEscape,
        closeOnSelect: t.closeOnSelect,
        side: t.side,
        align: t.align,
        sideOffset: t.sideOffset,
        alignOffset: t.alignOffset,
        avoidCollisions: t.avoidCollisions,
        collisionPadding: t.collisionPadding,
        lockScroll: t.lockScroll,
        highlightItemOnHover: t.highlightItemOnHover,
        onPortalMounted: t.onPortalMounted,
      });
      return (
        (r = Uh(t, i)),
        r?.applyFromSignal(),
        Zv.set(n, i),
        gy.set(e, { controller: i, bindSync: r }),
        () => {
          (gy.delete(e), Zv.delete(n), i.destroy());
        }
      );
    })
    .effect(({ host: e, input: t }) => {
      Bh(t);
      let n = gy.get(e);
      n && n.bindSync?.applyFromSignal();
    })
    .render(({ input: e }) => hy(e));
Object.assign(_y, {
  Root: _y,
  Static: hy,
  Trigger: ry,
  Content: iy,
  Item: uy,
  LinkItem: dy,
  CheckboxItem: fy,
  RadioItem: py,
  Label: oy,
  Separator: sy,
  Shortcut: cy,
  Group: ay,
});
var vy = `overflow-hidden rounded-lg bg-areia-background shadow-xs ring ring-areia-foreground/10`,
  yy = `flex w-full flex-col overflow-hidden rounded-lg bg-areia-surface-muted text-base ring ring-areia-foreground/10`,
  by = `-my-2 flex items-center gap-2 bg-areia-surface-muted p-4 text-base font-medium text-areia-subtle`,
  xy = `relative flex flex-col gap-2 overflow-hidden rounded-lg bg-areia-background p-4 pr-3 text-inherit no-underline ring ring-areia-foreground/10`;
function Sy(e = {}) {
  return q(vy);
}
function Cy(e) {
  let t = Um(e);
  return t.includes(`data-slot="layer-card-content"`) || t.includes(`data-slot="layer-card-title"`);
}
function wy(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<div
    data-slot="layer-card-content"
    class="${q(xy, n, r)}"
    ${W(J(i))}
  >
    ${$(t)}
  </div>`;
}
function Ty(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<div
    data-slot="layer-card-title"
    class="${q(by, n, r)}"
    ${W(J(i))}
  >
    ${$(t)}
  </div>`;
}
function Ey(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<div
    data-slot="layer-card"
    class="${q(Cy(t) ? yy : Sy(), n, r)}"
    ${W(J(i))}
  >
    ${$(t)}
  </div>`;
}
var Dy = Object.assign(Ey, { Root: Ey, Static: Ey, Content: wy, Title: Ty });
function Oy(e = {}) {
  let { class: t, className: n, ...r } = e;
  return U`<svg
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="${q(`link-external-icon`, t, n)}"
    ${W(J(r))}
  >
    <path
      d="M9 4H8.8C7.11984 4 6.27976 4 5.63803 4.32698C5.07354 4.6146 4.6146 5.07354 4.32698 5.63803C4 6.27976 4 7.11984 4 8.8V15.2C4 16.8802 4 17.7202 4.32698 18.362C4.6146 18.9265 5.07354 19.3854 5.63803 19.673C6.27976 20 7.11984 20 8.8 20H15.2C16.8802 20 17.7202 20 18.362 19.673C18.9265 19.3854 19.3854 18.9265 19.673 18.362C20 17.7202 20 16.8802 20 15.2V15"
    ></path>
    <path d="M14 4H20M20 4V10M20 4L11 13"></path>
  </svg>`;
}
var ky = {
    variant: {
      inline: {
        classes: `text-areia-primary underline underline-offset-[0.15em] decoration-[0.0625em] transition-colors hover:text-areia-primary/70`,
        description: `Inline text link that flows with content`,
      },
      current: {
        classes: `text-current underline underline-offset-[0.15em] decoration-[0.0625em] transition-colors hover:opacity-70`,
        description: `Link that inherits color from parent text`,
      },
      plain: {
        classes: `text-areia-primary transition-colors hover:text-areia-primary/70`,
        description: `Link without underline decoration`,
      },
    },
  },
  Ay = { variant: `inline` };
function jy(e, t, n) {
  return e[t ?? n] ?? e[n];
}
function My({ variant: e = Ay.variant } = {}) {
  return q(jy(ky.variant, e, Ay.variant).classes);
}
function Ny(e = {}) {
  let {
    children: t,
    label: n,
    class: r,
    className: i,
    external: a,
    variant: o = Ay.variant,
    ...s
  } = e;
  return U`<a
    class="${q(My({ variant: o }), `group/link inline-flex items-center gap-[0.1875em]`, r, i)}"
    ${W(J({ ...s, target: a ? `_blank` : s.target, rel: a ? `noopener noreferrer` : s.rel }))}
  >
    ${$(t ?? n)}
  </a>`;
}
Object.assign(Ny, { ExternalIcon: Oy });
var Py = {
    size: Zg.size,
    variant: {
      default: {
        classes: `focus:ring-areia-ring/50 focus:ring-[1.5px]`,
        description: `Default select appearance`,
      },
      error: {
        classes: `!ring-areia-destructive focus:ring-areia-destructive/50 focus:ring-[1.5px]`,
        description: `Error state for validation failures`,
      },
      ghost: {
        classes: `bg-transparent ring-transparent shadow-none focus:bg-areia-control-background`,
        description: `Minimal select appearance`,
      },
    },
  },
  Fy = { size: `base`, variant: `default` };
function Iy(e, t, n) {
  return e[t ?? n] ?? e[n];
}
function Ly({ size: e = Fy.size, variant: t = Fy.variant } = {}) {
  return q(
    `w-full appearance-none border-0 bg-areia-control-background text-areia-default ring ring-areia-divider outline-none focus:outline-none`,
    `placeholder:text-areia-placeholder disabled:cursor-not-allowed disabled:text-areia-disabled disabled:opacity-50`,
    `bg-no-repeat whitespace-nowrap overflow-hidden text-ellipsis`,
    `[background-image:linear-gradient(45deg,transparent_50%,currentColor_50%),linear-gradient(135deg,currentColor_50%,transparent_50%)]`,
    `[background-position:calc(100%-20px)_calc(1px+50%),calc(100%-16.1px)_calc(1px+50%)]`,
    `[background-size:4px_4px,4px_4px]`,
    `[padding-inline-end:1.75rem]`,
    `multiple:h-auto multiple:overflow-auto multiple:bg-none multiple:py-3 multiple:pe-3`,
    Iy(Py.size, e, Fy.size).classes,
    Iy(Py.variant, t, Fy.variant).classes,
  );
}
function Ry(e) {
  return typeof e != `object` ||
    !e ||
    Array.isArray(e) ||
    (`value` in e && typeof e.value == `string`)
    ? !1
    : `label` in e && e.label !== void 0;
}
function zy(e = {}) {
  let { label: t, class: n, className: r, ...i } = e;
  return U`<option
    class="${q(`rounded-md px-3 py-1.5`, n, r)}"
    ${W(J(i))}
  >
    ${t}
  </option>`;
}
function By(e, t) {
  let {
      label: n,
      children: r,
      disabled: i,
      class: a,
      className: o,
    } = Array.isArray(e) ? { label: `` } : e,
    s = Array.isArray(e) ? e : (t ?? r);
  return U`<optgroup
    label="${n}"
    class="${q(a, o)}"
    ${W(J({ disabled: i }))}
  >
    ${$(s)}
  </optgroup>`;
}
function Vy() {
  return U`<option disabled>──────────</option>`;
}
function Hy(e) {
  return Array.isArray(e)
    ? e.map((e) => zy(e))
    : Object.entries(e)
        .filter(([, e]) => e != null)
        .map(([e, t]) => {
          let n = Ry(t) ? t : void 0;
          return zy({ value: e, label: n ? n.label : t, disabled: n?.disabled });
        });
}
function Uy(e) {
  return e && typeof e == `object` && `message` in e ? e.message : e;
}
function Wy(e, t) {
  let { binds: n, attrs: r } = Nh(e),
    {
      class: i,
      className: a,
      children: o,
      description: s,
      error: c,
      items: l,
      label: u,
      labelTooltip: d,
      placeholder: f,
      required: p,
      size: m = Fy.size,
      variant: h,
      ...g
    } = r,
    _ = h ?? (c ? `error` : Fy.variant),
    v = t ?? (l ? Hy(l) : o),
    y = g;
  return Rh(
    `select`,
    n,
    ` class="${q(Ly({ size: m, variant: _ }), i, a)}"${J({ ...y, "aria-invalid": c ? `true` : y[`aria-invalid`], "aria-describedby": typeof y[`aria-describedby`] == `string` ? y[`aria-describedby`] : void 0 })}`,
    U`${f == null ? `` : zy({ value: ``, label: f, disabled: !!y.required, selected: y.value == null })}${$(v)}`,
  );
}
function Gy(e = {}, t) {
  let n = Array.isArray(e) ? {} : e,
    r = Array.isArray(e) ? e : t,
    { label: i, labelTooltip: a, description: o, error: s } = n,
    c = Uy(s),
    l = Wy(n, r);
  return i == null && o == null && c == null
    ? l
    : Xg.Static({ label: i, description: o, error: c, invalid: c != null, children: l });
}
var Ky = Object.assign(Gy, { Root: Gy, Static: Gy, Option: zy, Group: By, Separator: Vy }),
  qy = {
    size: Zg.size,
    inputSide: {
      right: { classes: ``, description: `Input positioned inline to the right of chips` },
      top: { classes: ``, description: `Input positioned above chips` },
    },
  },
  Jy = { size: `base`, inputSide: `right` };
function Yy(e, t, n) {
  return e[t ?? n] ?? e[n];
}
function Xy({ inputSide: e = Jy.inputSide } = {}) {
  return q(Yy(qy.inputSide, e, Jy.inputSide).classes);
}
function Zy(e) {
  return e && typeof e == `object` && `message` in e ? e.message : e;
}
var Qy = (e) => U`<svg
  aria-hidden="true"
  class="fill-current"
  width="${e}"
  height="${e}"
  viewBox="0 0 256 256"
  fill="currentColor"
>
  <path
    d="M213.66 101.66l-80 80a8 8 0 0 1-11.32 0l-80-80A8 8 0 0 1 53.66 90.34L128 164.69l74.34-74.35a8 8 0 0 1 11.32 11.32Z"
  ></path>
</svg>`,
  $y = () => U`<svg
  aria-hidden="true"
  class="size-4 fill-current"
  viewBox="0 0 256 256"
  fill="currentColor"
>
  <path
    d="M229.66 77.66l-128 128a8 8 0 0 1-11.32 0l-56-56a8 8 0 0 1 11.32-11.32L96 188.69 218.34 66.34a8 8 0 0 1 11.32 11.32Z"
  ></path>
</svg>`,
  eb = (e) => U`<svg
  aria-hidden="true"
  width="${e}"
  height="${e}"
  viewBox="0 0 256 256"
  fill="currentColor"
>
  <path
    d="M205.66 194.34a8 8 0 0 1-11.32 11.32L128 139.31l-66.34 66.35a8 8 0 0 1-11.32-11.32L116.69 128 50.34 61.66a8 8 0 0 1 11.32-11.32L128 116.69l66.34-66.35a8 8 0 0 1 11.32 11.32L139.31 128Z"
  ></path>
</svg>`,
  tb = {
    xs: { padding: `pr-7`, iconSize: 12, clearRight: `right-5`, caretRight: `right-1` },
    sm: { padding: `pr-9`, iconSize: 14, clearRight: `right-6`, caretRight: `right-1.5` },
    base: { padding: `pr-12`, iconSize: 16, clearRight: `right-8`, caretRight: `right-2` },
    lg: { padding: `pr-14`, iconSize: 18, clearRight: `right-9`, caretRight: `right-3` },
  },
  nb = {
    xs: { padding: `pr-5`, iconSize: 12, iconRight: `right-1` },
    sm: { padding: `pr-6`, iconSize: 14, iconRight: `right-1.5` },
    base: { padding: `pr-8`, iconSize: 16, iconRight: `right-2` },
    lg: { padding: `pr-10`, iconSize: 18, iconRight: `right-3` },
  };
function rb(e) {
  return J({
    "data-auto-highlight": e.autoHighlight,
    "data-default-open": e.defaultOpen,
    "data-default-value": Array.isArray(e.defaultValue)
      ? JSON.stringify(e.defaultValue)
      : e.defaultValue,
    "data-disabled": e.disabled,
    "data-multiple": e.multiple,
    "data-name": e.name,
    "data-open-on-focus": e.openOnFocus,
    "data-placeholder": e.placeholder,
    "data-required": e.required,
  });
}
function ib(e) {
  return J({
    "data-align": e.align,
    "data-align-offset": e.alignOffset,
    "data-avoid-collisions": e.avoidCollisions,
    "data-collision-padding": e.collisionPadding,
    "data-side": e.side,
    "data-side-offset": e.sideOffset,
  });
}
var ab = {
  xs: `min-h-5 py-0.5`,
  sm: `min-h-6.5 py-0.5`,
  base: `min-h-9 py-1`,
  lg: `min-h-10 py-1.5`,
};
function ob(e = {}) {
  let { binds: t, attrs: n } = Nh(e),
    {
      clearLabel: r = `Clear selection`,
      showOptionsLabel: i = `Show options`,
      multiple: a,
      size: o = Jy.size,
      variant: s = `default`,
      class: c,
      className: l,
      ...u
    } = n,
    d = tb[o],
    f = a
      ? U`<div
          class="${q(e_({ size: o, variant: s }), `flex h-auto w-full flex-wrap items-center`, s === `error` ? `focus-within:ring-[1.5px] focus-within:ring-areia-destructive/50` : `focus-within:ring-[1.5px] focus-within:ring-areia-ring/50`, ab[o], d.padding)}"
        >
          <div data-slot="combobox-chips" class="contents"></div>
          ${Lh(`input`, t, ` data-slot="combobox-input" class="min-w-16 flex-1 border-0 bg-transparent p-0 outline-none focus:ring-0 disabled:cursor-not-allowed"${J(u)} />`)}
        </div>
        <template data-slot="combobox-chip-template">
          <span class="${q(Qm({ variant: `secondary` }), `gap-1 pr-0.75`)}">
            <span data-slot="combobox-chip-label"></span>
            <button
              type="button"
              data-slot="combobox-chip-remove"
              class="flex cursor-pointer rounded-full border-0 bg-transparent p-0.5 hover:bg-areia-control-hover data-disabled:pointer-events-none"
            >
              ${eb(10)}
            </button>
          </span>
        </template>`
      : Lh(
          `input`,
          t,
          ` data-slot="combobox-input" class="${q(e_({ size: o, variant: s }), `w-full disabled:cursor-not-allowed`, d.padding)}"${J(u)} />`,
        );
  return U`<div
    class="${q(`relative inline-block w-full max-w-xs has-disabled:cursor-not-allowed has-disabled:opacity-50`, c, l)}"
  >
    ${f}
    <button
      type="button"
      data-slot="combobox-clear"
      aria-label="${r}"
      class="${q(`absolute top-1/2 hidden -translate-y-1/2 cursor-pointer border-0 bg-transparent p-0 in-data-value:flex data-disabled:pointer-events-none data-disabled:opacity-0`, d.clearRight)}"
    >
      ${eb(d.iconSize)}
    </button>
    <button
      type="button"
      data-slot="combobox-trigger"
      aria-label="${i}"
      class="${q(`absolute top-1/2 m-0 flex -translate-y-1/2 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-areia-subtle`, d.caretRight)}"
    >
      ${Qy(d.iconSize)}
    </button>
  </div>`;
}
function sb(e = {}) {
  let {
      placeholder: t,
      size: n = Jy.size,
      variant: r = `default`,
      class: i,
      className: a,
      ...o
    } = e,
    s = nb[n];
  return U`<button
    type="button"
    data-slot="combobox-trigger"
    class="${q(e_({ size: n, variant: r }), `relative flex w-full items-center text-left data-disabled:cursor-not-allowed data-disabled:opacity-50 data-placeholder:text-areia-placeholder`, s.padding, i, a)}"
    ${W(J(o))}
  >
    <span data-slot="combobox-value">${t}</span>
    <span
      class="${q(`absolute top-1/2 flex -translate-y-1/2 items-center text-areia-subtle`, s.iconRight)}"
      >${Qy(s.iconSize)}</span
    >
  </button>`;
}
function cb(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<div
    data-slot="combobox-content"
    hidden
    class="${q(`z-50 flex max-h-[min(var(--available-height),24rem)] min-w-(--anchor-width) flex-col rounded-lg bg-areia-background py-1.5 text-areia-default shadow-lg ring ring-areia-divider`, n, r)}"
    ${W(ib(i))}
    ${W(J(i))}
  >
    ${$(t)}
  </div>`;
}
function lb(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<div
    data-slot="combobox-list"
    class="${q(`min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-pb-2 scroll-pt-2`, n, r)}"
    ${W(J(i))}
  >
    ${$(t)}
  </div>`;
}
function ub(e) {
  let { children: t, class: n, className: r, disabled: i, label: a, value: o, ...s } = e;
  return U`<div
    data-slot="combobox-item"
    data-value="${o}"
    class="${q(`group mx-1.5 grid cursor-pointer grid-cols-[1fr_16px] gap-2 rounded px-2 py-1.5 text-base data-disabled:cursor-not-allowed data-disabled:text-areia-subtle data-disabled:opacity-60 data-highlighted:bg-areia-control-hover data-disabled:data-highlighted:bg-transparent`, n, r)}"
    ${W(J({ ...s, "data-label": a, "data-disabled": i, disabled: i }))}
  >
    <div class="col-start-1">${$(t)}</div>
    <span data-slot="combobox-item-indicator" class="col-start-2 flex items-center"
      >${$y()}</span
    >
  </div>`;
}
function db(e = {}) {
  let { children: t = `No options found.`, class: n, className: r, ...i } = e;
  return U`<div
    data-slot="combobox-empty"
    class="${q(`mx-1.5 shrink-0 px-4 py-2 text-[0.925rem] leading-4 text-areia-subtle empty:m-0 empty:p-0`, n, r)}"
    ${W(J(i))}
  >
    ${$(t)}
  </div>`;
}
function fb(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<div
    data-slot="combobox-group"
    class="${q(`mt-2 border-t border-areia-divider pt-2 first:mt-0 first:border-t-0 first:pt-0`, n, r)}"
    ${W(J(i))}
  >
    ${$(t)}
  </div>`;
}
function pb(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<div
    data-slot="combobox-label"
    class="${q(`mx-1.5 px-2 py-1.5 text-sm font-medium text-areia-subtle`, n, r)}"
    ${W(J(i))}
  >
    ${$(t)}
  </div>`;
}
function mb(e = {}) {
  let { class: t, className: n, ...r } = e;
  return U`<div
    data-slot="combobox-separator"
    class="${q(`my-1 h-px bg-areia-divider`, t, n)}"
    ${W(J(r))}
  ></div>`;
}
function hb(e = {}) {
  let { binds: t, attrs: n } = Nh(e),
    { size: r = Jy.size, variant: i = `default`, class: a, className: o, ...s } = n;
  return Lh(
    `input`,
    t,
    ` data-slot="combobox-input" class="${q(e_({ size: r, variant: i }), `mx-1.5 w-[calc(100%-0.75rem)] shrink-0 first:mb-2`, a, o)}"${J(s)} />`,
  );
}
function gb(e = {}) {
  let { children: t, removeLabel: n = `Remove`, class: r, className: i, ...a } = e;
  return U`<span
    class="${q(`flex h-6 items-center gap-2.5 rounded-sm bg-areia-surface-muted py-0 pl-2 pr-0.75 text-sm ring-1 ring-areia-divider`, r, i)}"
    ${W(J(a))}
  >
    ${$(t)}
    <button
      type="button"
      aria-label="${n}"
      class="flex cursor-pointer rounded-md border-0 bg-transparent p-1 hover:bg-areia-control-hover"
    >
      ${eb(10)}
    </button>
  </span>`;
}
function _b(e) {
  return Array.isArray(e)
    ? e.map((e) => ub({ value: e.value, disabled: e.disabled, children: e.label }))
    : Object.entries(e).flatMap(([e, t]) => {
        if (t == null) return [];
        let n = typeof t == `object` && !Array.isArray(t) && `label` in t ? t : void 0;
        return ub({
          value: e,
          disabled: n && `disabled` in n ? !!n.disabled : !1,
          children: n ? n.label : t,
        });
      });
}
function vb(e) {
  let { "bind:open": t, "bind:group": n, "bind:value": r, ...i } = e;
  return i;
}
function yb(e) {
  return e[`bind:group`] != null || e[`bind:value`] == null
    ? e
    : { ...e, "bind:group": e[`bind:value`] };
}
function bb(e, t) {
  let { binds: n, attrs: r } = Nh(e),
    i = vb(n),
    {
      autoHighlight: a,
      class: o,
      className: s,
      children: c,
      defaultOpen: l,
      defaultValue: u,
      description: d,
      disabled: f,
      error: p,
      filter: m,
      id: h,
      inputSide: g,
      itemToStringValue: _,
      items: v,
      label: y,
      labelTooltip: b,
      multiple: x,
      name: S,
      onInputValueChange: C,
      onOpenChange: w,
      onValueChange: T,
      openOnFocus: E,
      placeholder: D,
      required: O,
      size: k = Jy.size,
      variant: A,
      align: j,
      alignOffset: M,
      avoidCollisions: N,
      collisionPadding: ee,
      side: P,
      sideOffset: F,
      ...I
    } = r,
    L = Nt(() => Hh(e, l)),
    te = Nt(() => qh(yb(e), u)),
    R = p ? `error` : `default`,
    z = Zy(p),
    B = typeof I[`aria-describedby`] == `string` ? I[`aria-describedby`] : void 0,
    V = {
      align: j,
      alignOffset: M,
      avoidCollisions: N,
      collisionPadding: ee,
      side: P,
      sideOffset: F,
    },
    ne = t ?? (v ? _b(v) : c),
    H = U`${ob({ ...I, ...i, id: h, multiple: x, name: S, placeholder: D, disabled: f, required: O, size: k, variant: R, "aria-invalid": z == null ? I[`aria-invalid`] : `true`, "aria-describedby": B || void 0 })}
  ${cb({ ...V, children: lb({ children: [db(), ne] }) })}`;
  return Rh(
    `div`,
    {},
    ` data-slot="combobox" class="${q(`relative w-full`, Xy({ inputSide: g }), o, s)}"${rb({ autoHighlight: a, defaultOpen: L, defaultValue: te, disabled: f, multiple: x, name: S, openOnFocus: E, placeholder: D, required: O })}${ib(V)}`,
    H,
  );
}
function xb(e, t) {
  let { label: n, labelTooltip: r, description: i, error: a } = e,
    o = Zy(a),
    s = bb(e, t);
  return n == null && i == null && o == null
    ? s
    : Xg.Static({ label: n, description: i, error: o, invalid: o != null, children: s });
}
var Sb = new WeakMap(),
  Cb = nn
    .input()
    .onMount(({ host: e, input: t }) => {
      let n = e.matches(`[data-slot="combobox"]`) ? e : e.querySelector(`[data-slot="combobox"]`);
      if (!n) return;
      let r = null,
        i = null;
      bg(n, mg);
      let a = Ol.createCombobox(n, {
        align: t.align,
        alignOffset: t.alignOffset,
        autoHighlight: t.autoHighlight,
        avoidCollisions: t.avoidCollisions,
        collisionPadding: t.collisionPadding,
        defaultOpen: Hh(t, t.defaultOpen),
        defaultValue: qh(yb(t), t.defaultValue) ?? void 0,
        disabled: t.disabled,
        filter: t.filter,
        itemToStringValue: t.itemToStringValue,
        multiple: t.multiple,
        name: t.name,
        onInputValueChange: t.onInputValueChange,
        onOpenChange: (e) => {
          (r?.onUserChange(e), t.onOpenChange?.(e));
        },
        onValueChange: (e) => {
          (i?.onUserChange(e), t.onValueChange?.(e));
        },
        openOnFocus: t.openOnFocus,
        placeholder: t.placeholder,
        required: t.required,
        side: t.side,
        sideOffset: t.sideOffset,
        onPortalMounted: t.onPortalMounted,
      });
      ((r = Uh(t, a)),
        (i = Jh(
          yb(t),
          {
            getValue: () => (t.multiple ? [...a.values] : a.value),
            setValue: (e) => {
              e == null ? a.clear() : a.setValues(Array.isArray(e) ? e : [e]);
            },
          },
          t.multiple ? `multiple` : `single`,
        )),
        r?.applyFromSignal(),
        i?.applyFromSignal(),
        Sb.set(e, { controller: a, openSync: r, groupSync: i }));
      let o = Xh(
        n.querySelector(`[data-slot="combobox-input"]`) ??
          n.querySelector(`[data-slot="combobox"]`),
        t,
      );
      return () => {
        (Sb.delete(e), o?.(), a.destroy());
      };
    })
    .effect(({ host: e, input: t }) => {
      Bh(t);
      let n = Sb.get(e);
      n && (n.openSync?.applyFromSignal(), n.groupSync?.applyFromSignal());
    })
    .render(({ input: e }) => xb(e));
function wb(e = {}, t) {
  return xb(Array.isArray(e) ? {} : e, Array.isArray(e) ? e : t);
}
Object.assign(Cb, {
  Root: Cb,
  Static: wb,
  TriggerInput: ob,
  TriggerValue: sb,
  Content: cb,
  Input: hb,
  Empty: db,
  List: lb,
  Item: ub,
  Group: fb,
  GroupLabel: pb,
  Separator: mb,
  Chip: gb,
});
var Tb = {
    variant: {
      default: { classes: `ring-areia-divider`, description: `Default radio appearance` },
      error: {
        classes: `ring-areia-destructive`,
        description: `Error state for validation failures`,
      },
    },
    appearance: {
      default: { classes: ``, description: `Standard inline radio item` },
      card: {
        classes: `rounded-lg border border-areia-border bg-areia-control-background p-3 transition-colors hover:bg-areia-control-hover [&:has(input:checked)]:border-areia-control-active [&:has(input:checked)]:bg-areia-control-hover`,
        description: `Choice card appearance with border, padding, and highlighted selection state`,
      },
    },
  },
  Eb = { variant: `default`, appearance: `default` };
function Db(e, t, n) {
  return e[t ?? n] ?? e[n];
}
function Ob({ variant: e = Eb.variant, appearance: t = Eb.appearance } = {}) {
  return q(Db(Tb.variant, e, Eb.variant).classes, Db(Tb.appearance, t, Eb.appearance).classes);
}
function kb(e) {
  let { binds: t, attrs: n } = Nh(e),
    { checked: r, disabled: i, variant: a = Eb.variant, ...o } = n,
    s = t[`bind:checked`] != null || t[`bind:group`] != null;
  return U`<span
    class="relative mt-0.5 inline-flex size-4 shrink-0 items-center justify-center [&:has(input:checked)>input]:bg-areia-foreground [&:has(input:checked)>input]:ring-areia-foreground [&:has(input:checked)>span]:flex"
  >
    ${Lh(`input`, t, ` type="radio" class="${q(`peer size-4 appearance-none rounded-full border-0 bg-areia-control-background ring focus:outline-none after:absolute after:-inset-x-3 after:-inset-y-2`, Ob({ variant: a }), !i && `cursor-pointer hover:ring-areia-control-border focus:ring-areia-ring focus:ring-2 focus-visible:ring-2 focus-visible:ring-areia-ring focus-visible:outline-offset-3`, i && `cursor-not-allowed opacity-50`)}"${J({ ...o, ...(s ? {} : { checked: !!r }), disabled: i })} />`)}
    <span class="pointer-events-none absolute inset-0 hidden items-center justify-center">
      <span class="size-2 rounded-full bg-areia-control-background"></span>
    </span>
  </span>`;
}
function Ab(e) {
  let {
      label: t,
      description: n,
      disabled: r,
      variant: i = Eb.variant,
      appearance: a = Eb.appearance,
      controlPosition: o,
      class: s,
      className: c,
      ...l
    } = e,
    u = a === `card`,
    d = o ?? (u ? `end` : `start`),
    f = d === `start`,
    p = kb({ ...l, disabled: r, variant: i });
  return u
    ? U`<label
      class="${q(`m-0 group relative flex items-start gap-3`, Ob({ variant: i, appearance: a }), f && `flex-row-reverse`, i === `error` && `border-areia-destructive [&:has(input:checked)]:border-areia-destructive [&:has(input:checked)]:bg-areia-control-background`, r ? `cursor-not-allowed opacity-50` : `cursor-pointer`, s, c)}"
    >
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        ${fg({ asContent: !0, label: t, class: `text-base font-medium text-areia-default` })}
        ${n == null ? `` : U`<span class="text-sm text-areia-subtle">${n}</span>`}
      </div>
      ${p}
    </label>`
    : U`<label
    class="${q(`m-0 group relative inline-flex items-center gap-2 text-areia-default`, d === `end` && `flex-row-reverse justify-end`, r ? `cursor-not-allowed opacity-50` : `cursor-pointer`, s, c)}"
  >
    ${p} ${fg({ asContent: !0, label: t, class: `text-base text-areia-default` })}
  </label>`;
}
function jb({ label: e, class: t, className: n }) {
  return U`<legend
    class="${q(`mb-2 text-base font-medium text-areia-default`, t, n)}"
  >
    ${e}
  </legend>`;
}
function Mb(e = {}, t) {
  let {
      legend: n,
      children: r,
      orientation: i = `vertical`,
      appearance: a = Eb.appearance,
      error: o,
      description: s,
      disabled: c,
      defaultValue: l,
      value: u,
      name: d,
      controlPosition: f,
      class: p,
      className: m,
      ...h
    } = Array.isArray(e) ? {} : e,
    g = Array.isArray(e) ? e : (t ?? r),
    _ = Array.isArray(g)
      ? g.map((e) =>
          typeof e == `function`
            ? e({
                name: d,
                controlPosition: f,
                appearance: a,
                disabled: c,
                defaultValue: l,
                value: u,
              })
            : e,
        )
      : g;
  return U`<fieldset
    class="${q(`flex flex-col gap-4`, p, m)}"
    ${W(J({ ...h, disabled: c }))}
  >
    ${n == null ? `` : jb({ label: n })}
    <div
      class="${q(i === `vertical` ? q(`flex flex-col`, a === `card` ? `gap-3` : `gap-2`) : a === `card` ? `grid grid-cols-2 gap-3` : `flex flex-row flex-wrap gap-2`)}"
    >
      ${$(_)}
    </div>
    ${o == null ? `` : U`<p class="text-sm text-areia-destructive-soft-foreground">${o}</p>`}
    ${s == null ? `` : U`<p class="text-sm text-areia-subtle">${s}</p>`}
  </fieldset>`;
}
Object.assign(Mb, { Item: Ab, Group: Mb, Legend: jb });
var Nb = {
    side: {
      top: { classes: ``, description: `Popover appears above the trigger` },
      bottom: { classes: ``, description: `Popover appears below the trigger` },
      left: { classes: ``, description: `Popover appears to the left of the trigger` },
      right: { classes: ``, description: `Popover appears to the right of the trigger` },
    },
  },
  Pb = { side: `bottom` };
function Fb(e, t, n) {
  return e[t ?? n] ?? e[n];
}
function Ib({ side: e = Pb.side } = {}) {
  return q(
    `relative flex origin-[var(--transform-origin)] flex-col rounded-lg bg-areia-background px-4 py-3 text-sm text-areia-default`,
    `shadow-lg outline outline-1 outline-areia-divider`,
    `transition-[transform,scale,opacity] duration-150`,
    `data-starting-style:scale-90 data-starting-style:opacity-0`,
    `data-ending-style:scale-90 data-ending-style:opacity-0`,
    `data-instant:duration-0`,
    Fb(Nb.side, e, Pb.side).classes,
  );
}
function Lb(e) {
  return J({
    "data-align": e.align,
    "data-align-offset": e.alignOffset,
    "data-avoid-collisions": e.avoidCollisions,
    "data-close-on-click-outside": e.closeOnClickOutside,
    "data-close-on-escape": e.closeOnEscape,
    "data-collision-padding": e.collisionPadding,
    "data-default-open": e.defaultOpen,
    "data-portal": e.portal,
    "data-side": e.side,
    "data-side-offset": e.sideOffset,
  });
}
function Rb(e = {}) {
  let { class: t, className: n, side: r = Pb.side, ...i } = e;
  return U`<div
    data-slot="popover-arrow"
    data-side="${r}"
    class="${q(`pointer-events-none absolute z-10 size-2.5 rotate-45 bg-areia-background shadow-[inherit]`, `data-[side=bottom]:top-px data-[side=bottom]:left-1/2 data-[side=bottom]:-translate-x-1/2 data-[side=bottom]:-translate-y-1/2 data-[side=bottom]:border-t data-[side=bottom]:border-l data-[side=bottom]:border-areia-divider`, `data-[side=top]:bottom-px data-[side=top]:left-1/2 data-[side=top]:-translate-x-1/2 data-[side=top]:translate-y-1/2 data-[side=top]:border-r data-[side=top]:border-b data-[side=top]:border-areia-divider`, `data-[side=left]:top-1/2 data-[side=left]:right-px data-[side=left]:-translate-y-1/2 data-[side=left]:translate-x-1/2 data-[side=left]:border-t data-[side=left]:border-r data-[side=left]:border-areia-divider`, `data-[side=right]:top-1/2 data-[side=right]:left-px data-[side=right]:-translate-x-1/2 data-[side=right]:-translate-y-1/2 data-[side=right]:border-b data-[side=right]:border-l data-[side=right]:border-areia-divider`, t, n)}"
    ${W(J(i))}
  ></div>`;
}
function zb(e = {}) {
  let { as: t = `span`, children: n, class: r, className: i, type: a, ...o } = e,
    s = t;
  return U`<${W(s)}
    data-slot="popover-trigger"
    class="${q(`inline-flex cursor-default items-center bg-transparent p-0 leading-0`, s === `button` && `m-0 h-auto min-h-0 border-0 shadow-none`, r, i)}"
    ${W(J({ ...o, tabindex: s === `span` || s === `div` ? (o.tabindex ?? o.tabIndex ?? 0) : o.tabindex, type: s === `button` ? (a ?? `button`) : a }))}
  >${$(n)}</${W(s)}>`;
}
function Bb(e = {}) {
  let {
    align: t,
    alignOffset: n,
    arrow: r = !0,
    avoidCollisions: i,
    children: a,
    class: o,
    className: s,
    collisionPadding: c,
    portal: l,
    side: u = Pb.side,
    sideOffset: d = 8,
    ...f
  } = e;
  return U`<div
    data-slot="popover-content"
    hidden
    class="${q(Ib({ side: u }), o, s)}"
    ${W(Lb({ align: t, alignOffset: n, avoidCollisions: i, collisionPadding: c, portal: l, side: u, sideOffset: d }))}
    ${W(J(f))}
  >
    ${r ? Rb({ side: u }) : ``} ${$(a)}
  </div>`;
}
function Vb(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<h3
    class="${q(`m-0 text-base leading-6 font-medium`, n, r)}"
    ${W(J(i))}
  >
    ${t}
  </h3>`;
}
function Hb(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<p
    class="${q(`m-0 text-base leading-6 text-areia-subtle`, n, r)}"
    ${W(J(i))}
  >
    ${t}
  </p>`;
}
function Ub(e = {}) {
  let { as: t = `button`, children: n = `Close`, class: r, className: i, type: a, ...o } = e;
  return Mv({
    slot: `popover-close`,
    as: t,
    children: n,
    class: r,
    className: i,
    type: a,
    props: o,
  });
}
function Wb(e = {}) {
  let { binds: t, attrs: n } = Nh(e),
    {
      align: r,
      alignOffset: i,
      arrow: a,
      avoidCollisions: o,
      children: s,
      class: c,
      className: l,
      closeOnClickOutside: u,
      closeOnEscape: d,
      collisionPadding: f,
      content: p,
      contentClass: m,
      contentClassName: h,
      defaultOpen: g,
      onOpenChange: _,
      portal: v,
      position: y,
      side: b = Pb.side,
      sideOffset: x = 8,
      trigger: S,
      triggerAs: C,
      triggerClass: w,
      triggerClassName: T,
      ...E
    } = n,
    D = Nt(() => Hh(e, g)),
    { "bind:open": O, ...k } = t,
    A = $(s),
    j = Km(s, `popover-content`),
    M = Km(s, `popover-trigger`)
      ? void 0
      : (qm(S, `popover-trigger`, w, T) ??
        (S == null ? void 0 : $(S)) ??
        qm(s, `popover-trigger`, w, T) ??
        zb({ as: C, class: w, className: T, children: s })),
    N = U`${j ? A : M}
  ${j ? `` : Bb({ align: r, alignOffset: i, arrow: a, avoidCollisions: o, class: m, className: h, collisionPadding: f, children: p, portal: v, side: b, sideOffset: x })}`;
  return Rh(
    `div`,
    k,
    ` data-slot="popover" class="${q(`inline-flex`, c, l)}"${Lb({ align: r, alignOffset: i, avoidCollisions: o, closeOnClickOutside: u, closeOnEscape: d, collisionPadding: f, defaultOpen: D, portal: v, side: b, sideOffset: x })}${J(E)}`,
    N,
  );
}
function Gb(e) {
  let t = e.querySelector(`[data-slot="popover-content"]`),
    n = e.querySelector(`[data-slot="popover-arrow"]`),
    r = t?.getAttribute(`data-side`);
  n && r && n.setAttribute(`data-side`, r);
}
var Kb = new WeakMap(),
  qb = nn
    .input()
    .onMount(({ host: e, input: t }) => {
      let n = e.matches(`[data-slot="popover"]`) ? e : e.querySelector(`[data-slot="popover"]`);
      if (!n) return;
      let r = () => {
          let e = n.querySelector(`[data-slot="popover-content"]`),
            t = n.querySelector(`[data-slot="popover-arrow"]`),
            r = e?.getAttribute(`data-side`);
          t && r && t.setAttribute(`data-side`, r);
        },
        i = null;
      bg(n, mg);
      let a = Ku.createPopover(n, {
        align: t.align,
        alignOffset: t.alignOffset,
        avoidCollisions: t.avoidCollisions,
        closeOnClickOutside: t.closeOnClickOutside,
        closeOnEscape: t.closeOnEscape,
        collisionPadding: t.collisionPadding,
        defaultOpen: Hh(t, t.defaultOpen),
        onOpenChange: (e) => {
          (i?.onUserChange(e), t.onOpenChange?.(e));
        },
        portal: t.portal,
        side: t.side,
        sideOffset: t.sideOffset,
        onPortalMounted: t.onPortalMounted,
      });
      ((i = Uh(t, a)), i?.applyFromSignal(), Kb.set(e, { controller: a, bindSync: i }), r());
      let o = n.querySelector(`[data-slot="popover-content"]`),
        s = o ? new MutationObserver(r) : void 0;
      return (
        s?.observe(o, { attributes: !0, attributeFilter: [`data-side`] }),
        () => {
          (Kb.delete(e), s?.disconnect(), a.destroy());
        }
      );
    })
    .effect(({ host: e, input: t }) => {
      Bh(t);
      let n = Kb.get(e);
      n && n.bindSync?.applyFromSignal();
    })
    .on(`[data-slot='popover-content']@animationend`, ({ host: e }) => {
      let t = e.matches(`[data-slot="popover"]`) ? e : e.querySelector(`[data-slot="popover"]`);
      t && Gb(t);
    })
    .on(`[data-slot='popover-content']@transitionend`, ({ host: e }) => {
      let t = e.matches(`[data-slot="popover"]`) ? e : e.querySelector(`[data-slot="popover"]`);
      t && Gb(t);
    })
    .render(({ input: e }) => Wb(Gm(e, [`content`, `trigger`, `children`])));
function Jb(e = {}) {
  return Wb(Gm(e, [`content`, `trigger`, `children`]));
}
Object.assign(qb, {
  Root: qb,
  Static: Jb,
  Trigger: zb,
  Content: Bb,
  Title: Vb,
  Description: Hb,
  Close: Ub,
  Arrow: Rb,
});
var Yb = new WeakMap(),
  Xb = {
    side: {
      top: { classes: ``, description: `HoverCard appears above the trigger` },
      bottom: { classes: ``, description: `HoverCard appears below the trigger` },
      left: { classes: ``, description: `HoverCard appears to the left of the trigger` },
      right: { classes: ``, description: `HoverCard appears to the right of the trigger` },
    },
  },
  Zb = { side: `bottom` };
function Qb(e, t, n) {
  return e[t ?? n] ?? e[n];
}
function $b({ side: e = Zb.side } = {}) {
  return q(
    `relative flex origin-[var(--transform-origin)] flex-col rounded-lg bg-areia-background text-sm text-areia-default`,
    `shadow-lg outline outline-1 outline-areia-divider`,
    `transition-[transform,scale,opacity] duration-150`,
    `data-starting-style:scale-90 data-starting-style:opacity-0`,
    `data-ending-style:scale-90 data-ending-style:opacity-0`,
    `data-instant:duration-0`,
    Qb(Xb.side, e, Zb.side).classes,
  );
}
function ex(e) {
  return J({
    "data-align": e.align,
    "data-align-offset": e.alignOffset,
    "data-avoid-collisions": e.avoidCollisions,
    "data-close-delay": e.closeDelay,
    "data-collision-padding": e.collisionPadding,
    "data-delay": e.delay,
    "data-portal": e.portal,
    "data-side": e.side,
    "data-side-offset": e.sideOffset,
    "data-skip-delay-duration": e.skipDelayDuration,
    "data-close-on-click-outside": e.closeOnClickOutside,
    "data-close-on-escape": e.closeOnEscape,
  });
}
function tx(e = {}) {
  let { as: t = `span`, children: n, class: r, className: i, type: a, ...o } = e,
    s = t;
  return U`<${W(s)}
    data-slot="hover-card-trigger"
    class="${q(`inline-flex cursor-default items-center bg-transparent p-0 leading-0`, s === `button` && `m-0 h-auto min-h-0 border-0 shadow-none`, r, i)}"
    ${W(J({ ...o, tabindex: s === `span` || s === `div` ? (o.tabindex ?? o.tabIndex ?? 0) : o.tabindex, type: s === `button` ? (a ?? `button`) : a }))}
  >${$(n)}</${W(s)}>`;
}
function nx(e = {}) {
  let {
    align: t,
    alignOffset: n,
    avoidCollisions: r,
    children: i,
    class: a,
    className: o,
    collisionPadding: s,
    portal: c,
    side: l = Zb.side,
    sideOffset: u = 4,
    ...d
  } = e;
  return U`<div
    data-slot="hover-card-content"
    hidden
    class="${q($b({ side: l }), `w-64 p-4`, a, o)}"
    ${W(ex({ align: t, alignOffset: n, avoidCollisions: r, collisionPadding: s, portal: c, side: l, sideOffset: u }))}
    ${W(J(d))}
  >
    ${$(i)}
  </div>`;
}
function rx(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<h3
    class="${q(`m-0 text-base leading-6 font-medium`, n, r)}"
    ${W(J(i))}
  >
    ${t}
  </h3>`;
}
function ix(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<p
    class="${q(`m-0 text-base leading-6 text-areia-subtle`, n, r)}"
    ${W(J(i))}
  >
    ${t}
  </p>`;
}
function ax(e = {}) {
  let { binds: t, attrs: n } = Nh(e),
    {
      align: r,
      alignOffset: i,
      avoidCollisions: a,
      children: o,
      class: s,
      className: c,
      closeDelay: l,
      closeOnClickOutside: u,
      closeOnEscape: d,
      collisionPadding: f,
      content: p,
      contentClass: m,
      contentClassName: h,
      defaultOpen: g,
      delay: _,
      onOpenChange: v,
      portal: y,
      side: b = Zb.side,
      sideOffset: x = 4,
      skipDelayDuration: S,
      trigger: C,
      triggerAs: w,
      triggerClass: T,
      triggerClassName: E,
      ...D
    } = n,
    O = Nt(() => Hh(e, g)),
    { "bind:open": k, ...A } = t,
    j = $(o),
    M = Km(o, `hover-card-content`),
    N = Km(o, `hover-card-trigger`)
      ? void 0
      : (qm(C, `hover-card-trigger`, T, E) ??
        (C == null ? void 0 : $(C)) ??
        qm(o, `hover-card-trigger`, T, E) ??
        tx({ as: w, class: T, className: E, children: o })),
    ee = U`${M ? j : N}
  ${M ? `` : nx({ align: r, alignOffset: i, avoidCollisions: a, class: m, className: h, collisionPadding: f, children: p, portal: y, side: b, sideOffset: x })}`;
  return Rh(
    `div`,
    A,
    ` data-slot="hover-card" class="${q(`inline-flex`, s, c)}"${J({ "data-default-open": O })}${ex({ align: r, alignOffset: i, avoidCollisions: a, closeDelay: l, closeOnClickOutside: u, closeOnEscape: d, collisionPadding: f, delay: _, portal: y, side: b, sideOffset: x, skipDelayDuration: S })}${J(D)}`,
    ee,
  );
}
var ox = new WeakMap(),
  sx = nn
    .input()
    .onMount(({ host: e, input: t }) => {
      let n = e.matches(`[data-slot="hover-card"]`)
        ? e
        : e.querySelector(`[data-slot="hover-card"]`);
      if (!n) return;
      let r = null;
      bg(n, mg);
      let i = Mu.createHoverCard(n, {
        align: t.align,
        alignOffset: t.alignOffset,
        avoidCollisions: t.avoidCollisions,
        closeDelay: t.closeDelay,
        closeOnClickOutside: t.closeOnClickOutside,
        closeOnEscape: t.closeOnEscape,
        collisionPadding: t.collisionPadding,
        defaultOpen: Hh(t, t.defaultOpen),
        delay: t.delay,
        onOpenChange: (e) => {
          (r?.onUserChange(e), t.onOpenChange?.(e));
        },
        portal: t.portal,
        side: t.side,
        sideOffset: t.sideOffset,
        skipDelayDuration: t.skipDelayDuration,
        onPortalMounted: t.onPortalMounted,
      });
      return (
        (r = Uh(t, i)),
        r?.applyFromSignal(),
        Yb.set(n, i),
        ox.set(e, { controller: i, bindSync: r }),
        () => {
          (ox.delete(e), Yb.delete(n), i.destroy());
        }
      );
    })
    .effect(({ host: e, input: t }) => {
      Bh(t);
      let n = ox.get(e);
      n && n.bindSync?.applyFromSignal();
    })
    .render(({ input: e }) => ax(Gm(e, [`content`, `trigger`, `children`])));
function cx(e = {}) {
  return ax(Gm(e, [`content`, `trigger`, `children`]));
}
Object.assign(sx, { Root: sx, Static: cx, Trigger: tx, Content: nx, Title: rx, Description: ix });
function lx(e) {
  return J({ "data-value": e.value, "data-min": e.min, "data-max": e.max });
}
function ux(e = {}) {
  let { label: t, class: n, className: r } = e;
  return U`<span
    data-slot="progress-label"
    class="${q(`text-sm font-medium text-areia-default`, n, r)}"
    >${t ?? `Progress`}</span
  >`;
}
function dx(e = {}) {
  let { class: t, className: n } = e;
  return U`<span
    data-slot="progress-value"
    class="${q(`text-sm tabular-nums text-areia-subtle`, t, n)}"
  ></span>`;
}
function fx(e = {}) {
  let { children: t, class: n, className: r } = e;
  return U`<div
    data-slot="progress-track"
    class="${q(`h-2 w-full overflow-hidden rounded-full bg-areia-control-background`, n, r)}"
  >
    ${t ?? px()}
  </div>`;
}
function px(e = {}) {
  let { class: t, className: n } = e;
  return U`<div
    data-slot="progress-indicator"
    class="${q(`h-full rounded-full bg-areia-primary transition-[width] duration-200 ease-out data-indeterminate:w-full data-indeterminate:animate-pulse`, t, n)}"
  ></div>`;
}
function mx(e = {}) {
  let {
    value: t,
    min: n,
    max: r,
    label: i,
    showValue: a = !0,
    class: o,
    className: s,
    trackClass: c,
    indicatorClass: l,
    valueClass: u,
    onValueChange: d,
    ...f
  } = e;
  return U`<div
    data-slot="progress"
    class="${q(`flex w-full flex-col gap-2`, o, s)}"
    ${W(lx({ value: t, min: n, max: r }))}
    ${W(J(f))}
  >
    ${
      i != null || a
        ? U`<div class="flex items-center justify-between gap-3">
          ${i == null ? `` : ux({ label: i })}
          ${a ? dx({ class: u }) : ``}
        </div>`
        : ``
    }
    ${fx({ class: c, children: px({ class: l }) })}
  </div>`;
}
var hx = nn
  .input()
  .onMount(({ host: e, input: t }) => {
    let n = e.matches(`[data-slot="progress"]`) ? e : e.querySelector(`[data-slot="progress"]`);
    if (!n) return;
    bg(n, mg);
    let r = ed.createProgress(n, {
      value: t.value,
      min: t.min,
      max: t.max,
      onValueChange: t.onValueChange,
    });
    return () => r.destroy();
  })
  .render(({ input: e }) => mx(e));
Object.assign(hx, { Root: hx, Static: mx, Label: ux, Track: fx, Indicator: px, Value: dx });
function gx(e) {
  return e !== void 0 && Array.isArray(e) ? 2 : 1;
}
function _x(e) {
  if (e !== void 0) return Array.isArray(e) ? e.join(`,`) : String(e);
}
function vx(e) {
  return J({
    "data-default-value": _x(e.defaultValue ?? e.value),
    "data-min": e.min,
    "data-max": e.max,
    "data-step": e.step,
    "data-orientation": e.orientation,
    "data-thumb-alignment": e.thumbAlignment ?? `edge`,
    "data-disabled": e.disabled ? `true` : void 0,
  });
}
function yx(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<div
    data-slot="slider-track"
    class="${q(`relative grow overflow-hidden rounded-full bg-areia-surface-muted`, n, r)}"
    ${W(J(i))}
  >
    ${t ?? bx()}
  </div>`;
}
function bx(e = {}) {
  let { class: t, className: n } = e;
  return U`<div
    data-slot="slider-range"
    class="${q(`h-full bg-areia-primary`, t, n)}"
  ></div>`;
}
function xx(e = {}) {
  let { class: t, className: n } = e;
  return U`<div
    data-slot="slider-thumb"
    class="${q(`block shrink-0 select-none rounded-full border border-areia-primary bg-areia-background shadow-sm`, `size-4`, `transition-[color,box-shadow]`, `hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden`, `ring-areia-ring/50`, `disabled:pointer-events-none disabled:opacity-50`, t, n)}"
  ></div>`;
}
function Sx(e) {
  let t = gx(e.defaultValue ?? e.value),
    n = e.thumbClass;
  return Array.from({ length: t }, () => xx({ class: n }));
}
function Cx(e = {}) {
  let {
      value: t,
      defaultValue: n,
      min: r,
      max: i,
      step: a,
      orientation: o = `horizontal`,
      disabled: s,
      thumbAlignment: c,
      class: l,
      className: u,
      controlClass: d,
      trackClass: f,
      rangeClass: p,
      thumbClass: m,
      onValueChange: h,
      onValueCommit: g,
      ..._
    } = e,
    v = o === `vertical`,
    y = v ? `h-full w-1.5` : `h-1.5 w-full`,
    b = v ? `h-full w-auto min-h-40 flex-col items-center` : `w-full items-center`;
  return U`<div
    data-slot="slider"
    class="${q(v ? `h-full` : `min-w-64`, l, u)}"
    ${W(vx({ defaultValue: n ?? t, min: r, max: i, step: a, orientation: o, disabled: s, thumbAlignment: c }))}
    ${W(J(_))}
  >
    <div
      class="${q(`relative flex touch-none select-none`, b, s && `opacity-50`, d)}"
    >
      ${yx({ class: q(y, f), children: bx({ class: p }) })}
      ${Sx(e)}
    </div>
  </div>`;
}
var wx = nn
  .input()
  .onMount(({ host: e, input: t }) => {
    let n = e.matches(`[data-slot="slider"]`) ? e : e.querySelector(`[data-slot="slider"]`);
    if (!n) return;
    bg(n, mg);
    let r = Ud.createSlider(n, {
      defaultValue: t.value ?? t.defaultValue,
      min: t.min,
      max: t.max,
      step: t.step,
      orientation: t.orientation,
      disabled: t.disabled,
      thumbAlignment: t.thumbAlignment,
      onValueChange: t.onValueChange,
      onValueCommit: t.onValueCommit,
    });
    return () => r.destroy();
  })
  .render(({ input: e }) => Cx(e));
Object.assign(wx, { Root: wx, Static: Cx, Track: yx, Range: bx, Thumb: xx });
var Tx = [25, 50, 100, 250],
  Ex = (e, t, n) => Math.min(Math.max(e, t), n),
  Dx = {
    navigation: `Pagination`,
    firstPage: `First page`,
    previousPage: `Previous page`,
    nextPage: `Next page`,
    lastPage: `Last page`,
    pageNumber: `Page number`,
    pageSize: `Page size`,
  },
  Ox = { controls: `full` };
function kx(e) {
  return { ...Dx, ...e };
}
function Ax(e, t) {
  return Math.max(1, Math.ceil((e ?? 1) / (t ?? 1)));
}
function jx(e = 1, t, n) {
  if (!n || n <= 0) return `0-0`;
  let r = t ?? 1;
  return `${e * r - r + 1}-${Math.min(e * r, n)}`;
}
function Mx(e) {
  return U`<svg
    aria-hidden="true"
    class="size-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    ${{ first: U`<path d="m11 17-5-5 5-5"></path><path d="m18 17-5-5 5-5"></path>`, previous: U`<path d="m15 18-6-6 6-6"></path>`, next: U`<path d="m9 18 6-6-6-6"></path>`, last: U`<path d="m13 17 5-5-5-5"></path><path d="m6 17 5-5-5-5"></path>` }[e]}
  </svg>`;
}
function Nx(e = {}) {
  let { children: t, class: n, className: r, page: i = 1, perPage: a, totalCount: o, ...s } = e,
    c =
      t ??
      (o && o > 0
        ? U`Showing <span class="tabular-nums">${jx(i, a, o)}</span> of
          <span class="tabular-nums">${o}</span>`
        : ``);
  return U`<div
    data-slot="pagination-info"
    class="${q(`text-sm text-areia-subtle`, n, r)}"
    ${W(J(s))}
  >
    ${c}
  </div>`;
}
function Px(e = {}) {
  let { class: t, className: n, ...r } = e;
  return U`<div
    data-slot="pagination-separator"
    class="${q(`mx-2 h-6 border-l border-areia-divider`, t, n)}"
    ${W(J(r))}
  ></div>`;
}
function Fx(e) {
  let {
      class: t,
      className: n,
      label: r = `Per page:`,
      labels: i,
      name: a,
      options: o = [...Tx],
      value: s,
      ...c
    } = e,
    l = kx(i);
  return U`<div
    data-slot="pagination-page-size"
    class="${q(`flex items-center gap-2`, t, n)}"
    ${W(J(c))}
  >
    ${r ? U`<span class="text-sm text-areia-subtle">${r}</span>` : ``}
    ${Ky({ "aria-label": l.pageSize, name: a, value: String(s), class: `w-auto`, "data-pagination-page-size": ``, items: o.map((e) => ({ value: String(e), label: e })) })}
  </div>`;
}
function Ix(e, t, n, r, i) {
  return kh({
    "aria-label": r,
    class: q(
      Th({ size: i, shape: `square`, variant: `secondary` }),
      `rounded-none first:rounded-l-md last:rounded-r-md`,
    ),
    disabled: n,
    icon: Mx(e),
    shape: `square`,
    size: i,
    type: `button`,
    "data-pagination-action": e,
    "data-pagination-page": t,
  });
}
function Lx(e = {}) {
  let {
      buttonSize: t = `base`,
      class: n,
      className: r,
      controls: i = Ox.controls,
      labels: a,
      page: o = 1,
      pageSelector: s = `input`,
      perPage: c,
      totalCount: l,
      ...u
    } = e,
    d = kx(a),
    f = Ax(l, c),
    p = Ex(o, 1, f),
    m = Math.max(p - 1, 1),
    h = Math.min(p + 1, f);
  return U`<div
    data-slot="pagination-controls"
    class="${q(`flex grow flex-col items-end`, n, r)}"
    ${W(J(u))}
  >
    <nav aria-label="${d.navigation}">
      <div class="inline-flex items-stretch rounded-md shadow-xs">
        ${i === `full` ? Ix(`first`, 1, p <= 1, d.firstPage, t) : ``}
        ${Ix(`previous`, m, p <= 1, d.previousPage, t)}
        ${
          i === `full`
            ? s === `dropdown`
              ? Ky({
                  "aria-label": d.pageNumber,
                  value: String(p),
                  class: `w-18 rounded-none ring-areia-divider`,
                  "data-pagination-page-select": ``,
                  items: Array.from({ length: f }, (e, t) => ({
                    value: String(t + 1),
                    label: t + 1,
                  })),
                })
              : U`<input
                aria-label="${d.pageNumber}"
                class="h-9 w-12.5 border-0 bg-areia-control-background text-center text-base text-areia-default ring ring-areia-divider outline-none focus:ring-areia-ring/50 focus:ring-[1.5px]"
                value="${p}"
                inputmode="numeric"
                autocomplete="off"
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
                data-pagination-page-input
              />`
            : ``
        }
        ${Ix(`next`, h, p >= f, d.nextPage, t)}
        ${i === `full` ? Ix(`last`, f, p >= f, d.lastPage, t) : ``}
      </div>
    </nav>
  </div>`;
}
function Rx(e = {}) {
  let {
      children: t,
      class: n,
      className: r,
      controls: i = Ox.controls,
      labels: a,
      page: o = 1,
      pageSelector: s,
      perPage: c,
      totalCount: l,
      setPage: u,
      onPageChange: d,
      onPageSizeChange: f,
      ...p
    } = e,
    m = t ?? [
      U`<div aria-live="polite" aria-atomic="true" class="grow">
      ${Nx({ page: o, perPage: c, totalCount: l })}
    </div>`,
      Lx({ controls: i, labels: a, page: o, pageSelector: s, perPage: c, totalCount: l }),
    ];
  return U`<div
    data-slot="pagination"
    data-page="${o}"
    data-per-page="${c ?? ``}"
    data-total-count="${l ?? ``}"
    class="${q(`flex w-full items-center gap-2`, n, r)}"
    ${W(J(p))}
  >
    ${$(m)}
  </div>`;
}
function zx(e, t) {
  e.dispatchEvent(new CustomEvent(`pagination:page-change`, { bubbles: !0, detail: { page: t } }));
}
function Bx(e, t) {
  e.dispatchEvent(
    new CustomEvent(`pagination:page-size-change`, { bubbles: !0, detail: { pageSize: t } }),
  );
}
var Vx = nn
  .input()
  .onMount(({ host: e, input: t }) => {
    let n = e.matches(`[data-slot="pagination"]`) ? e : e.querySelector(`[data-slot="pagination"]`);
    if (!n) return;
    let r = Ax(t.totalCount, t.perPage),
      i = (e) => {
        let i = Ex(e, 1, r);
        (t.setPage?.(i), t.onPageChange?.(i), zx(n, i));
      },
      a = (e) => {
        let t = e.target?.closest?.(`[data-pagination-action]`);
        if (!t || !n.contains(t) || t.hasAttribute(`disabled`)) return;
        let r = Number(t.dataset.paginationPage);
        Number.isFinite(r) && i(r);
      },
      o = (e) => i(Number(e.value)),
      s = (e) => {
        let t = e.target;
        t instanceof HTMLInputElement && t.hasAttribute(`data-pagination-page-input`) && o(t);
      },
      c = (e) => {
        let t = e.target;
        e.key === `Enter` &&
          t instanceof HTMLInputElement &&
          t.hasAttribute(`data-pagination-page-input`) &&
          o(t);
      },
      l = (e) => {
        let r = e.target;
        if (
          (r instanceof HTMLSelectElement &&
            r.hasAttribute(`data-pagination-page-select`) &&
            i(Number(r.value)),
          r instanceof HTMLSelectElement && r.hasAttribute(`data-pagination-page-size`))
        ) {
          let e = Number(r.value);
          (t.onPageSizeChange?.(e), Bx(n, e));
        }
      };
    return (
      n.addEventListener(`click`, a),
      n.addEventListener(`focusout`, s),
      n.addEventListener(`keydown`, c),
      n.addEventListener(`change`, l),
      () => {
        (n.removeEventListener(`click`, a),
          n.removeEventListener(`focusout`, s),
          n.removeEventListener(`keydown`, c),
          n.removeEventListener(`change`, l));
      }
    );
  })
  .render(({ input: e }) => Rx(e));
function Hx(e = {}) {
  return Rx(e);
}
Object.assign(Vx, { Root: Vx, Static: Hx, Info: Nx, PageSize: Fx, Controls: Lx, Separator: Px });
var Ux = {
    size: {
      sm: {
        classes: `h-4 w-8`,
        thumbClasses: `size-4 data-checked:translate-x-4`,
        description: `Small switch for compact UIs`,
      },
      base: {
        classes: `h-4.5 w-9`,
        thumbClasses: `size-4.5 data-checked:translate-x-4.5`,
        description: `Default switch size`,
      },
      lg: {
        classes: `h-5 w-10`,
        thumbClasses: `size-5 data-checked:translate-x-5`,
        description: `Large switch for prominent toggles`,
      },
    },
    variant: {
      default: {
        classes: `data-checked:bg-areia-primary data-checked:ring-areia-primary data-unchecked:bg-areia-surface-muted data-unchecked:ring-areia-surface-muted bg-areia-surface-muted ring-areia-surface-muted`,
        thumbClasses: `bg-areia-background data-checked:bg-areia-primary-foreground`,
        description: `Default switch with brand color`,
      },
      neutral: {
        classes: `data-checked:bg-areia-foreground data-checked:ring-areia-foreground data-unchecked:bg-areia-surface-muted data-unchecked:ring-areia-surface-muted bg-areia-surface-muted ring-areia-surface-muted`,
        thumbClasses: `bg-areia-background data-checked:bg-areia-background`,
        description: `Monochrome switch for subtle toggles`,
      },
    },
  },
  Wx = { size: `base`, variant: `default` };
function Gx(e, t, n) {
  return e[t ?? n] ?? e[n];
}
function Kx(e) {
  return Gx(Ux.size, e, Wx.size);
}
function qx(e) {
  return Gx(Ux.variant, e, Wx.variant);
}
function Jx({ size: e = Wx.size, variant: t = Wx.variant } = {}) {
  return q(Kx(e).classes, qx(t).classes);
}
function Yx({ size: e = Wx.size, variant: t = Wx.variant } = {}) {
  return q(Kx(e).thumbClasses, qx(t).thumbClasses);
}
function Xx(e) {
  return J({
    "data-default-checked": e.defaultChecked,
    "data-disabled": e.disabled,
    "data-read-only": e.readOnly,
    "data-required": e.required,
    "data-name": e.name,
    "data-value": e.value,
    "data-unchecked-value": e.uncheckedValue,
  });
}
function Zx(e = {}) {
  let { binds: t, attrs: n } = Nh(e),
    {
      checked: r,
      defaultChecked: i,
      disabled: a,
      readOnly: o,
      required: s,
      name: c,
      value: l,
      uncheckedValue: u,
      transitioning: d,
      size: f = Wx.size,
      variant: p = Wx.variant,
      class: m,
      className: h,
      id: g,
      form: _,
      role: v,
      tabIndex: y,
      tabindex: b,
      "aria-checked": x,
      "aria-disabled": S,
      "aria-readonly": C,
      "aria-required": w,
      "aria-busy": T,
      "aria-label": E,
      "aria-labelledby": D,
      "aria-describedby": O,
      ...k
    } = n,
    A = t[`bind:checked`],
    j = !!(r ?? (typeof A == `function` ? A() : void 0) ?? i),
    M = t[`bind:checked`] != null || t[`bind:group`] != null,
    N = r ?? (typeof A == `function` ? A() : void 0) ?? i;
  return U`<span
    data-slot="switch"
    class="${q(`relative inline-flex shrink-0 cursor-pointer items-center border-0 p-0 ring outline-none`, `rounded-[5px] supports-[corner-shape:squircle]:rounded-[10px] [corner-shape:squircle]`, `transition-colors duration-150 ease-out motion-reduce:transition-none`, `focus-visible:ring-2 focus-visible:ring-areia-ring`, `data-disabled:cursor-not-allowed data-disabled:opacity-50 data-readonly:cursor-default`, Jx({ size: f, variant: p }), m, h)}"
    ${W(Xx({ defaultChecked: N, disabled: a, readOnly: o, required: s, name: c, value: l, uncheckedValue: typeof u == `string` ? u : void 0 }))}
    ${W(J({ role: v ?? `switch`, tabindex: a ? -1 : (b ?? y ?? 0), "aria-checked": x ?? (j ? `true` : `false`), "aria-disabled": S ?? (a ? `true` : void 0), "aria-readonly": C ?? (o ? `true` : void 0), "aria-required": w ?? (s ? `true` : void 0), "aria-busy": T ?? (d ? `true` : void 0), "aria-label": E, "aria-labelledby": D, "aria-describedby": O }))}
  >
    ${Lh(`input`, t, ` type="checkbox" data-slot="switch-input" class="sr-only peer" data-switch-generated="input"${J({ ...k, id: g, name: c, value: l, form: _, required: s, disabled: a, ...(M ? {} : { checked: j }) })} />`)}
    <span
      data-slot="switch-thumb"
      class="${q(`pointer-events-none absolute top-0 bottom-0 block shadow-xs`, `rounded-[5px] supports-[corner-shape:squircle]:rounded-[10px] [corner-shape:squircle]`, `transition-transform duration-150 ease-out motion-reduce:transition-none`, Yx({ size: f, variant: p }))}"
    ></span>
  </span>`;
}
function Qx(e = {}) {
  let {
      label: t,
      labelTooltip: n,
      controlFirst: r = !0,
      required: i,
      disabled: a,
      id: o,
      onCheckedChange: s,
      ...c
    } = e,
    l = typeof o == `string` ? o : void 0,
    u = c[`aria-label`] ?? (typeof t == `string` ? t : `Switch`),
    d = Zx({
      ...c,
      id: l,
      disabled: !!a,
      required: typeof i == `boolean` ? i : void 0,
      "aria-label": u,
    });
  return t == null
    ? d
    : U`<label
    data-slot="switch-item"
    class="${q(`inline-flex items-center gap-2 text-base text-areia-default`, r ? `flex-row` : `flex-row-reverse justify-end`, a ? `cursor-not-allowed opacity-50` : `cursor-pointer`)}"
  >
    ${d}
    ${fg({ asContent: !0, label: t, showOptional: i === !1, tooltip: n, class: a ? `cursor-not-allowed` : `cursor-pointer` })}
  </label>`;
}
function $x(e = {}) {
  let { label: t, children: n, class: r, className: i } = e;
  return U`<legend
    class="${q(`text-base font-medium text-areia-default`, r, i)}"
  >
    ${$(n ?? t)}
  </legend>`;
}
function eS(e = {}) {
  return oS(e);
}
function tS(e = {}, t) {
  let {
      legend: n,
      children: r,
      error: i,
      description: a,
      disabled: o,
      controlFirst: s = !0,
      class: c,
      className: l,
      ...u
    } = Array.isArray(e) ? {} : e,
    d = Array.isArray(e) ? e : (t ?? r);
  return U`<fieldset
    class="${q(`flex flex-col gap-4`, !s && `[&_[data-slot=switch-item]]:flex-row-reverse [&_[data-slot=switch-item]]:justify-end`, c, l)}"
    data-control-first="${s ? `true` : `false`}"
    ${W(J({ ...u, disabled: o }))}
  >
    ${n == null ? `` : $x({ label: n })}
    <div class="flex flex-col gap-2">${d ?? ``}</div>
    ${i == null ? (a == null ? `` : U`<p class="text-sm text-areia-subtle">${$(a)}</p>`) : U`<p class="text-sm text-areia-destructive-soft-foreground">${$(i)}</p>`}
  </fieldset>`;
}
function nS(e, t) {
  e.dispatchEvent(new CustomEvent(`switch:change`, { bubbles: !0, detail: { checked: t } }));
}
var rS = new WeakMap();
function iS(e) {
  return e.matches(`[data-slot="switch"]`) ? e : e.querySelector(`[data-slot="switch"]`);
}
var aS = nn
    .input()
    .onMount(({ host: e, input: t }) => {
      let n = iS(e);
      if (!n) return;
      let r = null;
      bg(n);
      let i = nf.createSwitch(n, {
        defaultChecked:
          typeof t.checked == `boolean`
            ? t.checked
            : typeof t.defaultChecked == `boolean`
              ? t.defaultChecked
              : void 0,
        disabled: typeof t.disabled == `boolean` ? t.disabled : void 0,
        readOnly: typeof t.readOnly == `boolean` ? t.readOnly : void 0,
        required: typeof t.required == `boolean` ? t.required : void 0,
        name: typeof t.name == `string` ? t.name : void 0,
        value: typeof t.value == `string` ? t.value : void 0,
        uncheckedValue: typeof t.uncheckedValue == `string` ? t.uncheckedValue : void 0,
        onCheckedChange: (e) => {
          (r?.onUserChange(e), t.onCheckedChange?.(e), nS(n, e));
        },
      });
      return (
        (r = Vh(t, i)),
        r?.applyFromSignal(),
        rS.set(e, { controller: i, bindSync: r }),
        () => {
          (rS.delete(e), i.destroy());
        }
      );
    })
    .effect(({ host: e, input: t }) => {
      Bh(t);
      let n = rS.get(e);
      n && n.bindSync?.applyFromSignal();
    })
    .render(({ input: e }) => Qx(e)),
  oS = Object.assign(aS, { Root: aS, Static: Qx, Item: eS, Group: tS, Legend: $x, Control: Zx }),
  sS = {
    layout: {
      auto: { classes: ``, description: `Auto table layout - columns resize based on content` },
      fixed: {
        classes: `table-fixed`,
        description: `Fixed table layout - columns have equal width, controlled via colgroup`,
      },
    },
    variant: {
      default: { classes: ``, description: `Default row variant` },
      selected: { classes: `bg-areia-control-hover`, description: `Selected row variant` },
    },
    sticky: {
      left: {
        classes: `sticky left-0`,
        description: `Pin column to the left edge of the scroll container`,
      },
      right: {
        classes: `sticky right-0`,
        description: `Pin column to the right edge of the scroll container`,
      },
    },
  },
  cS = { layout: `auto`, variant: `default` };
function lS(e, t, n) {
  return e[t ?? n] ?? e[n];
}
function uS(e, t) {
  let n = lS(sS.sticky, e, `left`).classes,
    r = t === `head` ? `z-2` : `z-1`,
    i = e === `right` ? `before:-left-6` : `before:-right-6`,
    a = `before:pointer-events-none before:absolute before:inset-y-0 before:w-6`;
  return t === `cell`
    ? q(
        n,
        r,
        `bg-areia-background`,
        a,
        i,
        e === `right`
          ? `before:bg-gradient-to-r before:from-transparent before:to-areia-background`
          : `before:bg-gradient-to-l before:from-transparent before:to-areia-background`,
      )
    : q(
        n,
        r,
        `bg-areia-background group-data-[compact]/header:bg-areia-surface-muted`,
        a,
        i,
        e === `right`
          ? `before:bg-gradient-to-r before:from-transparent before:to-areia-background group-data-[compact]/header:before:to-areia-surface-muted`
          : `before:bg-gradient-to-l before:from-transparent before:to-areia-background group-data-[compact]/header:before:to-areia-surface-muted`,
      );
}
function dS({ layout: e = cS.layout } = {}) {
  return q(
    `isolate w-full text-left text-base text-areia-default`,
    lS(sS.layout, e, cS.layout).classes,
    `[&_td]:border-b [&_td]:border-areia-divider [&_td]:p-3 [&_tr:last-child_td]:border-b-0`,
    `[&_th]:border-b [&_th]:border-areia-divider [&_th]:bg-areia-background [&_th]:p-3 [&_th]:text-base [&_th]:font-semibold`,
  );
}
function fS(e = {}) {
  let { children: t, class: n, className: r, layout: i = cS.layout, ...a } = e;
  return U`<table
    class="${q(dS({ layout: i }), n, r)}"
    ${W(J(a))}
  >
    ${$(t)}
  </table>`;
}
function pS(e = {}) {
  let { children: t, class: n, className: r, sticky: i, variant: a = `default`, ...o } = e,
    s = a === `compact`;
  return U`<thead
    class="${q(`group/header`, s && `text-xs text-areia-strong [&_th]:bg-areia-surface-muted [&_th]:py-2`, i && `[&_th]:sticky [&_th]:top-0 [&_th]:z-1`, n, r)}"
    ${W(J({ ...o, "data-compact": s || void 0 }))}
  >
    ${$(t)}
  </thead>`;
}
function mS(e = {}) {
  let { children: t, class: n, className: r, sticky: i, ...a } = e;
  return U`<th
    class="${q(`group relative`, i && uS(i, `head`), n, r)}"
    ${W(J(a))}
  >
    ${t}
  </th>`;
}
function hS(e = {}) {
  let { children: t, class: n, className: r, variant: i = cS.variant, ...a } = e;
  return U`<tr
    class="${q(lS(sS.variant, i, cS.variant).classes, n, r)}"
    ${W(J(a))}
  >
    ${$(t)}
  </tr>`;
}
function gS(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<tbody class="${q(n, r)}" ${W(J(i))}>
    ${$(t)}
  </tbody>`;
}
function _S(e = {}) {
  let { children: t, class: n, className: r, sticky: i, ...a } = e;
  return U`<td
    class="${q(i && uS(i, `cell`), n, r)}"
    ${W(J(a))}
  >
    ${t}
  </td>`;
}
function vS(e = {}) {
  let { children: t, class: n, className: r, ...i } = e;
  return U`<tfoot class="${q(n, r)}" ${W(J(i))}>
    ${$(t)}
  </tfoot>`;
}
var yS = `
  const handle = event.currentTarget;
  const cell = handle.closest('th,td');
  if (!cell) return;
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startWidth = cell.getBoundingClientRect().width;
  const minWidth = Number(handle.dataset.minWidth || 40);
  const onMove = (moveEvent) => {
    const width = Math.max(minWidth, startWidth + moveEvent.clientX - startX);
    cell.style.width = width + 'px';
    cell.style.minWidth = width + 'px';
  };
  const onUp = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    handle.releasePointerCapture?.(event.pointerId);
  };
  handle.setPointerCapture?.(event.pointerId);
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp, { once: true });
`
  .replace(/\s+/g, ` `)
  .trim();
function bS(e = {}) {
  let { class: t, className: n, minWidth: r = 40, ...i } = e;
  return U`<button
    type="button"
    aria-label="Resize column"
    onpointerdown="${yS}"
    data-min-width="${r}"
    class="${q(`invisible absolute top-0 right-0 m-0 flex h-full w-2.5 cursor-col-resize touch-none items-center justify-center border-0 bg-areia-background p-0 select-none group-hover:visible focus-visible:ring-2 focus-visible:ring-areia-ring`, t, n)}"
    ${W(J(i))}
  >
    <span class="h-5 w-0.5 rounded bg-areia-divider"></span>
  </button>`;
}
function xS(e = {}) {
  let {
    checked: t,
    disabled: n,
    indeterminate: r,
    label: i,
    name: a,
    value: o,
    class: s,
    className: c,
    ...l
  } = e;
  return _S({
    ...l,
    class: q(`w-10 leading-none`, String(s ?? ``), String(c ?? ``)),
    children: Ig({
      checked: t,
      disabled: n,
      indeterminate: r,
      name: a,
      value: o,
      "aria-label": i ?? `Select row`,
      class: `relative before:absolute before:-inset-3 before:content-['']`,
    }),
  });
}
function SS(e = {}) {
  let {
    checked: t,
    disabled: n,
    indeterminate: r,
    label: i,
    name: a,
    value: o,
    class: s,
    className: c,
    ...l
  } = e;
  return mS({
    ...l,
    class: q(`w-10 leading-none`, String(s ?? ``), String(c ?? ``)),
    children: Ig({
      checked: t,
      disabled: n,
      indeterminate: r,
      name: a,
      value: o,
      "aria-label": i ?? `Select all rows`,
      class: `relative before:absolute before:-inset-3 before:content-['']`,
    }),
  });
}
Object.assign(fS, {
  Header: pS,
  Head: mS,
  Row: hS,
  Body: gS,
  Cell: _S,
  CheckCell: xS,
  CheckHead: SS,
  Footer: vS,
  ResizeHandle: bS,
});
var CS = {
    variant: {
      segmented: { classes: ``, description: `Pill-shaped indicator on a filled track` },
      underline: { classes: ``, description: `Underline indicator below tab text` },
    },
    size: {
      sm: { classes: ``, description: `Compact tabs` },
      base: { classes: ``, description: `Default tabs` },
    },
  },
  wS = { variant: `segmented`, size: `base` };
function TS(e, t, n) {
  return e[t ?? n] ?? e[n];
}
function ES({ variant: e = wS.variant, size: t = wS.size } = {}) {
  return (
    TS(CS.variant, e, wS.variant),
    TS(CS.size, t, wS.size),
    q(`relative isolate min-w-0 font-medium`)
  );
}
function DS({ variant: e = wS.variant, size: t = wS.size, overflowing: n }) {
  let r = e === `segmented`,
    i = e === `underline`,
    a = t === `sm`;
  return q(
    `relative flex min-w-0 shrink items-stretch`,
    r &&
      `areia-tabs-list overflow-x-auto rounded-lg bg-areia-surface-muted px-0.5 ring ring-areia-border/70 [--scroll-fade-width:3rem] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`,
    r && (a ? `h-6.5 rounded-md` : `h-9`),
    i && `gap-4 border-b border-areia-border pb-2`,
    i && (a ? `h-6.5` : `h-7.5`),
    n && `cursor-grab active:cursor-grabbing`,
  );
}
function OS({ variant: e = wS.variant, size: t = wS.size, overflowing: n }) {
  let r = e === `segmented`,
    i = e === `underline`,
    a = t === `sm`;
  return q(
    `relative z-2 flex items-center rounded bg-transparent whitespace-nowrap`,
    `focus:outline-none focus:ring-areia-ring/50 focus-visible:ring-2 focus-visible:ring-areia-ring`,
    `disabled:pointer-events-none disabled:opacity-50`,
    n ? `cursor-grab active:cursor-grabbing` : `cursor-pointer`,
    a ? `text-xs` : `text-base`,
    r &&
      `my-0.5 rounded-md text-areia-subtle hover:text-areia-default data-[state=active]:text-areia-default focus-visible:ring-inset`,
    r && (a ? `px-2` : `px-2.5`),
    i &&
      `text-areia-subtle hover:bg-areia-control-hover hover:text-areia-default data-[state=active]:font-medium data-[state=active]:text-areia-default data-[state=active]:hover:bg-areia-control-hover`,
    i && (a ? `px-1.5 py-2.5` : `px-2 py-3`),
  );
}
function kS({ variant: e = wS.variant, size: t = wS.size } = {}) {
  let n = e === `segmented`,
    r = e === `underline`;
  return q(
    `absolute left-0 z-1`,
    `w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] transition-all duration-200`,
    n &&
      q(
        `top-[var(--active-tab-top)] h-[var(--active-tab-height)] bg-areia-background shadow-sm ring ring-areia-border`,
        t === `sm` ? `rounded` : `rounded-md`,
      ),
    r && `bottom-0 h-0.5 bg-areia-primary`,
  );
}
function AS(e) {
  let {
    value: t,
    label: n,
    children: r,
    content: i,
    contentClass: a,
    contentClassName: o,
    active: s,
    disabled: c,
    class: l,
    className: u,
    variant: d = wS.variant,
    size: f = wS.size,
    ...p
  } = e;
  return U`<button
    type="button"
    data-slot="tabs-trigger"
    class="${q(OS({ variant: d, size: f }), l, u)}"
    ${W(J({ ...p, "data-value": t, "data-disabled": c, "data-state": s === void 0 ? void 0 : s ? `active` : `inactive`, "aria-selected": s, tabindex: s ? 0 : s === !1 ? -1 : void 0, disabled: c }))}
  >
    ${r ?? n ?? t}
  </button>`;
}
function jS(e = {}) {
  let { variant: t = wS.variant, size: n = wS.size, class: r, className: i, ...a } = e;
  return U`<div
    data-slot="tabs-indicator"
    class="${q(kS({ variant: t, size: n }), r, i)}"
    ${W(J(a))}
  ></div>`;
}
function MS(e) {
  let { side: t, class: n, className: r, ...i } = e;
  return U`<div
    aria-hidden="true"
    data-slot="tabs-scroll-fade"
    data-side="${t}"
    hidden
    class="${q(`pointer-events-none sticky inset-y-0 z-3 w-[var(--scroll-fade-width)] flex-none self-stretch opacity-0 transition-opacity duration-150`, t === `left` && `-left-0.5 -mr-[var(--scroll-fade-width)] bg-gradient-to-r from-areia-surface-muted to-transparent`, t === `right` && `-right-0.5 -ml-[var(--scroll-fade-width)] bg-gradient-to-l from-areia-surface-muted to-transparent`, n, r)}"
    ${W(J(i))}
  ></div>`;
}
function NS(e = {}) {
  let {
    children: t,
    variant: n = wS.variant,
    size: r = wS.size,
    class: i,
    className: a,
    indicatorClass: o,
    indicatorClassName: s,
    overflowing: c,
    ...l
  } = e;
  return U`<div
    data-slot="tabs-list"
    class="${q(DS({ variant: n, size: r, overflowing: c }), i, a)}"
    ${W(J(l))}
  >
    ${n === `segmented` ? MS({ side: `left` }) : ``} ${t}
    ${jS({ variant: n, size: r, class: q(o, s) })}
    ${n === `segmented` ? MS({ side: `right` }) : ``}
  </div>`;
}
function PS(e) {
  let { value: t, children: n, active: r, class: i, className: a, ...o } = e;
  return U`<div
    data-slot="tabs-content"
    data-value="${t}"
    class="${q(`mt-4 outline-none`, i, a)}"
    ${W(J({ ...o, "data-state": r === void 0 ? void 0 : r ? `active` : `inactive`, hidden: r === !1 }))}
  >
    ${n}
  </div>`;
}
function FS(e = {}) {
  let { binds: t, attrs: n } = Nh(e),
    {
      tabs: r = [],
      children: i,
      value: a,
      selectedValue: o,
      defaultValue: s,
      activationMode: c,
      activateOnFocus: l,
      class: u,
      className: d,
      listClass: f,
      listClassName: p,
      contentClass: m,
      contentClassName: h,
      indicatorClass: g,
      indicatorClassName: _,
      onValueChange: v,
      variant: y = wS.variant,
      size: b = wS.size,
      ...x
    } = n,
    S = $(i),
    C = Wm(i);
  if (r.length === 0 && !C) return ``;
  let w = qh(e, a ?? o ?? s),
    T = (typeof w == `string` ? w : void 0) ?? (Array.isArray(w) ? w[0] : void 0) ?? r[0]?.value,
    E = r.map((e) => AS({ ...e, variant: y, size: b, active: e.value === T })),
    D = r
      .filter((e) => e.content != null)
      .map((e) =>
        PS({
          value: e.value,
          active: e.value === T,
          class: q(m, h, e.contentClass, e.contentClassName),
          children: e.content,
        }),
      ),
    O = U`${
      C
        ? S
        : U`${NS({ children: E, variant: y, size: b, class: q(f, p), indicatorClass: q(g, _) })}
      ${D}`
    }`;
  return Rh(
    `div`,
    t,
    ` data-slot="tabs" data-tabs-variant="${y}" data-tabs-size="${b}" class="${q(ES({ variant: y, size: b }), u, d)}"${J({ ...x, "data-default-value": T })}`,
    O,
  );
}
function IS(e) {
  let t = e.querySelector(`[data-slot="tabs-list"]`);
  if (!t) return () => {};
  let n = null,
    r = 0,
    i = 0,
    a = !1,
    o = !1,
    s = t.querySelector(`[data-slot="tabs-scroll-fade"][data-side="left"]`),
    c = t.querySelector(`[data-slot="tabs-scroll-fade"][data-side="right"]`),
    l = (e, t) => {
      e &&
        ((e.hidden = !t),
        e.classList.toggle(`opacity-100`, t),
        e.classList.toggle(`opacity-0`, !t));
    },
    u = () => {
      let e = t.scrollWidth > t.clientWidth,
        n = t.scrollWidth - t.clientWidth,
        r = Math.max(0, Math.min(t.scrollLeft, n));
      (t.toggleAttribute(`data-overflowing`, e),
        t.classList.toggle(`cursor-grab`, e),
        t.classList.toggle(`active:cursor-grabbing`, e));
      for (let n of t.querySelectorAll(`[data-slot="tabs-trigger"]`))
        (n.classList.toggle(`cursor-grab`, e), n.classList.toggle(`active:cursor-grabbing`, e));
      (l(s, e && r > 1), l(c, e && r < n - 1));
    },
    d = (e) => {
      t.hasAttribute(`data-overflowing`) &&
        e.pointerType === `mouse` &&
        e.button === 0 &&
        ((n = e.pointerId), (r = e.clientX), (i = t.scrollLeft), (a = !1), (o = !1));
    },
    f = (e) => {
      if (n !== e.pointerId) return;
      let s = e.clientX - r;
      if (!a) {
        if (Math.abs(s) <= 3) return;
        ((a = !0), (o = !0), t.setPointerCapture(e.pointerId));
      }
      (e.preventDefault(), (t.scrollLeft = i - s));
    },
    p = (e) => {
      n === e.pointerId &&
        ((n = null),
        (a = !1),
        t.hasPointerCapture(e.pointerId) && t.releasePointerCapture(e.pointerId),
        o &&
          window.setTimeout(() => {
            o = !1;
          }, 0));
    },
    m = (e) => {
      o &&= (e.preventDefault(), e.stopPropagation(), !1);
    },
    h = new ResizeObserver(u);
  return (
    h.observe(t),
    u(),
    t.addEventListener(`pointerdown`, d, { capture: !0 }),
    t.addEventListener(`pointermove`, f, { capture: !0 }),
    t.addEventListener(`pointerup`, p, { capture: !0 }),
    t.addEventListener(`pointercancel`, p, { capture: !0 }),
    t.addEventListener(`click`, m, { capture: !0 }),
    t.addEventListener(`scroll`, u, { passive: !0 }),
    () => {
      (h.disconnect(),
        t.removeEventListener(`pointerdown`, d, { capture: !0 }),
        t.removeEventListener(`pointermove`, f, { capture: !0 }),
        t.removeEventListener(`pointerup`, p, { capture: !0 }),
        t.removeEventListener(`pointercancel`, p, { capture: !0 }),
        t.removeEventListener(`click`, m, { capture: !0 }),
        t.removeEventListener(`scroll`, u));
    }
  );
}
var LS = new WeakMap();
function RS(e) {
  return e.matches(`[data-slot="tabs"]`) ? e : e.querySelector(`[data-slot="tabs"]`);
}
var zS = nn
  .input()
  .onMount(({ host: e, input: t }) => {
    let n = RS(e);
    if (!n) return;
    let r = null,
      i = qh(t, t.value ?? t.selectedValue ?? t.defaultValue) ?? void 0,
      a = typeof i == `string` ? i : Array.isArray(i) ? i[0] : void 0;
    bg(n, mg);
    let o = vf.createTabs(n, {
        defaultValue: a,
        activationMode: t.activationMode ?? (t.activateOnFocus ? `auto` : `manual`),
        onValueChange: (e) => {
          (r?.onUserChange(e), t.onValueChange?.(e));
        },
      }),
      s = IS(n);
    return (
      (r = Jh(
        t,
        {
          getValue: () => o.value,
          setValue: (e) => {
            typeof e == `string` ? o.select(e) : Array.isArray(e) && e[0] && o.select(e[0]);
          },
        },
        `single`,
      )),
      r?.applyFromSignal(),
      LS.set(e, { controller: o, groupSync: r }),
      () => {
        (LS.delete(e), s(), o.destroy());
      }
    );
  })
  .effect(({ host: e, input: t }) => {
    Bh(t);
    let n = LS.get(e);
    if (!n) return;
    let r = RS(e);
    (r && bg(r, mg), n.controller.updateIndicator(), n.groupSync?.applyFromSignal());
  })
  .render(({ input: e }) => FS(e));
Object.assign(zS, {
  Root: zS,
  Static: FS,
  List: NS,
  Trigger: AS,
  Content: PS,
  Indicator: jS,
  ScrollFade: MS,
});
var BS = {
    size: {
      xs: {
        classes: `text-xs rounded-sm px-1.5 py-1`,
        description: `Extra small textarea for compact UIs`,
      },
      sm: {
        classes: `text-xs rounded-md px-2 py-1.5`,
        description: `Small textarea for secondary fields`,
      },
      base: { classes: `text-base rounded-lg px-3 py-2`, description: `Default textarea size` },
      lg: {
        classes: `text-base rounded-lg px-4 py-2.5`,
        description: `Large textarea for prominent fields`,
      },
    },
    variant: {
      default: {
        classes: `focus:ring-areia-ring/50 focus:ring-[1.5px]`,
        description: `Default textarea appearance`,
      },
      error: {
        classes: `!ring-areia-destructive focus:ring-areia-destructive/50 focus:ring-[1.5px]`,
        description: `Error state for validation failures`,
      },
    },
  },
  VS = { size: `base`, variant: `default` };
function HS(e, t, n) {
  return e[t ?? n] ?? e[n];
}
function US({ variant: e = VS.variant, size: t = VS.size, focusIndicator: n = !1 } = {}) {
  return q(
    `w-full border-0 bg-areia-control-background text-areia-default ring ring-areia-divider outline-none focus:outline-none`,
    `resize-vertical`,
    `placeholder:text-areia-placeholder disabled:cursor-not-allowed disabled:text-areia-disabled disabled:opacity-50`,
    HS(BS.size, t, VS.size).classes,
    HS(BS.variant, e, VS.variant).classes,
    n &&
      (e === `error`
        ? `focus:ring-areia-destructive/50 focus:ring-[1.5px]`
        : `focus:ring-areia-ring/50 focus:ring-[1.5px]`),
  );
}
function WS(e) {
  return e && typeof e == `object` && `message` in e ? e.message : e;
}
function GS(e) {
  let { binds: t, attrs: n } = Nh(e),
    {
      class: r,
      className: i,
      error: a,
      label: o,
      labelTooltip: s,
      description: c,
      size: l = VS.size,
      variant: u,
      rows: d = 3,
      value: f,
      defaultValue: p,
      children: m,
      ...h
    } = n,
    g = u ?? (a ? `error` : VS.variant),
    _ = t[`bind:value`] != null,
    v = _ ? `` : (f ?? p ?? m ?? ``),
    y = h;
  return Rh(
    `textarea`,
    t,
    ` class="${q(US({ size: l, variant: g, focusIndicator: !0 }), r, i)}" rows="${d}"${J({ ...y, ...(_ ? { value: void 0, defaultValue: void 0 } : {}), "aria-invalid": a ? `true` : y[`aria-invalid`], "aria-describedby": typeof y[`aria-describedby`] == `string` ? y[`aria-describedby`] : void 0 })}`,
    v,
  );
}
function KS(e = {}) {
  let { label: t, labelTooltip: n, description: r, error: i, ...a } = e,
    o = WS(i),
    s = t != null || r != null || o != null,
    c = typeof a.id == `string` && a.id ? a.id : s ? Rg(`areia-textarea`) : void 0,
    l = GS({
      ...a,
      ...(c ? { id: c } : {}),
      error: i,
      "data-slot": a[`data-slot`] ?? `field-control`,
    });
  return s
    ? Xg.Static({ label: t, description: r, error: o, invalid: o != null, htmlFor: c, children: l })
    : GS(e);
}
Object.assign(KS, { Static: GS });
var qS = {
    variant: {
      default: {
        classes: `bg-areia-control-background text-areia-control-foreground ring ring-areia-control-border hover:bg-areia-control-hover data-[state=on]:bg-areia-control-hover data-[state=on]:ring-areia-control-active`,
      },
      outline: {
        classes: `border border-areia-border bg-transparent hover:bg-areia-control-hover data-[state=on]:bg-areia-control-hover`,
      },
    },
    size: {
      sm: { classes: `h-8 gap-1 rounded-md px-2.5 text-xs` },
      default: { classes: `h-9 gap-1.5 rounded-lg px-3 text-base` },
      lg: { classes: `h-10 gap-2 rounded-lg px-4 text-base` },
    },
  },
  JS = { variant: `default`, size: `default` };
function YS({ variant: e = JS.variant, size: t = JS.size } = {}) {
  return q(
    `inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors outline-none`,
    `focus-visible:ring-2 focus-visible:ring-areia-ring focus-visible:ring-offset-2`,
    `disabled:pointer-events-none disabled:opacity-50`,
    qS.variant[e].classes,
    qS.size[t].classes,
  );
}
function XS(e) {
  return J({
    "data-default-pressed": e.defaultPressed ? `` : void 0,
    "data-disabled": e.disabled ? `true` : void 0,
  });
}
function ZS(e = {}) {
  let {
    defaultPressed: t,
    disabled: n,
    variant: r = JS.variant,
    size: i = JS.size,
    class: a,
    className: o,
    children: s,
    onPressedChange: c,
    ...l
  } = e;
  return U`<button
    type="button"
    data-slot="toggle"
    class="${q(YS({ variant: r, size: i }), a, o)}"
    ${W(XS({ defaultPressed: t, disabled: n }))}
    ${W(J({ ...l, disabled: n || void 0 }))}
  >
    ${$(s)}
  </button>`;
}
var QS = nn
  .input()
  .onMount(({ host: e, input: t }) => {
    let n = e.matches(`[data-slot="toggle"]`) ? e : e.querySelector(`[data-slot="toggle"]`);
    if (!n) return;
    bg(n);
    let r = Ef.createToggle(n, {
      defaultPressed: t.defaultPressed,
      disabled: t.disabled,
      onPressedChange: t.onPressedChange,
    });
    return () => r.destroy();
  })
  .render(({ input: e }) => ZS(e));
Object.assign(QS, { Root: QS, Static: ZS });
function $S() {
  return q(
    `flex w-fit items-stretch overflow-hidden rounded-lg border border-areia-control-border *:focus-visible:relative *:focus-visible:z-10`,
    `[&>button]:rounded-none [&>button]:shadow-none [&>button]:ring-0 [&>button]:border-0`,
  );
}
function eC(e = {}) {
  let {
    value: t,
    children: n,
    disabled: r,
    variant: i = `default`,
    size: a = `default`,
    class: o,
    className: s,
    ...c
  } = e;
  return U`<button
    type="button"
    data-slot="toggle-group-item"
    data-value="${t}"
    class="${q(YS({ variant: i, size: a }), o, s)}"
    ${W(J({ ...c, disabled: r || void 0 }))}
  >
    ${n}
  </button>`;
}
function tC(e = {}) {
  let { binds: t, attrs: n } = Nh(e),
    {
      children: r,
      class: i,
      className: a,
      type: o = `single`,
      defaultValue: s,
      disabled: c,
      orientation: l = `horizontal`,
      loop: u,
      variant: d,
      size: f,
      onValueChange: p,
      ...m
    } = n,
    h = qh(e, s),
    g = h == null ? void 0 : Array.isArray(h) ? h.join(` `) : String(h);
  return Rh(
    `div`,
    t,
    ` data-slot="toggle-group" data-type="${o}" class="${q($S(), i, a)}"${J({ ...m, "data-default-value": g, "data-multiple": o === `multiple` ? `` : void 0, "data-orientation": l, "data-loop": u, "data-disabled": c })}`,
    $(r),
  );
}
var nC = new WeakMap();
function rC(e) {
  return e.matches(`[data-slot="toggle-group"]`)
    ? e
    : e.querySelector(`[data-slot="toggle-group"]`);
}
var iC = nn
  .input()
  .onMount(({ host: e, input: t }) => {
    let n = rC(e);
    if (!n) return;
    let r = t.type === `multiple` ? `multiple` : `single`,
      i = null;
    bg(n);
    let a = jf.createToggleGroup(n, {
      defaultValue: qh(t, t.defaultValue) ?? void 0,
      multiple: t.type === `multiple`,
      orientation: t.orientation,
      loop: t.loop,
      disabled: t.disabled,
      onValueChange: (e) => {
        (i?.onUserChange(e), t.onValueChange?.(e));
      },
    });
    return (
      (i = Jh(t, { getValue: () => a.value, setValue: (e) => a.setValue(e ?? []) }, r)),
      i?.applyFromSignal(),
      nC.set(e, { controller: a, groupSync: i }),
      () => {
        (nC.delete(e), a.destroy());
      }
    );
  })
  .effect(({ host: e, input: t }) => {
    Bh(t);
    let n = nC.get(e);
    n && n.groupSync?.applyFromSignal();
  })
  .render(({ input: e }) => tC(e));
function aC(e = {}) {
  let { class: t, className: n, ...r } = e;
  return U`<div
    data-slot="toggle-group-separator"
    class="${q(`relative shrink-0 self-stretch bg-areia-border`, t, n)}"
    ${W(J(r))}
  ></div>`;
}
Object.assign(iC, { Root: iC, Static: tC, Item: eC, Separator: aC });
var oC = `__areiaResizablePart`,
  sC = Symbol.for(`ilha.renderPart`);
function cC(e) {
  let t = dC(e);
  return t && typeof t == `object` && t && `value` in t ? String(t.value) : String(t ?? ``);
}
function lC(e, t) {
  let n = { [oC]: e, [sC]: !0, input: t };
  return (Object.defineProperty(n, "toString", { value: () => cC(n), enumerable: !1 }), n);
}
function uC(e) {
  if (typeof e != `object` || !e) return !1;
  let t = e[oC];
  return t === `panel` || t === `handle`;
}
function dC(e) {
  return e[oC] === `panel` ? hC(e.input) : gC(e.input);
}
function fC(e) {
  if (e == null || e === !1) return ``;
  if (Array.isArray(e)) return e.map(fC);
  if (uC(e)) return dC(e);
  if (typeof e == `object` && `value` in e && typeof e.value == `string`) {
    let t = Rm(e.value);
    return t.includes(`data-slot="resizable-panel"`) || t.includes(`data-slot="resizable-handle"`)
      ? W(t)
      : $(t);
  }
  return typeof e == `string` ? $(e) : e;
}
function pC(e) {
  let t = Array.isArray(e) ? [...e] : e == null || e === !1 ? [] : [e];
  if (t.length === 0) return e;
  let n = [];
  for (let e = 0; e < t.length; e++) {
    let r = t[e];
    uC(r) && r[oC] === `panel` && n.push(e);
  }
  if (n.length === 0) return e;
  let r = 0,
    i = 0,
    a = n.map((e) => {
      let n = t[e].input.defaultSize;
      if (typeof n == `number` && Number.isFinite(n)) return ((i += 1), (r += n), n);
    }),
    o = n.length - i;
  if (o === 0) return e;
  i > 0 &&
    typeof process < `u` &&
    console.warn(
      `[areia:Resizable] Some panels omit defaultSize while others set it. defaultSize is a percentage of the group (sum ≈ 100). Missing siblings will share the remaining space in markup; prefer explicit sizes on every panel.`,
    );
  let s = Math.max(0, 100 - r) / o;
  for (let e = 0; e < n.length; e++) {
    if (a[e] != null) continue;
    let r = n[e],
      i = t[r];
    t[r] = lC(`panel`, { ...i.input, defaultSize: s });
  }
  return t;
}
function mC(e) {
  return J({
    "data-default-size": e.defaultSize,
    "data-min-size": e.minSize,
    "data-max-size": e.maxSize,
    "data-collapsed-size": e.collapsedSize,
    "data-collapsible": e.collapsible ?? void 0,
  });
}
function hC(e = {}) {
  let {
      children: t,
      defaultSize: n,
      minSize: r,
      maxSize: i,
      collapsedSize: a,
      collapsible: o,
      class: s,
      className: c,
      style: l,
      ...u
    } = e,
    d = u[`data-morph-preserve`];
  delete u[`data-morph-preserve`];
  let f = [`flex-basis:0`, `flex-shrink:1`, `flex-grow:${n ?? 1}`, `overflow:hidden`, l]
    .filter(Boolean)
    .join(`;`);
  return U`<div
    data-slot="resizable-panel"
    class="${q(`min-w-0`, s, c)}"
    ${W(mC({ defaultSize: n, minSize: r, maxSize: i, collapsedSize: a, collapsible: o }))}
    data-morph-preserve="${gg(d, mg)}"
    style="${f}"
    ${W(J(u))}
  >
    ${fC(t)}
  </div>`;
}
function gC(e = {}) {
  let { withHandle: t, children: n, class: r, className: i, ...a } = e,
    o = a[`data-morph-preserve`];
  return (
    delete a[`data-morph-preserve`],
    U`<div
    data-slot="resizable-handle"
    class="${q(`relative flex w-px cursor-col-resize items-center justify-center bg-areia-border`, `after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2`, `focus-visible:ring-1 focus-visible:ring-areia-ring focus-visible:outline-hidden`, `data-[direction=vertical]:h-px data-[direction=vertical]:w-full data-[direction=vertical]:cursor-row-resize data-[direction=vertical]:after:inset-x-0 data-[direction=vertical]:after:top-1/2 data-[direction=vertical]:after:left-auto data-[direction=vertical]:after:h-1 data-[direction=vertical]:after:w-full data-[direction=vertical]:after:-translate-y-1/2 data-[direction=vertical]:after:translate-x-0`, `group-data-[direction=vertical]/resizable:h-px group-data-[direction=vertical]/resizable:w-full group-data-[direction=vertical]/resizable:cursor-row-resize group-data-[direction=vertical]/resizable:after:inset-x-0 group-data-[direction=vertical]/resizable:after:top-1/2 group-data-[direction=vertical]/resizable:after:left-auto group-data-[direction=vertical]/resizable:after:h-1 group-data-[direction=vertical]/resizable:after:w-full group-data-[direction=vertical]/resizable:after:-translate-y-1/2 group-data-[direction=vertical]/resizable:after:translate-x-0`, `[&[data-direction=vertical]>div]:h-1 [&[data-direction=vertical]>div]:w-6`, `group-data-[direction=vertical]/resizable:[&>div]:h-1 group-data-[direction=vertical]/resizable:[&>div]:w-6`, r, i)}"
    data-morph-preserve="${gg(o, mg)}"
    ${W(J(a))}
  >
    ${t ? U`<div class="z-10 h-6 w-1 shrink-0 rounded-lg bg-areia-border"></div>` : ``}
    ${fC(n)}
  </div>`
  );
}
function _C(e = {}) {
  return lC(`panel`, e);
}
function vC(e = {}) {
  return lC(`handle`, e);
}
function yC(e = {}) {
  return {
    direction: e.direction,
    keyboardResizeBy: e.keyboardResizeBy,
    onLayoutChange: e.onLayoutChange,
  };
}
function bC(e) {
  let t = new Set();
  if (e instanceof HTMLElement) {
    e.matches(`[data-slot="resizable"]`) && t.add(e);
    let n = e.closest(`[data-slot="resizable"]`);
    n instanceof HTMLElement && t.add(n);
  }
  return (
    e.querySelectorAll?.(`[data-slot="resizable"]`).forEach((e) => {
      e instanceof HTMLElement && t.add(e);
    }),
    [...t]
  );
}
function xC(e) {
  bg(e, mg);
}
function SC(e) {
  e.setLayout(e.layout);
}
function CC(e, t = {}) {
  let n = yC(t),
    r = [];
  for (let t of bC(e))
    if (t.querySelectorAll(`[data-slot="resizable-panel"]`).length !== 0) {
      if (fd.hasBinding(t)) {
        let e = fd.getBinding(t);
        e && (xC(t), SC(e), r.push(e));
        continue;
      }
      try {
        let e = fd.reconnectResizable(t, n);
        (xC(t), r.push(e));
      } catch {}
    }
  if (r.length !== 0) return () => r.forEach((e) => e.destroy());
}
function wC(e, t = {}) {
  queueMicrotask(() => CC(e, t));
}
function TC(e = {}) {
  let {
      direction: t,
      keyboardResizeBy: n,
      class: r,
      className: i,
      children: a,
      onLayoutChange: o,
      ...s
    } = e,
    c = s[`data-morph-preserve`];
  return (
    delete s[`data-morph-preserve`],
    U`<div
    data-slot="resizable"
    class="${q(`group/resizable flex h-full w-full overflow-hidden data-[direction=vertical]:flex-col`, r, i)}"
    data-morph-preserve="${gg(c, mg)}"
    ${W(J({ "data-direction": t, "data-keyboard-resize-by": n, ...s }))}
  >
    ${fC(pC(a))}
  </div>`
  );
}
var EC = nn
  .input()
  .onMount(({ host: e, input: t }) => {
    let n = !1,
      r;
    return (
      queueMicrotask(() => {
        n || (r = CC(e, t));
      }),
      () => {
        ((n = !0), r?.());
      }
    );
  })
  .effect(({ host: e, input: t }) => {
    wC(e, t);
  })
  .render(({ input: e }) => TC(e));
function DC(e = document) {
  wC(e);
}
(typeof document < `u` &&
  (queueMicrotask(() => DC()),
  document.addEventListener(`DOMContentLoaded`, () => DC(), { once: !0 }),
  new MutationObserver((e) => {
    for (let t of e)
      t.addedNodes.forEach((e) => {
        e instanceof Element && DC(e);
      });
  }).observe(document.documentElement, { childList: !0, subtree: !0 })),
  Object.assign(TC, { Root: EC, Static: TC, Panel: _C, Handle: vC }));
var OC = o((e) => {
    var t = Symbol.for(`react.transitional.element`),
      n = Symbol.for(`react.portal`),
      r = Symbol.for(`react.fragment`),
      i = Symbol.for(`react.strict_mode`),
      a = Symbol.for(`react.profiler`),
      o = Symbol.for(`react.consumer`),
      s = Symbol.for(`react.context`),
      c = Symbol.for(`react.forward_ref`),
      l = Symbol.for(`react.suspense`),
      u = Symbol.for(`react.memo`),
      d = Symbol.for(`react.lazy`),
      f = Symbol.for(`react.activity`),
      p = Symbol.iterator;
    function m(e) {
      return typeof e != `object` || !e
        ? null
        : ((e = (p && e[p]) || e[`@@iterator`]), typeof e == `function` ? e : null);
    }
    var h = {
        isMounted: function () {
          return !1;
        },
        enqueueForceUpdate: function () {},
        enqueueReplaceState: function () {},
        enqueueSetState: function () {},
      },
      g = Object.assign,
      _ = {};
    function v(e, t, n) {
      ((this.props = e), (this.context = t), (this.refs = _), (this.updater = n || h));
    }
    ((v.prototype.isReactComponent = {}),
      (v.prototype.setState = function (e, t) {
        if (typeof e != `object` && typeof e != `function` && e != null)
          throw Error(
            `takes an object of state variables to update or a function which returns an object of state variables.`,
          );
        this.updater.enqueueSetState(this, e, t, `setState`);
      }),
      (v.prototype.forceUpdate = function (e) {
        this.updater.enqueueForceUpdate(this, e, `forceUpdate`);
      }));
    function y() {}
    y.prototype = v.prototype;
    function b(e, t, n) {
      ((this.props = e), (this.context = t), (this.refs = _), (this.updater = n || h));
    }
    var x = (b.prototype = new y());
    ((x.constructor = b), g(x, v.prototype), (x.isPureReactComponent = !0));
    var S = Array.isArray;
    function C() {}
    var w = { H: null, A: null, T: null, S: null },
      T = Object.prototype.hasOwnProperty;
    function E(e, n, r) {
      var i = r.ref;
      return { $$typeof: t, type: e, key: n, ref: i === void 0 ? null : i, props: r };
    }
    function D(e, t) {
      return E(e.type, t, e.props);
    }
    function O(e) {
      return typeof e == `object` && !!e && e.$$typeof === t;
    }
    function k(e) {
      var t = { "=": `=0`, ":": `=2` };
      return (
        `$` +
        e.replace(/[=:]/g, function (e) {
          return t[e];
        })
      );
    }
    var A = /\/+/g;
    function j(e, t) {
      return typeof e == `object` && e && e.key != null ? k(`` + e.key) : t.toString(36);
    }
    function M(e) {
      switch (e.status) {
        case `fulfilled`:
          return e.value;
        case `rejected`:
          throw e.reason;
        default:
          switch (
            (typeof e.status == `string`
              ? e.then(C, C)
              : ((e.status = `pending`),
                e.then(
                  function (t) {
                    e.status === `pending` && ((e.status = `fulfilled`), (e.value = t));
                  },
                  function (t) {
                    e.status === `pending` && ((e.status = `rejected`), (e.reason = t));
                  },
                )),
            e.status)
          ) {
            case `fulfilled`:
              return e.value;
            case `rejected`:
              throw e.reason;
          }
      }
      throw e;
    }
    function N(e, r, i, a, o) {
      var s = typeof e;
      (s === `undefined` || s === `boolean`) && (e = null);
      var c = !1;
      if (e === null) c = !0;
      else
        switch (s) {
          case `bigint`:
          case `string`:
          case `number`:
            c = !0;
            break;
          case `object`:
            switch (e.$$typeof) {
              case t:
              case n:
                c = !0;
                break;
              case d:
                return ((c = e._init), N(c(e._payload), r, i, a, o));
            }
        }
      if (c)
        return (
          (o = o(e)),
          (c = a === `` ? `.` + j(e, 0) : a),
          S(o)
            ? ((i = ``),
              c != null && (i = c.replace(A, `$&/`) + `/`),
              N(o, r, i, ``, function (e) {
                return e;
              }))
            : o != null &&
              (O(o) &&
                (o = D(
                  o,
                  i +
                    (o.key == null || (e && e.key === o.key)
                      ? ``
                      : (`` + o.key).replace(A, `$&/`) + `/`) +
                    c,
                )),
              r.push(o)),
          1
        );
      c = 0;
      var l = a === `` ? `.` : a + `:`;
      if (S(e))
        for (var u = 0; u < e.length; u++) ((a = e[u]), (s = l + j(a, u)), (c += N(a, r, i, s, o)));
      else if (((u = m(e)), typeof u == `function`))
        for (e = u.call(e), u = 0; !(a = e.next()).done; )
          ((a = a.value), (s = l + j(a, u++)), (c += N(a, r, i, s, o)));
      else if (s === `object`) {
        if (typeof e.then == `function`) return N(M(e), r, i, a, o);
        throw (
          (r = String(e)),
          Error(
            `Objects are not valid as a React child (found: ` +
              (r === `[object Object]`
                ? `object with keys {` + Object.keys(e).join(`, `) + `}`
                : r) +
              `). If you meant to render a collection of children, use an array instead.`,
          )
        );
      }
      return c;
    }
    function ee(e, t, n) {
      if (e == null) return e;
      var r = [],
        i = 0;
      return (
        N(e, r, ``, ``, function (e) {
          return t.call(n, e, i++);
        }),
        r
      );
    }
    function P(e) {
      if (e._status === -1) {
        var t = e._result;
        ((t = t()),
          t.then(
            function (t) {
              (e._status === 0 || e._status === -1) && ((e._status = 1), (e._result = t));
            },
            function (t) {
              (e._status === 0 || e._status === -1) && ((e._status = 2), (e._result = t));
            },
          ),
          e._status === -1 && ((e._status = 0), (e._result = t)));
      }
      if (e._status === 1) return e._result.default;
      throw e._result;
    }
    var F =
        typeof reportError == `function`
          ? reportError
          : function (e) {
              if (typeof window == `object` && typeof window.ErrorEvent == `function`) {
                var t = new window.ErrorEvent(`error`, {
                  bubbles: !0,
                  cancelable: !0,
                  message:
                    typeof e == `object` && e && typeof e.message == `string`
                      ? String(e.message)
                      : String(e),
                  error: e,
                });
                if (!window.dispatchEvent(t)) return;
              } else if (typeof process == `object` && typeof process.emit == `function`) {
                process.emit(`uncaughtException`, e);
                return;
              }
              console.error(e);
            },
      I = {
        map: ee,
        forEach: function (e, t, n) {
          ee(
            e,
            function () {
              t.apply(this, arguments);
            },
            n,
          );
        },
        count: function (e) {
          var t = 0;
          return (
            ee(e, function () {
              t++;
            }),
            t
          );
        },
        toArray: function (e) {
          return (
            ee(e, function (e) {
              return e;
            }) || []
          );
        },
        only: function (e) {
          if (!O(e))
            throw Error(`React.Children.only expected to receive a single React element child.`);
          return e;
        },
      };
    ((e.Activity = f),
      (e.Children = I),
      (e.Component = v),
      (e.Fragment = r),
      (e.Profiler = a),
      (e.PureComponent = b),
      (e.StrictMode = i),
      (e.Suspense = l),
      (e.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = w),
      (e.__COMPILER_RUNTIME = {
        __proto__: null,
        c: function (e) {
          return w.H.useMemoCache(e);
        },
      }),
      (e.cache = function (e) {
        return function () {
          return e.apply(null, arguments);
        };
      }),
      (e.cacheSignal = function () {
        return null;
      }),
      (e.cloneElement = function (e, t, n) {
        if (e == null)
          throw Error(`The argument must be a React element, but you passed ` + e + `.`);
        var r = g({}, e.props),
          i = e.key;
        if (t != null)
          for (a in (t.key !== void 0 && (i = `` + t.key), t))
            !T.call(t, a) ||
              a === `key` ||
              a === `__self` ||
              a === `__source` ||
              (a === `ref` && t.ref === void 0) ||
              (r[a] = t[a]);
        var a = arguments.length - 2;
        if (a === 1) r.children = n;
        else if (1 < a) {
          for (var o = Array(a), s = 0; s < a; s++) o[s] = arguments[s + 2];
          r.children = o;
        }
        return E(e.type, i, r);
      }),
      (e.createContext = function (e) {
        return (
          (e = {
            $$typeof: s,
            _currentValue: e,
            _currentValue2: e,
            _threadCount: 0,
            Provider: null,
            Consumer: null,
          }),
          (e.Provider = e),
          (e.Consumer = { $$typeof: o, _context: e }),
          e
        );
      }),
      (e.createElement = function (e, t, n) {
        var r,
          i = {},
          a = null;
        if (t != null)
          for (r in (t.key !== void 0 && (a = `` + t.key), t))
            T.call(t, r) && r !== `key` && r !== `__self` && r !== `__source` && (i[r] = t[r]);
        var o = arguments.length - 2;
        if (o === 1) i.children = n;
        else if (1 < o) {
          for (var s = Array(o), c = 0; c < o; c++) s[c] = arguments[c + 2];
          i.children = s;
        }
        if (e && e.defaultProps)
          for (r in ((o = e.defaultProps), o)) i[r] === void 0 && (i[r] = o[r]);
        return E(e, a, i);
      }),
      (e.createRef = function () {
        return { current: null };
      }),
      (e.forwardRef = function (e) {
        return { $$typeof: c, render: e };
      }),
      (e.isValidElement = O),
      (e.lazy = function (e) {
        return { $$typeof: d, _payload: { _status: -1, _result: e }, _init: P };
      }),
      (e.memo = function (e, t) {
        return { $$typeof: u, type: e, compare: t === void 0 ? null : t };
      }),
      (e.startTransition = function (e) {
        var t = w.T,
          n = {};
        w.T = n;
        try {
          var r = e(),
            i = w.S;
          (i !== null && i(n, r),
            typeof r == `object` && r && typeof r.then == `function` && r.then(C, F));
        } catch (e) {
          F(e);
        } finally {
          (t !== null && n.types !== null && (t.types = n.types), (w.T = t));
        }
      }),
      (e.unstable_useCacheRefresh = function () {
        return w.H.useCacheRefresh();
      }),
      (e.use = function (e) {
        return w.H.use(e);
      }),
      (e.useActionState = function (e, t, n) {
        return w.H.useActionState(e, t, n);
      }),
      (e.useCallback = function (e, t) {
        return w.H.useCallback(e, t);
      }),
      (e.useContext = function (e) {
        return w.H.useContext(e);
      }),
      (e.useDebugValue = function () {}),
      (e.useDeferredValue = function (e, t) {
        return w.H.useDeferredValue(e, t);
      }),
      (e.useEffect = function (e, t) {
        return w.H.useEffect(e, t);
      }),
      (e.useEffectEvent = function (e) {
        return w.H.useEffectEvent(e);
      }),
      (e.useId = function () {
        return w.H.useId();
      }),
      (e.useImperativeHandle = function (e, t, n) {
        return w.H.useImperativeHandle(e, t, n);
      }),
      (e.useInsertionEffect = function (e, t) {
        return w.H.useInsertionEffect(e, t);
      }),
      (e.useLayoutEffect = function (e, t) {
        return w.H.useLayoutEffect(e, t);
      }),
      (e.useMemo = function (e, t) {
        return w.H.useMemo(e, t);
      }),
      (e.useOptimistic = function (e, t) {
        return w.H.useOptimistic(e, t);
      }),
      (e.useReducer = function (e, t, n) {
        return w.H.useReducer(e, t, n);
      }),
      (e.useRef = function (e) {
        return w.H.useRef(e);
      }),
      (e.useState = function (e) {
        return w.H.useState(e);
      }),
      (e.useSyncExternalStore = function (e, t, n) {
        return w.H.useSyncExternalStore(e, t, n);
      }),
      (e.useTransition = function () {
        return w.H.useTransition();
      }),
      (e.version = `19.2.8`));
  }),
  kC = o((e, t) => {
    t.exports = OC();
  }),
  AC = o((e) => {
    kC().__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  }),
  jC = o((e, t) => {
    function n() {
      if (
        !(
          typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > `u` ||
          typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != `function`
        )
      )
        try {
          __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n);
        } catch (e) {
          console.error(e);
        }
    }
    (n(), (t.exports = AC()));
  }),
  MC = c(kC(), 1);
jC();
function NC(e) {
  if (!e || typeof document > `u`) return;
  let t = document.head || document.getElementsByTagName(`head`)[0],
    n = document.createElement(`style`);
  ((n.type = `text/css`),
    t.appendChild(n),
    n.styleSheet ? (n.styleSheet.cssText = e) : n.appendChild(document.createTextNode(e)));
}
Array(12).fill(0);
var PC = 1,
  FC = new (class {
    constructor() {
      ((this.subscribe = (e) => (
        this.subscribers.push(e),
        () => {
          let t = this.subscribers.indexOf(e);
          this.subscribers.splice(t, 1);
        }
      )),
        (this.publish = (e) => {
          this.subscribers.forEach((t) => t(e));
        }),
        (this.addToast = (e) => {
          (this.publish(e), (this.toasts = [...this.toasts, e]));
        }),
        (this.create = (e) => {
          let { message: t, ...n } = e,
            r = typeof e?.id == `number` || e.id?.length > 0 ? e.id : PC++,
            i = this.toasts.find((e) => e.id === r),
            a = e.dismissible === void 0 || e.dismissible;
          return (
            this.dismissedToasts.has(r) && this.dismissedToasts.delete(r),
            i
              ? (this.toasts = this.toasts.map((n) =>
                  n.id === r
                    ? (this.publish({ ...n, ...e, id: r, title: t }),
                      { ...n, ...e, id: r, dismissible: a, title: t })
                    : n,
                ))
              : this.addToast({ title: t, ...n, dismissible: a, id: r }),
            r
          );
        }),
        (this.dismiss = (e) => (
          e
            ? (this.dismissedToasts.add(e),
              requestAnimationFrame(() =>
                this.subscribers.forEach((t) => t({ id: e, dismiss: !0 })),
              ))
            : this.toasts.forEach((e) => {
                this.subscribers.forEach((t) => t({ id: e.id, dismiss: !0 }));
              }),
          e
        )),
        (this.message = (e, t) => this.create({ ...t, message: e })),
        (this.error = (e, t) => this.create({ ...t, message: e, type: `error` })),
        (this.success = (e, t) => this.create({ ...t, type: `success`, message: e })),
        (this.info = (e, t) => this.create({ ...t, type: `info`, message: e })),
        (this.warning = (e, t) => this.create({ ...t, type: `warning`, message: e })),
        (this.loading = (e, t) => this.create({ ...t, type: `loading`, message: e })),
        (this.promise = (e, t) => {
          if (!t) return;
          let n;
          t.loading !== void 0 &&
            (n = this.create({
              ...t,
              promise: e,
              type: `loading`,
              message: t.loading,
              description: typeof t.description == `function` ? void 0 : t.description,
            }));
          let r = Promise.resolve(e instanceof Function ? e() : e),
            i = n !== void 0,
            a,
            o = r
              .then(async (e) => {
                if (((a = [`resolve`, e]), MC.isValidElement(e)))
                  ((i = !1), this.create({ id: n, type: `default`, message: e }));
                else if (LC(e) && !e.ok) {
                  i = !1;
                  let r =
                      typeof t.error == `function`
                        ? await t.error(`HTTP error! status: ${e.status}`)
                        : t.error,
                    a =
                      typeof t.description == `function`
                        ? await t.description(`HTTP error! status: ${e.status}`)
                        : t.description,
                    o = typeof r == `object` && !MC.isValidElement(r) ? r : { message: r };
                  this.create({ id: n, type: `error`, description: a, ...o });
                } else if (e instanceof Error) {
                  i = !1;
                  let r = typeof t.error == `function` ? await t.error(e) : t.error,
                    a = typeof t.description == `function` ? await t.description(e) : t.description,
                    o = typeof r == `object` && !MC.isValidElement(r) ? r : { message: r };
                  this.create({ id: n, type: `error`, description: a, ...o });
                } else if (t.success !== void 0) {
                  i = !1;
                  let r = typeof t.success == `function` ? await t.success(e) : t.success,
                    a = typeof t.description == `function` ? await t.description(e) : t.description,
                    o = typeof r == `object` && !MC.isValidElement(r) ? r : { message: r };
                  this.create({ id: n, type: `success`, description: a, ...o });
                }
              })
              .catch(async (e) => {
                if (((a = [`reject`, e]), t.error !== void 0)) {
                  i = !1;
                  let r = typeof t.error == `function` ? await t.error(e) : t.error,
                    a = typeof t.description == `function` ? await t.description(e) : t.description,
                    o = typeof r == `object` && !MC.isValidElement(r) ? r : { message: r };
                  this.create({ id: n, type: `error`, description: a, ...o });
                }
              })
              .finally(() => {
                (i && (this.dismiss(n), (n = void 0)), t.finally == null || t.finally.call(t));
              }),
            s = () =>
              new Promise((e, t) => o.then(() => (a[0] === `reject` ? t(a[1]) : e(a[1]))).catch(t));
          return typeof n != `string` && typeof n != `number`
            ? { unwrap: s }
            : Object.assign(n, { unwrap: s });
        }),
        (this.custom = (e, t) => {
          let n = t?.id || PC++;
          return (this.create({ jsx: e(n), id: n, ...t }), n);
        }),
        (this.getActiveToasts = () => this.toasts.filter((e) => !this.dismissedToasts.has(e.id))),
        (this.subscribers = []),
        (this.toasts = []),
        (this.dismissedToasts = new Set()));
    }
  })(),
  IC = (e, t) => {
    let n = t?.id || PC++;
    return (FC.addToast({ title: e, ...t, id: n }), n);
  },
  LC = (e) =>
    e &&
    typeof e == `object` &&
    `ok` in e &&
    typeof e.ok == `boolean` &&
    `status` in e &&
    typeof e.status == `number`,
  RC = Object.assign(
    IC,
    {
      success: FC.success,
      info: FC.info,
      warning: FC.warning,
      error: FC.error,
      custom: FC.custom,
      message: FC.message,
      promise: FC.promise,
      dismiss: FC.dismiss,
      loading: FC.loading,
    },
    { getHistory: () => FC.toasts, getToasts: () => FC.getActiveToasts() },
  );
NC(
  `[data-sonner-toaster][dir=ltr],html[dir=ltr]{--toast-icon-margin-start:-3px;--toast-icon-margin-end:4px;--toast-svg-margin-start:-1px;--toast-svg-margin-end:0px;--toast-button-margin-start:auto;--toast-button-margin-end:0;--toast-close-button-start:0;--toast-close-button-end:unset;--toast-close-button-transform:translate(-35%, -35%)}[data-sonner-toaster][dir=rtl],html[dir=rtl]{--toast-icon-margin-start:4px;--toast-icon-margin-end:-3px;--toast-svg-margin-start:0px;--toast-svg-margin-end:-1px;--toast-button-margin-start:0;--toast-button-margin-end:auto;--toast-close-button-start:unset;--toast-close-button-end:0;--toast-close-button-transform:translate(35%, -35%)}[data-sonner-toaster]{position:fixed;width:var(--width);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica Neue,Arial,Noto Sans,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol,Noto Color Emoji;--gray1:hsl(0, 0%, 99%);--gray2:hsl(0, 0%, 97.3%);--gray3:hsl(0, 0%, 95.1%);--gray4:hsl(0, 0%, 93%);--gray5:hsl(0, 0%, 90.9%);--gray6:hsl(0, 0%, 88.7%);--gray7:hsl(0, 0%, 85.8%);--gray8:hsl(0, 0%, 78%);--gray9:hsl(0, 0%, 56.1%);--gray10:hsl(0, 0%, 52.3%);--gray11:hsl(0, 0%, 43.5%);--gray12:hsl(0, 0%, 9%);--border-radius:8px;box-sizing:border-box;padding:0;margin:0;list-style:none;outline:0;z-index:999999999;transition:transform .4s ease}@media (hover:none) and (pointer:coarse){[data-sonner-toaster][data-lifted=true]{transform:none}}[data-sonner-toaster][data-x-position=right]{right:var(--offset-right)}[data-sonner-toaster][data-x-position=left]{left:var(--offset-left)}[data-sonner-toaster][data-x-position=center]{left:50%;transform:translateX(-50%)}[data-sonner-toaster][data-y-position=top]{top:var(--offset-top)}[data-sonner-toaster][data-y-position=bottom]{bottom:var(--offset-bottom)}[data-sonner-toast]{--y:translateY(100%);--lift-amount:calc(var(--lift) * var(--gap));z-index:var(--z-index);position:absolute;opacity:0;transform:var(--y);touch-action:none;transition:transform .4s,opacity .4s,height .4s,box-shadow .2s;box-sizing:border-box;outline:0;overflow-wrap:anywhere}[data-sonner-toast][data-styled=true]{padding:16px;background:var(--normal-bg);border:1px solid var(--normal-border);color:var(--normal-text);border-radius:var(--border-radius);box-shadow:0 4px 12px rgba(0,0,0,.1);width:var(--width);font-size:13px;display:flex;align-items:center;gap:6px}[data-sonner-toast]:focus-visible{box-shadow:0 4px 12px rgba(0,0,0,.1),0 0 0 2px rgba(0,0,0,.2)}[data-sonner-toast][data-y-position=top]{top:0;--y:translateY(-100%);--lift:1;--lift-amount:calc(1 * var(--gap))}[data-sonner-toast][data-y-position=bottom]{bottom:0;--y:translateY(100%);--lift:-1;--lift-amount:calc(var(--lift) * var(--gap))}[data-sonner-toast][data-styled=true] [data-description]{font-weight:400;line-height:1.4;color:#3f3f3f}[data-rich-colors=true][data-sonner-toast][data-styled=true] [data-description]{color:inherit}[data-sonner-toaster][data-sonner-theme=dark] [data-description]{color:#e8e8e8}[data-sonner-toast][data-styled=true] [data-title]{font-weight:500;line-height:1.5;color:inherit}[data-sonner-toast][data-styled=true] [data-icon]{display:flex;height:16px;width:16px;position:relative;justify-content:flex-start;align-items:center;flex-shrink:0;margin-left:var(--toast-icon-margin-start);margin-right:var(--toast-icon-margin-end)}[data-sonner-toast][data-promise=true] [data-icon]>svg{opacity:0;transform:scale(.8);transform-origin:center;animation:sonner-fade-in .3s ease forwards}[data-sonner-toast][data-styled=true] [data-icon]>*{flex-shrink:0}[data-sonner-toast][data-styled=true] [data-icon] svg{margin-left:var(--toast-svg-margin-start);margin-right:var(--toast-svg-margin-end)}[data-sonner-toast][data-styled=true] [data-content]{display:flex;flex-direction:column;gap:2px}[data-sonner-toast][data-styled=true] [data-button]{border-radius:4px;padding-left:8px;padding-right:8px;height:24px;font-size:12px;color:var(--normal-bg);background:var(--normal-text);margin-left:var(--toast-button-margin-start);margin-right:var(--toast-button-margin-end);border:none;font-weight:500;cursor:pointer;outline:0;display:flex;align-items:center;flex-shrink:0;transition:opacity .4s,box-shadow .2s}[data-sonner-toast][data-styled=true] [data-button]:focus-visible{box-shadow:0 0 0 2px rgba(0,0,0,.4)}[data-sonner-toast][data-styled=true] [data-button]:first-of-type{margin-left:var(--toast-button-margin-start);margin-right:var(--toast-button-margin-end)}[data-sonner-toast][data-styled=true] [data-cancel]{color:var(--normal-text);background:rgba(0,0,0,.08)}[data-sonner-toaster][data-sonner-theme=dark] [data-sonner-toast][data-styled=true] [data-cancel]{background:rgba(255,255,255,.3)}[data-sonner-toast][data-styled=true] [data-close-button]{position:absolute;left:var(--toast-close-button-start);right:var(--toast-close-button-end);top:0;height:20px;width:20px;display:flex;justify-content:center;align-items:center;padding:0;color:var(--gray12);background:var(--normal-bg);border:1px solid var(--gray4);transform:var(--toast-close-button-transform);border-radius:50%;cursor:pointer;z-index:1;transition:opacity .1s,background .2s,border-color .2s}[data-sonner-toast][data-styled=true] [data-close-button]:focus-visible{box-shadow:0 4px 12px rgba(0,0,0,.1),0 0 0 2px rgba(0,0,0,.2)}[data-sonner-toast][data-styled=true] [data-disabled=true]{cursor:not-allowed}[data-sonner-toast][data-styled=true]:hover [data-close-button]:hover{background:var(--gray2);border-color:var(--gray5)}[data-sonner-toast][data-swiping=true]::before{content:'';position:absolute;left:-100%;right:-100%;height:100%;z-index:-1}[data-sonner-toast][data-y-position=top][data-swiping=true]::before{bottom:50%;transform:scaleY(3) translateY(50%)}[data-sonner-toast][data-y-position=bottom][data-swiping=true]::before{top:50%;transform:scaleY(3) translateY(-50%)}[data-sonner-toast][data-swiping=false][data-removed=true]::before{content:'';position:absolute;inset:0;transform:scaleY(2)}[data-sonner-toast][data-expanded=true]::after{content:'';position:absolute;left:0;height:calc(var(--gap) + 1px);bottom:100%;width:100%}[data-sonner-toast][data-mounted=true]{--y:translateY(0);opacity:1}[data-sonner-toast][data-expanded=false][data-front=false]{--scale:var(--toasts-before) * 0.05 + 1;--y:translateY(calc(var(--lift-amount) * var(--toasts-before))) scale(calc(-1 * var(--scale)));height:var(--front-toast-height)}[data-sonner-toast]>*{transition:opacity .4s}[data-sonner-toast][data-x-position=right]{right:0}[data-sonner-toast][data-x-position=left]{left:0}[data-sonner-toast][data-expanded=false][data-front=false][data-styled=true]>*{opacity:0}[data-sonner-toast][data-visible=false]{opacity:0;pointer-events:none}[data-sonner-toast][data-mounted=true][data-expanded=true]{--y:translateY(calc(var(--lift) * var(--offset)));height:var(--initial-height)}[data-sonner-toast][data-removed=true][data-front=true][data-swipe-out=false]{--y:translateY(calc(var(--lift) * -100%));opacity:0}[data-sonner-toast][data-removed=true][data-front=false][data-swipe-out=false][data-expanded=true]{--y:translateY(calc(var(--lift) * var(--offset) + var(--lift) * -100%));opacity:0}[data-sonner-toast][data-removed=true][data-front=false][data-swipe-out=false][data-expanded=false]{--y:translateY(40%);opacity:0;transition:transform .5s,opacity .2s}[data-sonner-toast][data-removed=true][data-front=false]::before{height:calc(var(--initial-height) + 20%)}[data-sonner-toast][data-swiping=true]{transform:var(--y) translateY(var(--swipe-amount-y,0)) translateX(var(--swipe-amount-x,0));transition:none}[data-sonner-toast][data-swiped=true]{user-select:none}[data-sonner-toast][data-swipe-out=true][data-y-position=bottom],[data-sonner-toast][data-swipe-out=true][data-y-position=top]{animation-duration:.2s;animation-timing-function:ease-out;animation-fill-mode:forwards}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=left]{animation-name:swipe-out-left}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=right]{animation-name:swipe-out-right}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=up]{animation-name:swipe-out-up}[data-sonner-toast][data-swipe-out=true][data-swipe-direction=down]{animation-name:swipe-out-down}@keyframes swipe-out-left{from{transform:var(--y) translateX(var(--swipe-amount-x));opacity:1}to{transform:var(--y) translateX(calc(var(--swipe-amount-x) - 100%));opacity:0}}@keyframes swipe-out-right{from{transform:var(--y) translateX(var(--swipe-amount-x));opacity:1}to{transform:var(--y) translateX(calc(var(--swipe-amount-x) + 100%));opacity:0}}@keyframes swipe-out-up{from{transform:var(--y) translateY(var(--swipe-amount-y));opacity:1}to{transform:var(--y) translateY(calc(var(--swipe-amount-y) - 100%));opacity:0}}@keyframes swipe-out-down{from{transform:var(--y) translateY(var(--swipe-amount-y));opacity:1}to{transform:var(--y) translateY(calc(var(--swipe-amount-y) + 100%));opacity:0}}@media (max-width:600px){[data-sonner-toaster]{position:fixed;right:var(--mobile-offset-right);left:var(--mobile-offset-left);width:100%}[data-sonner-toaster][dir=rtl]{left:calc(var(--mobile-offset-left) * -1)}[data-sonner-toaster] [data-sonner-toast]{left:0;right:0;width:calc(100% - var(--mobile-offset-left) * 2)}[data-sonner-toaster][data-x-position=left]{left:var(--mobile-offset-left)}[data-sonner-toaster][data-y-position=bottom]{bottom:var(--mobile-offset-bottom)}[data-sonner-toaster][data-y-position=top]{top:var(--mobile-offset-top)}[data-sonner-toaster][data-x-position=center]{left:var(--mobile-offset-left);right:var(--mobile-offset-right);transform:none}}[data-sonner-toaster][data-sonner-theme=light]{--normal-bg:#fff;--normal-border:var(--gray4);--normal-text:var(--gray12);--success-bg:hsl(143, 85%, 96%);--success-border:hsl(145, 92%, 87%);--success-text:hsl(140, 100%, 27%);--info-bg:hsl(208, 100%, 97%);--info-border:hsl(221, 91%, 93%);--info-text:hsl(210, 92%, 45%);--warning-bg:hsl(49, 100%, 97%);--warning-border:hsl(49, 91%, 84%);--warning-text:hsl(31, 92%, 45%);--error-bg:hsl(359, 100%, 97%);--error-border:hsl(359, 100%, 94%);--error-text:hsl(360, 100%, 45%)}[data-sonner-toaster][data-sonner-theme=light] [data-sonner-toast][data-invert=true]{--normal-bg:#000;--normal-border:hsl(0, 0%, 20%);--normal-text:var(--gray1)}[data-sonner-toaster][data-sonner-theme=dark] [data-sonner-toast][data-invert=true]{--normal-bg:#fff;--normal-border:var(--gray3);--normal-text:var(--gray12)}[data-sonner-toaster][data-sonner-theme=dark]{--normal-bg:#000;--normal-bg-hover:hsl(0, 0%, 12%);--normal-border:hsl(0, 0%, 20%);--normal-border-hover:hsl(0, 0%, 25%);--normal-text:var(--gray1);--success-bg:hsl(150, 100%, 6%);--success-border:hsl(147, 100%, 12%);--success-text:hsl(150, 86%, 65%);--info-bg:hsl(215, 100%, 6%);--info-border:hsl(223, 43%, 17%);--info-text:hsl(216, 87%, 65%);--warning-bg:hsl(64, 100%, 6%);--warning-border:hsl(60, 100%, 9%);--warning-text:hsl(46, 87%, 65%);--error-bg:hsl(358, 76%, 10%);--error-border:hsl(357, 89%, 16%);--error-text:hsl(358, 100%, 81%)}[data-sonner-toaster][data-sonner-theme=dark] [data-sonner-toast] [data-close-button]{background:var(--normal-bg);border-color:var(--normal-border);color:var(--normal-text)}[data-sonner-toaster][data-sonner-theme=dark] [data-sonner-toast] [data-close-button]:hover{background:var(--normal-bg-hover);border-color:var(--normal-border-hover)}[data-rich-colors=true][data-sonner-toast][data-type=success]{background:var(--success-bg);border-color:var(--success-border);color:var(--success-text)}[data-rich-colors=true][data-sonner-toast][data-type=success] [data-close-button]{background:var(--success-bg);border-color:var(--success-border);color:var(--success-text)}[data-rich-colors=true][data-sonner-toast][data-type=info]{background:var(--info-bg);border-color:var(--info-border);color:var(--info-text)}[data-rich-colors=true][data-sonner-toast][data-type=info] [data-close-button]{background:var(--info-bg);border-color:var(--info-border);color:var(--info-text)}[data-rich-colors=true][data-sonner-toast][data-type=warning]{background:var(--warning-bg);border-color:var(--warning-border);color:var(--warning-text)}[data-rich-colors=true][data-sonner-toast][data-type=warning] [data-close-button]{background:var(--warning-bg);border-color:var(--warning-border);color:var(--warning-text)}[data-rich-colors=true][data-sonner-toast][data-type=error]{background:var(--error-bg);border-color:var(--error-border);color:var(--error-text)}[data-rich-colors=true][data-sonner-toast][data-type=error] [data-close-button]{background:var(--error-bg);border-color:var(--error-border);color:var(--error-text)}.sonner-loading-wrapper{--size:16px;height:var(--size);width:var(--size);position:absolute;inset:0;z-index:10}.sonner-loading-wrapper[data-visible=false]{transform-origin:center;animation:sonner-fade-out .2s ease forwards}.sonner-spinner{position:relative;top:50%;left:50%;height:var(--size);width:var(--size)}.sonner-loading-bar{animation:sonner-spin 1.2s linear infinite;background:var(--gray11);border-radius:6px;height:8%;left:-10%;position:absolute;top:-3.9%;width:24%}.sonner-loading-bar:first-child{animation-delay:-1.2s;transform:rotate(.0001deg) translate(146%)}.sonner-loading-bar:nth-child(2){animation-delay:-1.1s;transform:rotate(30deg) translate(146%)}.sonner-loading-bar:nth-child(3){animation-delay:-1s;transform:rotate(60deg) translate(146%)}.sonner-loading-bar:nth-child(4){animation-delay:-.9s;transform:rotate(90deg) translate(146%)}.sonner-loading-bar:nth-child(5){animation-delay:-.8s;transform:rotate(120deg) translate(146%)}.sonner-loading-bar:nth-child(6){animation-delay:-.7s;transform:rotate(150deg) translate(146%)}.sonner-loading-bar:nth-child(7){animation-delay:-.6s;transform:rotate(180deg) translate(146%)}.sonner-loading-bar:nth-child(8){animation-delay:-.5s;transform:rotate(210deg) translate(146%)}.sonner-loading-bar:nth-child(9){animation-delay:-.4s;transform:rotate(240deg) translate(146%)}.sonner-loading-bar:nth-child(10){animation-delay:-.3s;transform:rotate(270deg) translate(146%)}.sonner-loading-bar:nth-child(11){animation-delay:-.2s;transform:rotate(300deg) translate(146%)}.sonner-loading-bar:nth-child(12){animation-delay:-.1s;transform:rotate(330deg) translate(146%)}@keyframes sonner-fade-in{0%{opacity:0;transform:scale(.8)}100%{opacity:1;transform:scale(1)}}@keyframes sonner-fade-out{0%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.8)}}@keyframes sonner-spin{0%{opacity:1}100%{opacity:.15}}@media (prefers-reduced-motion){.sonner-loading-bar,[data-sonner-toast],[data-sonner-toast]>*{transition:none!important;animation:none!important}}.sonner-loader{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);transform-origin:center;transition:opacity .2s,transform .2s}.sonner-loader[data-visible=false]{opacity:0;transform:scale(.8) translate(-50%,-50%)}`,
);
var zC = new Set(),
  BC;
function VC(e) {
  if ((zC.add(e), !BC)) {
    let e = [
        `success`,
        `info`,
        `warning`,
        `error`,
        `custom`,
        `message`,
        `promise`,
        `dismiss`,
        `loading`,
      ],
      t = new Map(),
      n = () => queueMicrotask(() => zC.forEach((e) => e()));
    (e.forEach((e) => {
      let r = RC[e];
      (t.set(e, r),
        (RC[e] = (...e) => {
          let t = r(...e);
          return (n(), t);
        }));
    }),
      (BC = () => {
        for (let [e, n] of t) e !== "default" && (RC[e] = n);
        BC = void 0;
      }));
  }
  return () => {
    (zC.delete(e), zC.size === 0 && BC?.());
  };
}
function HC(e) {
  let t = typeof e == `function` ? e() : e;
  return t == null || typeof t == `boolean`
    ? ``
    : typeof t == `string` || typeof t == `number`
      ? t
      : typeof t == `object` && `value` in t
        ? W(String(t.value))
        : ``;
}
function UC(e) {
  return typeof e == `object` && e && `value` in e ? String(e.value) : String(e ?? ``);
}
function WC(e) {
  return q(
    e.includes(`top`) ? `top-4` : `bottom-4`,
    e.includes(`left`) && `left-4`,
    e.includes(`right`) && `right-4`,
    e.includes(`center`) && `left-1/2 -translate-x-1/2`,
  );
}
function GC() {
  if (typeof document > `u` || document.getElementById(`areia-sonner-styles`)) return;
  let e = document.createElement(`style`);
  ((e.id = `areia-sonner-styles`),
    (e.textContent = `
    [data-areia-sonner-toast] {
      --areia-sonner-enter-x: 0;
      --areia-sonner-enter-y: 100%;
      --areia-sonner-exit-x: 0;
      --areia-sonner-exit-y: 100%;
      transform-origin: center;
      will-change: transform, opacity;
      animation: areia-sonner-enter 400ms cubic-bezier(.21,1.02,.73,1) forwards;
    }
    [data-areia-sonner-toast][data-position*="right"] {
      --areia-sonner-enter-x: 100%;
      --areia-sonner-enter-y: 0;
      --areia-sonner-exit-x: 100%;
      --areia-sonner-exit-y: 0;
    }
    [data-areia-sonner-toast][data-position*="left"] {
      --areia-sonner-enter-x: -100%;
      --areia-sonner-enter-y: 0;
      --areia-sonner-exit-x: -100%;
      --areia-sonner-exit-y: 0;
    }
    [data-areia-sonner-toast][data-position*="top"]:not([data-position*="left"]):not([data-position*="right"]) {
      --areia-sonner-enter-y: -100%;
      --areia-sonner-exit-y: -100%;
    }
    [data-areia-sonner-toast][data-state="closed"] {
      pointer-events: none;
      animation: areia-sonner-exit 200ms ease-in forwards;
    }
    @keyframes areia-sonner-enter {
      from { opacity: 0; transform: translate3d(var(--areia-sonner-enter-x), var(--areia-sonner-enter-y), 0) scale(.95); }
      to { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
    }
    @keyframes areia-sonner-exit {
      from { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
      to { opacity: 0; transform: translate3d(var(--areia-sonner-exit-x), var(--areia-sonner-exit-y), 0) scale(.95); }
    }
    @media (prefers-reduced-motion: reduce) {
      [data-areia-sonner-toast],
      [data-areia-sonner-toast][data-state="closed"] {
        animation-duration: 1ms !important;
      }
    }
  `),
    document.head.appendChild(e));
}
function KC(e = {}) {
  let {
    class: t,
    className: n,
    id: r,
    position: i = `bottom-right`,
    theme: a = `light`,
    richColors: o,
    expand: s,
    duration: c,
    visibleToasts: l,
    closeButton: u,
    gap: d,
    ...f
  } = e;
  return U`<div
    id="${r ?? `sonner-toaster`}"
    data-slot="sonner-toaster"
    data-areia-sonner-toaster
    data-theme="${a}"
    data-position="${i}"
    class="${q(`fixed z-[2147483647] flex flex-col gap-3 pointer-events-none`, WC(i), t, n)}"
    ${W(J({ ...f, "data-rich-colors": o, "data-expand": s, "data-duration": c, "data-visible-toasts": l, "data-close-button": u, "data-gap": d }))}
  ></div>`;
}
function qC(e, t = {}) {
  return {
    ...t,
    closeButton: t.closeButton ?? e.hasAttribute(`data-close-button`),
    duration: t.duration ?? JC(e, `data-duration`),
    visibleToasts: t.visibleToasts ?? JC(e, `data-visible-toasts`),
  };
}
function JC(e, t) {
  let n = e.getAttribute(t);
  return n == null || n === `` ? void 0 : Number(n);
}
function YC(e) {
  return RC.getToasts()
    .filter((e) => !(`dismiss` in e))
    .slice(-(e.visibleToasts ?? 3));
}
var XC = 4e3,
  ZC = 200;
function QC(e) {
  return `[data-toast-id="${CSS.escape(String(e))}"]`;
}
function $C(e, t) {
  let n = e.type ?? `normal`,
    r = e.closeButton ?? t.closeButton,
    i = e.position ?? t.position ?? `bottom-right`;
  return U`<div
    data-areia-sonner-toast
    data-toast-id="${e.id}"
    data-position="${i}"
    data-type="${n}"
    data-state="open"
    class="${q(`pointer-events-auto grid min-w-80 max-w-[calc(100vw-2rem)] gap-1 rounded-lg border border-areia-border bg-areia-background px-4 py-3 text-areia-default shadow-lg`, n === `success` && `border-green-500`, n === `error` && `border-red-500`, n === `warning` && `border-yellow-500`, n === `info` && `border-blue-500`, e.className)}"
  >
    <div class="flex items-start gap-3">
      ${e.icon ? U`<div>${HC(e.icon)}</div>` : ``}
      <div class="min-w-0 flex-1">
        <div class="font-medium">${HC(e.title)}</div>
        ${
          e.description
            ? U`<div class="${q(`text-sm text-areia-subtle`, e.descriptionClassName)}">
              ${HC(e.description)}
            </div>`
            : ``
        }
      </div>
      ${
        r
          ? U`<button
            type="button"
            data-areia-sonner-close="${e.id}"
            class="text-areia-subtle hover:text-areia-default"
          >
            ×
          </button>`
          : ``
      }
    </div>
  </div>`;
}
var ew = new WeakMap();
function tw(e, t = {}) {
  (ew.get(e)?.(), GC());
  let n = e.parentNode,
    r = e.nextSibling;
  e.parentElement !== document.body && document.body.appendChild(e);
  let i = new Map(),
    a = new Map(),
    o = new Map(),
    s = (t) => {
      let n = String(t);
      (clearTimeout(i.get(n)), i.delete(n));
      let r = e.querySelector(QC(n));
      !r ||
        r.dataset.state === `closed` ||
        ((r.dataset.state = `closed`),
        clearTimeout(a.get(n)),
        a.set(
          n,
          setTimeout(() => {
            (r.remove(), o.delete(n), a.delete(n));
          }, ZC),
        ));
    },
    c = () => {
      let n = qC(e, t),
        r = YC(n),
        a = new Set(r.map((e) => String(e.id)));
      e.querySelectorAll(`[data-areia-sonner-toast]`).forEach((e) => {
        let t = e.dataset.toastId;
        t && !a.has(t) && s(t);
      });
      for (let t of r) {
        let r = String(t.id),
          i = e.querySelector(QC(r)),
          a = UC($C(t, n));
        if (i) {
          if (i.dataset.state === `closed` || o.get(r) === a) continue;
          i.outerHTML = a;
        } else e.insertAdjacentHTML(`beforeend`, a);
        o.set(r, a);
      }
      for (let e of r) {
        let t = String(e.id);
        if (e.duration === 1 / 0 || i.has(t)) continue;
        let r = e.duration ?? n.duration ?? XC;
        i.set(
          t,
          setTimeout(() => {
            (e.onAutoClose?.(e), s(e.id), setTimeout(() => RC.dismiss(e.id), ZC));
          }, r),
        );
      }
    },
    l = VC(c),
    u = (e) => {
      let t = e.target.closest(`[data-areia-sonner-close]`);
      t?.dataset.areiaSonnerClose &&
        (s(t.dataset.areiaSonnerClose),
        setTimeout(() => RC.dismiss(t.dataset.areiaSonnerClose), ZC));
    };
  (e.addEventListener(`click`, u), c());
  let d = () => {
    (l(),
      e.removeEventListener(`click`, u),
      i.forEach(clearTimeout),
      a.forEach(clearTimeout),
      n && n.insertBefore(e, r),
      ew.delete(e));
  };
  return (ew.set(e, d), d);
}
function nw(e = globalThis.document) {
  e && e.querySelectorAll(`[data-areia-sonner-toaster]`).forEach((e) => !ew.has(e) && tw(e));
}
if (typeof document < `u`) {
  let e = () => nw();
  (document.readyState === `loading`
    ? document.addEventListener(`DOMContentLoaded`, e)
    : queueMicrotask(e),
    queueMicrotask(() => {
      new MutationObserver(() => nw()).observe(document.documentElement, {
        childList: !0,
        subtree: !0,
      });
    }));
}
var rw = nn
  .input()
  .onMount(({ host: e, input: t }) => {
    let n = e.matches(`[data-areia-sonner-toaster]`)
      ? e
      : e.querySelector(`[data-areia-sonner-toaster]`);
    if (n) return tw(n, t);
  })
  .render(({ input: e }) => KC(e));
function iw(e = {}) {
  return KC(e);
}
var aw = Object.assign(rw, { Root: rw, Static: iw });
function ow(e) {
  return e == null || e === !1 || Array.isArray(e) ? e : [e];
}
function sw(e, t) {
  let n = e.length === 0 ? [] : e.map(t),
    r = n;
  return (
    Object.defineProperty(r, "else", {
      value(t) {
        return e.length === 0 ? ow(typeof t == `function` ? t(e) : t) : n;
      },
      enumerable: !1,
    }),
    r
  );
}
function cw(e) {
  return {
    key(t) {
      return {
        as(n) {
          return sw(e, (e, r) => n(e, r, t(e, r)));
        },
      };
    },
    as(t) {
      return sw(e, t);
    },
  };
}
function lw(e) {
  if (typeof e == `function`)
    throw TypeError(
      `[quando] each() expected an array but received a function. Call accessors first (each(state.items())) or pass a snapshot from a reactive render.`,
    );
  return cw(Array.isArray(e) ? e : []);
}
var uw = Symbol.for(`ilha.raw`),
  dw = Symbol.for(`ilha.signalAccessor`),
  fw = Symbol.for(`ilha.island`),
  pw = Symbol.for(`ilha.islandCall`),
  mw = Symbol.for(`ilha.renderPart`),
  hw = /^[A-Za-z_:][A-Za-z0-9:._-]*$/,
  gw = /^[A-Za-z][A-Za-z0-9]*$/,
  _w = /^on([a-z][a-z0-9-]*)(?::(abortable|once|capture|passive))?$/,
  vw = {
    className: `class`,
    htmlFor: `for`,
    acceptCharset: `accept-charset`,
    httpEquiv: `http-equiv`,
    accentHeight: `accent-height`,
    alignmentBaseline: `alignment-baseline`,
    baselineShift: `baseline-shift`,
    clipPath: `clip-path`,
    clipRule: `clip-rule`,
    dominantBaseline: `dominant-baseline`,
    fillOpacity: `fill-opacity`,
    fillRule: `fill-rule`,
    floodColor: `flood-color`,
    floodOpacity: `flood-opacity`,
    fontFamily: `font-family`,
    fontSize: `font-size`,
    fontStyle: `font-style`,
    fontWeight: `font-weight`,
    markerEnd: `marker-end`,
    markerMid: `marker-mid`,
    markerStart: `marker-start`,
    stopColor: `stop-color`,
    stopOpacity: `stop-opacity`,
    strokeDasharray: `stroke-dasharray`,
    strokeDashoffset: `stroke-dashoffset`,
    strokeLinecap: `stroke-linecap`,
    strokeLinejoin: `stroke-linejoin`,
    strokeMiterlimit: `stroke-miterlimit`,
    strokeOpacity: `stroke-opacity`,
    strokeWidth: `stroke-width`,
    textAnchor: `text-anchor`,
    vectorEffect: `vector-effect`,
    xlinkHref: `xlink:href`,
  },
  yw = new Set([`contenteditable`, `draggable`, `spellcheck`]),
  bw = new Set([
    `area`,
    `base`,
    `br`,
    `col`,
    `embed`,
    `hr`,
    `img`,
    `input`,
    `link`,
    `meta`,
    `param`,
    `source`,
    `track`,
    `wbr`,
  ]),
  xw = /^(-{2}[a-zA-Z][a-zA-Z0-9-]*|-?[a-zA-Z][a-zA-Z0-9-]*)$/,
  Sw = new Set([`href`, `src`, `action`, `formaction`, `cite`, `data`, `poster`]),
  Cw =
    /^(?!javascript:|data:text\/html|data:text\/xml|data:application\/xhtml\+xml|data:image\/svg|vbscript:)/i;
function ww(e) {
  return Cw.test(e.replace(/[\u0000-\u0020]/g, ``));
}
function Tw(e) {
  return !!(e && typeof e == `object` && uw in e);
}
function Ew(e) {
  return typeof e == `function` && dw in e;
}
function Dw(e) {
  return typeof e == `function` && fw in e;
}
function Ow(e) {
  return e == null || (typeof e != `object` && typeof e != `function`)
    ? !1
    : pw in e || (typeof e == `object` && `island` in e && Dw(e.island));
}
function kw(e) {
  return Array.isArray(e)
    ? e.filter(Boolean).join(` `)
    : e && typeof e == `object`
      ? Object.entries(e)
          .filter(([, e]) => !!e)
          .map(([e]) => e)
          .join(` `)
      : String(e);
}
function Aw(e, t) {
  let n = e && `children` in e ? e.children : void 0;
  return (t.length > 0 ? t : n === void 0 ? [] : [n]).flat(1);
}
function jw(e) {
  let t = String(e);
  if (t.trim().length === 0) throw Error(`jsx key requires a non-empty string.`);
  if (t.includes(`:`)) throw Error(`jsx key cannot contain the slot separator ":" (got "${t}").`);
  return t;
}
function Mw(e, t) {
  let n = e?.key,
    r = t ?? (typeof n == `string` || typeof n == `number` ? n : void 0);
  if (r != null) return jw(r);
}
function Nw(e) {
  return Object.entries(e)
    .map(([e, t]) => {
      if (!xw.test(e)) return ``;
      let n = e.replace(/[A-Z]/g, (e) => `-${e.toLowerCase()}`),
        r = String(t);
      return /[<>{};]/.test(r) || /expression\(/i.test(r) || /javascript:/i.test(r)
        ? ``
        : `${n}:${r}`;
    })
    .filter(Boolean)
    .join(`;`);
}
function Pw({ chunks: e, values: t, eventSpecs: n, name: r, value: i }) {
  if (
    i == null ||
    r === `children` ||
    r === `key` ||
    r === `__proto__` ||
    r === `constructor` ||
    r === `prototype`
  )
    return;
  if (r.startsWith(`bind:`)) {
    let [n, a, ...o] = r.split(`:`);
    if (n !== `bind` || o.length > 0 || !a || !gw.test(a) || !Ew(i)) return;
    ((e[e.length - 1] += ` ${n}:${a}=`), t.push(i), e.push(``));
    return;
  }
  if (!hw.test(r)) return;
  let a = vw[r] ?? r;
  if (a.startsWith(`on`)) {
    let e = _w.exec(a);
    if (typeof i != `function` || !e) return;
    let t = e[1],
      r = e[2],
      o = rn({ type: t, handler: i, modifier: r });
    o !== void 0 && n.push(`${t}:${o}`);
    return;
  }
  let o = a.toLowerCase();
  if (o === `srcdoc`) return;
  let s = o.startsWith(`aria-`) || yw.has(o);
  if (typeof i == `boolean` && s) i = String(i);
  else if (i === !1) return;
  if (
    (a === `class` && !Tw(i) && (i = kw(i)),
    a === `style` && i && typeof i == `object` && !Tw(i) && (i = Nw(i)),
    !(
      (Sw.has(o) || /:(href|src|action|formaction|cite|data|poster)$/.test(o)) &&
      !ww(typeof i == `string` ? i : String(i))
    ))
  ) {
    if (i === !0) {
      e[e.length - 1] += ` ${a}`;
      return;
    }
    ((e[e.length - 1] += ` ${a}="`), t.push(i), e.push(`"`));
  }
}
function Fw(e) {
  return e.replace(/&/g, `&amp;`).replace(/"/g, `&quot;`).replace(/</g, `&lt;`);
}
function Iw(e, t) {
  let n = /^\s*<([a-zA-Z][a-zA-Z0-9:._-]*)/.exec(e.value);
  if (!n) return e;
  let r = e.value.indexOf(`>`, n.index),
    i = e.value.slice(n.index, r === -1 ? void 0 : r);
  if (/\sdata-key\s*=/.test(i)) return e;
  let a = n.index + n[0].length;
  return W(`${e.value.slice(0, a)} data-key="${Fw(t)}"${e.value.slice(a)}`);
}
function Lw({ type: e, props: t, children: n, slotKey: r }) {
  let i = [`<${e}`],
    a = [],
    o = [];
  if (t)
    for (let [e, n] of Object.entries(t))
      Pw({ chunks: i, values: a, eventSpecs: o, name: e, value: n });
  if (
    (r !== void 0 &&
      t?.[`data-key`] == null &&
      Pw({ chunks: i, values: a, eventSpecs: o, name: `data-key`, value: r }),
    o.length > 0 && (i[i.length - 1] += ` data-ilha-on="${o.join(`,`)}"`),
    (i[i.length - 1] += `>`),
    !bw.has(e))
  ) {
    for (let e of n) (a.push(e), i.push(``));
    i[i.length - 1] += `</${e}>`;
  }
  return U(i, ...a);
}
function Rw(e, t, n, ...r) {
  let i = typeof n == `string` || typeof n == `number`,
    a = i ? n : void 0,
    o = Aw(t, i || n === void 0 ? r : [n, ...r]),
    s = Mw(t, typeof a == `string` || typeof a == `number` ? a : void 0);
  if (typeof e == `function`) {
    let n = { ...t, ...(o.length > 0 ? { children: o } : {}) };
    delete n.key;
    let r = e(Object.keys(n).length ? n : {});
    return Ow(r)
      ? (s !== void 0 && (r.key = s), U`${r}`)
      : Tw(r)
        ? s === void 0
          ? r
          : Iw(r, s)
        : typeof r == `string` && Dw(e)
          ? an({ island: e, props: n, key: s })
          : typeof r == `string`
            ? U`${r}`
            : typeof r == `object` &&
                r &&
                Object.getPrototypeOf(r) === Object.prototype &&
                r[mw] === !0 &&
                typeof r.toString == `function`
              ? W(String(r))
              : U`${r}`;
  }
  return Lw({ type: e, props: t, children: o, slotKey: s });
}
var zw = Rw,
  Bw = [
    { id: `1`, text: `Start Ilha Dev Server`, completed: !0 },
    { id: `2`, text: `Develop my Ilha app`, completed: !1 },
    { id: `3`, text: `Deploy my Ilha app`, completed: !1 },
  ],
  Vw = Bn(({ head: e }) => (e({ title: `Home` }), { todos: Bw })),
  Hw = Ea({ draft: ``, items: [] })
    .derived(`pending`, ({ get: e }) => (e().items ?? []).filter((e) => !e.completed))
    .action(`addItem`, (e, { get: t }) => {
      e.preventDefault();
      let n = t().draft.trim();
      if (!n) return;
      let r = { id: crypto.randomUUID(), text: n, completed: !1 };
      return { items: [...t().items, r], draft: `` };
    })
    .action(`deleteItem`, (e, { get: t }) => ({ items: t().items.filter((t, n) => n !== e) }))
    .action(`toggleItem`, (e, { get: t }) => ({
      items: t().items.map((t, n) => (n === e ? { ...t, completed: !t.completed } : t)),
    }))
    .build(),
  Uw = nn
    .input()
    .onMount(({ input: e }) => {
      Hw.items(e.todos);
    })
    .render(() =>
      Rw(`div`, {
        class: `flex flex-col gap-4`,
        children: zw(Dy, {
          children: [
            zw(Dy.Title, {
              children: [
                Rw(`span`, { children: `To Do` }),
                Rw($m, { children: Hw.pending()?.length }),
              ],
            }),
            zw(Dy.Content, {
              children: [
                Rw(`form`, {
                  onsubmit: Hw.addItem,
                  children: zw(`div`, {
                    class: `flex items-center gap-2`,
                    children: [
                      Rw(i_, {
                        placeholder: `Add a new todo`,
                        class: `w-full`,
                        "bind:value": Hw.draft,
                      }),
                      Rw(kh, { type: `submit`, children: `Add` }),
                    ],
                  }),
                }),
                Rw(`div`, {
                  class: `flex flex-col gap-2`,
                  children: lw(Hw.items())
                    .as((e, t) =>
                      zw(
                        `div`,
                        {
                          class: `flex items-center justify-between gap-2`,
                          children: [
                            Rw(Ig, {
                              label: e.text,
                              "bind:checked": Hw.bind((e) => e.items[t]?.completed ?? !1),
                            }),
                            Rw(`button`, { onclick: () => Hw.deleteItem(t), children: `Delete` }),
                          ],
                        },
                        e.id,
                      ),
                    )
                    .else(Rw(`p`, { children: `No todos.` })),
                }),
                Rw(`button`, {
                  onclick: async () => {
                    let e = await Gi.foo.$get().then((e) => e.text());
                    return RC.success(e);
                  },
                  children: `Get foo`,
                }),
              ],
            }),
          ],
        }),
      }),
    ),
  Ww = nr((e) =>
    nn(
      ({ input: t }) => (
        fi({ titleTemplate: (e) => `${e} · Ilha + Hono` }),
        zw(`div`, {
          class: `mt-2 flex flex-col gap-2`,
          children: [
            zw(`nav`, {
              class: `container mx-auto flex max-w-xl items-center gap-2`,
              children: [
                Rw(Ah, { href: `/`, variant: ri(`/`) ? `secondary` : `ghost`, children: `Home` }),
                Rw(Ah, {
                  href: `/learn`,
                  variant: ri(`/learn`) ? `secondary` : `ghost`,
                  children: `Learn`,
                }),
              ],
            }),
            Rw(`main`, { class: `container mx-auto max-w-xl`, children: Rw(e, { ...t }) }),
            Rw(aw, {}),
          ],
        })
      ),
    ),
  ),
  Gw = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJsdWNpZGUgbHVjaWRlLWxpbmstaWNvbiBsdWNpZGUtbGluayI+PHBhdGggZD0iTTEwIDEzYTUgNSAwIDAgMCA3LjU0LjU0bDMtM2E1IDUgMCAwIDAtNy4wNy03LjA3bC0xLjcyIDEuNzEiLz48cGF0aCBkPSJNMTQgMTFhNSA1IDAgMCAwLTcuNTQtLjU0bC0zIDNhNSA1IDAgMCAwIDcuMDcgNy4wN2wxLjcxLTEuNzEiLz48L3N2Zz4=`,
  Kw = [
    {
      title: `Documentation`,
      description: `Learn how to use Ilha.`,
      href: `https://ilha.build/docs`,
      icon: `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJsdWNpZGUgbHVjaWRlLWJvb2staWNvbiBsdWNpZGUtYm9vayI+PHBhdGggZD0iTTQgMTkuNXYtMTVBMi41IDIuNSAwIDAgMSA2LjUgMkgxOWExIDEgMCAwIDEgMSAxdjE4YTEgMSAwIDAgMS0xIDFINi41YTEgMSAwIDAgMSAwLTVIMjAiLz48L3N2Zz4=`,
    },
    {
      title: `Discord`,
      description: `Join our Discord server.`,
      href: `https://discord.gg/WnVTMCTz74`,
      icon: Gw,
    },
    { title: `x.com`, description: `Follow us on X.`, href: `https://x.com/ilha_js`, icon: Gw },
  ],
  qw = nn(
    () => (
      fi({ title: `Learn` }),
      zw(Dy, {
        children: [
          Rw(Dy.Title, { children: `Learn Ilha` }),
          Rw(Dy.Content, {
            children: lw(Kw).as((e) =>
              zw(Ah, {
                href: e.href,
                icon: Rw(`img`, { src: W(e.icon), alt: e.title, class: `size-6` }),
                class: `w-full`,
                external: !0,
                children: [e.title, ` - `, e.description],
              }),
            ),
          }),
        ],
      })
    ),
  ),
  Jw = nn(() => {
    let { path: e } = Nr();
    return zw(`section`, {
      class: `flex flex-col gap-2`,
      children: [
        Rw(`h1`, { class: `text-xl font-semibold`, children: `404` }),
        zw(`p`, { children: [`No page found for `, Rw(`code`, { children: e() }), `.`] }),
        Rw(Ah, { href: `/`, variant: `outline`, children: `Go home` }),
      ],
    });
  }),
  Yw = tr(Ww, Uw),
  Xw = tr(Ww, qw),
  Zw = tr(Ww, Jw);
Mi().route(`/`, Yw).clientLoader(`/`, Vw).route(`/learn`, Xw).route(`/**:slug`, Zw).mount(`#app`);
export { o as t };
