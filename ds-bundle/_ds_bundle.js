/* @ds-bundle: {"namespace":"InterpollDS","components":[{"name":"Avatar","sourcePath":"components/general/Avatar/Avatar.jsx"},{"name":"Badge","sourcePath":"components/general/Badge/Badge.jsx"},{"name":"Button","sourcePath":"components/general/Button/Button.jsx"},{"name":"Card","sourcePath":"components/general/Card/Card.jsx"},{"name":"Input","sourcePath":"components/general/Input/Input.jsx"},{"name":"Modal","sourcePath":"components/general/Modal/Modal.jsx"},{"name":"Pill","sourcePath":"components/general/Pill/Pill.jsx"},{"name":"PollCard","sourcePath":"components/general/PollCard/PollCard.jsx"},{"name":"Toolbar","sourcePath":"components/general/Toolbar/Toolbar.jsx"},{"name":"VoteForm","sourcePath":"components/general/VoteForm/VoteForm.jsx"}],"sourceHashes":{"components/general/Avatar/Avatar.jsx":"ac8a99ef000f","components/general/Avatar/Avatar.d.ts":"7d35ee10685e","components/general/Avatar/Avatar.prompt.md":"91234476ae55","components/general/Badge/Badge.jsx":"abb61c84fa09","components/general/Badge/Badge.d.ts":"c8cd6a4ccd08","components/general/Badge/Badge.prompt.md":"3b07a0caabaa","components/general/Button/Button.jsx":"92bbd72f8a84","components/general/Button/Button.d.ts":"5ea037b00565","components/general/Button/Button.prompt.md":"432db28f24e5","components/general/Card/Card.jsx":"b6a495906ba2","components/general/Card/Card.d.ts":"5ec676a36c22","components/general/Card/Card.prompt.md":"aae691eac14a","components/general/Input/Input.jsx":"3b1184c566de","components/general/Input/Input.d.ts":"7c65698b1965","components/general/Input/Input.prompt.md":"8fdde9085f0d","components/general/Modal/Modal.jsx":"b2fc0b59c24b","components/general/Modal/Modal.d.ts":"7bbc3b1708fb","components/general/Modal/Modal.prompt.md":"530d84a19f1e","components/general/Pill/Pill.jsx":"1d9914e3e8eb","components/general/Pill/Pill.d.ts":"af8ce29ef7d1","components/general/Pill/Pill.prompt.md":"a402ce1f98ac","components/general/PollCard/PollCard.jsx":"e0972ce7f246","components/general/PollCard/PollCard.d.ts":"e0b2c9886e4d","components/general/PollCard/PollCard.prompt.md":"6f7c75e036bd","components/general/Toolbar/Toolbar.jsx":"a3de42cf0d3b","components/general/Toolbar/Toolbar.d.ts":"e9d5faa7ba7c","components/general/Toolbar/Toolbar.prompt.md":"fd98aa1e27b4","components/general/VoteForm/VoteForm.jsx":"51cd4ecde5de","components/general/VoteForm/VoteForm.d.ts":"3a392e8419b0","components/general/VoteForm/VoteForm.prompt.md":"cd4996095523"},"inlinedExternals":[],"builtBy":"cc-design-sync"} */
"use strict";
var InterpollDS = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e2) {
      throw err = [e2], e2;
    }
  };
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e2) {
      throw mod = 0, e2;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // <define:import.meta.env>
  var init_define_import_meta_env = __esm({
    "<define:import.meta.env>"() {
    }
  });

  // shim:react-shim
  var require_react_shim = __commonJS({
    "shim:react-shim"(exports, module) {
      init_define_import_meta_env();
      var R = window.React;
      function np(p, k2) {
        var o = {};
        for (var x2 in p) if (x2 !== "children") o[x2] = p[x2];
        if (k2 !== void 0) o.key = k2;
        return o;
      }
      function jsx(t, p, k2) {
        var c = p && p.children;
        return c === void 0 ? R.createElement(t, np(p, k2)) : R.createElement(t, np(p, k2), c);
      }
      function jsxs(t, p, k2) {
        return R.createElement.apply(R, [t, np(p, k2)].concat(p.children));
      }
      module.exports = R;
      module.exports.jsx = jsx;
      module.exports.jsxs = jsxs;
      module.exports.jsxDEV = function(t, p, k2, s2) {
        return (s2 ? jsxs : jsx)(t, p, k2);
      };
      module.exports.Fragment = R.Fragment;
    }
  });

  // design-system/dist/index.es.js
  var index_es_exports = {};
  __export(index_es_exports, {
    Avatar: () => V,
    Badge: () => u,
    Button: () => N,
    Card: () => f,
    Input: () => T,
    Modal: () => F,
    Pill: () => E,
    PollCard: () => M,
    Toolbar: () => A,
    VoteForm: () => O
  });
  init_define_import_meta_env();
  var import_jsx_runtime = __toESM(require_react_shim(), 1);
  var import_react = __toESM(require_react_shim(), 1);
  var N = ({
    variant: l = "primary",
    size: a = "md",
    block: i = false,
    loading: r = false,
    icon: c,
    disabled: n,
    children: t,
    className: o,
    ..._
  }) => {
    const d = [
      "ip-btn",
      `ip-btn--${l}`,
      `ip-btn--${a}`,
      i ? "ip-btn--block" : "",
      r ? "ip-btn--loading" : "",
      o || ""
    ].filter(Boolean).join(" ");
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { className: d, disabled: n || r, ..._, children: [
      r && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ip-btn__spinner", "aria-hidden": "true" }),
      !r && c && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ip-btn__icon", children: c }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ip-btn__label", children: t })
    ] });
  };
  var f = ({
    interactive: l = false,
    padding: a = "md",
    className: i,
    children: r,
    ...c
  }) => {
    const n = [
      "ip-card",
      l ? "ip-card--interactive" : "",
      `ip-card--pad-${a}`,
      i || ""
    ].filter(Boolean).join(" ");
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: n, ...c, children: r });
  };
  var u = ({
    tone: l = "neutral",
    dot: a = false,
    icon: i,
    className: r,
    children: c,
    ...n
  }) => {
    const t = ["ip-badge", `ip-badge--${l}`, r || ""].filter(Boolean).join(" ");
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: t, ...n, children: [
      a && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ip-badge__dot", "aria-hidden": "true" }),
      i && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ip-badge__icon", children: i }),
      c
    ] });
  };
  var E = ({ icon: l, active: a = false, className: i, children: r, ...c }) => {
    const n = ["ip-pill", a ? "ip-pill--active" : "", i || ""].filter(Boolean).join(" ");
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: n, ...c, children: [
      l && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ip-pill__icon", children: l }),
      r
    ] });
  };
  var T = ({
    label: l,
    hint: a,
    invalid: i = false,
    icon: r,
    className: c,
    id: n,
    ...t
  }) => {
    const o = n || (l ? `ip-input-${l.replace(/\s+/g, "-").toLowerCase()}` : void 0);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: ["ip-field", i ? "ip-field--invalid" : "", c || ""].filter(Boolean).join(" "), children: [
      l && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "ip-field__label", htmlFor: o, children: l }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ip-field__control", children: [
        r && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ip-field__icon", children: r }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { id: o, className: "ip-field__input", "aria-invalid": i, ...t })
      ] }),
      a && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ip-field__hint", children: a })
    ] });
  };
  var b = ["#5e6ad2", "#8b5cf6", "#7c8cff", "#34d399", "#fbbf24", "#f87171", "#22d3ee"];
  function j(l) {
    let a = 0;
    for (let i = 0; i < l.length; i++) a = a * 31 + l.charCodeAt(i) >>> 0;
    return a;
  }
  function B(l) {
    const a = l.replace(/^u\//, "").trim().split(/\s+/).filter(Boolean);
    return a.length === 0 ? "?" : a.length === 1 ? a[0].slice(0, 2).toUpperCase() : (a[0][0] + a[a.length - 1][0]).toUpperCase();
  }
  var V = ({ name: l, src: a, size: i = "md", className: r, style: c, ...n }) => {
    const t = b[j(l) % b.length], o = ["ip-avatar", `ip-avatar--${i}`, r || ""].filter(Boolean).join(" ");
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "span",
      {
        className: o,
        style: { "--ip-avatar-color": t, ...c },
        title: l,
        ...n,
        children: a ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { className: "ip-avatar__img", src: a, alt: l }) : B(l)
      }
    );
  };
  var A = ({ start: l, title: a, end: i, className: r, children: c, ...n }) => {
    const t = ["ip-toolbar", r || ""].filter(Boolean).join(" ");
    return c ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: t, ...n, children: c }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: t, ...n, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ip-toolbar__start", children: l }),
      a && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ip-toolbar__title", children: a }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ip-toolbar__end", children: i })
    ] });
  };
  var F = ({
    open: l = true,
    title: a,
    footer: i,
    onClose: r,
    className: c,
    children: n,
    ...t
  }) => l ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ip-modal__backdrop", onClick: r, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      className: ["ip-modal", c || ""].filter(Boolean).join(" "),
      role: "dialog",
      "aria-modal": "true",
      onClick: (o) => o.stopPropagation(),
      ...t,
      children: [
        (a || r) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ip-modal__header", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: "ip-modal__title", children: a }),
          r && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "ip-modal__close", "aria-label": "Close", onClick: r, children: "\xD7" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ip-modal__body", children: n }),
        i && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ip-modal__footer", children: i })
      ]
    }
  ) }) : null;
  var x = "\u{1F4CA}";
  var C = "\u{1F465}";
  var $ = "\u{1F6E1}\uFE0F";
  var k = "\u23F3";
  var M = ({
    question: l,
    description: a,
    options: i,
    author: r = "anon",
    timeAgo: c,
    timeRemaining: n,
    verifiedCount: t = 0,
    ended: o = false,
    onClick: _
  }) => {
    const d = i.reduce((p, v) => p + (v.votes || 0), 0), m = i.slice(0, 3), h = (p) => d > 0 ? Math.round((p.votes || 0) / d * 100) : 0;
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(f, { interactive: true, padding: "none", className: "ip-pollcard", onClick: _, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ip-pollcard__body", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ip-pollcard__header", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(u, { tone: "accent", icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": true, children: x }), children: "Poll" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ip-pollcard__meta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ip-pollcard__author", children: [
            "u/",
            r
          ] }),
          c && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ip-pollcard__dot", children: "\u2022" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: c })
          ] }),
          o && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(u, { tone: "neutral", className: "ip-pollcard__ended", children: "Ended" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "ip-pollcard__question", children: l || "Untitled Poll" }),
      a && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "ip-pollcard__description", children: a }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ip-pollcard__options", children: [
        m.map((p, v) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ip-pollcard__option", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ip-pollcard__bar", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ip-pollcard__fill", style: { width: `${h(p)}%` } }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ip-pollcard__option-info", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ip-pollcard__option-text", children: p.text || `Option ${v + 1}` }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ip-pollcard__option-votes", children: [
              h(p),
              "%"
            ] })
          ] })
        ] }, p.id || v)),
        i.length > 3 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ip-pollcard__more", children: [
          "+",
          i.length - 3,
          " more option",
          i.length - 3 !== 1 ? "s" : ""
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "ip-pollcard__footer", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ip-pollcard__stat", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": true, children: C }),
          " ",
          d,
          " vote",
          d !== 1 ? "s" : ""
        ] }),
        t > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ip-pollcard__stat ip-pollcard__stat--verified", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": true, children: $ }),
          " ",
          t,
          " verified"
        ] }),
        n && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "ip-pollcard__stat", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": true, children: k }),
          " ",
          n
        ] })
      ] })
    ] }) });
  };
  var O = ({
    title: l,
    description: a,
    options: i,
    alreadyVoted: r = false,
    submitting: c = false,
    onSubmit: n
  }) => {
    const [t, o] = (0, import_react.useState)("");
    return r ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(f, { padding: "lg", className: "ip-voteform ip-voteform--voted", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ip-voteform__voted-badge", "aria-hidden": true, children: "\u26A0\uFE0E" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "ip-voteform__voted-title", children: "Already Voted" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "ip-voteform__voted-text", children: "You've already voted on this poll from this device. Each device can only vote once to ensure fair results." }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(N, { variant: "secondary", size: "sm", className: "ip-voteform__voted-action", children: "View My Receipt" })
      ] })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(f, { padding: "lg", className: "ip-voteform", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "ip-voteform__title", children: l }),
      a && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "ip-voteform__description", children: a }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "ip-voteform__options", role: "radiogroup", "aria-label": l, children: i.map((_, d) => {
        const m = _.id || _.text, h = t === m;
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "label",
          {
            className: ["ip-voteform__option", h ? "ip-voteform__option--active" : ""].join(" "),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  type: "radio",
                  name: "ip-vote",
                  value: m,
                  checked: h,
                  onChange: () => o(m),
                  className: "ip-voteform__radio"
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ip-voteform__radio-dot", "aria-hidden": true }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "ip-voteform__option-text", children: _.text || `Option ${d + 1}` })
            ]
          },
          m
        );
      }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "ip-voteform__notice", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "One vote per device." }),
        " Your device fingerprint is recorded to prevent duplicates. You'll receive a 12-word verification code to verify your vote later."
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        N,
        {
          block: true,
          loading: c,
          disabled: !t,
          onClick: () => t && (n == null ? void 0 : n(t)),
          className: "ip-voteform__submit",
          children: c ? "Submitting\u2026" : "Cast Vote"
        }
      )
    ] });
  };
  return __toCommonJS(index_es_exports);
})();
window.InterpollDS=InterpollDS.__dsMainNs?Object.assign({},InterpollDS,InterpollDS.__dsMainNs,{__dsMainNs:undefined}):InterpollDS;
