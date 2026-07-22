/*! Cosmos 100% alignment prototype | docs.augmentcode.com + product UI */
(function () {
  "use strict";

  /* ========== ICONS ========== */
  const S = (d, n = 15) =>
    `<svg width="${n}" height="${n}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  /* Product Cosmos mark (interlocking striped rings) — advisor banners, not the expert hex */
  const COSMOS_MARK = `<svg class="cosmos-mark" width="18" height="15" viewBox="0 0 555 475" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M338.889 179.894C345.523 176.878 356.331 170.214 362.865 166.437L478.429 99.7614C492.173 91.8334 506.73 83.7446 520.204 75.4805C521.775 77.4917 523.411 80.5455 524.87 82.73C529.519 89.6929 533.07 96.5978 536.918 103.999C536.969 104.247 536.885 104.421 536.824 104.703C535.522 106.081 524.208 112.315 521.835 113.675L356.691 208.934C355.88 207.673 355.036 206.086 354.351 204.74C349.864 195.914 344.371 188.094 338.889 179.894Z"/><path d="M42.322 408.403C51.9709 402.648 62.1451 396.967 71.8997 391.339L131.312 357.056C163.142 338.689 195.565 319.455 227.538 301.599C233.264 308.267 241.458 317.479 248.303 323.001C245.762 323.996 234.214 330.95 231.368 332.595L62.9859 429.754C57.6415 425.414 45.8982 414.092 42.322 408.403Z"/><path d="M310.564 149.956L492.071 45.2755C496.661 47.7759 509.14 62.0715 513.293 66.2496L331.521 171.121C327.708 166.59 324.496 163.09 320.209 158.937C317.786 156.589 312.482 152.26 310.564 149.956Z"/><path d="M76.8659 440.564C82.7778 437.613 90.5984 432.803 96.4958 429.402L215.78 360.584C231.02 351.79 246.501 342.626 261.846 334.083C264.305 335.147 268.152 337.909 270.571 339.443C274.595 341.973 278.71 344.354 282.908 346.581C260.284 360.201 236.111 373.625 213.118 386.892L97.4781 453.59C93.3225 451.519 79.4831 443.5 76.8659 440.564Z"/><path d="M274.487 127.058C287.487 119.187 301.56 111.361 314.76 103.746L434.086 34.9041C440.394 31.2606 451.191 24.5885 457.433 21.5889C461.716 23.1815 475.035 31.2458 478.142 34.4451C476.397 35.1418 473.126 37.1321 471.365 38.1494L341.34 113.183C326.297 121.862 310.93 130.555 296.017 139.414C290.816 135.599 280.261 130.21 274.487 127.058Z"/><path d="M124.521 465.072C126.707 463.567 131.065 461.227 133.457 459.847L296.779 365.615C300.902 363.23 305.686 360.305 309.9 358.19C312.248 358.278 324.175 361.554 326.758 362.474C315.509 369.383 301.937 376.765 290.392 383.426L166.937 454.663C159.472 458.979 148.087 466.032 140.6 469.713C137.144 469.712 127.716 466.412 124.521 465.072Z"/><path d="M228.779 112.255C236.381 107.38 247.697 101.31 255.677 96.7057L377.296 26.5261C389.209 19.6521 402.109 11.8542 414.095 5.42257C418.222 5.43332 426.667 8.28854 430.522 9.8971C424.598 13.7895 414.998 18.93 408.574 22.6344L246.089 116.366C243.664 115.977 230.296 112.954 228.779 112.255Z"/><path d="M180.135 474.519C182.651 472.725 189.645 468.94 192.646 467.205L301.182 404.589C306.2 401.694 340.513 381.394 342.622 381.125L342.855 381.518C342.455 383.049 341.206 384.872 340.356 386.269C333.934 397.003 334.459 396.421 323.836 402.434L310.849 409.908L219.319 462.715L207.515 469.572C205.441 470.775 201.722 472.947 199.762 473.748C196.96 474.894 182.307 475.475 180.135 474.519Z"/><path d="M222.397 77.765C225.211 75.9136 229.369 73.6694 232.384 71.932L339.917 9.87972C343.839 7.61381 351.012 3.33586 354.848 1.45183C358.127 -0.158819 371.349 -0.21648 375.229 0.262556C370.427 3.18238 365.342 6.04557 360.467 8.87413L262.161 65.5908C245.826 75.0152 227.621 85.0344 211.65 94.8606C212.863 90.8996 219.36 80.5243 222.397 77.765Z"/><path d="M83.4006 138.111L100.196 128.421C103.531 127.613 109.045 124.386 112.388 122.953C115.962 121.421 119.414 120.162 123.087 118.877C150.043 109.534 178.803 106.575 207.101 110.231C204.867 114.467 202.835 118.806 201.012 123.234C183.291 166.003 183.276 214.058 200.968 256.848C196.295 259.888 188.734 263.931 183.725 266.82L42.0237 348.569C38.9376 350.35 15.7881 363.936 14.9806 363.904C13.8222 362.5 11.571 356.027 10.848 354.051C2.77281 331.391 -0.853227 307.388 0.168813 283.358C2.50055 228.454 30.4777 176.427 75.0207 144.205C77.9778 142.065 80.6051 140.671 83.4006 138.111Z"/><path d="M359.333 214.988C375.51 205.935 391.8 196.32 407.886 187.04L497.699 135.218C511.617 127.187 526.147 118.447 540.095 110.713C544.083 120.528 546.894 128.067 549.513 138.456C559.055 176.586 556.096 216.767 541.071 253.084C530.504 278.66 514.269 301.507 493.591 319.908C490.136 322.965 486.307 326.172 482.697 329.058C479.987 331.22 475.491 333.449 473.182 336.009L453.148 347.567C449.011 348.674 446.441 350.473 442.612 352.056C438.969 353.562 434.775 355.089 431.044 356.379C410.287 363.439 388.44 366.761 366.517 366.19C363.125 366.076 358.284 365.925 355.035 365.376C357.638 360.809 361.622 351.092 363.462 346.066C375.871 312.367 377.58 275.66 368.351 240.952C366.905 235.598 365.221 230.312 363.305 225.108C362.338 222.562 359.992 217.253 359.333 214.988Z"/><path d="M19.5667 374.523C18.9045 372.683 17.5215 370.219 19.9228 368.963C24.3162 366.666 28.576 364.152 32.869 361.673L189.684 271.178C193.926 268.727 199.515 265.674 203.508 262.98C205.947 267.726 208.201 272.608 210.833 277.255C213.73 282.368 217.193 287.339 220.441 292.244C216.682 294.998 206.217 300.683 201.67 303.3L81.0763 372.864C65.8042 381.676 50.221 390.468 35.0956 399.463C33.6845 397.356 31.3511 393.614 29.6212 391.925L19.5667 374.523Z"/></svg>`;
  const I = {
    cosmos: COSMOS_MARK,
    /* Expert card glyph — thin hex outline (product) */
    hex: S(`<path d="M8 1.75l5.4 3.1v6.3L8 14.25 2.6 11.15v-6.3L8 1.75z"/>`),
    agent: S(`<path d="M8 1.75l5.4 3.1v6.3L8 14.25 2.6 11.15v-6.3L8 1.75z"/><circle cx="6.5" cy="7.2" r=".65" fill="currentColor" stroke="none"/><circle cx="9.5" cy="7.2" r=".65" fill="currentColor" stroke="none"/>`),
    folder: S(`<path d="M2.5 4h3.2l1.3 1.3H13.5v7.2a1 1 0 01-1 1h-9a1 1 0 01-1-1V4z"/>`),
    file: S(`<path d="M4.2 2.5h4.3L11.8 5.8V13.5H4.2V2.5z"/><path d="M8.5 2.5V5.8h3.3"/>`, 14),
    env: S(`<rect x="2.5" y="4.5" width="11" height="8" rx="1.5"/><path d="M5.2 4.5V3.4a1 1 0 011-1h3.6a1 1 0 011 1v1.1"/>`, 14),
    sessions: S(`<path d="M3.5 3.5h9a1 1 0 011 1v5.5a1 1 0 01-1 1H7.2L4.5 13.2V11H3.5a1 1 0 01-1-1V4.5a1 1 0 011-1z"/>`),
    auto: S(`<path d="M5.2 10.5c-1.4 0-2.5-1.1-2.5-2.5S3.8 5.5 5.2 5.5c1.1 0 1.9.5 2.8 1.5L8 8l-.05.05C7.1 9.9 6.3 10.5 5.2 10.5zM10.8 5.5c1.4 0 2.5 1.1 2.5 2.5s-1.1 2.5-2.5 2.5c-1.1 0-1.9-.5-2.8-1.5L8 8l.05-.05C8.9 6.1 9.7 5.5 10.8 5.5z"/>`),
    config: S(`<path d="M3 4.5h10M3 8h10M3 11.5h10"/><path d="M6 3.5v2M10 7v2M7.5 10.5v2"/>`),
    terminal: S(`<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><path d="M5 6.5l2 1.5L5 9.5M8.5 9.5H11"/>`),
    subs: S(`<path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h6"/><circle cx="12" cy="11.5" r="1.2"/>`),
    github: S(`<path d="M8 2.2a5.8 5.8 0 00-1.83 11.3c.3.05.4-.13.4-.28v-1c-1.67.36-2.02-.8-2.02-.8-.27-.7-.67-.88-.67-.88-.55-.37.04-.36.04-.36.6.04.92.62.92.62.54.92 1.4.66 1.75.5.05-.4.21-.66.38-.81-1.33-.15-2.73-.67-2.73-2.96 0-.66.23-1.19.62-1.61-.06-.15-.27-.77.06-1.6 0 0 .5-.16 1.65.62a5.7 5.7 0 013 0c1.14-.78 1.64-.62 1.64-.62.33.83.12 1.45.06 1.6.39.42.62.95.62 1.61 0 2.3-1.4 2.8-2.74 2.95.22.19.41.56.41 1.13v1.68c0 .15.1.34.41.28A5.8 5.8 0 008 2.2z"/>`),
    linear: S(`<path d="M3.5 10.2L10.2 3.5M4.8 12.2a5.2 5.2 0 007.4-7.4"/>`),
    slack: S(`<path d="M5.5 9.5a1.2 1.2 0 01-1.2 1.2H3.1a1.2 1.2 0 010-2.4h1.2a1.2 1.2 0 011.2 1.2zm.6 0a1.2 1.2 0 011.2-1.2h2.4v1.2a1.2 1.2 0 01-2.4 0V9.5zM6.1 5.5A1.2 1.2 0 015 4.3V3.1a1.2 1.2 0 012.4 0v1.2a1.2 1.2 0 01-1.2 1.2zm0 .6a1.2 1.2 0 011.2 1.2v2.4H6.1a1.2 1.2 0 010-2.4V6.1z"/>`),
    web: S(`<circle cx="8" cy="8" r="5.2"/><path d="M2.8 8h10.4M8 2.8c1.5 1.6 2.3 3.4 2.3 5.2S9.5 11.6 8 13.2C6.5 11.6 5.7 9.8 5.7 8S6.5 4.4 8 2.8z"/>`),
    cloud: S(`<path d="M4.5 11.5h7.2a2.6 2.6 0 00.3-5.2 3.5 3.5 0 00-6.7-1.2A2.8 2.8 0 004.5 11.5z"/>`),
    daemon: S(`<rect x="3" y="5" width="10" height="7" rx="1"/><path d="M5.5 5V3.8a2.5 2.5 0 015 0V5M6.5 8.5h3"/>`),
    /* Composer tools chip — product uses compact headset/tool glyph */
    tools: S(`<path d="M5.2 10.8a2.4 2.4 0 01-2.4-2.4V7.2a3.2 3.2 0 015.4-2.3 3.2 3.2 0 015 2.3v1.2a2.4 2.4 0 01-2.4 2.4"/><path d="M5.2 10.8v1.4a1.4 1.4 0 001.4 1.4h2.8a1.4 1.4 0 001.4-1.4v-1.4"/>`),
    copy: S(`<rect x="5.5" y="5.5" width="7" height="7" rx="1"/><path d="M3.5 10.5V3.5a1 1 0 011-1h7"/>`),
    sun: S(`<circle cx="8" cy="8" r="2.8"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1.1 1.1M11.1 11.1l1.1 1.1M3.8 12.2l1.1-1.1M11.1 4.9l1.1-1.1"/>`),
    moon: S(`<path d="M11.5 9.2A4.5 4.5 0 118 2.8 3.5 3.5 0 0011.5 9.2z"/>`),
    keyboard: S(`<rect x="2" y="4" width="12" height="8" rx="1.5"/><path d="M4.5 7h.01M7 7h.01M9.5 7h.01M12 7h.01M5.5 9.5h5"/>`),
    share: S(`<circle cx="12" cy="4.5" r="1.5"/><circle cx="4" cy="8" r="1.5"/><circle cx="12" cy="11.5" r="1.5"/><path d="M5.4 7.3l5.2-2.1M5.4 8.7l5.2 2.1"/>`),
    plus: S(`<path d="M8 3.5v9M3.5 8h9"/>`),
    search: S(`<circle cx="7" cy="7" r="4"/><path d="M10.5 10.5L13.2 13.2"/>`),
    chev: S(`<path d="M6 4l4 4-4 4"/>`, 12),
    chevD: S(`<path d="M4 6l4 4 4-4"/>`, 12),
  };

  /* ========== DATA ========== */
  /* Product Experts table: Name · Automations · Integrations · Creator · Updated */
  /* 12 template Experts, aligned to docs/experts-templates (name + one-line purpose per doc). */
  const EXPERTS = [
    { id: "advisor", name: "Cosmos Advisor", desc: "Your go-to agent for navigating Cosmos — connects integrations, builds Environments, creates and tunes Experts, and wires Automations through prompting rather than editing forms.", instructions: "Configure Cosmos conversationally. Prefer Advisor over hand-editing forms.", placeholder: "How can I set up Cosmos for my team?", badge: "New", badgeType: "new", starred: true, mine: false, shared: false, model: "prism", hitl: "advisor", prompt: "You are Cosmos Advisor. Help configure Experts, Environments, and Automations. Deploy triggers disarmed by default.", creator: "SR", updated: "Mon 12:17 PM", integ: ["github", "linear", "slack", "web"], autos: 0 },
    { id: "pr-author", name: "PR Author", desc: "The canonical Ticket-to-PR Expert — takes a request to a ready-for-review pull request or merge request.", instructions: "Canonical Ticket-to-PR expert. CRITICAL: never change code without opening a PR.", placeholder: "Describe the change you want implemented…", badge: "18/wk", badgeType: "freq", starred: true, mine: true, shared: false, model: "prism", hitl: "checkpoint", prompt: "CRITICAL: You MUST NEVER make code changes without opening a pull request.\nYou are a GitHub PR Author agent.", creator: "SR", updated: "May 7, 8:23 AM", integ: ["github", "linear", "slack"], autos: 1 },
    { id: "risk-analyzer", name: "Risk Analyzer", desc: "Triages new code reviews — auto-approves low-risk changes with a brief justification and routes higher-risk ones to focused human review, handing flagged changes to Pair Reviewer.", instructions: "Automated trigger on PR/MR opened or marked ready for review. Auto-approve low-risk; flag higher-risk with a focused note.", placeholder: "Paste a PR/MR URL to assess risk…", badge: "9/wk", badgeType: "freq", starred: false, mine: false, shared: true, model: "prism", hitl: "automation", prompt: "You are Risk Analyzer. Auto-approve low-risk changes; route higher-risk ones (architecture, security, rollout, tests, product behavior) to focused human review.", creator: "SR", updated: "May 8, 9:12 AM", integ: ["github", "slack"], autos: 1 },
    { id: "deep-reviewer", name: "Deep Reviewer", desc: "Performs non-interactive, line-by-line correctness review — posts detailed inline comments with an approve / request-changes verdict.", instructions: "This is a non-interactive deep review: the agent reviews the PR and posts inline bug-finding comments on behalf of the Augment bot. There is no human-in-the-loop — the agent does not consult you between phases.", placeholder: "GitHub PR URL", badge: "12/wk", badgeType: "freq", starred: true, mine: false, shared: true, model: "claude-opus-4", hitl: "non-interactive", prompt: "You are Deep Reviewer. Review the PR line-by-line for correctness, security, and test completeness. Post inline comments and a final verdict.", creator: "SR", updated: "Mon 3:20 PM", integ: ["github", "linear", "slack"], autos: 0 },
    { id: "pair-reviewer", name: "Pair Reviewer", desc: "Interactive review focused on items in the change requiring human judgment and knowledge transfer — design, architecture, and security.", instructions: "Interactive review — pull humans in for architecture and security judgment.", placeholder: "Paste a PR URL for pair review…", badge: "6/wk", badgeType: "freq", starred: false, mine: false, shared: true, model: "claude-opus-4", hitl: "interactive", prompt: "You are Pair Reviewer. Focus on design, architecture, security, and knowledge transfer. Ask when judgment is required.", creator: "SR", updated: "May 5, 4:06 PM", integ: ["github", "slack"], autos: 0 },
    { id: "verifier", name: "Verifier", desc: "Exercises a change against a running environment and reports evidence-backed findings focused on merge confidence — does not merge code or replace human judgment.", instructions: "Provision the identities/flags needed to exercise the change; deploy or serve it; gather evidence from observability. Report observations, not merge decisions.", placeholder: "Paste a change URL to verify…", badge: "5/wk", badgeType: "freq", starred: false, mine: false, shared: true, model: "claude-opus-4", hitl: "checkpoint", prompt: "You are Verifier. Exercise the change in a real environment and report evidence-backed findings. Never merge or replace human judgment.", creator: "SR", updated: "May 8, 2:05 PM", integ: ["github", "web"], autos: 0 },
    { id: "incident", name: "Incident Investigator", desc: "Investigates alerts or incident threads and summarizes evidence-backed findings.", instructions: "Investigate alerts and incident threads; summarize findings with supporting evidence.", placeholder: "Paste an alert or incident thread…", badge: "1/wk", badgeType: "freq", starred: false, mine: false, shared: true, model: "claude-opus-4", hitl: "checkpoint", prompt: "You are Incident Investigator. Investigate the alert or incident thread and summarize evidence-backed findings.", creator: "SR", updated: "May 7, 8:25 AM", integ: ["slack", "web"], autos: 0 },
    { id: "feedback-triager", name: "Feedback Triager", desc: "Converts incoming feedback into one researched downstream ticket per thread — watches Slack channels, researches with codebase context, then files in Linear without duplicates.", instructions: "Run on a schedule or trigger. Read the full feedback thread, research with codebase context, and file one well-formed downstream ticket per thread.", placeholder: "Which feedback channel should I watch?", badge: "7/wk", badgeType: "freq", starred: false, mine: false, shared: true, model: "prism", hitl: "automation", prompt: "You are Feedback Triager. Convert each feedback thread into one researched, de-duplicated downstream ticket in Linear.", creator: "SR", updated: "May 6, 4:40 PM", integ: ["slack", "linear"], autos: 1 },
    { id: "project-builder", name: "Project Builder", desc: "Turns a large feature into a design, ticket breakdown, and coordinated implementation — launches a PR Author worker per unit of work in dependency waves. Never writes feature code itself.", instructions: "Interactive. Research the repo, draft and iterate on a design doc, break work into tickets, then dispatch PR Author workers in dependency waves. Never merge or write feature code.", placeholder: "Describe the feature, or paste a doc / mockup / ticket…", badge: "3/wk", badgeType: "freq", starred: false, mine: true, shared: false, model: "claude-opus-4", hitl: "interactive", prompt: "You are Project Builder. Turn the feature into a design, ticket breakdown, and coordinated implementation via PR Author workers. Report when changes are ready for review and when the feature is complete.", creator: "AV", updated: "May 6, 11:02 AM", integ: ["github", "linear"], autos: 0 },
    { id: "ticket-dispatcher", name: "Ticket Dispatcher", desc: "Scans ready work and dispatches implementation workers under backpressure — one worker per ticket, labelled dispatched / skipped / failed so re-runs don't double-fire.", instructions: "Dispatch ready work to PR Author workers.", placeholder: "Which projects should I scan?", badge: "4/wk", badgeType: "freq", starred: false, mine: false, shared: false, model: "prism", hitl: "automation", prompt: "Scan tickets and dispatch implementation workers.", creator: "SR", updated: "May 7, 8:23 AM", integ: ["github", "linear"], autos: 1 },
    { id: "data-analyst", name: "Data Analyst", desc: "Answers questions about your data with read-only queries against source-of-truth datasets — names the source and time window per answer, and asks rather than guesses without a data guide.", instructions: "Read-only query tooling on a cloud environment. Pull credentials from Cosmos secrets. Follow the user-supplied data guide for the authoritative dataset and metric definitions.", placeholder: "Ask a question about your data…", badge: "New", badgeType: "new", starred: false, mine: true, shared: false, model: "prism", hitl: "interactive", prompt: "You are Data Analyst. Answer with read-only queries against the authoritative dataset. Name the source and time window in every answer. Without a data guide, ask rather than guess.", creator: "AV", updated: "Mon 1:38 PM", integ: ["web"], autos: 0 },
    { id: "cosmos-analyst", name: "Cosmos Analyst", desc: "Reports how Cosmos impacted your engineering team using GitHub PR / GitLab MR activity and cost data — read-only by discipline, never posts or approves.", instructions: "Read-only. Point at repos/projects, the team, an optional adoption start date, and a data window. Compute changes per engineer, complexity-weighted output, cycle time, revert rate, and lines of code.", placeholder: "Which repos and window should I analyze?", badge: "New", badgeType: "new", starred: false, mine: false, shared: true, model: "prism", hitl: "interactive", prompt: "You are Cosmos Analyst. Report engineering ROI from GitHub PR / GitLab MR activity paired with Cosmos spend over the chosen window. Read-only — never post or approve.", creator: "SR", updated: "May 8, 10:39 AM", integ: ["github"], autos: 0 },
  ];

  const MODELS = [
    { id: "prism", group: "Routing", name: "Prism (Claude + Gemini)", short: "Prism", sub: "Auto-routes each turn for cost + quality", prism: true },
    { id: "claude-sonnet", group: "Single model", name: "Claude Sonnet 4.6", short: "Sonnet 4.6", sub: "Balanced speed + intelligence" },
    { id: "claude-opus-4", group: "Single model", name: "Claude Opus 4.7", short: "Opus 4.7", sub: "Highest capability" },
    { id: "gemini", group: "Single model", name: "Gemini 2.5 Pro", short: "Gemini 2.5", sub: "Long context tasks" },
  ];

  /* Product Environments table: Name · Size · Repos · Creator · Last built */
  const ENVIRONMENTS = [
    { id: "gitlab-env", name: "Gitlab_env", kind: "Cloud", size: "2 CPU · 4GB", repos: [], note: "", creator: "SR", built: "8 hours ago", mine: true },
    { id: "hermes", name: "hermes_test", kind: "Cloud", size: "0.125 CPU · 2GB", repos: ["augment-solutions/aaos-vhal"], note: "", creator: "SR", built: "7 hours ago", mine: true },
    { id: "sharath-demo", name: "Sharath-Demo", kind: "Cloud", size: "2 CPU · 4GB", repos: ["augment-solutions/voyager"], note: "This env is made for the Github Jira E2E demo", creator: "SR", built: "6 hours ago", mine: true },
    { id: "sharath-test", name: "Sharath-Test", kind: "Cloud", size: "2 CPU · 4GB", repos: ["augment-solutions/voyager"], note: "", creator: "SR", built: "6 hours ago", mine: true },
    { id: "augment", name: "Augment", kind: "Cloud", size: "2 CPU · 4GB", repos: ["acme/acme-monorepo"], note: "TypeScript 6.0 base", creator: "AV", built: "2 days ago", mine: true },
    { id: "daemon", name: "laptop-daemon", kind: "Self-hosted", size: "host", repos: [], note: "macOS arm64 daemon", creator: "AV", built: "1 day ago", mine: true },
    { id: "rails", name: "billing-rails", kind: "Cloud", size: "2 CPU · 4GB", repos: ["acme/billing"], note: "Ruby 3.4", creator: "TM", built: "3 days ago", mine: false },
  ];

  const INTEGRATIONS = [
    { id: "gh-app", name: "GitHub App", group: "Team Apps", icon: "github", connected: true },
    { id: "linear-app", name: "Linear App", group: "Team Apps", icon: "linear", connected: true },
    { id: "slack", name: "Slack", group: "Team Apps", icon: "slack", connected: true },
    { id: "pagerduty", name: "PagerDuty", group: "Team Apps", icon: "hex", connected: false },
    { id: "gitlab", name: "GitLab", group: "Team Apps", icon: "hex", connected: false },
    { id: "gh-user", name: "GitHub", group: "Personal Apps", icon: "github", connected: true },
    { id: "linear-user", name: "Linear", group: "Personal Apps", icon: "linear", connected: false },
    { id: "web-fetch", name: "Web Fetch", group: "Personal Apps", icon: "web", connected: true },
  ];

  const MCP = [
    { name: "Context Engine", url: "https://mcp.augmentcode.com/context", status: "active", transport: "http", scope: "org" },
    { name: "Sentry", url: "stdio://sentry-mcp", status: "active", transport: "stdio", scope: "org" },
    { name: "Notion", url: "https://mcp.notion.com", status: "paused", transport: "http", scope: "space" },
  ];

  /* Partner catalog (docs: Atlassian, Sentry, Stripe, Figma, Datadog, Salesforce) */
  const MCP_CATALOG = [
    { id: "sentry", name: "Sentry", blurb: "Errors, issues, and release health", transport: "stdio", url: "stdio://sentry-mcp", icon: "hex" },
    { id: "atlassian", name: "Atlassian", blurb: "Jira + Confluence via MCP", transport: "http", url: "https://mcp.atlassian.com/v1/sse", icon: "web" },
    { id: "stripe", name: "Stripe", blurb: "Payments, customers, disputes", transport: "http", url: "https://mcp.stripe.com", icon: "hex" },
    { id: "figma", name: "Figma", blurb: "Design files and components", transport: "http", url: "https://mcp.figma.com/mcp", icon: "hex" },
    { id: "datadog", name: "Datadog", blurb: "Metrics, logs, monitors", transport: "http", url: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp", icon: "hex" },
    { id: "salesforce", name: "Salesforce", blurb: "CRM objects and SOQL", transport: "http", url: "https://mcp.salesforce.com", icon: "cloud" },
    { id: "context", name: "Context Engine", blurb: "Augment structural codebase search", transport: "http", url: "https://mcp.augmentcode.com/context", icon: "hex" },
    { id: "custom", name: "Custom server", blurb: "HTTP, SSE, or stdio endpoint you host", transport: "http", url: "", icon: "plus", custom: true },
  ];
  const WEBHOOKS = [
    { id: "wh_9f2a1c", name: "datadog-alerts", url: "https://acme.api.augmentcode.com/webhooks/wh_9f2a1c", events: 128, scope: "shared", type: "Bearer Token" },
    { id: "wh_1bc4e2", name: "circleci-pipelines", url: "https://acme.api.augmentcode.com/webhooks/wh_1bc4e2", events: 42, scope: "personal", type: "Bearer Token" },
  ];
  /* Secrets scopes (docs/config-secrets): only Private | Shared. Auto-exported to VM as $UPPER_SNAKE. */
  const SECRETS = [
    { name: "OPENAI_API_KEY", scope: "Shared", vmInstall: true, updated: "3d ago" },
    { name: "SNYK_TOKEN", scope: "Shared", vmInstall: true, updated: "1w ago" },
    { name: "PAGERDUTY_KEY", scope: "Private", vmInstall: true, updated: "2w ago" },
  ];
  /* Product VFS: User / Organization dual-pane (tree + Name/Size/Modified list) */
  const FILES = {
    user: [
      { id: "demo-verifier", name: "demo-verifier", type: "folder", size: "62.4 KiB", modified: "4/24/2026, 12:43:02 PM", children: [
        { id: "dv-readme", name: "README.md", type: "file", size: "2.1 KiB", modified: "4/24/2026, 12:40:00 PM", content: "# Demo verifier\n\nEvidence-backed findings.\n" },
      ] },
      { id: "vertex-export", name: "vertex-ai-claude-workflow-export", type: "folder", size: "160.5 KiB", modified: "5/14/2026, 10:35:30 AM", children: [
        { id: "vx-main", name: "workflow.json", type: "file", size: "48.2 KiB", modified: "5/14/2026, 10:30:00 AM", content: "{\n  \"workflow\": \"vertex-ai-claude\"\n}\n" },
      ] },
      { id: "atmosic", name: "Atmosic_analysis.md", type: "file", size: "12.0 KiB", modified: "6/1/2026, 3:27:05 PM", content: "# Atmosic analysis\n\nFindings…\n" },
      { id: "call-csv", name: "call_analysis.csv", type: "file", size: "17.6 KiB", modified: "6/1/2026, 1:40:24 PM", content: "id,sentiment\n1,positive\n" },
      { id: "cust-csv", name: "cosmos_customers.csv", type: "file", size: "1.6 KiB", modified: "6/1/2026, 11:13:37 AM", content: "customer,plan\n" },
      { id: "overview-html", name: "cosmos-overview.html", type: "file", size: "26.9 KiB", modified: "5/4/2026, 10:28:48 AM", content: "<html><body>Cosmos overview</body></html>" },
      { id: "demo-overview", name: "demo_overview.md", type: "file", size: "11.8 KiB", modified: "4/23/2026, 12:55:11 PM", content: "# Demo overview\n" },
      { id: "demo-script", name: "demo_script.md", type: "file", size: "10.9 KiB", modified: "4/22/2026, 8:02:11 AM", content: "# Demo script\n" },
      { id: "first-steps", name: "first-steps.md", type: "file", size: "7.3 KiB", modified: "5/4/2026, 1:36:23 PM", content: "# First steps\n" },
      { id: "gitlab-zip", name: "gitlab-mr-experts-bundle.zip", type: "file", size: "25.0 KiB", modified: "4/30/2026, 10:03:37 AM", content: "(binary)" },
      { id: "mr-yaml", name: "mr-author.yaml", type: "file", size: "17.9 KiB", modified: "4/27/2026, 4:32:29 PM", content: "expert: PR Author\n" },
      { id: "plan", name: "plan.md", type: "file", size: "5.4 KiB", modified: "5/4/2026, 1:34:23 PM", content: "# Plan\n" },
      { id: "handoff", name: "poseidon-session-handoff.json", type: "file", size: "189 B", modified: "4/21/2026, 12:31:31 PM", content: "{}\n" },
      { id: "voy-acts", name: "poseidon-voyager-acts.pptx", type: "file", size: "34.0 KiB", modified: "5/4/2026, 10:16:59 AM", content: "(binary)" },
      { id: "voy-add", name: "poseidon-voyager-addenda.pptx", type: "file", size: "35.5 KiB", modified: "4/22/2026, 12:18:33 PM", content: "(binary)" },
      { id: "voy-demo", name: "poseidon-voyager-demo-session-handoff.md", type: "file", size: "12.5 KiB", modified: "4/21/2026, 12:45:18 PM", content: "# Handoff\n" },
      { id: "sessions-md", name: "sessions.md", type: "file", size: "6.9 KiB", modified: "4/21/2026, 11:30:44 AM", content: "# Sessions\n" },
      { id: "skills", name: ".augment", type: "folder", size: "4.2 KiB", modified: "5/1/2026, 9:00:00 AM", children: [
        { id: "skills-dir", name: "skills", type: "folder", size: "3.1 KiB", modified: "5/1/2026, 9:00:00 AM", children: [
          { id: "review", name: "review-style.md", type: "file", size: "1.2 KiB", modified: "5/1/2026, 9:00:00 AM", content: "# Review style\n" },
        ] },
      ] },
    ],
    /* Product Organization VFS sample (cosmos.augmentcode.com/vfs/org) */
    org: [
      { id: "experts", name: "experts", type: "folder", size: "128.5 KiB", modified: "6/3/2026, 3:28:44 PM", children: [
        { id: "ex-pr", name: "pr-author.yaml", type: "file", size: "12.0 KiB", modified: "6/3/2026, 3:20:00 PM", content: "name: PR Author\n" },
        { id: "ex-ci", name: "ci-triage.yaml", type: "file", size: "8.2 KiB", modified: "6/2/2026, 1:00:00 PM", content: "name: CI Triage\n" },
      ] },
      { id: "incident-reports", name: "incident-reports", type: "folder", size: "16.3 KiB", modified: "5/7/2026, 2:20:50 PM", children: [
        { id: "ir-1", name: "2026-05-sev1.md", type: "file", size: "4.1 KiB", modified: "5/7/2026, 2:15:00 PM", content: "# SEV-1\n" },
      ] },
      { id: "incidents", name: "incidents", type: "folder", size: "10.2 KiB", modified: "5/5/2026, 4:35:58 PM", children: [
        { id: "inc-runbook", name: "oncall.md", type: "file", size: "3.0 KiB", modified: "5/5/2026, 4:30:00 PM", content: "# On-call\n" },
      ] },
      { id: "knowledge", name: "knowledge", type: "folder", size: "9.4 KiB", modified: "6/1/2026, 4:54:40 PM", children: [
        { id: "know-1", name: "glossary.md", type: "file", size: "2.2 KiB", modified: "6/1/2026, 4:50:00 PM", content: "# Glossary\n" },
      ] },
      { id: "skills", name: "skills", type: "folder", size: "3.4 KiB", modified: "6/1/2026, 11:00:33 AM", children: [
        { id: "sk-review", name: "review.md", type: "file", size: "1.1 KiB", modified: "6/1/2026, 11:00:00 AM", content: "# Review skill\n" },
      ] },
      { id: "test", name: "test", type: "folder", size: "0 B", modified: "5/20/2026, 2:58:35 PM", children: [] },
      { id: "voy-runs", name: "voy-runs", type: "folder", size: "521.4 KiB", modified: "5/5/2026, 11:54:31 AM", children: [
        { id: "voy-1", name: "run-001.json", type: "file", size: "40.0 KiB", modified: "5/5/2026, 11:50:00 AM", content: "{}\n" },
      ] },
      { id: "ae-map", name: "ae-to-sa-mapping.json", type: "file", size: "5.5 KiB", modified: "4/14/2026, 8:11:43 AM", content: "{\n  \"mappings\": []\n}\n" },
      { id: "booking", name: "booking-rules.json", type: "file", size: "1.7 KiB", modified: "4/14/2026, 8:11:43 AM", content: "{\n  \"rules\": []\n}\n" },
      { id: "status", name: "CURRENT_STATUS.md", type: "file", size: "6.7 KiB", modified: "4/14/2026, 8:30:27 AM", content: "# Current status\n" },
      { id: "expert-yaml", name: "expert-yaml-example.yaml", type: "file", size: "3.6 KiB", modified: "4/14/2026, 8:15:57 AM", content: "expert:\n  name: example\n" },
      { id: "quick-ref", name: "QUICK_REFERENCE.md", type: "file", size: "3.6 KiB", modified: "4/14/2026, 8:15:57 AM", content: "# Quick reference\n" },
      { id: "readme-org", name: "README.md", type: "file", size: "4.1 KiB", modified: "4/14/2026, 8:11:43 AM", content: "# Organization VFS\n\nShared institutional memory.\n" },
      { id: "sa-assign", name: "sa-assignments.jsonl", type: "file", size: "0 B", modified: "4/14/2026, 8:11:43 AM", content: "" },
      { id: "sa-cal", name: "sa-calendar-config.json", type: "file", size: "3.4 KiB", modified: "4/14/2026, 8:11:43 AM", content: "{}\n" },
      { id: "setup", name: "SETUP_CHECKLIST.md", type: "file", size: "4.7 KiB", modified: "4/14/2026, 8:11:43 AM", content: "# Setup checklist\n" },
      { id: "slack-issue", name: "SLACK_WORKSPACE_ISSUE.md", type: "file", size: "4.9 KiB", modified: "4/14/2026, 8:22:32 AM", content: "# Slack workspace issue\n" },
      { id: "slack-mis", name: "SLACK_WORKSPACE_MISMATCH.md", type: "file", size: "5.5 KiB", modified: "4/14/2026, 8:32:24 AM", content: "# Slack workspace mismatch\n" },
      { id: "slack-ch", name: "slack-channels.json", type: "file", size: "1.9 KiB", modified: "4/14/2026, 8:15:57 AM", content: "{\n  \"channels\": []\n}\n" },
      { id: "ws-diag", name: "WORKSPACE_DIAGNOSIS.md", type: "file", size: "8.2 KiB", modified: "4/14/2026, 9:00:00 AM", content: "# Workspace diagnosis\n" },
    ],
  };
  const EVENTS = [
    { time: "10:04", source: "GitHub", detail: "pull_request.opened · acme-monorepo#4822", expert: "Deep Reviewer", status: "running" },
    { time: "10:02", source: "Linear", detail: "issue.status_changed · BIL-204 → In Progress", expert: "PR Author", status: "running" },
    { time: "09:51", source: "GitHub", detail: "pull_request.ready_for_review · acme-monorepo#4820", expert: "Risk Analyzer", status: "done" },
    { time: "09:12", source: "Slack", detail: "app_mention · #feedback-billing", expert: "Feedback Triager", status: "done" },
    { time: "08:40", source: "Schedule", detail: "cron 0 8 * * * · daily dispatch", expert: "Ticket Dispatcher", status: "done" },
    { time: "07:18", source: "Webhook", detail: "datadog-alerts · monitor triggered", expert: "Incident Investigator", status: "done" },
  ];
  /* Triggers: Expert + type + event + JSONLogic filter (docs/config-triggers) */
  const TRIGGERS = [
    { id: "t1", expertId: "deep-reviewer", name: "on-pr-opened", type: "github", event: "pull_request", filter: '{"==":[{"var":"action"},"opened"]}', armed: true, maxRpm: 10, autoArchive: true, detail: "GitHub · pull_request · action=opened" },
    { id: "t2", expertId: "pr-author", name: "linear-in-progress", type: "linear", event: "Issue", filter: '{"and":[{"==":[{"var":"action"},"update"]},{"==":[{"var":"data.state.name"},"In Progress"]}]}', armed: true, maxRpm: 5, autoArchive: false, detail: "Linear · Issue · status → In Progress" },
    { id: "t3", expertId: "ticket-dispatcher", name: "daily-dispatch", type: "schedule", event: "cron", filter: "", armed: false, maxRpm: 1, autoArchive: true, detail: "Schedule · 0 8 * * * · America/Los_Angeles", cron: "0 8 * * *", tz: "America/Los_Angeles" },
    { id: "t4", expertId: "risk-analyzer", name: "on-pr-ready", type: "github", event: "pull_request", filter: '{"in":[{"var":"action"},["opened","ready_for_review"]]}', armed: true, maxRpm: 20, autoArchive: true, detail: "GitHub · pull_request · opened / ready_for_review" },
    { id: "t5", expertId: "incident", name: "pd-p1", type: "pagerduty", event: "incident.triggered", filter: '{"in":[{"var":"event.data.priority.name"},["P1"]]}', armed: false, maxRpm: 30, autoArchive: true, detail: "PagerDuty · incident.triggered · P1" },
  ];

  const TRIGGER_TYPES = [
    { id: "github", label: "GitHub", group: "First-party", events: ["pull_request", "pull_request_review", "pull_request_review_comment", "issues", "issue_comment", "push", "check_suite", "status", "workflow_run", "workflow_job", "workflow_dispatch"], sampleFilter: '{"==":[{"var":"action"},"opened"]}' },
    { id: "linear", label: "Linear", group: "First-party", events: ["Issue", "Comment", "Project"], sampleFilter: '{"==":[{"var":"action"},"update"]}' },
    { id: "slack", label: "Slack", group: "First-party", events: ["app_mention", "message"], sampleFilter: '{"==":[{"var":"event.type"},"app_mention"]}' },
    { id: "gitlab", label: "GitLab", group: "First-party", events: ["gitlab.push", "gitlab.tag_push", "gitlab.merge_request", "gitlab.issue", "gitlab.note", "gitlab.pipeline"], sampleFilter: "" },
    { id: "pagerduty", label: "PagerDuty", group: "First-party", events: ["incident.triggered", "incident.acknowledged", "incident.resolved"], sampleFilter: '{"==":[{"var":"event.event_type"},"incident.triggered"]}' },
    { id: "schedule", label: "Scheduled", group: "Schedule", events: ["cron"], sampleFilter: "" },
    { id: "webhook", label: "Webhook", group: "Webhook", events: ["json_post"], sampleFilter: "" },
  ];

  const EVENT_PAYLOADS = {
    "GitHub|pull_request.opened · acme-monorepo#4822": {
      source: "GitHub", event: "pull_request", headers: { "X-GitHub-Event": "pull_request", "X-GitHub-Delivery": "abc-123" },
      payload: { action: "opened", number: 4822, pull_request: { title: "feat: refund path", base: { ref: "main" }, head: { ref: "feat/refund" }, draft: false }, repository: { full_name: "acme/acme-monorepo" } },
    },
    "Linear|issue.status_changed · BIL-204 → In Progress": {
      source: "Linear", event: "Issue", headers: { "Linear-Delivery": "evt_9f2" },
      payload: { action: "update", type: "Issue", data: { id: "BIL-204", title: "Refund endpoint", state: { name: "In Progress" } }, updatedFrom: { state: { name: "Todo" } } },
    },
  };
  /* Exact labels from docs/keyboard-command-reference */
  const SHORTCUTS = [
    { title: "Global navigation", rows: [["Open command palette", "⌘K"], ["Go to sessions list", "⌘⇧L"], ["Go to files", "⌘⇧E"], ["Go to recent session (1–9)", "⌥1–9"]] },
    { title: "Command palette", rows: [["Navigate results", "↑ / ↓"], ["Select or start session", "↵"], ["Edit resource", "⌘↵"], ["Close", "Esc"]] },
    { title: "Actions", rows: [["New session", "⌘⇧O"]] },
    { title: "Application", rows: [["Toggle left sidebar", "⌘."], ["Toggle settings navigation", "⌘⇧,"], ["Show keyboard shortcuts", "⌘/"]] },
    { title: "Sessions", rows: [["Previous turn", "⌘↑"], ["Next turn", "⌘↓"], ["Enhance prompt", "⌘E"], ["Toggle right sidebar", "⌘⇧."], ["Unfocus input", "Esc"]] },
    { title: "Files", rows: [["Search files", "⌘P"], ["New folder in selected", "⇧N"], ["Rename selected", "↵"], ["Delete selected", "⌫"]] },
  ];

  let SESSIONS = [
    { id: "s1", title: "Let cosmos Author my PRs", expertId: "pr-author", status: "done", private: false, pinned: true, unread: false, tunnel: false, updated: "Just now", sessionId: "01KPPH32EJGEKRNC2AT1M4GCCM", messages: [
      { role: "user", text: "When a Linear ticket moves to In Progress, open a PR that implements it.", time: "10:02" },
      { role: "assistant", expert: "PR Author", time: "10:03", html: `<p>I'll wire an Automation on <strong>PR Author</strong> with a Linear status-change trigger.</p><details class="tool-call open"><summary>⚙ expert.configure_trigger</summary><pre>source: linear\nevent: issue.status_changed\nfilter: status.to == "In Progress"\narmed: false  // dry-run first</pre></details><div class="callout"><strong>Triggers stay off by default.</strong> Expert usable from Home; arm when ready.</div>` },
    /* Artifact type labels exact (docs/artifacts): Pull request | Git branch | Linear issue | Link */
    ], artifacts: [
      { type: "Pull request", label: "acme/acme-monorepo#4821", url: "https://github.com/acme/acme-monorepo/pull/4821" },
      { type: "Git branch", label: "feat/linear-in-progress-pr", url: "" },
      { type: "Linear issue", label: "BIL-204", url: "https://linear.app/acme/issue/BIL-204" },
    ] },
    { id: "s2", title: "Deep review #4788", expertId: "deep-reviewer", status: "done", private: false, pinned: true, unread: false, tunnel: false, updated: "1h ago", sessionId: "01KQREVIEW4788XYZABCDEF12", messages: [
      { role: "user", text: "https://github.com/acme/acme-monorepo/pull/4788", time: "08:15" },
      { role: "assistant", expert: "Deep Reviewer", time: "08:18", html: `<p><strong>Verdict: Request changes</strong> — 3 findings, 1 high severity.</p><p><strong>H1 · Missing authz on refund endpoint</strong> — <code>services/billing/refund.ts:88</code></p>` },
    ], artifacts: [
      { type: "Pull request", label: "acme/acme-monorepo#4788", url: "https://github.com/acme/acme-monorepo/pull/4788" },
      { type: "Link", label: "Review style skill", url: "https://cosmos.augmentcode.com/files/user/.augment/skills/review-style.md" },
    ] },
    { id: "s3", title: "Set Up Agent Workflow for Ticket to PR with GitHub Slack and Linear", expertId: "advisor", status: "done", private: false, pinned: false, unread: false, tunnel: false, updated: "6 min ago", sessionId: "01KTCCZW4QHQNS5FA19K2BD8RA", branch: "main", messages: [
      { role: "user", text: "Help me set up an agent workflow for ticket to PR with GitHub, Slack and Linear", time: "10:23" },
      { role: "assistant", expert: "Cosmos Advisor", time: "10:24", html: `
<p>"ticket → PR" as a workflow (not a one-off launch) is the trigger that gets tickets to it.</p>
<p>Two natural shapes here, depending on how hands-off you want it:</p>
<ol>
<li><strong>Backlog Dispatcher (scheduled)</strong> — runs on a cron (e.g. hourly), scans the Linear teams + GitHub repos you configure, picks up tickets in a "ready" state, and dispatches each to PR Author. Labels each ticket as dispatched / skipped / failed so re-runs don't double-fire. Most hands-off, batch-style.</li>
<li><strong>PR Author with a Linear trigger</strong> — fires the moment a Linear issue hits a chosen state or gets a chosen label, opens a PR straight away. Tighter loop, per-ticket. (For this we deploy your own PR Author rather than triggering the tenant-shared one.)</li>
</ol>
<p>A couple of things I want to nail down before deploying anything, since the answers change what gets built:</p>
<ul>
<li><strong>Slack's role</strong> in your loop — three common options:
  <ul>
  <li>(a) Just team comms, no agent wiring needed.</li>
  <li>(b) Status updates to a channel ("opened PR #123 for TICKET-456, CI green, ready for review"). Small add to PR Author's prompt + an <code class="code-soft">app_mention</code> or per-event post.</li>
  <li>(c) Triggering ticket-to-PR from a Slack message ( <code class="code-soft">@augment ship TICKET-456</code> ). Different shape — a Slack-triggered router that hands off to PR Author.</li>
  </ul>
</li>
<li><strong>Which Linear team(s)</strong> the workflow watches, and <strong>which GitHub repo(s)</strong> PRs should land in.</li>
<li>For the Linear-triggered variant: the <strong>trigger signal</strong> — a label (e.g. <code class="code-soft">cosmos:ready</code> ), a status change (e.g. moved to "Ready for Cosmos"), or something else?</li>
</ul>
<p>My default recommendation if you just want it running: <strong>Backlog Dispatcher + status posts to one Slack channel</strong>, pointing at the Linear team(s) and GitHub repo(s) you name. Confirm the Linear team key(s), repo(s), Slack channel, and the "ready" signal in Linear (label name or state) and I'll deploy it with <em>triggers off</em> so you can dry-run before it fires automatically.</p>
` },
    ], artifacts: [] },
  ];

  /* ========== STATE ========== */
  const state = {
    route: "home",
    expertTab: "all", /* all | mine | recent | popular — product Home tabs */
    expertQuery: "",
    searchOpen: false,
    homeStarOnly: false, /* right-rail ★ filter */
    selectedExpertId: null, // real product home = expert grid first
    modelId: "claude-opus-4",
    envId: "augment",
    isPrivate: false, /* product default often Shared / toggle off */
    promptDraft: "",
    userFirstName: "Alex",
    activeSessionId: null,
    rightbarOpen: false,
    fileScope: "user", /* product default often User VFS */
    selectedFileId: null,
    vfsFolderId: null, /* null = root of current scope */
    vfsExpanded: {},
    autoPanel: "list", // real product: Automations table first
    autoScope: "all", /* mine | all */
    autoQuery: "",
    autoExpanded: {},
    cmdIndex: 0,
    space: "Engineering",
    spaces: ["Engineering", "Data Science", "On-call", "Default"],
    showcase: false,
    shareKind: "session",
    expertsScope: "all", /* product Experts list often shows All */
    expertListQuery: "",
    envScope: "mine", /* product default Mine on Environments */
    envQuery: "",
    envSort: "name",
    sessionTab: "agent",
    navCollapsed: { auto: false, files: false, config: false },
    toolsOpen: false,
    autoCreate: null,
    eventFilter: { source: "", eventType: "", payloadLogic: "", headerLogic: "" },
    eventDetail: null,
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const expert = (id) => EXPERTS.find((e) => e.id === id);
  const model = (id) => MODELS.find((m) => m.id === id) || MODELS[0];
  const env = (id) => ENVIRONMENTS.find((e) => e.id === id) || ENVIRONMENTS[0];
  const uid = () => "01K" + Math.random().toString(36).slice(2, 14).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase();

  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  function modelLabel(id) {
    const m = model(id);
    /* Product Home: name only in model chip; tool stack is separate (count beside stack) */
    if (m.prism) {
      return `<span class="prism-stack" aria-hidden="true"><span class="prism-dot dot-claude">C</span><span class="prism-dot dot-gemini">G</span></span><span class="c-model-name">${esc(m.short)}</span>`;
    }
    return `<span class="c-model-name">${m.id === "claude-opus-4" ? "Default (Opus 4.7)" : esc(m.short)}</span>`;
  }

  function viewModelToolsStack() {
    /* Product: monochrome stacked logos + count next to model (e.g. 14) */
    const tools = sessionToolEntries();
    const n = tools.length;
    const shown = tools.slice(0, 3);
    const stack = shown.map((t, i) =>
      `<span class="tools-stack-ico" style="z-index:${i + 1}" title="${esc(t.name)}">${I[t.icon] || I.hex}</span>`
    ).join("");
    return `<button type="button" class="c-toolcount" id="tools-chip" title="${n} tools / integrations" aria-expanded="${state.toolsOpen ? "true" : "false"}">
      <span class="tools-stack" aria-hidden="true">${stack || `<span class="tools-stack-ico">${I.tools}</span>`}</span>
      <span class="c-toolcount-n">${n}</span>
    </button>`;
  }

  function setCrumb(t) { $("#crumb").textContent = t; }

  function setRightbar(open) {
    state.rightbarOpen = open;
    const rb = $("#rightbar");
    if (open) { rb.hidden = false; $("#app").classList.add("rightbar-open"); }
    else { rb.hidden = true; $("#app").classList.remove("rightbar-open"); }
  }

  /* ========== SIDEBAR ========== */
  function renderSidebarNav() {
    /* REAL product order (live app): New session | Sessions | Files | Configuration | Automations
       Docs: Event Log + Run History are sub-items under Automations group */
    const c = state.navCollapsed;
    $("#sb-nav").innerHTML = `
      <button type="button" class="sb-item" data-nav="sessions">${I.sessions} Sessions</button>
      <div class="sb-group ${c.files ? "collapsed" : ""}" data-toggle="files">
        <div class="sb-group-left">${I.folder} Files</div>${I.chev}
      </div>
      <div class="sb-collapse ${c.files ? "" : "open"}" id="collapse-files">
        <button type="button" class="sb-sub" data-nav="files-org">Organization</button>
        <button type="button" class="sb-sub" data-nav="files-user">User</button>
      </div>
      <div class="sb-group ${c.config ? "collapsed" : ""}" data-toggle="config">
        <div class="sb-group-left">${I.config} Configuration</div>${I.chev}
      </div>
      <div class="sb-collapse ${c.config ? "" : "open"}" id="collapse-config">
        <div class="sb-sec">Foundation</div>
        <button type="button" class="sb-sub" data-nav="experts">Experts</button>
        <button type="button" class="sb-sub" data-nav="environments">Environments</button>
        <div class="sb-sec">Capabilities</div>
        <button type="button" class="sb-sub" data-nav="integrations">Integrations</button>
        <button type="button" class="sb-sub" data-nav="mcp">MCP Registry</button>
        <button type="button" class="sb-sub" data-nav="webhooks">Webhooks</button>
        <button type="button" class="sb-sub" data-nav="secrets">Secrets</button>
      </div>
      <div class="sb-group ${c.auto ? "collapsed" : ""}" data-toggle="auto">
        <div class="sb-group-left">${I.auto} Automations</div>${I.chev}
      </div>
      <div class="sb-collapse ${c.auto ? "" : "open"}" id="collapse-auto">
        <button type="button" class="sb-sub" data-nav="automations" data-panel="list">Automations</button>
        <button type="button" class="sb-sub" data-nav="automations" data-panel="events">Event Log</button>
        <button type="button" class="sb-sub" data-nav="automations" data-panel="runs">Run History</button>
      </div>`;
    bindSidebarNav();
    setNavActive();
  }

  function bindSidebarNav() {
    $$("#sb-nav [data-nav]").forEach((el) => {
      el.addEventListener("click", () => {
        if (el.dataset.panel) state.autoPanel = el.dataset.panel;
        navigate(el.dataset.nav);
      });
    });
    $$("#sb-nav [data-toggle]").forEach((el) => {
      el.addEventListener("click", () => {
        const k = el.dataset.toggle;
        state.navCollapsed[k] = !state.navCollapsed[k];
        renderSidebarNav();
      });
    });
  }

  function setNavActive() {
    const r = state.route;
    $$("[data-nav]").forEach((el) => {
      const nav = el.dataset.nav;
      let on = false;
      if (nav === "home" && r === "home") on = true;
      else if (nav === "sessions" && (r === "sessions" || r === "session")) on = true;
      else if (nav === "automations" && r === "automations") on = !el.dataset.panel || el.dataset.panel === state.autoPanel;
      else if (nav === "files-org" && r === "files" && state.fileScope === "org") on = true;
      else if (nav === "files-user" && r === "files" && state.fileScope === "user") on = true;
      else if (nav === "experts" && (r === "experts" || r === "expert-detail")) on = true;
      else if (nav === "philosophy" && r === "philosophy") on = true;
      else if (nav === r) on = true;
      el.classList.toggle("active", on);
    });
    $(".sb-new")?.classList.toggle("active", r === "home");
  }

  function renderRecents() {
    const sorted = [...SESSIONS].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    $("#recent-list").innerHTML = sorted
      .map((s) => `<button type="button" class="sb-recent ${s.pinned ? "pinned" : ""} ${state.activeSessionId === s.id ? "active" : ""}" data-session="${s.id}" draggable="true">${esc(s.title)}</button>`)
      .join("");
    $$("#recent-list [data-session]").forEach((btn) => {
      btn.addEventListener("click", () => openSession(btn.dataset.session));
      btn.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/session", btn.dataset.session);
      });
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showSessionContext(e, btn.dataset.session);
      });
    });
    // favorites
    const pinned = SESSIONS.filter((s) => s.pinned);
    const fav = $("#favorites-list");
    if (pinned.length) {
      fav.innerHTML = pinned.map((s) => `<button type="button" class="sb-fav-item" data-session="${s.id}">★ ${esc(s.title)}</button>`).join("");
      $$("#favorites-list [data-session]").forEach((b) => b.addEventListener("click", () => openSession(b.dataset.session)));
    } else {
      fav.innerHTML = `<span class="sb-fav-hint">Drag sessions here to pin</span>`;
    }
    fav.ondragover = (e) => { e.preventDefault(); fav.classList.add("drag-over"); };
    fav.ondragleave = () => fav.classList.remove("drag-over");
    fav.ondrop = (e) => {
      e.preventDefault();
      fav.classList.remove("drag-over");
      const id = e.dataTransfer.getData("text/session");
      const s = SESSIONS.find((x) => x.id === id);
      if (s) { s.pinned = true; toast("Pinned to Favorites"); render(); }
    };
  }

  function showSessionContext(e, id) {
    $$(".context-menu").forEach((m) => m.remove());
    const s = SESSIONS.find((x) => x.id === id);
    if (!s) return;
    const m = document.createElement("div");
    m.className = "context-menu";
    m.style.left = e.clientX + "px";
    m.style.top = e.clientY + "px";
    m.innerHTML = `
      <button type="button" data-a="open">Open</button>
      <button type="button" data-a="pin">${s.pinned ? "Unpin" : "Pin"}</button>
      <button type="button" data-a="priv">${s.private ? "Make shared" : "Make private"}</button>
      <button type="button" data-a="unread">${s.unread ? "Mark read" : "Mark unread"}</button>
      <button type="button" data-a="archive">Archive</button>`;
    document.body.appendChild(m);
    m.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.a === "open") openSession(id);
        if (b.dataset.a === "pin") { s.pinned = !s.pinned; toast(s.pinned ? "Pinned" : "Unpinned"); render(); }
        if (b.dataset.a === "priv") { s.private = !s.private; toast(s.private ? "Private" : "Shared"); render(); }
        if (b.dataset.a === "unread") { s.unread = !s.unread; toast(s.unread ? "Marked unread" : "Marked read"); render(); }
        if (b.dataset.a === "archive") { SESSIONS = SESSIONS.filter((x) => x.id !== id); toast("Session archived"); render(); }
        m.remove();
      })
    );
    setTimeout(() => document.addEventListener("click", () => m.remove(), { once: true }), 0);
  }

  /* ========== ROUTER ========== */
  function navigate(route) {
    if (route === "files-user") { state.fileScope = "user"; state.route = "files"; }
    else if (route === "files-org") { state.fileScope = "org"; state.route = "files"; }
    else state.route = route;
    if (state.route !== "session") {
      state.activeSessionId = null;
      setRightbar(false);
      $("#app")?.classList.remove("session-mode");
    }
    if (state.route !== "files") $("#app")?.classList.remove("files-mode");
    render();
  }

  function openSession(id) {
    const s = SESSIONS.find((x) => x.id === id);
    if (s) s.unread = false;
    state.activeSessionId = id;
    state.route = "session";
    state.sessionTab = "agent";
    render();
  }

  function render() {
    const vp = $("#viewport");
    const r = state.route;
    const map = {
      home: () => { setCrumb("Home · New Session"); vp.innerHTML = viewHome(); bindHome(); },
      sessions: () => { setCrumb("Sessions"); vp.innerHTML = viewSessions(); bindSessions(); },
      session: () => {
        const s = SESSIONS.find((x) => x.id === state.activeSessionId);
        /* Product: session title lives in session header, not breadcrumb clutter */
        setCrumb("");
        $("#app")?.classList.add("session-mode");
        vp.innerHTML = viewSession(s);
        bindSession(s);
        setRightbar(true);
        renderRightbar(s);
      },
      files: () => {
        setCrumb(state.fileScope === "org" ? "Organization VFS" : "User VFS");
        $("#app")?.classList.add("files-mode");
        vp.innerHTML = viewFiles();
        bindFiles();
      },
      experts: () => { setCrumb("Configuration · Experts"); vp.innerHTML = viewExperts(); bindExperts(); },
      "expert-detail": () => { const e = expert(state.selectedExpertId); setCrumb("Experts · " + (e?.name || "")); vp.innerHTML = viewExpertDetail(e); bindExpertDetail(e); },
      environments: () => { setCrumb("Configuration · Environments"); vp.innerHTML = viewEnvironments(); bindEnvironments(); },
      integrations: () => { setCrumb("Configuration · Integrations"); vp.innerHTML = viewIntegrations(); bindIntegrations(); },
      mcp: () => { setCrumb("MCP Registry"); vp.innerHTML = viewMcp(); bindMcpWhSec(); },
      webhooks: () => { setCrumb("Webhooks"); vp.innerHTML = viewWebhooks(); bindMcpWhSec(); },
      secrets: () => { setCrumb("Secrets"); vp.innerHTML = viewSecrets(); bindMcpWhSec(); },
      automations: () => { setCrumb(state.autoPanel === "events" ? "Automations · Event Log" : state.autoPanel === "runs" ? "Automations · Run History" : "Automations"); vp.innerHTML = viewAutomations(); bindAutomations(); },
      philosophy: () => { setCrumb("Design philosophy"); vp.innerHTML = viewPhilosophy(); bindPhilosophy(); },
      settings: () => { setCrumb("Settings"); vp.innerHTML = viewSettings(); bindSettings(); },
    };
    (map[r] || map.home)();
    setNavActive();
    renderRecents();
    syncShowcase();
    updateThemeIcon();
  }

  /* ========== COMPOSER ==========
     Product (cosmos.augmentcode.com/home):
     - Inside card: textarea + [+] [tool stack+count] [model ▾] [enhance] [send]
     - Outside card: env left · Private toggle right
     - No "7 tools" pill in footer
  */
  function viewComposer(opts = {}) {
    const ex = expert(state.selectedExpertId);
    const ph = opts.placeholder || ex?.placeholder || "Describe what you'd like to work on";
    const hasText = !!(state.promptDraft || "").trim();
    const toolsPanel = state.toolsOpen ? viewToolsExpandPanel() : "";
    return `<div class="composer-shell">
      <div class="composer">
        <textarea id="prompt" rows="${opts.rows || 3}" placeholder="${esc(ph)}">${esc(state.promptDraft)}</textarea>
        <div class="composer-bar">
          <button type="button" class="c-plus" id="btn-attach" title="Attach">+</button>
          ${viewModelToolsStack()}
          <button type="button" class="c-model" id="model-btn">${modelLabel(state.modelId)}<span class="c-tools-chev">${I.chevD}</span></button>
          <button type="button" class="c-sparkle" id="btn-enhance" title="Enhance (⌘E)" ${hasText ? "" : "disabled"}>✦</button>
          <button type="button" class="c-send ${hasText ? "ready" : ""}" id="btn-send" title="Send" ${hasText ? "" : "disabled"}>↑</button>
        </div>
        ${toolsPanel}
      </div>
      <div class="composer-meta">
        <button type="button" class="c-env" id="env-btn"><span class="c-env-ico">${I.env}</span>${esc(env(state.envId).name)}<span class="c-tools-chev">${I.chevD}</span></button>
        <div class="c-privacy">Private
          <button type="button" class="toggle ${state.isPrivate ? "" : "off"}" id="priv-toggle" aria-label="Private session"><span class="toggle-knob"></span></button>
        </div>
      </div>
    </div>`;
  }

  function sessionToolEntries() {
    const integ = INTEGRATIONS.filter((i) => i.connected).map((i) => ({
      kind: "Integration", id: i.id, name: i.name, icon: i.icon, on: true,
    }));
    const mcp = MCP.filter((m) => m.status === "active").map((m) => ({
      kind: "MCP", id: "mcp-" + m.name, name: m.name, icon: "hex", on: true,
    }));
    return integ.concat(mcp);
  }
  function sessionToolCount() {
    return sessionToolEntries().length;
  }

  function viewToolsExpandPanel() {
    const tools = sessionToolEntries();
    return `<div class="tools-inline-panel" id="tools-wrap">
      <div class="tools-hrow" role="list">
        ${tools.map((t) => `
          <span class="tools-hchip" role="listitem" title="${esc(t.kind)}">
            <span class="tools-hchip-ico">${I[t.icon] || I.hex}</span>
            <span class="tools-hchip-name">${esc(t.name)}</span>
          </span>`).join("")}
        <button type="button" class="tools-hchip tools-hchip-add" id="tools-manage" title="Manage">+ Manage</button>
      </div>
    </div>`;
  }

  function bindComposer() {
    const ta = $("#prompt"), send = $("#btn-send"), enh = $("#btn-enhance");
    const syncSend = () => {
      const on = !!(ta?.value || "").trim();
      if (send) { send.disabled = !on; send.classList.toggle("ready", on); }
      if (enh) enh.disabled = !on;
    };
    ta?.addEventListener("input", () => {
      state.promptDraft = ta.value;
      syncSend();
    });
    ta?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendPrompt(); }
    });
    send?.addEventListener("click", sendPrompt);
    enh?.addEventListener("click", () => {
      if (!ta?.value.trim()) return;
      ta.value = ta.value.trim() + "\n\nContext: environment " + env(state.envId).name + ". Follow Organization Files standards. Open a PR; include tests and risk notes.";
      state.promptDraft = ta.value;
      syncSend();
      toast("Prompt enhanced");
    });
    $("#btn-attach")?.addEventListener("click", () => toast("Attach up to 10 files / 10 images (docs limits)"));
    $("#model-btn")?.addEventListener("click", (e) => openModelDd(e.currentTarget));
    $("#env-btn")?.addEventListener("click", (e) => openEnvDd(e.currentTarget));
    $("#priv-toggle")?.addEventListener("click", () => {
      state.isPrivate = !state.isPrivate;
      state.promptDraft = $("#prompt")?.value || state.promptDraft;
      render();
      toast(state.isPrivate ? "Session will be private" : "Session will be shared with org");
    });
    $("#tools-chip")?.addEventListener("click", (e) => {
      e.stopPropagation();
      state.toolsOpen = !state.toolsOpen;
      state.promptDraft = $("#prompt")?.value || state.promptDraft;
      render();
    });
    $("#tools-manage")?.addEventListener("click", (e) => {
      e.stopPropagation();
      state.toolsOpen = false;
      navigate("integrations");
    });
  }

  function filteredExperts() {
    let list = EXPERTS.slice();
    if (state.expertTab === "mine") list = list.filter((e) => e.mine);
    if (state.expertTab === "recent") list = list.slice(0, 6);
    if (state.expertTab === "popular") list = [...list].sort((a, b) => {
      const na = parseInt(String(a.badge).replace(/\D/g, ""), 10) || 0;
      const nb = parseInt(String(b.badge).replace(/\D/g, ""), 10) || 0;
      return nb - na;
    });
    if (state.homeStarOnly) list = list.filter((e) => e.starred);
    if (state.expertQuery.trim()) {
      const q = state.expertQuery.toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(q) || e.desc.toLowerCase().includes(q));
    }
    return list;
  }

  /* ========== VIEWS ========== */
  function viewHome() {
    const selected = expert(state.selectedExpertId);
    const name = state.userFirstName || "Alex";

    /* —— Selected expert (product: title + back + expert chip + blurb + composer) —— */
    if (selected) {
      return `<div class="home-selected">
        <h1 class="greeting">What's on your mind, ${esc(name)}?</h1>
        <button type="button" class="home-back" id="browse-experts">← All Experts</button>
        <div class="home-expert-chip">
          <span class="card-icon">${I.hex}</span>
          <div class="home-expert-chip-body">
            <div class="home-expert-chip-name">${esc(selected.name)} <button type="button" class="icon-btn sm-ico" id="edit-expert-chip" title="Edit">✎</button></div>
            <div class="home-expert-chip-desc">${esc(selected.desc)}</div>
            <div class="home-expert-chip-meta"><span class="badge badge-${selected.badgeType}">${esc(selected.badge)}</span></div>
          </div>
        </div>
        <div class="home-expert-blurb">
          <p>${esc(selected.instructions)}</p>
          <p class="muted" style="margin-top:10px">The Advisor walks you through deploying new experts and tuning the ones running on real PRs and tickets.
            <a href="#" id="full-details">full details ↗</a></p>
        </div>
        <div class="composer-wrap">${viewComposer({ placeholder: selected.placeholder || "Help me set up an agent workflow", rows: 3 })}</div>
      </div>`;
    }

    /* —— Expert grid: scrollable cards + fixed composer dock (no jump on tab change) —— */
    const experts = filteredExperts();
    const tabs = [
      { id: "all", label: "All Experts" },
      { id: "mine", label: "Mine" },
      { id: "recent", label: "Recent" },
      { id: "popular", label: "Popular" },
    ];
    return `<div class="home-shell">
      <div class="home-body">
        <div class="home-center">
          <h1 class="greeting">What's on your mind, ${esc(name)}?</h1>
          <div class="tabs home-tabs">
            ${tabs.map((t) =>
              `<button type="button" class="tab ${state.expertTab === t.id ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`
            ).join("")}
          </div>
          <div class="search-wrap ${state.searchOpen ? "open" : ""}" id="home-search-wrap">
            <div class="search-inner">${I.search}<input id="expert-search" placeholder="Search experts…" value="${esc(state.expertQuery)}" autocomplete="off"/></div>
          </div>
          <div class="home-grid-row">
            <div class="home-grid-scroll" id="home-grid-scroll">
              <div class="grid">${experts.length ? experts.map((e) => `
                <button type="button" class="card" data-expert="${e.id}">
                  <div class="card-header">
                    <div class="card-title-row"><span class="card-icon">${I.hex}</span><span class="card-name">${esc(e.name)}</span></div>
                    <span class="card-star ${e.starred ? "on" : ""}" data-star="${e.id}" title="Pin">${e.starred ? "★" : "☆"}</span>
                  </div>
                  <div class="card-desc">${esc(e.desc)}</div>
                </button>`).join("") : `<div class="empty" style="grid-column:1/-1;padding:24px"><h3>No experts match</h3><p>Try another tab or clear search / star filter.</p></div>`}
              </div>
            </div>
            <aside class="home-rail" aria-label="Expert filters">
              <button type="button" class="home-rail-btn ${state.searchOpen ? "on" : ""}" id="rail-search" title="Search experts">${I.search}</button>
              <button type="button" class="home-rail-btn ${state.homeStarOnly ? "on" : ""}" id="rail-star" title="Starred only">★</button>
              <!-- product: short mini thumb (not a full-height line) -->
              <div class="home-vscroll" id="home-vscroll" title="Scroll experts">
                <div class="home-vscroll-track" id="home-vscroll-track">
                  <div class="home-vscroll-thumb" id="home-vscroll-thumb" aria-hidden="true"></div>
                </div>
                <button type="button" class="home-scroll-down" id="home-scroll-down" title="Scroll down" aria-label="Scroll down">
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5L6 7.5 9 4.5"/></svg>
                </button>
              </div>
            </aside>
          </div>
        </div>
      </div>
      <div class="home-dock">
        <div class="composer-wrap">${viewComposer()}</div>
      </div>
    </div>`;
  }

  function bindHome() {
    $$(".tab[data-tab]").forEach((t) => t.addEventListener("click", () => {
      state.expertTab = t.dataset.tab;
      state.promptDraft = $("#prompt")?.value || state.promptDraft;
      state._homeGridScroll = 0; /* new tab list → top of grid; dock stays put */
      render();
    }));
    if (typeof state._homeGridScroll === "number" && $("#home-grid-scroll")) {
      $("#home-grid-scroll").scrollTop = state._homeGridScroll;
    }
    const openSearch = () => {
      state.searchOpen = true;
      state.promptDraft = $("#prompt")?.value || state.promptDraft;
      render();
      setTimeout(() => $("#expert-search")?.focus(), 0);
    };
    $("#rail-search")?.addEventListener("click", () => {
      if (state.searchOpen && !state.expertQuery) {
        state.searchOpen = false;
        render();
      } else openSearch();
    });
    $("#rail-star")?.addEventListener("click", () => {
      state.homeStarOnly = !state.homeStarOnly;
      state.promptDraft = $("#prompt")?.value || state.promptDraft;
      state._homeGridScroll = 0;
      render();
      toast(state.homeStarOnly ? "Showing starred experts" : "Showing all in tab");
    });
    $("#expert-search")?.addEventListener("input", (e) => {
      state.expertQuery = e.target.value;
      state.promptDraft = $("#prompt")?.value || state.promptDraft;
      state._homeGridScroll = 0;
      render();
      const input = $("#expert-search");
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    });
    const syncHomeScroll = () => {
      const el = $("#home-grid-scroll");
      const wrap = $("#home-vscroll");
      const track = $("#home-vscroll-track");
      const thumb = $("#home-vscroll-thumb");
      const down = $("#home-scroll-down");
      if (!el || !wrap || !track || !thumb) return;
      const overflow = el.scrollHeight > el.clientHeight + 2;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      wrap.classList.toggle("no-overflow", !overflow);
      /* product: short pill thumb (~28–40px), not full-height bar */
      const trackH = track.clientHeight || 1;
      const thumbH = overflow
        ? Math.max(28, Math.min(40, Math.round(trackH * (el.clientHeight / el.scrollHeight))))
        : 32;
      const travel = Math.max(0, trackH - thumbH);
      const top = max > 0 ? (el.scrollTop / max) * travel : 0;
      thumb.style.height = thumbH + "px";
      thumb.style.transform = `translateY(${top}px)`;
      state._homeGridScroll = el.scrollTop;
      if (down) {
        down.classList.toggle("dim", !overflow || el.scrollTop >= max - 2);
        down.disabled = !overflow;
      }
    };
    $("#home-grid-scroll")?.addEventListener("scroll", syncHomeScroll, { passive: true });
    $("#home-scroll-down")?.addEventListener("click", () => {
      const el = $("#home-grid-scroll");
      if (!el) return;
      el.scrollBy({ top: Math.max(120, el.clientHeight * 0.55), behavior: "smooth" });
    });
    $("#home-vscroll-track")?.addEventListener("click", (e) => {
      const el = $("#home-grid-scroll");
      const track = e.currentTarget;
      if (!el || e.target.id === "home-vscroll-thumb") return;
      const rect = track.getBoundingClientRect();
      const y = (e.clientY - rect.top) / Math.max(1, rect.height);
      el.scrollTop = y * Math.max(0, el.scrollHeight - el.clientHeight);
    });
    requestAnimationFrame(syncHomeScroll);
    window.addEventListener("resize", syncHomeScroll, { once: true });
    $$(".card[data-expert]").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest("[data-star]")) return;
        state.selectedExpertId = card.dataset.expert;
        const ex = expert(card.dataset.expert);
        if (ex?.model) state.modelId = ex.model;
        /* Visibility default follows Expert origin (docs/sessions-overview):
           shared/org Expert → Shared; personal Expert → Private */
        if (ex) state.isPrivate = !!(ex.mine && !ex.shared);
        state.promptDraft = "";
        state.toolsOpen = false;
        render();
        setTimeout(() => $("#prompt")?.focus(), 0);
      });
    });
    $$("[data-star]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const ex = expert(btn.dataset.star);
        if (ex) { ex.starred = !ex.starred; toast(ex.starred ? `Pinned ${ex.name}` : `Unpinned ${ex.name}`); render(); }
      })
    );
    $("#browse-experts")?.addEventListener("click", () => {
      state.selectedExpertId = null;
      state.promptDraft = $("#prompt")?.value || "";
      render();
    });
    $("#edit-expert-chip")?.addEventListener("click", (e) => {
      e.stopPropagation();
      navigate("expert-detail");
    });
    $("#full-details")?.addEventListener("click", (e) => { e.preventDefault(); navigate("expert-detail"); });
    bindComposer();
  }

  function sendPrompt() {
    const text = ($("#prompt")?.value || state.promptDraft || "").trim();
    if (!text) return;
    const ex = expert(state.selectedExpertId) || expert("advisor");
    const session = {
      id: "s" + Date.now(),
      title: text.slice(0, 52) + (text.length > 52 ? "…" : ""),
      expertId: ex.id,
      status: "starting", /* env boots — composer queues messages (product) */
      private: state.isPrivate,
      pinned: false,
      unread: false,
      tunnel: false,
      updated: "Just now",
      sessionId: uid(),
      messages: [{ role: "user", text, time: "Now" }, { role: "thinking", text: "Starting environment…", time: "Now" }],
      artifacts: [],
      queue: [],
    };
    SESSIONS.unshift(session);
    state.promptDraft = "";
    state.activeSessionId = session.id;
    state.route = "session";
    state.sessionTab = "agent";
    render();
    /* starting → running → done; queue accepted throughout starting/running */
    setTimeout(() => {
      session.status = "running";
      if (state.activeSessionId === session.id) render();
      setTimeout(() => simulateAgent(session.id, ex, text), 600);
    }, 500);
  }

  function simulateAgent(sessionId, ex, userText) {
    const s = SESSIONS.find((x) => x.id === sessionId);
    if (!s) return;
    const envName = env(state.envId).name;
    let html;
    if (ex.id === "deep-reviewer") {
      html = `<p>Fetching the PR and mapping structure via Context Engine…</p>
<details class="tool-call open"><summary>⚙ github.get_pull_request</summary><pre>${esc(userText.slice(0, 140))}</pre></details>
<p>I'll post inline findings when the review finishes.</p>`;
    } else if (ex.id === "advisor") {
      html = `<p>I'll configure Cosmos for you — <strong>describe the outcome, not the wiring</strong>.</p>
<ol>
<li><strong>Dependencies</strong> — GitHub App / Linear / Slack ✓</li>
<li><strong>Environment</strong> — <code>${esc(envName)}</code></li>
<li><strong>Experts</strong> — PR Author + review fleet (templates when they match)</li>
<li><strong>Automations</strong> — Linear In Progress → PR Author · JSONLogic on status</li>
</ol>
<div class="staging-card" data-stage="1">
  <div class="staging-title">Staged rollout (Advisor never arms behind your back)</div>
  <div class="staging-steps">
    <div class="staging-step done"><span class="sn">1</span><div><strong>Deploy with triggers off</strong><p>Expert usable from Home; no autonomous fires.</p></div></div>
    <div class="staging-step"><span class="sn">2</span><div><strong>Try it</strong><p>Run against a real PR or ticket and confirm behavior.</p></div></div>
    <div class="staging-step"><span class="sn">3</span><div><strong>Enable triggers</strong><p>Only when you're happy — then it fires on matching events.</p></div></div>
  </div>
  <div class="row gap-8" style="margin-top:12px;flex-wrap:wrap">
    <button type="button" class="btn primary sm" data-advisor-action="deploy">Deploy disarmed →</button>
    <button type="button" class="btn sm" data-advisor-action="try">Try PR Author now</button>
    <button type="button" class="btn ghost sm" data-advisor-action="arm">Enable triggers</button>
  </div>
</div>
<p class="muted" style="margin-top:12px;font-size:13px">Everything Advisor deploys is an ordinary Expert + triggers — inspect anytime under Automations.</p>`;
      s.artifacts.push({ type: "Link", label: "Automations · PR Author (disarmed)", url: "#automations" });
    } else {
      html = `<p>Running as <strong>${esc(ex.name)}</strong> with ${esc(model(state.modelId).name)} on <code>${esc(envName)}</code>.</p>
<details class="tool-call open"><summary>⚙ context_engine.search</summary><pre>query: ${esc(userText.slice(0, 80))}\nhits: 12 files · structural slice</pre></details>`;
      /* PR URL in chat auto-attaches Pull request artifact (docs/artifacts) */
      const pr = userText.match(/github\.com\/[^\s]+\/pull\/\d+/i);
      if (pr) s.artifacts.push({ type: "Pull request", label: pr[0].replace(/https?:\/\//, ""), url: "https://" + pr[0].replace(/^https?:\/\//, "") });
      const lin = userText.match(/\b[A-Z]{2,10}-\d+\b/);
      if (lin) s.artifacts.push({ type: "Linear issue", label: lin[0], url: "" });
    }
    s.messages = s.messages.filter((m) => m.role !== "thinking");
    s.messages.push({ role: "assistant", expert: ex.name, time: "Now", html });
    s.status = "done";
    if (!s.artifacts.some((a) => a.type === "Git branch") && ex.id === "pr-author") {
      s.artifacts.push({ type: "Git branch", label: "feat/agent-session", url: "" });
    }
    if (state.activeSessionId === sessionId && state.route === "session") render();
  }

  function viewSessions() {
    return `<div class="page wide">
      <div class="page-header"><div><h1>Sessions</h1><p class="sub">Interactive and automation sessions in ${esc(state.space)}. Conversations are saved indefinitely; environments pause after inactivity (docs).</p></div>
      <button type="button" class="btn primary" id="btn-new-sess">${I.plus} New session</button></div>
      <div class="toolbar">
        <input class="field" id="sess-filter" placeholder="Filter sessions…" style="max-width:280px"/>
        <div class="seg" id="sess-seg">
          <button type="button" class="active" data-f="all">All</button>
          <button type="button" data-f="running">Running</button>
          <button type="button" data-f="pinned">Pinned</button>
          <button type="button" data-f="private">Private</button>
          <button type="button" data-f="tunnel">Tunnels</button>
          <button type="button" data-f="unread">Unread</button>
        </div>
      </div>
      <table class="table" id="sess-table">
        <thead><tr><th>Title</th><th>Expert</th><th>Status</th><th>Visibility</th><th>Updated</th></tr></thead>
        <tbody>${SESSIONS.map((s) => {
          const ex = expert(s.expertId);
          return `<tr data-session="${s.id}" draggable="true"><td>${s.pinned ? "★ " : ""}${s.unread ? '<span style="color:var(--accent)">● </span>' : ""}${s.tunnel ? "🔗 " : ""}${esc(s.title)}</td><td class="muted">${esc(ex?.name || "—")}</td><td><span class="status ${s.status}">${s.status}</span></td><td class="muted">${s.private ? "🔒 Private" : "Shared"}</td><td class="muted">${esc(s.updated)}</td></tr>`;
        }).join("")}</tbody>
      </table>
      <div class="table-footer"><span>${SESSIONS.length} sessions</span></div>
    </div>`;
  }

  function bindSessions() {
    $("#btn-new-sess")?.addEventListener("click", () => navigate("home"));
    let f = "all";
    const apply = () => {
      const q = ($("#sess-filter")?.value || "").toLowerCase();
      $$("#sess-table tbody tr").forEach((tr) => {
        const s = SESSIONS.find((x) => x.id === tr.dataset.session);
        let ok = true;
        if (f === "running") ok = s.status === "running";
        if (f === "pinned") ok = s.pinned;
        if (f === "private") ok = s.private;
        if (f === "tunnel") ok = !!s.tunnel;
        if (f === "unread") ok = !!s.unread;
        if (q) ok = ok && s.title.toLowerCase().includes(q);
        tr.style.display = ok ? "" : "none";
      });
    };
    $("#sess-filter")?.addEventListener("input", apply);
    $$("#sess-seg button").forEach((b) => b.addEventListener("click", () => {
      $$("#sess-seg button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      f = b.dataset.f;
      apply();
    }));
    $$("#sess-table tr[data-session]").forEach((tr) => {
      tr.addEventListener("click", () => openSession(tr.dataset.session));
      tr.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/session", tr.dataset.session));
    });
  }

  function viewSessionTabBody(s, ex) {
    const tab = state.sessionTab;
    if (tab === "terminal") {
      return `<div class="session-pane"><div class="term-window"><div class="term-bar">bash · ${esc(env(state.envId).name)} · cloud sandbox</div>
<pre class="term-body">$ pwd
/workspace
$ git status -sb
## feat/agent-session
$ ls
package.json  src/  README.md
<span class="term-cursor">▌</span></pre></div>
<p class="muted" style="margin-top:12px">Session Environment terminal (docs). Isolated sandbox; pauses after inactivity.</p></div>`;
    }
    if (tab === "files") {
      return `<div class="session-pane">
        <div class="seg" id="sess-file-scope" style="margin-bottom:12px">
          <button type="button" class="active" data-s="workspace">Workspace</button>
          <button type="button" data-s="user">User</button>
          <button type="button" data-s="org">Organization</button>
        </div>
        <table class="table"><thead><tr><th>Name</th><th>Size</th><th>Modified</th></tr></thead>
        <tbody>
          <tr><td>${I.folder} src</td><td class="muted">—</td><td class="muted">Just now</td></tr>
          <tr><td>${I.file} package.json</td><td class="muted">1.2 KiB</td><td class="muted">Just now</td></tr>
          <tr><td>${I.file} README.md</td><td class="muted">4.1 KiB</td><td class="muted">1h ago</td></tr>
        </tbody></table>
        <p class="muted" style="margin-top:12px">Docs: Workspace is live VM <code>/workspace</code>; User/Org scopes share the VFS.</p>
      </div>`;
    }
    if (tab === "subs") {
      return `<div class="session-pane"><div class="empty" style="padding:32px"><h3>No subscriptions</h3>
        <p>Runtime listeners via <code>subscribe-event</code> (PR comments, Linear updates, Slack threads). Live only for this session — vs triggers which open new sessions.</p>
        <button type="button" class="btn sm" id="btn-mock-sub" style="margin-top:12px">Simulate subscribe (PR comments)</button>
      </div></div>`;
    }
    const queue = s.queue || [];
    /* Product: clean article prose; timestamp + copy/share actions bottom-right; side scrollers */
    return `<div class="session-agent-pane">
      <div class="session-messages-wrap">
        <div class="session-messages" id="msg-box">${s.messages.map((m) => {
          if (m.role === "user") {
            return `<div class="msg msg-user">
              <div class="msg-body"><div class="user-bubble">${esc(m.text)}</div>
              <div class="msg-foot"><span class="when">${esc(m.time)}</span></div></div>
            </div>`;
          }
          if (m.role === "thinking") {
            return `<div class="msg"><div class="thinking">… Thinking</div></div>`;
          }
          if (m.role === "queued") {
            return `<div class="msg msg-queued"><div class="msg-body"><div class="user-bubble queue-bubble">${esc(m.text)} <span class="meta-pill">waiting</span></div></div></div>`;
          }
          return `<div class="msg msg-assistant">
            <div class="msg-body article-body">${m.html}
              <div class="msg-foot">
                <span class="when">${esc(m.time)}</span>
                <button type="button" class="icon-btn sm-ico msg-act" title="Copy" data-copy-msg="1">${I.copy}</button>
                <button type="button" class="icon-btn sm-ico msg-act" title="More" data-msg-more="1">⋯</button>
              </div>
            </div>
          </div>`;
        }).join("")}
        ${queue.length ? `<div class="queue-banner">${queue.length} message${queue.length > 1 ? "s" : ""} queued while agent is working</div>` : ""}
        </div>
        <div class="msg-scroll-rail" aria-hidden="true">
          <button type="button" class="msg-scroll-btn" id="msg-scroll-up" title="Scroll up">⌃</button>
          <button type="button" class="msg-scroll-btn" id="msg-scroll-down" title="Scroll down">⌄</button>
        </div>
      </div>
      ${viewSessionComposer(s, ex)}
    </div>`;
  }

  function viewSessionComposer(s, ex) {
    /* Product: Advisor · main chips; paperclip · Opus 4.7 · enhance · send */
    const ph = s.status === "running" || s.status === "starting"
      ? "Queue another message while the agent is working…"
      : "Ask anything or type / for commands";
    const branch = s.branch || "main";
    const exLabel = ex?.id === "advisor" ? "Advisor" : (ex?.name || "Expert");
    const modelName = state.modelId === "claude-opus-4" || state.modelId === "prism"
      ? "Opus 4.7"
      : (model(state.modelId).short || "Opus 4.7");
    return `<div class="session-composer">
      <div class="sess-composer-card">
        <div class="sess-composer-chips">
          <span class="sess-chip"><span class="card-icon">${I.hex}</span> ${esc(exLabel)}</span>
          <span class="sess-chip muted-chip">⎇ ${esc(branch)}</span>
        </div>
        <textarea id="session-prompt" rows="2" placeholder="${esc(ph)}"></textarea>
        <div class="composer-bar sess-composer-bar">
          <button type="button" class="c-plus sess-attach" id="sess-attach" title="Attach">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5.5 8.5l4.2-4.2a2 2 0 012.8 2.8L6.2 13.4a3.2 3.2 0 01-4.5-4.5l6.4-6.4"/></svg>
          </button>
          <button type="button" class="c-model" id="sess-model">${esc(modelName)}<span class="c-tools-chev">${I.chevD}</span></button>
          <button type="button" class="c-sparkle" id="sess-enhance" disabled title="Enhance">✦</button>
          ${s.status === "starting"
            ? `<button type="button" class="c-send spinning" id="sess-send" disabled title="Starting…">◌</button>`
            : `<button type="button" class="c-send" id="sess-send" disabled>↑</button>`}
        </div>
      </div>
    </div>`;
  }

  function viewSession(s) {
    if (!s) return `<div class="page empty"><h3>Session not found</h3></div>`;
    const ex = expert(s.expertId);
    /* Product: title + ··· in header; right panel toggle; tabs with underline */
    return `<div class="session-view">
      <div class="session-header">
        <div class="session-title-wrap">
          <div class="session-title" title="${esc(s.title)}">${esc(s.title)}</div>
          <button type="button" class="icon-btn" id="btn-sess-menu" title="More">⋯</button>
        </div>
        <div class="row gap-8">
          ${s.status === "running" || s.status === "starting"
            ? `<button type="button" class="btn ghost sm" id="btn-stop">Stop</button>`
            : ""}
          <button type="button" class="icon-btn" id="btn-rb" title="${state.rightbarOpen ? "Hide panel" : "Show panel"}">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M9.5 2.5v11"/></svg>
          </button>
        </div>
      </div>
      <div class="session-tabs">
        ${["agent", "terminal", "files", "subs"].map((t) => {
          const labels = { agent: [I.agent, "Agent"], terminal: [I.terminal, "Terminal"], files: [I.folder, "Files"], subs: [I.subs, "Subscriptions"] };
          return `<button type="button" class="sess-tab ${state.sessionTab === t ? "active" : ""}" data-tab="${t}"><span class="tab-ico">${labels[t][0]}</span> ${labels[t][1]}</button>`;
        }).join("")}
      </div>
      <div class="session-body">${viewSessionTabBody(s, ex)}</div>
    </div>`;
  }

  function drainSessionQueue(s) {
    if (!s.queue?.length) return;
    const next = s.queue.shift();
    s.messages = s.messages.filter((m) => !(m.role === "queued" && m.text === next));
    s.messages.push({ role: "user", text: next, time: "Now" });
    s.status = "running";
    s.updated = "Just now";
    if (state.activeSessionId === s.id) render();
    setTimeout(() => {
      s.messages.push({
        role: "assistant",
        expert: expert(s.expertId)?.name,
        time: "Now",
        html: `<p>Processed queued message.</p><details class="tool-call open"><summary>⚙ worker.continue</summary><pre>${esc(next)}</pre></details>`,
      });
      s.status = "done";
      if (s.queue?.length) drainSessionQueue(s);
      else if (state.activeSessionId === s.id) render();
    }, 700);
  }

  function bindSession(s) {
    if (!s) return;
    if (!s.queue) s.queue = [];
    const box = $("#msg-box");
    if (box) box.scrollTop = box.scrollHeight;
    $("#btn-rb")?.addEventListener("click", () => {
      setRightbar(!state.rightbarOpen);
      if (state.rightbarOpen) renderRightbar(s);
      render();
    });
    $("#btn-sess-menu")?.addEventListener("click", (e) => {
      e.stopPropagation();
      hidePopovers();
      const dd = $("#user-dd");
      dd.innerHTML = `
        <button type="button" class="dd-opt" data-sm="pin"><div class="dd-opt-name">${s.pinned ? "Unpin" : "Pin"} session</div></button>
        <button type="button" class="dd-opt" data-sm="share"><div class="dd-opt-name">Share…</div></button>
        <button type="button" class="dd-opt" data-sm="copy"><div class="dd-opt-name">Copy link</div></button>
        <button type="button" class="dd-opt" data-sm="archive"><div class="dd-opt-name">Archive</div></button>`;
      placePopover(dd, e.currentTarget, { preferDown: true });
      $$("#user-dd [data-sm]").forEach((b) => b.addEventListener("click", () => {
        hidePopovers();
        const a = b.dataset.sm;
        if (a === "pin") { s.pinned = !s.pinned; toast(s.pinned ? "Pinned" : "Unpinned"); render(); }
        else if (a === "share") openShare("session");
        else if (a === "copy") {
          navigator.clipboard?.writeText(`https://cosmos.augmentcode.com/s/${s.sessionId}`);
          toast("Link copied");
        } else toast("Session archived (prototype)");
      }));
    });
    $("#btn-stop")?.addEventListener("click", () => {
      s.status = "done";
      toast("Agent interrupted");
      if (s.queue?.length) drainSessionQueue(s);
      else render();
    });
    $$(".sess-tab").forEach((tab) => tab.addEventListener("click", () => {
      state.sessionTab = tab.dataset.tab;
      render();
      setRightbar(true);
      renderRightbar(s);
    }));
    $("#btn-mock-sub")?.addEventListener("click", () => toast("Subscribed to pull_request.review_comment on this PR (session-scoped)"));
    $$("[data-advisor-action]").forEach((btn) => btn.addEventListener("click", () => {
      const act = btn.dataset.advisorAction;
      if (act === "deploy") {
        const has = TRIGGERS.some((t) => t.expertId === "pr-author" && t.name === "advisor-linear-ip");
        if (!has) {
          TRIGGERS.push({
            id: "t-adv-" + Date.now(), expertId: "pr-author", name: "advisor-linear-ip", type: "linear", event: "Issue",
            filter: '{"and":[{"==":[{"var":"action"},"update"]},{"==":[{"var":"data.state.name"},"In Progress"]}]}',
            armed: false, maxRpm: 5, autoArchive: false,
            detail: "Linear · Issue · In Progress (Advisor deploy · disarmed)",
          });
        }
        s.messages.push({ role: "assistant", expert: "Cosmos Advisor", time: "Now", html: `<div class="callout"><strong>Deployed · stage 1 complete.</strong> Triggers disarmed for dry-run.</div>` });
        toast("Deployed with triggers off");
        render();
      } else if (act === "try") {
        state.selectedExpertId = "pr-author";
        state.promptDraft = "Implement Linear BIL-204";
        navigate("home");
      } else if (act === "arm") {
        TRIGGERS.filter((t) => t.expertId === "pr-author").forEach((t) => { t.armed = true; });
        s.messages.push({ role: "assistant", expert: "Cosmos Advisor", time: "Now", html: `<div class="callout"><strong>Triggers enabled.</strong></div>` });
        toast("Triggers enabled");
        render();
      }
    }));
    $$("[data-copy-msg]").forEach((btn) => btn.addEventListener("click", () => {
      const body = btn.closest(".msg-body");
      navigator.clipboard?.writeText(body?.innerText || "");
      toast("Message copied");
    }));
    $$("[data-msg-more]").forEach((btn) => btn.addEventListener("click", () => toast("Message actions (prototype)")));
    $("#msg-scroll-up")?.addEventListener("click", () => {
      const box = $("#msg-box");
      if (box) box.scrollBy({ top: -180, behavior: "smooth" });
    });
    $("#msg-scroll-down")?.addEventListener("click", () => {
      const box = $("#msg-box");
      if (box) box.scrollBy({ top: 180, behavior: "smooth" });
    });
    const ta = $("#session-prompt"), send = $("#sess-send");
    if (!ta || !send) return;
    const sync = () => {
      if (s.status === "starting") { send.disabled = true; return; }
      const on = !!ta.value.trim();
      send.disabled = !on;
      send.classList.toggle("ready", on);
      const e = $("#sess-enhance");
      if (e) e.disabled = !on;
    };
    ta.addEventListener("input", sync);
    const doSend = () => {
      const text = ta.value.trim();
      if (!text) return;
      state.sessionTab = "agent";
      if (s.status === "running" || s.status === "starting") {
        s.queue.push(text);
        s.messages.push({ role: "queued", text, time: "Now" });
        s.updated = "Just now";
        toast("Message queued");
        ta.value = "";
        render();
        return;
      }
      s.messages.push({ role: "user", text, time: "Now" });
      s.status = "running";
      s.updated = "Just now";
      render();
      setTimeout(() => {
        s.messages.push({
          role: "assistant",
          expert: expert(s.expertId)?.name,
          time: "Now",
          html: `<p>Follow-up received — continuing from your last message.</p>`,
        });
        s.status = "done";
        if (s.queue?.length) drainSessionQueue(s);
        else if (state.activeSessionId === s.id) render();
      }, 800);
    };
    send.addEventListener("click", doSend);
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } });
    $("#sess-model")?.addEventListener("click", (e) => openModelDd(e.currentTarget));
    $("#sess-enhance")?.addEventListener("click", () => {
      ta.value += "\n\nInclude file paths, test plan, and risk notes.";
      sync();
      toast("Prompt enhanced");
    });
    $("#sess-attach")?.addEventListener("click", () => toast("Attach files (up to 10, 4 MB each)"));
  }

  function renderRightbar(s) {
    /* Product screenshot: SESSION meta · CONFIGURATION (Expert, Integrations, MCP with failures) */
    if (!s) return;
    const ex = expert(s.expertId);
    const header = $("#rightbar .rb-header span");
    if (header) header.textContent = "SESSION";
    $("#rightbar-body").innerHTML = `
      <div class="rb-label">Session name</div>
      <div class="rb-value rb-title">${esc(s.title)}</div>
      <div class="rb-label">Session ID</div>
      <div class="rb-value mono rb-id">${esc(s.sessionId)} <button type="button" class="icon-btn sm-ico" id="rb-copy" title="Copy">${I.copy}</button></div>
      <div class="rb-label">Last active</div>
      <div class="rb-value">${esc(s.updated)}</div>
      <div class="rb-label">Created</div>
      <div class="rb-value muted" style="font-weight:400;font-size:13px">Friday, June 5, 2026 at 10:23:44 AM</div>

      <div class="rb-section">
        <h4>Configuration</h4>
        <div class="rb-label">Expert</div>
        <div class="rb-expert-pill">${I.hex} ${esc(ex?.name === "Cosmos Advisor" ? "Advisor" : (ex?.name || "—"))}</div>
        <div class="rb-label">Integrations</div>
        <div class="config-row"><span>${I.github} GitHub</span></div>
        <div class="config-row"><span>${I.github} GitHub App</span><span class="rb-warn">Update required</span></div>
        <div class="config-row"><span>${I.linear} Linear</span></div>
        <div class="config-row"><span>${I.linear} Linear App</span><span class="rb-warn">Update required</span></div>
        <div class="config-row"><span>${I.slack} Slack</span><span class="rb-warn">Update required</span></div>
        <div class="config-row"><span>${I.web} Web Access</span></div>
        <div class="rb-label" style="margin-top:14px">MCP Servers <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">7 servers (3 failed)</span>
          <button type="button" class="icon-btn sm-ico" id="rb-mcp-refresh" style="float:right" title="Refresh">↻</button>
        </div>
        <div class="mcp-fail-card">
          <div class="config-row"><span><strong>Snyk</strong><div class="muted" style="font-size:11.5px">stdio</div></span><span class="status failed">Failed</span></div>
        </div>
        <div class="mcp-fail-card">
          <div class="config-row"><span><strong>Cross Repo Search</strong><div class="muted" style="font-size:11.5px">http</div></span><span class="status failed">Failed</span></div>
          <div class="mcp-fail-detail">Streamable HTTP error: Error POSTing to endpoint: Authorization header required</div>
        </div>
      </div>

      ${s.artifacts?.length ? `<div class="rb-section">
        <h4>Artifacts <button type="button" class="btn ghost sm" id="btn-add-artifact" style="float:right">+ Add</button></h4>
        ${s.artifacts.map((a, i) => `
          <div class="artifact-card">
            <div class="artifact-main">
              <span class="tag">${esc(a.type)}</span>
              ${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener" class="artifact-link">${esc(a.label)}</a>` : `<span>${esc(a.label)}</span>`}
            </div>
            <div class="row gap-8">
              ${a.type !== "Git branch" ? `<button type="button" class="btn ghost sm" data-art-edit="${i}">Edit</button>` : `<span class="muted" style="font-size:11px">auto</span>`}
              <button type="button" class="btn ghost sm" data-art-del="${i}">Delete</button>
            </div>
          </div>`).join("")}
      </div>` : `<div class="rb-section"><button type="button" class="btn ghost sm" id="btn-add-artifact">+ Add artifact</button></div>`}`;
    $("#rb-copy")?.addEventListener("click", () => { navigator.clipboard?.writeText(s.sessionId); toast("Session ID copied"); });
    $("#rb-mcp-refresh")?.addEventListener("click", () => toast("Refresh MCP server status"));
    $("#btn-add-artifact")?.addEventListener("click", () => openAddArtifact(s));
    $$("[data-art-edit]").forEach((btn) => btn.addEventListener("click", () => {
      const a = s.artifacts[+btn.dataset.artEdit];
      if (!a) return;
      const label = prompt("Label", a.label);
      if (label == null) return;
      const url = prompt("URL (http/https)", a.url || "");
      if (url == null) return;
      a.label = label.trim() || a.label;
      a.url = url.trim();
      renderRightbar(s);
      toast("Artifact updated");
    }));
    $$("[data-art-del]").forEach((btn) => btn.addEventListener("click", () => {
      s.artifacts.splice(+btn.dataset.artDel, 1);
      renderRightbar(s);
      toast("Artifact removed");
    }));
    const fn = $("#float-session-name"), fi = $("#float-session-id");
    if (fn) fn.textContent = s.title;
    if (fi) fi.textContent = s.sessionId;
  }

  function openAddArtifact(s) {
    const body = $("#artifact-body");
    if (!body) {
      const type = prompt("Type: Pull request | Linear issue | Link", "Link");
      if (!type) return;
      const url = prompt("URL or identifier");
      if (!url) return;
      const t = /pull|pr/i.test(type) ? "Pull request" : /linear/i.test(type) ? "Linear issue" : "Link";
      s.artifacts.push({ type: t, label: url, url: /^https?:\/\//i.test(url) ? url : "" });
      renderRightbar(s);
      toast(t + " attached");
      return;
    }
    body.innerHTML = `
      <p class="muted" style="margin:0 0 12px;font-size:13px">Git branch is recorded automatically from the VM — not available here (docs/artifacts).</p>
      <label class="field-label">Type</label>
      <select class="field-select" id="art-type">
        <option value="Pull request">Pull request</option>
        <option value="Linear issue">Linear issue</option>
        <option value="Link" selected>Link</option>
      </select>
      <label class="field-label" style="margin-top:12px">URL or identifier</label>
      <input class="field" id="art-url" placeholder="https://… or AUG-12110"/>
      <div class="row gap-8 end" style="margin-top:16px">
        <button type="button" class="btn ghost" data-close="artifact-backdrop">Cancel</button>
        <button type="button" class="btn primary" id="art-save">Add</button>
      </div>`;
    $("#artifact-backdrop").hidden = false;
    body.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => { $("#artifact-backdrop").hidden = true; }));
    $("#art-save")?.addEventListener("click", () => {
      const type = $("#art-type")?.value || "Link";
      const raw = ($("#art-url")?.value || "").trim();
      if (!raw) { toast("Enter a URL or identifier"); return; }
      if (type !== "Linear issue" && !/^https?:\/\//i.test(raw)) {
        toast("URLs must start with http:// or https://");
        return;
      }
      const label = type === "Linear issue" && !/^https?:\/\//i.test(raw) ? raw : raw.replace(/^https?:\/\//, "").slice(0, 64);
      s.artifacts.push({ type, label, url: /^https?:\/\//i.test(raw) ? raw : "" });
      $("#artifact-backdrop").hidden = true;
      renderRightbar(s);
      toast(type + " attached");
    });
  }

  /* Files / VFS — product: User VFS | tree + Name/Size/Modified list */
  function flatten(nodes, acc = []) {
    for (const n of nodes) {
      acc.push(n);
      if (n.children) flatten(n.children, acc);
    }
    return acc;
  }
  function findNode(nodes, id) {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children) {
        const f = findNode(n.children, id);
        if (f) return f;
      }
    }
    return null;
  }
  function vfsListNodes() {
    const root = FILES[state.fileScope] || [];
    if (!state.vfsFolderId) return root;
    const folder = findNode(root, state.vfsFolderId);
    return folder?.children || root;
  }
  function vfsStats(nodes) {
    let files = 0;
    let bytes = 0;
    const walk = (arr) => {
      for (const n of arr) {
        if (n.type === "file") {
          files += 1;
          const m = String(n.size || "").match(/([\d.]+)\s*KiB/i);
          if (m) bytes += parseFloat(m[1]) * 1024;
          else if (String(n.size || "").match(/([\d.]+)\s*B/i)) bytes += parseFloat(RegExp.$1);
        }
        if (n.children) walk(n.children);
      }
    };
    walk(nodes);
    const kib = bytes / 1024;
    const sizeStr = kib >= 100 ? kib.toFixed(1) + " KiB" : kib.toFixed(1) + " KiB";
    return { files: flatten(nodes).filter((x) => x.type === "file").length, sizeStr };
  }
  function renderVfsTree(nodes, depth) {
    return nodes.map((n) => {
      const exp = !!(state.vfsExpanded && state.vfsExpanded[n.id]);
      const active = state.vfsFolderId === n.id || state.selectedFileId === n.id;
      if (n.type === "folder") {
        return `<div class="vfs-tree-item depth-${depth}">
          <button type="button" class="vfs-tree-row ${active && n.id === state.vfsFolderId ? "active" : ""}" data-vfs-folder="${n.id}">
            <span class="vfs-chev ${exp ? "open" : ""}">›</span>
            <span class="vfs-ico">${I.folder}</span>
            <span class="vfs-label" title="${esc(n.name)}">${esc(n.name)}</span>
            <span class="vfs-row-more" data-vfs-more="${n.id}" title="More">⋯</span>
          </button>
          ${exp && n.children ? `<div class="vfs-tree-kids">${renderVfsTree(n.children, depth + 1)}</div>` : ""}
        </div>`;
      }
      return `<div class="vfs-tree-item depth-${depth}">
        <button type="button" class="vfs-tree-row ${state.selectedFileId === n.id ? "active" : ""}" data-vfs-file="${n.id}">
          <span class="vfs-chev"></span>
          <span class="vfs-ico">${I.file}</span>
          <span class="vfs-label" title="${esc(n.name)}">${esc(n.name)}</span>
        </button>
      </div>`;
    }).join("");
  }
  function viewFiles() {
    /* Product: dual pane — left tree (User VFS ▾), right list Name/Size/Modified */
    const tree = FILES[state.fileScope] || [];
    const list = vfsListNodes();
    const stats = vfsStats(tree);
    const scopeLabel = state.fileScope === "org" ? "Organization" : "User";
    const vfsTitle = state.fileScope === "org" ? "Organization VFS" : "User VFS";
    const folder = state.vfsFolderId ? findNode(tree, state.vfsFolderId) : null;
    const crumb = folder ? folder.name : scopeLabel;
    const sorted = [...list].sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    const selected = state.selectedFileId ? findNode(tree, state.selectedFileId) : null;

    return `<div class="vfs-page">
      <div class="vfs-layout">
        <aside class="vfs-sidebar">
          <button type="button" class="vfs-scope-btn" id="vfs-scope-toggle">
            ${esc(vfsTitle)} <span class="c-tools-chev">${I.chevD}</span>
          </button>
          <div class="vfs-scope-menu" id="vfs-scope-menu" hidden>
            <button type="button" class="dd-opt ${state.fileScope === "user" ? "active" : ""}" data-scope="user"><div class="dd-opt-name">User VFS</div></button>
            <button type="button" class="dd-opt ${state.fileScope === "org" ? "active" : ""}" data-scope="org"><div class="dd-opt-name">Organization VFS</div></button>
          </div>
          <div class="vfs-tree">${renderVfsTree(tree, 0)}</div>
          <div class="vfs-side-foot">${stats.files} files · ${esc(stats.sizeStr)}</div>
        </aside>
        <section class="vfs-main">
          <div class="vfs-main-head">
            <div class="vfs-crumb"><span class="vfs-ico">${I.folder}</span> ${esc(crumb)}</div>
            <div class="vfs-actions">
              <button type="button" class="icon-btn" id="btn-vfs-upload" title="Upload">↑</button>
              <button type="button" class="icon-btn" id="btn-vfs-new" title="New folder">＋</button>
              <button type="button" class="icon-btn" id="btn-vfs-dl" title="Download">↓</button>
            </div>
          </div>
          <div class="vfs-list-wrap">
            <table class="table vfs-table">
              <thead><tr><th>Name</th><th class="col-size">Size</th><th class="col-mod">Modified</th></tr></thead>
              <tbody>
                ${sorted.map((f) => `
                  <tr data-vfs-row="${f.id}" data-type="${f.type}" class="${state.selectedFileId === f.id || state.vfsFolderId === f.id ? "active" : ""}">
                    <td>
                      <span class="vfs-row-name">
                        <span class="vfs-ico">${f.type === "folder" ? I.folder : I.file}</span>
                        ${esc(f.name)}
                      </span>
                    </td>
                    <td class="muted col-size">${esc(f.size || "—")}</td>
                    <td class="muted col-mod">${esc(f.modified || "—")}</td>
                  </tr>`).join("") || `<tr><td colspan="3" class="muted" style="padding:24px">Empty folder</td></tr>`}
              </tbody>
            </table>
          </div>
          <div class="vfs-main-foot">${sorted.length} items${selected?.type === "file" ? ` · selected ${esc(selected.name)}` : ""} · ${esc(stats.sizeStr)}</div>
          ${selected?.type === "file" ? `
            <div class="vfs-preview">
              <div class="vfs-preview-head">
                <strong>${esc(selected.name)}</strong>
                <div class="row gap-8">
                  <button type="button" class="btn ghost sm" id="btn-copy-path">Copy path</button>
                  <button type="button" class="btn ghost sm" id="btn-copy-content">Copy</button>
                  <button type="button" class="btn ghost sm" id="btn-dl-file">Download</button>
                </div>
              </div>
              <pre class="vfs-preview-body">${esc(selected.content || "")}</pre>
            </div>` : ""}
        </section>
      </div>
    </div>`;
  }
  function bindFiles() {
    $("#vfs-scope-toggle")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const m = $("#vfs-scope-menu");
      if (m) m.hidden = !m.hidden;
    });
    $$("#vfs-scope-menu [data-scope]").forEach((b) => b.addEventListener("click", () => {
      state.fileScope = b.dataset.scope;
      state.vfsFolderId = null;
      state.selectedFileId = null;
      render();
    }));
    $$("[data-vfs-folder]").forEach((btn) => btn.addEventListener("click", (e) => {
      if (e.target.closest("[data-vfs-more]")) return;
      e.stopPropagation();
      const id = btn.dataset.vfsFolder;
      if (!state.vfsExpanded) state.vfsExpanded = {};
      /* open folder in main list; chevron rotates via .open class */
      const wasOpen = state.vfsFolderId === id && state.vfsExpanded[id];
      if (wasOpen) {
        state.vfsExpanded[id] = false;
      } else {
        state.vfsExpanded[id] = true;
        state.vfsFolderId = id;
        state.selectedFileId = null;
      }
      render();
    }));
    $$("[data-vfs-more]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toast("Folder actions: Rename · Download · Delete (prototype)");
    }));
    $$("[data-vfs-file]").forEach((btn) => btn.addEventListener("click", () => {
      state.selectedFileId = btn.dataset.vfsFile;
      render();
    }));
    $$("[data-vfs-row]").forEach((tr) => tr.addEventListener("click", () => {
      const id = tr.dataset.vfsRow;
      const type = tr.dataset.type;
      if (type === "folder") {
        if (!state.vfsExpanded) state.vfsExpanded = {};
        state.vfsExpanded[id] = true;
        state.vfsFolderId = id;
        state.selectedFileId = null;
      } else {
        state.selectedFileId = id;
      }
      render();
    }));
    $$("[data-vfs-row]").forEach((tr) => tr.addEventListener("dblclick", () => {
      if (tr.dataset.type === "folder") {
        state.vfsFolderId = tr.dataset.vfsRow;
        state.selectedFileId = null;
        render();
      }
    }));
    $("#btn-vfs-upload")?.addEventListener("click", () => toast("Upload to VFS (max 4 MiB per file)"));
    $("#btn-vfs-new")?.addEventListener("click", () => {
      const name = prompt("Folder name");
      if (!name) return;
      const root = FILES[state.fileScope];
      const parent = state.vfsFolderId ? findNode(root, state.vfsFolderId) : null;
      const node = { id: "f-" + Date.now(), name, type: "folder", size: "—", modified: "Just now", children: [] };
      if (parent?.children) parent.children.unshift(node);
      else root.unshift(node);
      toast(`Folder “${name}” created`);
      render();
    });
    $("#btn-vfs-dl")?.addEventListener("click", () => toast("Download started (prototype)"));
    const tree = FILES[state.fileScope];
    const selected = state.selectedFileId ? findNode(tree, state.selectedFileId) : null;
    $("#btn-copy-path")?.addEventListener("click", () => {
      navigator.clipboard?.writeText(`${state.fileScope}/${selected?.name || ""}`);
      toast("Path copied");
    });
    $("#btn-copy-content")?.addEventListener("click", () => {
      navigator.clipboard?.writeText(selected?.content || "");
      toast("Content copied");
    });
    $("#btn-dl-file")?.addEventListener("click", () => toast("Download started (prototype)"));
  }

  function expertAutoCount(e) {
    if (typeof e.autos === "number") return e.autos;
    return TRIGGERS.filter((t) => t.expertId === e.id).length;
  }
  function expertIntegIcons(e) {
    const keys = e.integ || ["github"];
    return keys.slice(0, 4).map((k) => `<span class="ex-integ-ico" title="${esc(k)}">${I[k] || I.hex}</span>`).join("") +
      `<span class="ex-integ-n">${keys.length}</span>`;
  }

  function viewExperts() {
    /* Product: checkbox · star · Name(+shared+desc) · Automations · Integrations · Creator · Updated · ⋯ */
    let list = EXPERTS.filter((e) => (state.expertsScope === "mine" ? e.mine : true));
    const q = (state.expertListQuery || "").toLowerCase();
    if (q) {
      list = list.filter((e) => e.name.toLowerCase().includes(q) || e.desc.toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));

    return `<div class="page wide ex-page">
      <div class="page-header">
        <div>
          <h1>Experts</h1>
          <p class="sub">An Expert is a reusable AI agent configuration. Define its role with a system prompt, choose how it runs, and start sessions from it anytime.</p>
        </div>
        <button type="button" class="btn primary" id="btn-create-expert">Create an expert</button>
      </div>

      <button type="button" class="advisor-banner" id="advisor-setup">
        <span class="advisor-mark">${I.cosmos}</span>
        <div>
          <div class="banner-title">Describe your workflow and an agent will set it up →</div>
          <div class="banner-sub">Cosmos Advisor agent configures the experts and automations</div>
        </div>
      </button>

      <div class="toolbar env-toolbar">
        <div class="seg" id="ex-scope">
          <button type="button" data-scope="mine" class="${state.expertsScope === "mine" ? "active" : ""}">Mine</button>
          <button type="button" data-scope="all" class="${state.expertsScope === "all" ? "active" : ""}">All</button>
        </div>
        <div class="env-toolbar-right">
          <button type="button" class="btn ghost sm" id="ex-filter-btn">☰ Filter ▾</button>
          <div class="env-search">
            <span class="env-search-ico">${I.search}</span>
            <input class="field" id="ex-filter" placeholder="Search experts…" value="${esc(state.expertListQuery || "")}"/>
          </div>
        </div>
      </div>

      <div class="env-table-wrap">
        <table class="table env-table ex-table" id="ex-table">
          <thead>
            <tr>
              <th class="col-check"><input type="checkbox" id="ex-check-all"/></th>
              <th class="col-star"></th>
              <th>Name</th>
              <th class="col-auto">Automations</th>
              <th class="col-integ">Integrations</th>
              <th>Creator</th>
              <th class="sortable">Updated <span class="sort-ico">↓</span></th>
              <th class="col-menu"></th>
            </tr>
          </thead>
          <tbody>
            ${list.map((e) => {
              const nAuto = expertAutoCount(e);
              const shared = e.shared || !e.mine;
              return `<tr data-expert="${e.id}">
                <td class="col-check"><input type="checkbox" data-ex-check="${e.id}"/></td>
                <td class="col-star">
                  <button type="button" class="card-star ${e.starred ? "on" : ""}" data-star-row="${e.id}" title="Pin">${e.starred ? "★" : "☆"}</button>
                </td>
                <td class="col-name">
                  <div class="ex-name-cell">
                    <span class="card-icon">${I.hex}</span>
                    <div class="ex-name-body">
                      <div class="ex-name-line">
                        <strong>${esc(e.name)}</strong>
                        ${shared ? `<span class="tag-shared">shared</span>` : ""}
                      </div>
                      <div class="ex-desc-line">${esc(e.desc)}</div>
                    </div>
                  </div>
                </td>
                <td class="muted col-auto">${nAuto || ""}</td>
                <td class="col-integ"><div class="ex-integ-stack">${expertIntegIcons(e)}</div></td>
                <td><span class="creator-av">${esc(e.creator || "AV")}</span></td>
                <td class="muted">${esc(e.updated || "—")}</td>
                <td class="col-menu">
                  <button type="button" class="icon-btn" data-ex-menu="${e.id}" title="More">⋯</button>
                </td>
              </tr>`;
            }).join("") || `<tr><td colspan="8" class="muted" style="padding:24px;text-align:center">No experts match</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="table-footer env-footer">
        <span>${list.length} expert${list.length === 1 ? "" : "s"}</span>
        <div class="env-pager">
          <button type="button" class="btn ghost sm" disabled>‹</button>
          <span class="muted">Page 1 of 1</span>
          <button type="button" class="btn ghost sm" disabled>›</button>
          <span class="muted" style="margin-left:12px">Rows</span>
          <select class="field-select env-rows" disabled><option>25</option></select>
        </div>
      </div>
    </div>`;
  }

  function bindExperts() {
    $$("#ex-scope button").forEach((b) => b.addEventListener("click", () => {
      state.expertsScope = b.dataset.scope;
      render();
    }));
    $("#ex-filter")?.addEventListener("input", (e) => {
      state.expertListQuery = e.target.value;
      render();
      const input = $("#ex-filter");
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    });
    $("#ex-filter-btn")?.addEventListener("click", () => toast("Filter: Shared · Starred · Has automations (prototype)"));
    $("#ex-check-all")?.addEventListener("change", (e) => {
      $$("[data-ex-check]").forEach((cb) => { cb.checked = e.target.checked; });
    });
    $$("#ex-table tr[data-expert]").forEach((tr) => tr.addEventListener("click", (e) => {
      if (e.target.closest("button, input, a")) return;
      state.selectedExpertId = tr.dataset.expert;
      navigate("expert-detail");
    }));
    $$("[data-star-row]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const ex = expert(btn.dataset.starRow);
      if (ex) {
        ex.starred = !ex.starred;
        toast(ex.starred ? `Pinned ${ex.name}` : `Unpinned ${ex.name}`);
        render();
      }
    }));
    $$("[data-ex-menu]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.exMenu;
      const ex = expert(id);
      hidePopovers();
      const dd = $("#user-dd");
      dd.innerHTML = `
        <button type="button" class="dd-opt" data-xm="launch"><div class="dd-opt-name">Launch session</div></button>
        <button type="button" class="dd-opt" data-xm="edit"><div class="dd-opt-name">Edit</div></button>
        <button type="button" class="dd-opt" data-xm="dup"><div class="dd-opt-name">Duplicate</div></button>
        <button type="button" class="dd-opt" data-xm="share"><div class="dd-opt-name">Share…</div></button>
        <button type="button" class="dd-opt" data-xm="del"><div class="dd-opt-name">Delete</div></button>`;
      placePopover(dd, btn, { preferDown: true, align: "end" });
      $$("#user-dd [data-xm]").forEach((b) => b.addEventListener("click", () => {
        hidePopovers();
        const a = b.dataset.xm;
        if (a === "launch") {
          state.selectedExpertId = id;
          if (ex?.model) state.modelId = ex.model;
          navigate("home");
          toast(`Selected ${ex.name}`);
        } else if (a === "edit") {
          state.selectedExpertId = id;
          navigate("expert-detail");
        } else if (a === "dup") {
          toast(`Duplicated “${ex.name}” as draft`);
        } else if (a === "share") {
          state.selectedExpertId = id;
          openShare("expert");
        } else if (a === "del" && confirm(`Delete expert “${ex.name}”?`)) {
          toast("Expert deleted (prototype)");
        }
      }));
    }));
    $("#btn-create-expert")?.addEventListener("click", () => {
      state.selectedExpertId = "advisor";
      state.promptDraft = "Help me create a custom Expert for our release checklist.";
      navigate("home");
    });
    $("#advisor-setup")?.addEventListener("click", () => {
      state.selectedExpertId = "advisor";
      state.promptDraft = "Describe your workflow and set up experts and automations. Triggers off.";
      navigate("home");
    });
  }

  function mdToolbar(forId) {
    /* Product markdown toolbar: B I S H1 H2 H3 lists code link */
    const tools = [
      ["b", "B", "Bold"], ["i", "I", "Italic"], ["s", "S", "Strikethrough"],
      ["h1", "H1", "Heading 1"], ["h2", "H2", "Heading 2"], ["h3", "H3", "Heading 3"],
      ["ul", "☰", "Bullet list"], ["ol", "1.", "Numbered list"],
      ["code", "</>", "Code"], ["link", "🔗", "Link"],
    ];
    return `<div class="md-toolbar" data-md-for="${forId}">
      ${tools.map(([k, lab, tip]) =>
        `<button type="button" class="md-btn" data-md="${k}" data-for="${forId}" title="${tip}">${lab}</button>`
      ).join("")}
    </div>`;
  }

  function viewExpertDetail(e) {
    /* Product expert editor: header · Advisor banner · Placeholder + User Instructions · System (Env, Model, Prompt) */
    if (!e) return `<div class="page empty"><h3>Not found</h3></div>`;
    const userInstr = e.instructions || e.desc || "";
    const descShort = e.desc.length > 120 ? e.desc.slice(0, 120) + "…" : e.desc;
    const descFull = e.desc;
    const updated = e.updated || "May 5, 4:06 PM";
    const creatorName = e.creator === "SR" ? "Sharath Rao" : e.creator === "AV" ? "Alex Vance" : (e.creator || "Team");

    return `<div class="page wide ex-detail-page">
      <button type="button" class="ex-back" id="back-experts">← All Experts</button>

      <div class="ex-detail-head">
        <div class="ex-detail-head-main">
          <span class="meta-pill team-pill">Team</span>
          <h1 class="ex-detail-title">${esc(e.name.replace(/\s+/g, "_"))}</h1>
          <p class="ex-detail-desc" id="ex-desc-short">${esc(descShort)}
            ${e.desc.length > 120 ? `<button type="button" class="text-btn" id="ex-show-more">Show more</button>` : ""}
          </p>
          <p class="ex-detail-desc full" id="ex-desc-full" hidden>${esc(descFull)}
            <button type="button" class="text-btn" id="ex-show-less">Show less</button>
          </p>
          <p class="ex-detail-meta">Updated ${esc(updated)} by ${esc(creatorName)}</p>
        </div>
        <div class="ex-detail-actions">
          <button type="button" class="btn sm" id="btn-dup-expert">${I.copy} Duplicate</button>
          <button type="button" class="btn primary sm" id="btn-save-expert">Save Expert</button>
        </div>
      </div>

      <button type="button" class="advisor-banner" id="tune-expert">
        <span class="advisor-mark">${I.cosmos}</span>
        <div>
          <div class="banner-title">Ask an agent to tune this expert →</div>
          <div class="banner-sub">Cosmos Advisor agent configures this expert</div>
        </div>
      </button>

      <div class="ex-detail-grid">
        <div class="ex-detail-col">
          <label class="field-label">Optional placeholder</label>
          <p class="field-hint">Optional placeholder shown in the home-page chat box when this expert is selected. Leave empty to use the default.</p>
          <input class="field" id="ex-ph" value="${esc(e.placeholder)}" placeholder="Tell me what to track or kick off"/>

          <label class="field-label" style="margin-top:20px">User Instructions</label>
          <p class="field-hint">Markdown shown to users explaining how to use this expert.</p>
          <div class="md-editor">
            ${mdToolbar("ex-user-instr")}
            <textarea class="field md-area" id="ex-user-instr" rows="5">${esc(
              e.id === "pr-author"
                ? "Enter a **task description**, **Linear ticket**, or **existing GitHub PR link**"
                : userInstr
            )}</textarea>
          </div>
        </div>
      </div>

      <div class="ex-system-section">
        <div class="ex-system-intro">
          <h2>System</h2>
          <p>How the agent thinks, where it runs, and which model powers it.</p>
        </div>
        <div class="ex-system-fields">
          <div class="ex-field-pair">
            <div>
              <label class="field-label">Environment</label>
              <p class="field-hint">Cloud sandbox or a connected daemon process.</p>
              <select class="field-select" id="ex-env">
                <option value="auto">Auto-resolved</option>
                ${ENVIRONMENTS.map((en) =>
                  `<option value="${en.id}" ${en.id === state.envId ? "selected" : ""}>${esc(en.name)}</option>`
                ).join("")}
              </select>
            </div>
            <div>
              <label class="field-label">Model</label>
              <p class="field-hint">Affects quality, speed, and credit usage.</p>
              <select class="field-select" id="ex-model">
                ${MODELS.map((m) =>
                  `<option value="${m.id}" ${m.id === e.model || (e.model === "prism" && m.id === "claude-opus-4") ? "selected" : ""}>${
                    m.id === "claude-opus-4" ? "Opus 4.7" : esc(m.name)
                  }</option>`
                ).join("")}
              </select>
            </div>
          </div>
          <label class="field-label" style="margin-top:16px">System Prompt</label>
          <p class="field-hint">Supports Markdown. Typical prompts are 50–300 lines.</p>
          <div class="md-editor">
            ${mdToolbar("ex-prompt")}
            <textarea class="field prompt-editor md-area" id="ex-prompt" rows="12">${esc(e.prompt)}</textarea>
          </div>
        </div>
      </div>

      ${viewExpertToolsWorkersSharing(e)}

      <div class="ex-detail-footer">
        <button type="button" class="btn ghost sm" id="btn-launch-ex">Start session</button>
      </div>
    </div>`;
  }

  function ensureExpertTools(e) {
    if (!e.tools) {
      /* default pinned tools from product screenshot pattern */
      e.tools = (e.integ || ["github", "linear", "slack"]).map((k) => {
        const map = {
          github: { id: "github", name: "GitHub", icon: "github" },
          "gh-app": { id: "github-app", name: "GitHub App", icon: "github" },
          linear: { id: "linear", name: "Linear", icon: "linear" },
          "linear-app": { id: "linear-app", name: "Linear App", icon: "linear" },
          slack: { id: "slack", name: "Slack", icon: "slack" },
          web: { id: "web-fetch", name: "Web Fetch", icon: "web" },
        };
        return map[k] || { id: k, name: k, icon: "hex" };
      });
      /* product often has both personal + app variants */
      if (e.id === "pr-author") {
        e.tools = [
          { id: "web-fetch", name: "Web Fetch", icon: "web" },
          { id: "github", name: "GitHub", icon: "github" },
          { id: "linear", name: "Linear", icon: "linear" },
          { id: "github-app", name: "GitHub App", icon: "github" },
          { id: "linear-app", name: "Linear App", icon: "linear" },
          { id: "slack", name: "Slack", icon: "slack" },
        ];
      }
    }
    if (!e.mcpPinned) {
      e.mcpPinned = e.id === "pr-author"
        ? ["Cross Repo Search", "Context Engine"]
        : MCP.filter((m) => m.status === "active").slice(0, 2).map((m) => m.name);
    }
    if (!e.workers) {
      e.workers = e.id === "pr-author" || e.id === "ticket-dispatcher"
        ? ["PR Author – Status Poll Worker"]
        : [];
    }
    return e;
  }

  function viewExpertToolsWorkersSharing(e) {
    /* Product screenshot: Tools (Integrations chips + MCP multi) · Workers · Sharing */
    ensureExpertTools(e);
    const integChips = e.tools.map((t) => `
      <span class="tool-chip" data-tool-id="${esc(t.id)}">
        <span class="tool-chip-ico">${I[t.icon] || I.hex}</span>
        ${esc(t.name)}
        <button type="button" class="tool-chip-x" data-rm-tool="${esc(t.id)}" title="Remove">×</button>
      </span>`).join("");

    const allInteg = [
      { id: "web-fetch", name: "Web Fetch", icon: "web" },
      { id: "github", name: "GitHub", icon: "github" },
      { id: "github-app", name: "GitHub App", icon: "github" },
      { id: "linear", name: "Linear", icon: "linear" },
      { id: "linear-app", name: "Linear App", icon: "linear" },
      { id: "slack", name: "Slack", icon: "slack" },
    ];
    const missing = allInteg.filter((t) => !e.tools.some((x) => x.id === t.id));

    const mcpOpts = [...new Set(MCP.map((m) => m.name).concat(["Cross Repo Search", "Context Engine", "Sentry", "Notion"]))];
    const workerChips = e.workers.map((w) => `
      <span class="tool-chip worker-chip">
        ${esc(w)}
        <button type="button" class="tool-chip-x" data-rm-worker="${esc(w)}" title="Remove">×</button>
      </span>`).join("");

    return `
      <div class="ex-section-row">
        <div class="ex-section-intro">
          <h2>Tools</h2>
          <p>Integrations and MCP servers the agent can reach during a session.</p>
        </div>
        <div class="ex-section-fields">
          <label class="field-label">Integrations</label>
          <p class="field-hint">Built-in tools available to this agent.</p>
          <div class="tool-chip-box" id="ex-tools-box">
            ${integChips || `<span class="muted" style="font-size:13px">No integrations pinned</span>`}
            ${missing.length ? `<button type="button" class="tool-chip tool-chip-add" id="ex-add-tool">+ Add</button>` : ""}
          </div>
          <div class="tool-add-menu" id="ex-tool-add-menu" hidden>
            ${missing.map((t) => `
              <button type="button" class="dd-opt" data-add-tool="${t.id}">
                <span class="tool-chip-ico">${I[t.icon] || I.hex}</span>
                <div class="dd-opt-name">${esc(t.name)}</div>
              </button>`).join("")}
          </div>

          <label class="field-label" style="margin-top:18px">MCP Servers</label>
          <p class="field-hint">Select MCP servers from the registry to be available in sessions created from this expert.</p>
          <div class="mcp-multi" id="ex-mcp-multi">
            <button type="button" class="mcp-multi-trigger field" id="ex-mcp-toggle">
              <span id="ex-mcp-label">${e.mcpPinned.length ? esc(e.mcpPinned.join(", ")) : "Select MCP servers…"}</span>
              <span class="c-tools-chev">${I.chevD}</span>
            </button>
            <div class="mcp-multi-dd" id="ex-mcp-dd" hidden>
              ${mcpOpts.map((name) => `
                <label class="mcp-multi-opt">
                  <input type="checkbox" data-mcp-pin="${esc(name)}" ${e.mcpPinned.includes(name) ? "checked" : ""}/>
                  ${esc(name)}
                </label>`).join("")}
            </div>
          </div>
        </div>
      </div>

      <div class="ex-section-row">
        <div class="ex-section-intro">
          <h2>Workers</h2>
          <p>Experts this agent can launch asynchronously to handle sub-tasks.</p>
        </div>
        <div class="ex-section-fields">
          <div class="tool-chip-box" id="ex-workers-box">
            ${workerChips || `<span class="muted" style="font-size:13px">No workers</span>`}
            <button type="button" class="tool-chip tool-chip-add" id="ex-add-worker">+ Add worker</button>
          </div>
        </div>
      </div>

      <div class="ex-section-row">
        <div class="ex-section-intro">
          <h2>Sharing</h2>
          <p>Manage who can discover and use this expert.</p>
        </div>
        <div class="ex-section-fields">
          <button type="button" class="btn share-expert-btn" id="btn-share-expert">Share expert</button>
        </div>
      </div>

      <div class="ex-section-row danger-section">
        <div class="ex-section-intro">
          <h2>Danger zone</h2>
          <p>These actions cannot be undone.</p>
        </div>
        <div class="ex-section-fields danger-fields">
          <div class="danger-row">
            <div>
              <div class="danger-title">Delete expert</div>
              <p class="field-hint" style="margin:0">Permanently removing this expert will cause any triggers or automations that reference it to stop working.</p>
            </div>
            <button type="button" class="btn danger-text" id="btn-del-expert">🗑 Delete expert</button>
          </div>
        </div>
      </div>`;
  }

  function bindMdToolbars() {
    $$(".md-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.for;
        const ta = document.getElementById(id);
        if (!ta) return;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const sel = ta.value.slice(start, end) || "text";
        const wrap = {
          b: `**${sel}**`,
          i: `*${sel}*`,
          s: `~~${sel}~~`,
          h1: `# ${sel}`,
          h2: `## ${sel}`,
          h3: `### ${sel}`,
          ul: `- ${sel}`,
          ol: `1. ${sel}`,
          code: `\`${sel}\``,
          link: `[${sel}](https://)`,
        }[btn.dataset.md] || sel;
        ta.value = ta.value.slice(0, start) + wrap + ta.value.slice(end);
        ta.focus();
        toast("Markdown inserted");
      });
    });
  }

  function bindExpertDetail(e) {
    if (!e) return;
    $("#back-experts")?.addEventListener("click", () => navigate("experts"));
    $("#ex-show-more")?.addEventListener("click", () => {
      $("#ex-desc-short").hidden = true;
      $("#ex-desc-full").hidden = false;
    });
    $("#ex-show-less")?.addEventListener("click", () => {
      $("#ex-desc-short").hidden = false;
      $("#ex-desc-full").hidden = true;
    });
    $("#btn-share-expert")?.addEventListener("click", () => openShare("expert"));
    $("#btn-dup-expert")?.addEventListener("click", () => toast(`Duplicated “${e.name}” as draft`));
    $("#btn-save-expert")?.addEventListener("click", () => {
      e.prompt = $("#ex-prompt")?.value || e.prompt;
      e.placeholder = $("#ex-ph")?.value || e.placeholder;
      e.instructions = $("#ex-user-instr")?.value || e.instructions;
      e.model = $("#ex-model")?.value || e.model;
      toast("Expert saved");
    });
    $("#tune-expert")?.addEventListener("click", () => {
      state.selectedExpertId = "advisor";
      state.promptDraft = `Tune the ${e.name} expert: improve instructions and suggest triggers.`;
      navigate("home");
    });
    $("#btn-launch-ex")?.addEventListener("click", () => {
      const envVal = $("#ex-env")?.value;
      if (envVal && envVal !== "auto") state.envId = envVal;
      state.modelId = $("#ex-model")?.value || e.model;
      state.selectedExpertId = e.id;
      state.promptDraft = $("#ex-ph")?.value || e.placeholder;
      navigate("home");
    });
    $("#btn-del-expert")?.addEventListener("click", () => {
      openConfirm(`Delete expert “${e.name}”? This cannot be undone.`, () => toast("Expert deleted (prototype)"));
    });
    bindMdToolbars();
    bindExpertToolsWorkers(e);
  }

  function bindExpertToolsWorkers(e) {
    ensureExpertTools(e);
    $$("[data-rm-tool]").forEach((btn) => btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      e.tools = e.tools.filter((t) => t.id !== btn.dataset.rmTool);
      toast("Integration removed");
      render();
    }));
    $("#ex-add-tool")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const menu = $("#ex-tool-add-menu");
      if (menu) menu.hidden = !menu.hidden;
    });
    $$("[data-add-tool]").forEach((btn) => btn.addEventListener("click", () => {
      const id = btn.dataset.addTool;
      const catalog = {
        "web-fetch": { id: "web-fetch", name: "Web Fetch", icon: "web" },
        github: { id: "github", name: "GitHub", icon: "github" },
        "github-app": { id: "github-app", name: "GitHub App", icon: "github" },
        linear: { id: "linear", name: "Linear", icon: "linear" },
        "linear-app": { id: "linear-app", name: "Linear App", icon: "linear" },
        slack: { id: "slack", name: "Slack", icon: "slack" },
      };
      if (catalog[id] && !e.tools.some((t) => t.id === id)) e.tools.push(catalog[id]);
      toast(`${catalog[id]?.name || id} added`);
      render();
    }));
    $("#ex-mcp-toggle")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const dd = $("#ex-mcp-dd");
      if (dd) dd.hidden = !dd.hidden;
    });
    $$("[data-mcp-pin]").forEach((cb) => cb.addEventListener("change", () => {
      e.mcpPinned = $$("[data-mcp-pin]:checked").map((c) => c.dataset.mcpPin);
      const lab = $("#ex-mcp-label");
      if (lab) lab.textContent = e.mcpPinned.length ? e.mcpPinned.join(", ") : "Select MCP servers…";
      toast("MCP selection updated");
    }));
    $$("[data-rm-worker]").forEach((btn) => btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      e.workers = e.workers.filter((w) => w !== btn.dataset.rmWorker);
      toast("Worker removed");
      render();
    }));
    $("#ex-add-worker")?.addEventListener("click", () => {
      const opts = EXPERTS.filter((x) => x.id !== e.id).map((x) => x.name);
      const name = prompt("Worker expert name", opts[0] || "PR Author – Status Poll Worker");
      if (!name) return;
      if (!e.workers.includes(name)) e.workers.push(name);
      toast(`Worker “${name}” added`);
      render();
    });
    document.addEventListener("click", (ev) => {
      if (!ev.target.closest("#ex-mcp-multi")) {
        const dd = $("#ex-mcp-dd");
        if (dd) dd.hidden = true;
      }
      if (!ev.target.closest("#ex-add-tool") && !ev.target.closest("#ex-tool-add-menu")) {
        const m = $("#ex-tool-add-menu");
        if (m) m.hidden = true;
      }
    }, { once: true });
  }

  function viewEnvironments() {
    /* Product screenshot: Environments list + Advisor banner + Create menu + Mine/All + Filter/Search + table */
    let list = ENVIRONMENTS.filter((en) => (state.envScope === "mine" ? en.mine : true));
    const q = (state.envQuery || "").toLowerCase();
    if (q) {
      list = list.filter((en) =>
        en.name.toLowerCase().includes(q) ||
        (en.note || "").toLowerCase().includes(q) ||
        (en.repos || []).join(" ").toLowerCase().includes(q)
      );
    }
    const sort = state.envSort || "name";
    list = [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      return 0;
    });
    return `<div class="page wide env-page">
      <div class="page-header">
        <div>
          <h1>Environments</h1>
          <p class="sub">An environment is a reusable VM snapshot with pre-installed tools, packages, and repositories. Each session runs inside one. Daemon pools group locally-running daemons so sessions can target a specific daemon.</p>
        </div>
        <div class="rel">
          <button type="button" class="btn primary create-env-btn" id="btn-create-env">Create an environment ${I.chevD}</button>
        </div>
      </div>

      <button type="button" class="advisor-banner env-advisor" id="env-advisor">
        <span class="advisor-mark">${I.cosmos}</span>
        <div>
          <div class="banner-title">Describe your environment and an agent will set it up →</div>
          <div class="banner-sub">Cosmos Advisor agent configures the environment</div>
        </div>
      </button>

      <div class="toolbar env-toolbar">
        <div class="seg" id="env-scope">
          <button type="button" data-scope="mine" class="${state.envScope === "mine" ? "active" : ""}">Mine</button>
          <button type="button" data-scope="all" class="${state.envScope === "all" ? "active" : ""}">All</button>
        </div>
        <div class="env-toolbar-right">
          <button type="button" class="btn ghost sm" id="env-filter-btn">☰ Filter ▾</button>
          <div class="env-search">
            <span class="env-search-ico">${I.search}</span>
            <input class="field" id="env-filter" placeholder="Search environments…" value="${esc(state.envQuery || "")}"/>
          </div>
        </div>
      </div>

      <div class="env-table-wrap">
        <table class="table env-table" id="env-table">
          <thead>
            <tr>
              <th class="col-check"><input type="checkbox" id="env-check-all" title="Select all"/></th>
              <th class="col-name sortable" data-sort="name">Name <span class="sort-ico">↑</span></th>
              <th>Size</th>
              <th>Repos</th>
              <th>Creator</th>
              <th>Last built</th>
              <th class="col-menu"></th>
            </tr>
          </thead>
          <tbody>
            ${list.map((en) => {
              const repos = en.repos || [];
              const isDaemon = en.kind === "Self-hosted";
              return `<tr data-env-row="${en.id}" class="${state.envId === en.id ? "is-default" : ""}">
                <td class="col-check"><input type="checkbox" data-env-check="${en.id}"/></td>
                <td class="col-name">
                  <div class="env-name-cell">
                    <span class="env-kind-ico" title="${esc(en.kind)}">${isDaemon ? I.daemon : I.cloud}</span>
                    <div>
                      <div class="env-name-line">
                        <strong>${esc(en.name)}</strong>
                        ${state.envId === en.id ? `<span class="meta-pill">default</span>` : ""}
                      </div>
                      ${en.note ? `<div class="env-note">${esc(en.note)}</div>` : ""}
                    </div>
                  </div>
                </td>
                <td class="muted">${esc(en.size)}</td>
                <td class="env-repos">
                  ${repos.length
                    ? repos.map((r) => `<span class="repo-pill">${esc(r)}</span>`).join(" ")
                    : `<span class="muted">—</span>`}
                </td>
                <td><span class="creator-av" title="${esc(en.creator)}">${esc(en.creator)}</span></td>
                <td class="muted">${esc(en.built || "—")}</td>
                <td class="col-menu">
                  <button type="button" class="icon-btn" data-env-menu="${en.id}" title="More">⋯</button>
                </td>
              </tr>`;
            }).join("") || `<tr><td colspan="7" class="muted" style="padding:24px;text-align:center">No environments match</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="table-footer env-footer">
        <span>${list.length} environment${list.length === 1 ? "" : "s"}</span>
        <div class="env-pager">
          <button type="button" class="btn ghost sm" disabled>‹</button>
          <span class="muted">Page 1 of 1</span>
          <button type="button" class="btn ghost sm" disabled>›</button>
          <span class="muted" style="margin-left:12px">Rows</span>
          <select class="field-select env-rows" disabled><option>25</option></select>
        </div>
      </div>
    </div>`;
  }

  function bindEnvironments() {
    $("#btn-create-env")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openCreateEnvDd(e.currentTarget);
    });
    $$("#env-scope button").forEach((b) => b.addEventListener("click", () => {
      state.envScope = b.dataset.scope;
      render();
    }));
    $("#env-filter")?.addEventListener("input", (e) => {
      state.envQuery = e.target.value;
      state.promptDraft = state.promptDraft; /* keep */
      /* soft re-render keeping focus */
      const v = e.target.value;
      state.envQuery = v;
      render();
      const input = $("#env-filter");
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    });
    $("#env-filter-btn")?.addEventListener("click", () => toast("Filter: Cloud · Self-hosted · Creator (prototype)"));
    $("#env-check-all")?.addEventListener("change", (e) => {
      $$("[data-env-check]").forEach((cb) => { cb.checked = e.target.checked; });
    });
    $$("[data-env-menu]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.envMenu;
      const en = env(id);
      hidePopovers();
      const dd = $("#create-env-dd");
      dd.innerHTML = `
        <button type="button" class="dd-opt" data-em="use"><div class="dd-opt-name">Use as default</div></button>
        <button type="button" class="dd-opt" data-em="edit"><div class="dd-opt-name">Edit</div></button>
        <button type="button" class="dd-opt" data-em="dup"><div class="dd-opt-name">Duplicate</div></button>
        <button type="button" class="dd-opt" data-em="del"><div class="dd-opt-name">Delete</div></button>`;
      placePopover(dd, btn, { preferDown: true, align: "end" });
      $$("#create-env-dd [data-em]").forEach((b) => b.addEventListener("click", () => {
        hidePopovers();
        const a = b.dataset.em;
        if (a === "use") {
          state.envId = id;
          toast(`Default environment → ${en.name}`);
          render();
        } else if (a === "edit") toast(`Edit “${en.name}” (prototype)`);
        else if (a === "dup") {
          ENVIRONMENTS.unshift({
            ...en,
            id: en.id + "-copy-" + Date.now().toString(36).slice(2, 6),
            name: en.name + " copy",
            built: "Just now",
            mine: true,
          });
          toast("Environment duplicated");
          render();
        } else if (a === "del" && confirm(`Delete environment “${en.name}”?`)) {
          const i = ENVIRONMENTS.findIndex((x) => x.id === id);
          if (i >= 0) ENVIRONMENTS.splice(i, 1);
          if (state.envId === id) state.envId = ENVIRONMENTS[0]?.id || "augment";
          toast("Environment deleted");
          render();
        }
      }));
    }));
    $$("#env-table tr[data-env-row]").forEach((tr) => tr.addEventListener("click", (e) => {
      if (e.target.closest("button, input, a")) return;
      state.envId = tr.dataset.envRow;
      toast(`Selected ${env(state.envId).name}`);
      render();
    }));
    $("#env-advisor")?.addEventListener("click", () => {
      state.selectedExpertId = "advisor";
      state.promptDraft = "Help me create an Environment for a Ruby on Rails project with Ruby 3.4 and Sqlite3.";
      navigate("home");
    });
  }

  function viewIntegrations() {
    const groups = [...new Set(INTEGRATIONS.map((i) => i.group))];
    return `<div class="page wide">
      <div class="page-header"><div><h1>Integrations</h1><p class="sub">Team Apps power org-wide triggers. Personal Apps attach to your sessions. Meet the work where it happens.</p></div></div>
      ${groups.map((g) => {
        const items = INTEGRATIONS.filter((i) => i.group === g);
        return `<div class="integ-section">${esc(g)}</div><div class="integ-grid">${items.map((i) => `
          <div class="integ-card"><div class="left"><div class="integ-icon">${I[i.icon] || I.hex}</div>
          <div><h3>${esc(i.name)}</h3><p>${i.connected ? "Connected" : "Not connected"}</p></div></div>
          ${i.connected
            ? `<button type="button" class="toggle" data-integ="${i.id}"><span class="toggle-knob"></span></button>`
            : `<button type="button" class="btn sm" data-connect="${i.id}">Connect ↗</button>`}
          </div>`).join("")}</div>`;
      }).join("")}
    </div>`;
  }
  function bindIntegrations() { wireInteg(); }

  function wireInteg() {
    $$("[data-integ]").forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = "1";
      const item = INTEGRATIONS.find((i) => i.id === btn.dataset.integ);
      if (item) btn.classList.toggle("off", !item.connected);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const it = INTEGRATIONS.find((i) => i.id === btn.dataset.integ);
        if (!it) return;
        it.connected = !it.connected;
        $$("[data-integ='" + it.id + "']").forEach((b) => b.classList.toggle("off", !it.connected));
        toast(`${it.name} ${it.connected ? "connected" : "disconnected"}`);
        if (state.route === "integrations") render();
        else syncShowcase();
      });
    });
    $$("[data-connect]").forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", () => {
        const it = INTEGRATIONS.find((i) => i.id === btn.dataset.connect);
        if (it) { it.connected = true; toast(`${it.name} connected`); render(); }
      });
    });
  }

  function viewMcp() {
    return `<div class="page wide">
      <div class="page-header">
        <div>
          <h1>MCP Registry</h1>
          <p class="sub">Settings → Capabilities. Add partner or custom MCP servers, then pin them on Experts (docs/config-mcp).</p>
        </div>
        <button type="button" class="btn add-server-btn" id="btn-add-mcp">${I.plus} Add server</button>
      </div>
      <div class="callout">Partner catalog: Atlassian, Sentry, Stripe, Figma, Datadog, Salesforce. Pin servers from the Expert editor Tools section.</div>
      <table class="table" id="mcp-table">
        <thead><tr><th>Name</th><th>Transport</th><th>Endpoint</th><th>Scope</th><th>Status</th><th></th></tr></thead>
        <tbody>${MCP.map((m, i) => `<tr data-mcp-i="${i}">
          <td><strong style="font-weight:500">${esc(m.name)}</strong></td>
          <td class="muted">${esc(m.transport || "http")}</td>
          <td class="mono muted" style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${esc(m.url)}</td>
          <td class="muted">${esc(m.scope || "org")}</td>
          <td><span class="status ${m.status === "active" ? "running" : "paused"}">${esc(m.status)}</span></td>
          <td class="row gap-8" style="justify-content:flex-end">
            <button type="button" class="btn ghost sm" data-mcp-test="${i}">Test</button>
            <button type="button" class="btn ghost sm" data-mcp-edit="${i}">Edit</button>
            <button type="button" class="btn ghost sm" data-mcp-del="${i}">Remove</button>
          </td>
        </tr>`).join("")}</tbody>
      </table>
      <div class="table-footer"><span>${MCP.length} servers in registry</span></div>
    </div>`;
  }

  /* ---- Add MCP server flow (designed interaction) ----
     Step catalog → configure → test → done
  */
  function openAddMcp(prefill) {
    state.mcpAdd = {
      step: "catalog", // catalog | configure | testing | done
      catalogId: prefill?.id || null,
      name: prefill?.name || "",
      transport: prefill?.transport || "http",
      url: prefill?.url || "",
      command: "",
      auth: "none", // none | bearer | header
      token: "",
      scope: "org", // org | space | personal
      testResult: null,
    };
    renderAddMcp();
  }

  function renderAddMcp() {
    const body = $("#mcp-add-body");
    const backdrop = $("#mcp-add-backdrop");
    const sub = $("#mcp-add-sub");
    if (!body || !backdrop || !state.mcpAdd) return;
    backdrop.hidden = false;
    const s = state.mcpAdd;

    if (s.step === "catalog") {
      if (sub) sub.textContent = "Pick a partner server or add a custom endpoint";
      body.innerHTML = `
        <div class="mcp-steps">
          <span class="mcp-step on">1 · Choose</span>
          <span class="mcp-step">2 · Configure</span>
          <span class="mcp-step">3 · Connect</span>
        </div>
        <div class="mcp-search-row">
          <input class="field" id="mcp-cat-q" placeholder="Search catalog…" autocomplete="off"/>
        </div>
        <div class="mcp-catalog" id="mcp-catalog">
          ${MCP_CATALOG.map((c) => `
            <button type="button" class="mcp-cat-card" data-cat="${c.id}">
              <span class="mcp-cat-ico">${I[c.icon] || I.hex}</span>
              <span class="mcp-cat-text">
                <span class="mcp-cat-name">${esc(c.name)}</span>
                <span class="mcp-cat-blurb">${esc(c.blurb)}</span>
              </span>
              <span class="mcp-cat-chev">${I.chev}</span>
            </button>`).join("")}
        </div>`;
      const filter = () => {
        const q = ($("#mcp-cat-q")?.value || "").toLowerCase();
        $$("#mcp-catalog .mcp-cat-card").forEach((card) => {
          const c = MCP_CATALOG.find((x) => x.id === card.dataset.cat);
          const hit = !q || c.name.toLowerCase().includes(q) || c.blurb.toLowerCase().includes(q);
          card.style.display = hit ? "" : "none";
        });
      };
      $("#mcp-cat-q")?.addEventListener("input", filter);
      $$("[data-cat]").forEach((btn) => btn.addEventListener("click", () => {
        const c = MCP_CATALOG.find((x) => x.id === btn.dataset.cat);
        if (!c) return;
        s.catalogId = c.id;
        s.name = c.custom ? "" : c.name;
        s.transport = c.transport;
        s.url = c.url;
        s.step = "configure";
        renderAddMcp();
      }));
      return;
    }

    if (s.step === "configure") {
      if (sub) sub.textContent = s.catalogId === "custom" ? "Custom MCP endpoint" : `Configure ${s.name || "server"}`;
      const isStdio = s.transport === "stdio";
      body.innerHTML = `
        <div class="mcp-steps">
          <span class="mcp-step done">1 · Choose</span>
          <span class="mcp-step on">2 · Configure</span>
          <span class="mcp-step">3 · Connect</span>
        </div>
        <label class="field-label">Display name</label>
        <input class="field" id="mcp-name" value="${esc(s.name)}" placeholder="e.g. Sentry production"/>
        <label class="field-label" style="margin-top:12px">Transport</label>
        <div class="seg" id="mcp-transport">
          <button type="button" data-t="http" class="${s.transport === "http" ? "active" : ""}">HTTP</button>
          <button type="button" data-t="sse" class="${s.transport === "sse" ? "active" : ""}">SSE</button>
          <button type="button" data-t="stdio" class="${s.transport === "stdio" ? "active" : ""}">stdio</button>
        </div>
        <div id="mcp-endpoint-block">
          ${isStdio ? `
            <label class="field-label" style="margin-top:12px">Command</label>
            <input class="field mono-field" id="mcp-cmd" value="${esc(s.command || s.url.replace(/^stdio:\/\//, "") || "")}" placeholder="npx -y @sentry/mcp-server"/>
            <p class="muted" style="font-size:12px;margin-top:6px">Runs in the Expert environment. Secrets can be injected from the Secrets manager.</p>
          ` : `
            <label class="field-label" style="margin-top:12px">Server URL</label>
            <input class="field mono-field" id="mcp-url" value="${esc(s.url)}" placeholder="https://mcp.example.com/sse"/>
          `}
        </div>
        <label class="field-label" style="margin-top:12px">Authentication</label>
        <select class="field-select" id="mcp-auth">
          <option value="none" ${s.auth === "none" ? "selected" : ""}>None</option>
          <option value="bearer" ${s.auth === "bearer" ? "selected" : ""}>Bearer token</option>
          <option value="header" ${s.auth === "header" ? "selected" : ""}>Custom header</option>
        </select>
        <div id="mcp-auth-extra" style="${s.auth === "none" ? "display:none" : ""};margin-top:10px">
          <label class="field-label">${s.auth === "header" ? "Header value" : "Token"}</label>
          <input class="field mono-field" id="mcp-token" type="password" value="${esc(s.token)}" placeholder="Paste secret or reference a Cosmos secret"/>
        </div>
        <label class="field-label" style="margin-top:12px">Visibility</label>
        <select class="field-select" id="mcp-scope">
          <option value="org" ${s.scope === "org" ? "selected" : ""}>Organization — all Spaces</option>
          <option value="space" ${s.scope === "space" ? "selected" : ""}>This Space · ${esc(state.space)}</option>
          <option value="personal" ${s.scope === "personal" ? "selected" : ""}>Personal — only you</option>
        </select>
        <div class="row gap-8 end" style="margin-top:18px">
          <button type="button" class="btn ghost" id="mcp-back-cat">Back</button>
          <button type="button" class="btn primary" id="mcp-to-test">Continue</button>
        </div>`;
      $$("#mcp-transport button").forEach((b) => b.addEventListener("click", () => {
        s.transport = b.dataset.t;
        s.name = $("#mcp-name")?.value || s.name;
        s.url = $("#mcp-url")?.value || s.url;
        s.command = $("#mcp-cmd")?.value || s.command;
        s.auth = $("#mcp-auth")?.value || s.auth;
        s.token = $("#mcp-token")?.value || s.token;
        s.scope = $("#mcp-scope")?.value || s.scope;
        renderAddMcp();
      }));
      $("#mcp-auth")?.addEventListener("change", (e) => {
        s.auth = e.target.value;
        const extra = $("#mcp-auth-extra");
        if (extra) extra.style.display = s.auth === "none" ? "none" : "";
      });
      $("#mcp-back-cat")?.addEventListener("click", () => { s.step = "catalog"; renderAddMcp(); });
      $("#mcp-to-test")?.addEventListener("click", () => {
        s.name = ($("#mcp-name")?.value || "").trim();
        s.transport = $$("#mcp-transport button.active")[0]?.dataset.t || s.transport;
        if (s.transport === "stdio") {
          s.command = ($("#mcp-cmd")?.value || "").trim();
          s.url = s.command ? "stdio://" + s.command.split(/\s+/)[0] : "";
        } else {
          s.url = ($("#mcp-url")?.value || "").trim();
        }
        s.auth = $("#mcp-auth")?.value || "none";
        s.token = $("#mcp-token")?.value || "";
        s.scope = $("#mcp-scope")?.value || "org";
        if (!s.name) { toast("Display name required"); return; }
        if (s.transport === "stdio" && !s.command) { toast("Command required for stdio"); return; }
        if (s.transport !== "stdio" && !s.url) { toast("Server URL required"); return; }
        if (s.transport !== "stdio" && !/^https?:\/\//i.test(s.url) && !s.url.startsWith("stdio:")) {
          toast("URL must start with http:// or https://"); return;
        }
        s.step = "testing";
        s.testResult = null;
        renderAddMcp();
        /* simulate connection probe */
        setTimeout(() => {
          if (state.mcpAdd !== s) return;
          s.testResult = {
            ok: true,
            tools: s.catalogId === "sentry" ? 6 : s.catalogId === "stripe" ? 12 : 4,
            latency: 80 + Math.floor(Math.random() * 120),
          };
          renderAddMcp();
        }, 900);
      });
      return;
    }

    if (s.step === "testing") {
      if (sub) sub.textContent = "Verify the server responds before saving";
      const pending = !s.testResult;
      body.innerHTML = `
        <div class="mcp-steps">
          <span class="mcp-step done">1 · Choose</span>
          <span class="mcp-step done">2 · Configure</span>
          <span class="mcp-step on">3 · Connect</span>
        </div>
        <div class="mcp-test-card">
          <div class="mcp-test-head">
            <strong>${esc(s.name)}</strong>
            <span class="meta-pill">${esc(s.transport)}</span>
          </div>
          <p class="mono muted" style="font-size:12px;margin:8px 0 0;word-break:break-all">${esc(s.transport === "stdio" ? s.command : s.url)}</p>
          <div class="mcp-test-status ${pending ? "pending" : s.testResult.ok ? "ok" : "fail"}">
            ${pending
              ? `<span class="mcp-spinner"></span> Probing tools/list…`
              : s.testResult.ok
                ? `✓ Connected · ${s.testResult.tools} tools · ${s.testResult.latency} ms`
                : `✕ Connection failed — check URL / credentials`}
          </div>
        </div>
        <div class="callout" style="margin-top:14px">After save, pin this server on an Expert under <strong>Tools</strong>. Live sessions can attach it without restart (Week 28).</div>
        <div class="row gap-8 end" style="margin-top:18px">
          <button type="button" class="btn ghost" id="mcp-back-cfg">Back</button>
          <button type="button" class="btn ghost" id="mcp-retest" ${pending ? "disabled" : ""}>Retest</button>
          <button type="button" class="btn primary" id="mcp-save" ${pending || (s.testResult && !s.testResult.ok) ? "disabled" : ""}>Add to registry</button>
        </div>`;
      $("#mcp-back-cfg")?.addEventListener("click", () => { s.step = "configure"; renderAddMcp(); });
      $("#mcp-retest")?.addEventListener("click", () => {
        s.testResult = null;
        renderAddMcp();
        setTimeout(() => {
          if (state.mcpAdd !== s) return;
          s.testResult = { ok: true, tools: 5, latency: 95 };
          renderAddMcp();
        }, 700);
      });
      $("#mcp-save")?.addEventListener("click", () => {
        if (pending || !s.testResult?.ok) return;
        MCP.unshift({
          name: s.name,
          url: s.transport === "stdio" ? (s.url || "stdio://" + s.command) : s.url,
          status: "active",
          transport: s.transport,
          scope: s.scope,
        });
        s.step = "done";
        renderAddMcp();
      });
      return;
    }

    if (s.step === "done") {
      if (sub) sub.textContent = "Server is in the registry";
      body.innerHTML = `
        <div class="mcp-done">
          <div class="mcp-done-check">✓</div>
          <h3 style="margin:0 0 6px;font-size:16px;font-weight:600;color:var(--heading)">${esc(s.name)} added</h3>
          <p class="muted" style="margin:0;font-size:13.5px;line-height:1.45">Pinned on no Experts yet. Open an Expert → Tools to attach it, or live-attach from a running session.</p>
        </div>
        <div class="row gap-8 end" style="margin-top:20px">
          <button type="button" class="btn ghost" id="mcp-add-another">Add another</button>
          <button type="button" class="btn primary" id="mcp-done-close">Done</button>
        </div>`;
      $("#mcp-add-another")?.addEventListener("click", () => openAddMcp());
      $("#mcp-done-close")?.addEventListener("click", () => {
        $("#mcp-add-backdrop").hidden = true;
        state.mcpAdd = null;
        render();
      });
    }
  }
  function viewWebhooks() {
    /* docs/config-webhooks: Bearer Token, shared/personal, URL + signing secret once */
    return `<div class="page wide"><div class="page-header"><div><h1>Webhooks</h1>
      <p class="sub">Custom HTTPS endpoints for Datadog, CircleCI, etc. Wire from Automations as a <strong>Webhook</strong> trigger. Under Capabilities / Webhooks.</p></div>
      <button type="button" class="btn primary" id="btn-add-wh">${I.plus} Create webhook</button></div>
      <div class="callout"><strong>URL form:</strong> <code>POST https://{tenant}.api.augmentcode.com/webhooks/{id}</code> · Authorization: Bearer &lt;signing secret&gt;</div>
      <div class="integ-grid">${WEBHOOKS.map((w) => `
        <div class="integ-card" style="flex-direction:column;align-items:stretch;gap:10px">
          <div class="row gap-8" style="justify-content:space-between">
            <div class="row gap-8"><div class="avatar">AV</div><div><h3 style="margin:0;font-size:14px;font-weight:500">${esc(w.name)}</h3>
              <div class="muted" style="font-size:12px">${esc(w.type || "Bearer Token")} · ${esc(w.scope || "shared")}</div></div></div>
            <span class="meta-pill">${w.events} events</span>
          </div>
          <p class="mono muted" style="margin:0;font-size:12px;word-break:break-all">${esc(w.url)}</p>
          <div class="row gap-8">
            <button type="button" class="btn sm" data-copy-url="${esc(w.url)}">${I.copy} Copy URL</button>
            <button type="button" class="btn ghost sm" data-wh-curl="${esc(w.id)}">curl test</button>
            <button type="button" class="btn ghost sm" data-wh-edit="${esc(w.name)}">Edit</button>
          </div>
        </div>`).join("")}</div></div>`;
  }
  function viewSecrets() {
    return `<div class="page wide"><div class="page-header"><div><h1>Secrets</h1><p class="sub">Cosmos Secrets Manager. Value pasted once, then write-only — rotate by editing. In-scope secrets auto-export into each Expert VM as upper-snake-case env vars (openai-api-key → <code>$OPENAI_API_KEY</code>).</p></div>
      <button type="button" class="btn primary" id="btn-add-secret">${I.plus} Add secret</button></div>
      <table class="table"><thead><tr><th>Name</th><th>Value</th><th>Scope</th><th>Install in VMs</th><th>Updated</th></tr></thead>
      <tbody>${SECRETS.map((s,i) => `<tr>
        <td class="mono">${esc(s.name)}</td>
        <td class="mono muted"><button type="button" class="btn ghost sm" data-reveal="${i}">••••••••</button></td>
        <td><span class="tag-shared">${esc(s.scope)}</span></td>
        <td class="muted">${s.vmInstall === false ? "Off" : "Auto"}</td>
        <td class="muted">${esc(s.updated)}</td>
      </tr>`).join("")}</tbody></table>
      <p class="muted" style="margin-top:12px;font-size:12px">Scope: <strong>Private</strong> — only your sessions can read it · <strong>Shared</strong> — visible to all members of your organization. On a name collision, your sessions read the Private one.</p></div>`;
  }
  function openCreateWebhook() {
    const body = $("#webhook-create-body");
    if (!body) {
      const name = prompt("Webhook name (description)");
      if (!name) return;
      const id = "wh_" + Math.random().toString(36).slice(2, 8);
      WEBHOOKS.unshift({ id, name, url: `https://acme.api.augmentcode.com/webhooks/${id}`, events: 0, scope: "shared", type: "Bearer Token" });
      toast(`Webhook created — copy signing secret now (shown once)`);
      render();
      return;
    }
    body.innerHTML = `
      <label class="field-label">Type</label>
      <select class="field-select" id="wh-type"><option>Bearer Token</option></select>
      <label class="field-label" style="margin-top:12px">Description / name</label>
      <input class="field" id="wh-name" placeholder="datadog-alerts"/>
      <label class="field-label" style="margin-top:12px">Sharing scope</label>
      <select class="field-select" id="wh-scope"><option value="shared">Shared with organization</option><option value="personal">Personal</option></select>
      <div class="row gap-8 end" style="margin-top:16px">
        <button type="button" class="btn ghost" data-close="webhook-create-backdrop">Cancel</button>
        <button type="button" class="btn primary" id="wh-create-go">Create</button>
      </div>`;
    $("#webhook-create-backdrop").hidden = false;
    body.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => { $("#webhook-create-backdrop").hidden = true; }));
    $("#wh-create-go")?.addEventListener("click", () => {
      const name = ($("#wh-name")?.value || "").trim();
      if (!name) { toast("Name required"); return; }
      const id = "wh_" + Math.random().toString(36).slice(2, 8);
      const secret = "whsec_" + Math.random().toString(36).slice(2, 18);
      const scope = $("#wh-scope")?.value || "shared";
      WEBHOOKS.unshift({ id, name, url: `https://acme.api.augmentcode.com/webhooks/${id}`, events: 0, scope, type: "Bearer Token" });
      body.innerHTML = `
        <div class="callout"><strong>Copy now — signing secret is shown once</strong> and cannot be retrieved later (docs).</div>
        <label class="field-label" style="margin-top:12px">Webhook URL</label>
        <input class="field mono-field" readonly value="https://acme.api.augmentcode.com/webhooks/${id}" id="wh-url-out"/>
        <label class="field-label" style="margin-top:12px">Signing Secret</label>
        <input class="field mono-field" readonly value="${secret}" id="wh-sec-out"/>
        <div class="row gap-8 end" style="margin-top:16px">
          <button type="button" class="btn sm" id="wh-copy-both">Copy both</button>
          <button type="button" class="btn primary" id="wh-done">Done</button>
        </div>`;
      $("#wh-copy-both")?.addEventListener("click", () => {
        navigator.clipboard?.writeText(`URL: https://acme.api.augmentcode.com/webhooks/${id}\nSecret: ${secret}`);
        toast("URL + secret copied");
      });
      $("#wh-done")?.addEventListener("click", () => {
        $("#webhook-create-backdrop").hidden = true;
        render();
      });
    });
  }

  function bindMcpWhSec() {
    $("#btn-add-mcp")?.addEventListener("click", () => openAddMcp());
    $$("[data-mcp-test]").forEach((btn) => btn.addEventListener("click", () => {
      const m = MCP[+btn.dataset.mcpTest];
      toast(m ? `tools/list ok · ${m.name}` : "Server missing");
    }));
    $$("[data-mcp-edit]").forEach((btn) => btn.addEventListener("click", () => {
      const m = MCP[+btn.dataset.mcpEdit];
      if (!m) return;
      openAddMcp({ id: "custom", name: m.name, transport: m.transport || "http", url: m.url, custom: true });
      /* jump to configure with existing values */
      if (state.mcpAdd) {
        state.mcpAdd.step = "configure";
        state.mcpAdd.name = m.name;
        state.mcpAdd.transport = m.transport || "http";
        state.mcpAdd.url = m.url;
        state.mcpAdd.scope = m.scope || "org";
        renderAddMcp();
      }
    }));
    $$("[data-mcp-del]").forEach((btn) => btn.addEventListener("click", () => {
      const i = +btn.dataset.mcpDel;
      const m = MCP[i];
      if (!m) return;
      if (confirm(`Remove “${m.name}” from the registry? Experts keep other tools.`)) {
        MCP.splice(i, 1);
        toast("MCP server removed");
        render();
      }
    }));
    $("#btn-add-wh")?.addEventListener("click", () => openCreateWebhook());
    $$("[data-copy-url]").forEach((btn) => btn.addEventListener("click", () => {
      navigator.clipboard?.writeText(btn.dataset.copyUrl);
      toast("Webhook URL copied");
    }));
    $$("[data-wh-curl]").forEach((btn) => btn.addEventListener("click", () => {
      const w = WEBHOOKS.find((x) => x.id === btn.dataset.whCurl);
      if (!w) return;
      const cmd = `curl -X POST "${w.url}" -H "Authorization: Bearer <signing-secret>" -H "Content-Type: application/json" -d '{"action":"ping"}'`;
      navigator.clipboard?.writeText(cmd);
      toast("curl sample copied — then check Event Log · source=Webhook");
    }));
    $$("[data-wh-edit]").forEach((btn) => btn.addEventListener("click", () => toast("Edit webhook “" + btn.dataset.whEdit + "” (prototype)")));
    $("#btn-add-secret")?.addEventListener("click", () => {
      const name = prompt("Secret name — exported upper-snake-case (e.g. openai-api-key → $OPENAI_API_KEY)");
      if (!name) return;
      SECRETS.unshift({ name, scope: "Private", vmInstall: true, updated: "Just now" });
      toast(`Secret “${name}” stored — value shown once, then write-only`); render();
    });
    $$("[data-copy-url]").forEach((btn) => btn.addEventListener("click", () => {
      navigator.clipboard?.writeText(btn.dataset.copyUrl);
      toast("Webhook URL copied");
    }));
    $$("[data-wh-edit]").forEach((btn) => btn.addEventListener("click", () => toast("Edit webhook “" + btn.dataset.whEdit + "”")));
    $$("[data-reveal]").forEach((btn) => btn.addEventListener("click", () => {
      if (btn.dataset.shown) {
        btn.textContent = "••••••••";
        delete btn.dataset.shown;
      } else {
        btn.textContent = "sk-••••-reveal-once";
        btn.dataset.shown = "1";
        toast("Secret revealed (allowed explicitly)");
      }
    }));
  }

  function triggersForExpert(expertId) {
    return TRIGGERS.filter((t) => t.expertId === expertId);
  }

  function viewAutomations() {
    /* Real product (docs/manage-automations + config-triggers):
       - Automations = table of Expert + its triggers
       - Create automation = right panel: Expert dropdown + Add trigger
       - Event Log / Run History under Automations group
       - Pause = disable trigger without deleting */
    const panel = state.autoPanel;
    if (panel === "events") {
      const f = state.eventFilter;
      const filtered = EVENTS.filter((ev) => {
        if (f.source && ev.source !== f.source) return false;
        if (f.eventType) {
          const hay = (ev.detail + " " + ev.source).toLowerCase();
          if (!hay.includes(f.eventType.toLowerCase())) return false;
        }
        return true;
      });
      const detail = state.eventDetail;
      return `<div class="page wide">
        <div class="page-header"><div><h1>Event Log</h1>
        <p class="sub">Every event Cosmos received. Same surface backend triggers see — use Advanced Filter / JSONLogic to sanity-check before pasting into a trigger.</p></div></div>
        <div class="toolbar">
          <select class="field-select" id="ev-source" style="width:auto;min-width:140px">
            <option value="">All sources</option>
            ${["GitHub", "GitLab", "Linear", "Slack", "Webhook", "PagerDuty", "Schedule"].map((s) =>
              `<option value="${s}" ${f.source === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
          <button type="button" class="btn sm" id="ev-advanced">Advanced Filter${f.eventType || f.payloadLogic || f.headerLogic ? " · active" : ""}</button>
          ${(f.eventType || f.payloadLogic || f.headerLogic) ? `<button type="button" class="btn ghost sm" id="ev-clear-filter">Clear advanced</button>` : ""}
        </div>
        <div class="event-layout">
          <div class="form-block" style="padding:0;overflow:hidden;flex:1;min-width:0">
            <div class="event-row event-head">
              <div>Time</div><div>Event</div><div>Expert</div><div>Status</div></div>
            ${filtered.map((ev, i) => `<div class="event-row" data-ev-idx="${EVENTS.indexOf(ev)}" style="cursor:pointer">
              <div class="event-time">${esc(ev.time)}</div>
              <div><span class="muted">${esc(ev.source)}</span> · ${esc(ev.detail)}</div>
              <div class="muted">${esc(ev.expert)}</div>
              <div><span class="status ${ev.status}">${esc(ev.status)}</span></div></div>`).join("") || `<div class="empty" style="padding:24px">No events match this filter</div>`}
          </div>
          ${detail ? `<aside class="event-detail-panel">
            <div class="row gap-8" style="justify-content:space-between;align-items:center;margin-bottom:10px">
              <strong style="font-size:13.5px;color:var(--heading)">Event details</strong>
              <button type="button" class="icon-btn" id="ev-detail-close">✕</button>
            </div>
            <div class="rb-label">Source</div><div class="rb-value" style="font-size:13px">${esc(detail.source)}</div>
            <div class="rb-label">Event type</div><div class="rb-value mono" style="font-size:12px">${esc(detail.event)}</div>
            <div class="rb-label">Headers</div>
            <pre class="payload-pre">${esc(JSON.stringify(detail.headers, null, 2))}</pre>
            <div class="rb-label">Payload (what triggers see)</div>
            <pre class="payload-pre">${esc(JSON.stringify(detail.payload, null, 2))}</pre>
            <button type="button" class="btn sm" id="ev-copy-filter" style="margin-top:10px">Copy sample JSONLogic filter</button>
          </aside>` : ""}
        </div>
      </div>`;
    }
    if (panel === "runs") {
      const runExpert = state.runExpertFilter;
      const runs = SESSIONS.filter((s) => !runExpert || s.expertId === runExpert);
      return `<div class="page wide">
        <div class="page-header"><div><h1>Run History</h1>
        <p class="sub">Sessions started by a <strong>trigger</strong> — not hand-launched sessions. Expand a row to open the session and inspect the worker tree.</p></div>
        ${runExpert ? `<button type="button" class="btn ghost sm" id="runs-clear">All experts</button>` : ""}</div>
        ${runExpert ? `<div class="callout">Filtered to <strong>${esc(expert(runExpert)?.name || runExpert)}</strong> — from automation row ⋯ → Run history.</div>` : ""}
        <table class="table">
          <thead><tr><th>Session</th><th>Expert</th><th>Status</th><th>Started</th></tr></thead>
          <tbody>${runs.map((s) => `<tr data-sid="${s.id}" style="cursor:pointer">
            <td>${esc(s.title)}</td>
            <td class="muted">${esc(expert(s.expertId)?.name || "—")}</td>
            <td><span class="status ${s.status}">${s.status}</span></td>
            <td class="muted">${esc(s.updated)}</td>
          </tr>`).join("") || `<tr><td colspan="4" class="muted">No trigger-started sessions yet</td></tr>`}</tbody>
        </table>
      </div>`;
    }
    // list — product: Expert · Last run · Updated · ⋯ (+ expandable triggers)
    let rows = EXPERTS.filter((e) => e.id !== "advisor");
    if (state.autoScope === "mine") rows = rows.filter((e) => e.mine);
    const aq = (state.autoQuery || "").toLowerCase();
    if (aq) rows = rows.filter((e) => e.name.toLowerCase().includes(aq) || e.desc.toLowerCase().includes(aq));
    /* sort by updated desc */
    rows = [...rows].sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));

    const lastRunFor = (eid) => {
      const sess = SESSIONS.find((s) => s.expertId === eid);
      return sess ? sess.updated : "Never";
    };

    return `<div class="page wide auto-page">
      <div class="page-header">
        <div>
          <h1>Automations</h1>
          <p class="sub">Manage experts that run from schedules, webhooks, and integrations.</p>
        </div>
        <button type="button" class="btn primary" id="btn-new-auto">Create automation</button>
      </div>

      <button type="button" class="advisor-banner" id="btn-auto-advisor">
        <span class="advisor-mark">${I.cosmos}</span>
        <div>
          <div class="banner-title">Describe your workflow and an agent will set it up →</div>
          <div class="banner-sub">Cosmos Advisor agent configures the experts and automations</div>
        </div>
      </button>

      <div class="toolbar env-toolbar">
        <div class="seg" id="auto-scope">
          <button type="button" data-scope="mine" class="${state.autoScope === "mine" ? "active" : ""}">Mine</button>
          <button type="button" data-scope="all" class="${state.autoScope === "all" ? "active" : ""}">All</button>
        </div>
        <div class="env-toolbar-right">
          <div class="env-search">
            <span class="env-search-ico">${I.search}</span>
            <input class="field" id="auto-filter" placeholder="Search automations…" value="${esc(state.autoQuery || "")}"/>
          </div>
        </div>
      </div>

      <div class="env-table-wrap">
        <table class="table env-table auto-table" id="auto-table">
          <thead>
            <tr>
              <th class="col-expert">Expert</th>
              <th class="col-lastrun">Last run</th>
              <th class="sortable">Updated <span class="sort-ico">↓</span></th>
              <th class="col-menu"></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((e) => {
              const trs = triggersForExpert(e.id);
              const expanded = !!(state.autoExpanded && state.autoExpanded[e.id]);
              const lastRun = lastRunFor(e.id);
              const integ = (e.integ || []).slice(0, 2);
              return `
              <tr data-auto="${e.id}" class="${expanded ? "expanded" : ""}">
                <td class="col-expert">
                  <div class="auto-expert-cell">
                    <button type="button" class="auto-expand-btn ${expanded ? "open" : ""}" data-expand="${e.id}" aria-label="Expand">
                      <span class="auto-chev">${expanded ? "▾" : "›"}</span>
                    </button>
                    <span class="auto-ex-ico">${I.hex}</span>
                    ${integ.length ? `<span class="auto-integ-stack">${integ.map((k) => `<span class="ex-integ-ico">${I[k] || I.hex}</span>`).join("")}</span>` : ""}
                    <span class="auto-ex-name">${esc(e.name)}</span>
                  </div>
                </td>
                <td class="col-lastrun">
                  <span class="creator-av" style="margin-right:6px">${esc(e.creator || "SR")}</span>
                  <span class="muted">${esc(lastRun)}</span>
                </td>
                <td class="muted">${esc(e.updated || "—")}</td>
                <td class="col-menu">
                  <button type="button" class="icon-btn" data-auto-menu="${e.id}" title="More">⋯</button>
                </td>
              </tr>
              <tr class="auto-detail" id="auto-detail-${e.id}" ${expanded ? "" : "hidden"}>
                <td colspan="4" class="auto-detail-cell">
                  ${/* Product expanded row: "name · Webhook {id}" + Disabled/Enabled + Add trigger */
                  trs.length ? trs.map((t) => {
                    const typeLabel = TRIGGER_TYPES.find((x) => x.id === t.type)?.label || t.type;
                    const idSuffix = t.id || "";
                    return `<div class="auto-trigger-row" data-trig-row="${t.id}">
                      <button type="button" class="auto-trigger-main" data-edit-trig="${t.id}">
                        <span class="auto-trigger-name">${esc(t.name)}</span>
                        <span class="auto-trigger-sep">·</span>
                        <span class="auto-trigger-type">${esc(typeLabel)}${idSuffix ? " " + esc(idSuffix) : ""}</span>
                      </button>
                      <span class="auto-trigger-status ${t.armed ? "on" : "off"}">${t.armed ? "Enabled" : "Disabled"}</span>
                      <button type="button" class="toggle ${t.armed ? "" : "off"}" data-arm="${t.id}" title="Enable/disable"><span class="toggle-knob"></span></button>
                      <button type="button" class="icon-btn sm-ico" data-rm-trigger="${t.id}" title="Remove">×</button>
                    </div>`;
                  }).join("") : `<div class="muted auto-no-trig">No triggers yet</div>`}
                  <button type="button" class="btn sm auto-add-trig" data-add-trig="${e.id}">Add trigger</button>
                </td>
              </tr>`;
            }).join("") || `<tr><td colspan="4" class="muted" style="padding:24px;text-align:center">No automations match</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="table-footer env-footer">
        <span>${rows.length} automation${rows.length === 1 ? "" : "s"}</span>
        <div class="env-pager">
          <button type="button" class="btn ghost sm" disabled>‹</button>
          <span class="muted">Page 1 of 1</span>
          <button type="button" class="btn ghost sm" disabled>›</button>
          <span class="muted" style="margin-left:12px">Rows</span>
          <select class="field-select env-rows" disabled><option>25</option></select>
        </div>
      </div>
    </div>`;
  }

  function openCreateAutomation(preselectExpertId) {
    state.autoCreate = {
      expertId: preselectExpertId || "pr-author",
      triggers: [],
      step: "form", // form | pick-type
      draft: null,
    };
    renderCreateAutomationDrawer();
  }

  function renderCreateAutomationDrawer() {
    const ac = state.autoCreate;
    const drawer = $("#auto-create-drawer");
    const backdrop = $("#auto-create-backdrop");
    if (!ac || !drawer || !backdrop) return;
    backdrop.hidden = false;
    drawer.hidden = false;
    const tt = ac.draft ? TRIGGER_TYPES.find((t) => t.id === ac.draft.type) : null;

    if (ac.step === "pick-type") {
      let lastG = "";
      drawer.innerHTML = `
        <div class="drawer-header">
          <h2>Choose trigger type</h2>
          <button type="button" class="icon-btn" id="ac-close">✕</button>
        </div>
        <div class="drawer-body">
          <p class="muted" style="margin:0 0 12px;font-size:13px">First-party integrations · Schedule · Webhook (docs/config-triggers)</p>
          ${TRIGGER_TYPES.map((t) => {
            const head = t.group !== lastG ? `<div class="dd-label" style="margin-top:8px">${esc(t.group)}</div>` : "";
            lastG = t.group;
            return `${head}<button type="button" class="dd-opt type-pick" data-type="${t.id}">
              <span class="card-icon">${I[t.id] || I.hex}</span>
              <div><div class="dd-opt-name">${esc(t.label)}</div>
              <div class="dd-opt-sub">${t.events.slice(0, 3).join(", ")}${t.events.length > 3 ? "…" : ""}</div></div>
            </button>`;
          }).join("")}
        </div>
        <div class="drawer-footer">
          <button type="button" class="btn ghost" id="ac-back-form">Back</button>
        </div>`;
      $("#ac-close")?.addEventListener("click", closeCreateAutomation);
      $("#ac-back-form")?.addEventListener("click", () => { ac.step = "form"; ac.draft = null; renderCreateAutomationDrawer(); });
      $$(".type-pick").forEach((btn) => btn.addEventListener("click", () => {
        const type = TRIGGER_TYPES.find((t) => t.id === btn.dataset.type);
        ac.draft = {
          type: type.id,
          name: type.id === "schedule" ? "scheduled-run" : `on-${type.id}`,
          event: type.events[0] || "",
          filter: type.sampleFilter || "",
          maxRpm: type.id === "schedule" ? 1 : 10,
          autoArchive: true,
          cron: "0 8 * * *",
          tz: "America/Los_Angeles",
        };
        ac.step = "form";
        renderCreateAutomationDrawer();
      }));
      return;
    }

    drawer.innerHTML = `
      <div class="drawer-header">
        <h2>Create automation</h2>
        <button type="button" class="icon-btn" id="ac-close">✕</button>
      </div>
      <div class="drawer-body">
        <label class="field-label">Expert</label>
        <select class="field-select" id="ac-expert">
          ${EXPERTS.filter((e) => e.id !== "advisor").map((e) =>
            `<option value="${e.id}" ${ac.expertId === e.id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}
        </select>
        <p class="muted" style="font-size:12px;margin:6px 0 16px">Expert must already exist — create from Experts first (docs).</p>

        <div class="row gap-8" style="justify-content:space-between;align-items:center;margin-bottom:8px">
          <label class="field-label" style="margin:0">New triggers</label>
          <button type="button" class="btn sm" id="ac-add-trigger">${I.plus} Add trigger</button>
        </div>
        ${ac.triggers.length ? ac.triggers.map((t, i) => `
          <div class="list-card" style="margin:0 0 8px;cursor:default">
            <div><h3>${esc(t.name)}</h3><p>${esc(t.type)} · ${esc(t.event)}${t.filter ? " · filter" : ""}</p></div>
            <button type="button" class="btn ghost sm" data-ac-rm="${i}">Remove</button>
          </div>`).join("") : `<div class="muted" style="font-size:13px;margin-bottom:12px">No triggers yet — add at least one, or save Expert-only (arm later).</div>`}

        ${ac.draft ? `
          <div class="form-block" style="margin-top:8px">
            <div class="row gap-8" style="justify-content:space-between;margin-bottom:10px">
              <strong style="font-size:13.5px;color:var(--heading)">${esc(TRIGGER_TYPES.find((x) => x.id === ac.draft.type)?.label || ac.draft.type)} trigger</strong>
              <button type="button" class="btn ghost sm" id="ac-change-type">Change type</button>
            </div>
            <label class="field-label">Trigger name</label>
            <input class="field" id="ac-name" value="${esc(ac.draft.name)}" placeholder="on-pr-opened"/>
            ${ac.draft.type === "schedule" ? `
              <label class="field-label" style="margin-top:10px">Frequency</label>
              <select class="field-select" id="ac-freq">
                ${[
                  ["every_5", "Every 5 minutes", "*/5 * * * *"],
                  ["hourly", "Hourly", "0 * * * *"],
                  ["daily", "Daily at 08:00", "0 8 * * *"],
                  ["weekdays", "Weekdays 09:00", "0 9 * * MON-FRI"],
                  ["weekly", "Weekly (Sunday midnight)", "0 0 * * 0"],
                  ["monthly", "Monthly (1st midnight)", "0 0 1 * *"],
                  ["custom", "Custom cron expression", ac.draft.cron || "0 8 * * *"],
                ].map(([id, lab, cron]) => `<option value="${id}" data-cron="${esc(cron)}" ${ac.draft.freq === id || (!ac.draft.freq && id === "daily") ? "selected" : ""}>${lab}</option>`).join("")}
              </select>
              <label class="field-label" style="margin-top:10px">Cron expression (5-field)</label>
              <input class="field mono-field" id="ac-cron" value="${esc(ac.draft.cron || "0 8 * * *")}" placeholder="0 8 * * *"/>
              <label class="field-label" style="margin-top:10px">Timezone (IANA)</label>
              <input class="field" id="ac-tz" value="${esc(ac.draft.tz || "America/Los_Angeles")}" placeholder="America/Los_Angeles"/>
              <p class="muted" style="font-size:12px;margin-top:6px">5-field cron (no seconds, no macros like <code>@daily</code>). If a fire arrives while the previous run is still executing, it's skipped — runs aren't queued or backfilled (docs/schedules).</p>
            ` : ac.draft.type === "webhook" ? `
              <label class="field-label" style="margin-top:10px">Webhook</label>
              <select class="field-select" id="ac-webhook">
                ${WEBHOOKS.map((w) => `<option value="${esc(w.id)}" ${ac.draft.webhookId === w.id ? "selected" : ""}>${esc(w.name)} · ${esc(w.scope || "shared")}</option>`).join("")}
              </select>
              <p class="muted" style="font-size:12px;margin:6px 0 10px">Mint URLs under Webhooks (Bearer Token). Wire by name here (docs/config-webhooks).</p>
              <label class="field-label">Filter (JSONLogic, optional)</label>
              <textarea class="field mono-field" id="ac-filter" rows="4" placeholder='{"==":[{"var":"alert_type"},"error"]}'>${esc(ac.draft.filter)}</textarea>
            ` : `
              <label class="field-label" style="margin-top:10px">Event</label>
              <select class="field-select" id="ac-event">
                ${(tt?.events || []).map((ev) => `<option value="${esc(ev)}" ${ac.draft.event === ev ? "selected" : ""}>${esc(ev)}</option>`).join("")}
              </select>
              ${ac.draft.type === "pagerduty" ? `<p class="muted" style="font-size:12px;margin:6px 0">Routed by PagerDuty integration key; filter on <code>event.event_type</code>.</p>` : ""}
              ${ac.draft.type === "slack" ? `<p class="muted" style="font-size:12px;margin:6px 0">An @-mention is delivered twice — as <code>app_mention</code> and <code>message</code>. Filter on <code>event.type</code> to avoid firing twice (docs/config-slack).</p>` : ""}
              <label class="field-label" style="margin-top:10px">Filter (JSONLogic, optional)</label>
              <textarea class="field mono-field" id="ac-filter" rows="4" placeholder='{"==":[{"var":"action"},"opened"]}'>${esc(ac.draft.filter)}</textarea>
              <p class="muted" style="font-size:12px;margin-top:6px">Sanity-check filters in Event Log before pasting here.</p>
            `}
            <label class="field-label" style="margin-top:10px">Maximum runs per minute</label>
            <input class="field" id="ac-rpm" type="number" min="1" max="120" value="${ac.draft.maxRpm || 10}" style="max-width:120px"/>
            <label class="row gap-8 muted" style="font-size:12.5px;margin-top:12px">
              <input type="checkbox" id="ac-archive" ${ac.draft.autoArchive !== false ? "checked" : ""}/> Auto-archive sessions created by this trigger
            </label>
            <div class="row gap-8 end" style="margin-top:14px">
              <button type="button" class="btn ghost" id="ac-cancel-draft">Cancel</button>
              <button type="button" class="btn primary" id="ac-commit-draft">Add to automation</button>
            </div>
          </div>
        ` : ""}
      </div>
      <div class="drawer-footer">
        <button type="button" class="btn ghost" id="ac-close-2">Cancel</button>
        <button type="button" class="btn primary" id="ac-save">Save automation</button>
      </div>`;

    $("#ac-close")?.addEventListener("click", closeCreateAutomation);
    $("#ac-close-2")?.addEventListener("click", closeCreateAutomation);
    $("#ac-expert")?.addEventListener("change", (e) => { ac.expertId = e.target.value; });
    $("#ac-add-trigger")?.addEventListener("click", () => { ac.step = "pick-type"; renderCreateAutomationDrawer(); });
    $("#ac-change-type")?.addEventListener("click", () => { ac.step = "pick-type"; renderCreateAutomationDrawer(); });
    $("#ac-cancel-draft")?.addEventListener("click", () => { ac.draft = null; renderCreateAutomationDrawer(); });
    $$("[data-ac-rm]").forEach((btn) => btn.addEventListener("click", () => {
      ac.triggers.splice(+btn.dataset.acRm, 1);
      renderCreateAutomationDrawer();
    }));
    $("#ac-freq")?.addEventListener("change", (e) => {
      const opt = e.target.selectedOptions[0];
      const cron = opt?.dataset.cron;
      if (cron && $("#ac-cron")) $("#ac-cron").value = cron;
      ac.draft.freq = e.target.value;
    });
    $("#ac-commit-draft")?.addEventListener("click", () => {
      if (!ac.draft) return;
      ac.draft.name = $("#ac-name")?.value?.trim() || ac.draft.name;
      if (ac.draft.type === "schedule") {
        ac.draft.cron = $("#ac-cron")?.value?.trim() || ac.draft.cron;
        ac.draft.tz = $("#ac-tz")?.value?.trim() || ac.draft.tz;
        ac.draft.freq = $("#ac-freq")?.value || "custom";
        ac.draft.event = "cron";
        ac.draft.filter = "";
      } else if (ac.draft.type === "webhook") {
        ac.draft.webhookId = $("#ac-webhook")?.value || WEBHOOKS[0]?.id;
        ac.draft.event = "json_post";
        ac.draft.filter = $("#ac-filter")?.value?.trim() || "";
        const wh = WEBHOOKS.find((w) => w.id === ac.draft.webhookId);
        ac.draft.webhookName = wh?.name || ac.draft.webhookId;
      } else {
        ac.draft.event = $("#ac-event")?.value || ac.draft.event;
        ac.draft.filter = $("#ac-filter")?.value?.trim() || "";
      }
      ac.draft.maxRpm = Math.max(1, parseInt($("#ac-rpm")?.value, 10) || 10);
      ac.draft.autoArchive = !!$("#ac-archive")?.checked;
      ac.triggers.push({ ...ac.draft });
      ac.draft = null;
      toast("Trigger added to draft (disarmed until you enable)");
      renderCreateAutomationDrawer();
    });
    $("#ac-save")?.addEventListener("click", () => {
      const ex = expert(ac.expertId);
      if (!ex) return;
      ac.triggers.forEach((d) => {
        const id = "t" + Date.now() + Math.random().toString(36).slice(2, 5);
        let detail;
        if (d.type === "schedule") detail = `Schedule · ${d.cron} · ${d.tz}`;
        else if (d.type === "webhook") detail = `Webhook · ${d.webhookName || d.webhookId}${d.filter ? " · JSONLogic" : ""}`;
        else detail = `${TRIGGER_TYPES.find((x) => x.id === d.type)?.label || d.type} · ${d.event}${d.filter ? " · JSONLogic" : ""}`;
        TRIGGERS.push({
          id, expertId: ac.expertId, name: d.name, type: d.type, event: d.event,
          filter: d.filter || "", armed: false, maxRpm: d.maxRpm, autoArchive: d.autoArchive,
          detail, cron: d.cron, tz: d.tz, webhookId: d.webhookId, webhookName: d.webhookName,
        });
      });
      toast(`Automation on ${ex.name}: ${ac.triggers.length} trigger(s) saved · all disarmed`);
      closeCreateAutomation();
      state.autoPanel = "list";
      render();
    });
  }

  function closeCreateAutomation() {
    state.autoCreate = null;
    const drawer = $("#auto-create-drawer");
    const backdrop = $("#auto-create-backdrop");
    if (drawer) drawer.hidden = true;
    if (backdrop) backdrop.hidden = true;
  }

  function openEventAdvancedFilter() {
    const f = state.eventFilter;
    const body = $("#ev-filter-body");
    if (!body) return;
    body.innerHTML = `
      <p class="muted" style="margin:0 0 14px;font-size:13px">Filter Event Log the same way triggers evaluate payloads (docs/manage-automations).</p>
      <label class="field-label">Event type</label>
      <input class="field" id="af-event" value="${esc(f.eventType)}" placeholder="pull_request, Issue, app_mention…"/>
      <label class="field-label" style="margin-top:12px">JSONLogic payload filter</label>
      <textarea class="field mono-field" id="af-payload" rows="4" placeholder='{"==":[{"var":"action"},"opened"]}'>${esc(f.payloadLogic)}</textarea>
      <label class="field-label" style="margin-top:12px">Header filter (JSONLogic)</label>
      <textarea class="field mono-field" id="af-header" rows="2" placeholder='{"==":[{"var":"X-GitHub-Event"},"pull_request"]}'>${esc(f.headerLogic)}</textarea>
      <div class="row gap-8 end" style="margin-top:16px">
        <button type="button" class="btn ghost" data-close="ev-filter-backdrop">Cancel</button>
        <button type="button" class="btn primary" id="af-apply">Apply filter</button>
      </div>`;
    $("#ev-filter-backdrop").hidden = false;
    body.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => { const el = $("#" + btn.dataset.close); if (el) el.hidden = true; });
    });
    $("#af-apply")?.addEventListener("click", () => {
      state.eventFilter.eventType = $("#af-event")?.value?.trim() || "";
      state.eventFilter.payloadLogic = $("#af-payload")?.value?.trim() || "";
      state.eventFilter.headerLogic = $("#af-header")?.value?.trim() || "";
      $("#ev-filter-backdrop").hidden = true;
      if (state.eventFilter.payloadLogic || state.eventFilter.headerLogic) {
        toast("Advanced filter applied (prototype: event type + source; JSONLogic shown for copy-paste)");
      }
      render();
    });
  }

  function bindAutomations() {
    $("#btn-new-auto")?.addEventListener("click", () => openCreateAutomation());
    $("#btn-auto-advisor")?.addEventListener("click", () => {
      state.selectedExpertId = "advisor";
      state.promptDraft = "When feedback lands in #feedback-billing, triage it, open a Linear ticket, take a first pass at the fix, and open a PR. Keep triggers off until I try once.";
      navigate("home");
    });
    $$("#auto-scope button").forEach((b) => b.addEventListener("click", () => {
      state.autoScope = b.dataset.scope;
      render();
    }));
    $("#auto-filter")?.addEventListener("input", (e) => {
      state.autoQuery = e.target.value;
      render();
      const input = $("#auto-filter");
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    });
    $$("[data-expand]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.expand;
      if (!state.autoExpanded) state.autoExpanded = {};
      state.autoExpanded[id] = !state.autoExpanded[id];
      render();
    }));
    $$("[data-arm]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = TRIGGERS.find((x) => x.id === btn.dataset.arm);
      if (t) { t.armed = !t.armed; toast(t.armed ? "Trigger enabled" : "Trigger paused (config kept)"); render(); }
    }));
    $$("[data-rm-trigger]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = TRIGGERS.findIndex((x) => x.id === btn.dataset.rmTrigger);
      if (idx >= 0 && confirm("Remove this trigger? The Expert keeps its capabilities.")) {
        TRIGGERS.splice(idx, 1);
        toast("Trigger removed");
        render();
      }
    }));
    $$("[data-add-trig]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openCreateAutomation(btn.dataset.addTrig);
    }));
    $$("[data-auto-menu]").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      hidePopovers();
      const dd = $("#user-dd"); /* reuse popover shell */
      dd.innerHTML = `
        <button type="button" class="dd-opt" data-menu-act="runs"><div class="dd-opt-name">Run history</div><div class="dd-opt-sub">Trigger-started sessions only</div></button>
        <button type="button" class="dd-opt" data-menu-act="add"><div class="dd-opt-name">Add trigger</div></button>
        <button type="button" class="dd-opt" data-menu-act="advisor"><div class="dd-opt-name">Tune with Advisor</div></button>`;
      placePopover(dd, btn);
      $$("#user-dd [data-menu-act]").forEach((b) => b.addEventListener("click", () => {
        hidePopovers();
        const act = b.dataset.menuAct;
        const eid = btn.dataset.autoMenu;
        if (act === "runs") { state.runExpertFilter = eid; state.autoPanel = "runs"; render(); }
        else if (act === "add") openCreateAutomation(eid);
        else {
          state.selectedExpertId = "advisor";
          state.promptDraft = `Tune automation for ${expert(eid)?.name || eid}: review triggers and JSONLogic filters. Keep disarmed.`;
          navigate("home");
        }
      }));
    }));
    $$("[data-t-archive]").forEach((cb) => cb.addEventListener("change", (e) => {
      e.stopPropagation();
      const t = TRIGGERS.find((x) => x.id === cb.dataset.tArchive);
      if (t) { t.autoArchive = cb.checked; toast(cb.checked ? "Auto-archive on" : "Auto-archive off — sessions stay visible after idle"); }
    }));
    $("#runs-clear")?.addEventListener("click", () => { state.runExpertFilter = null; render(); });
    $$("[data-sid]").forEach((el) => el.addEventListener("click", () => openSession(el.dataset.sid)));
    $$("#auto-table tr[data-auto]").forEach((tr) => tr.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const id = tr.dataset.auto;
      const row = $("#auto-detail-" + id);
      if (row) row.hidden = !row.hidden;
    }));
    $$(".event-row[data-ev-idx]").forEach((row) => row.addEventListener("click", () => {
      const ev = EVENTS[+row.dataset.evIdx];
      if (!ev) return;
      const key = ev.source + "|" + ev.detail;
      const stock = EVENT_PAYLOADS[key];
      state.eventDetail = stock || {
        source: ev.source,
        event: ev.detail.split(" · ")[0] || ev.source,
        headers: { "X-Cosmos-Source": ev.source, "X-Received-At": ev.time },
        payload: { summary: ev.detail, expert_hint: ev.expert, status: ev.status },
      };
      render();
    }));
    $("#ev-detail-close")?.addEventListener("click", () => { state.eventDetail = null; render(); });
    $("#ev-copy-filter")?.addEventListener("click", () => {
      const sample = state.eventDetail?.payload?.action != null
        ? JSON.stringify({ "==": [{ var: "action" }, state.eventDetail.payload.action] })
        : '{"==":[{"var":"action"},"opened"]}';
      navigator.clipboard?.writeText(sample);
      toast("Sample JSONLogic copied — paste into trigger Filter");
    });
    $$("[data-edit-trig]").forEach((btn) => btn.addEventListener("click", () => {
      const t = TRIGGERS.find((x) => x.id === btn.dataset.editTrig);
      if (!t) return;
      toast(`${t.name}: ${t.armed ? "enabled" : "disabled"} · ${t.type}${t.filter ? " · has filter" : ""}`);
    }));
    $("#ev-advanced")?.addEventListener("click", openEventAdvancedFilter);
    $("#ev-clear-filter")?.addEventListener("click", () => {
      state.eventFilter = { source: "", eventType: "", payloadLogic: "", headerLogic: "" };
      render();
    });
    $("#ev-source")?.addEventListener("change", (e) => {
      state.eventFilter.source = e.target.value;
      render();
    });
  }

  function viewSettings() {
    /* Week 28: personal + organization settings in one settings navigation */
    return `<div class="page wide">
      <div class="page-header"><div><h1>Settings</h1><p class="sub">Personal and organization settings (product: single settings navigation).</p></div></div>
      <div class="form-grid">
        <div class="form-block"><h3>Personal</h3>
          <p>Display name, notification prefs, default model, theme.</p>
          <label class="field-label">Display name</label><input class="field" value="Alex Vance"/>
          <label class="field-label" style="margin-top:10px">Default model</label>
          <select class="field-select">${MODELS.map(m=>`<option ${m.id===state.modelId?"selected":""}>${esc(m.name)}</option>`).join("")}</select>
        </div>
        <div class="form-block"><h3>Organization</h3>
          <p>SSO, retention, service accounts, feature flags.</p>
          <div class="config-row"><span>SSO / SAML</span><span class="muted">Configured</span></div>
          <div class="config-row"><span>Service accounts</span><button type="button" class="btn sm" id="btn-svc">Manage</button></div>
          <div class="config-row"><span>No training on code</span><span class="muted">Enforced</span></div>
        </div>
        <div class="form-block"><h3>Linked Accounts</h3>
          <p>Personal Jira, Confluence, GitHub (Week 29).</p>
          <div class="config-row"><span>Jira</span><button type="button" class="btn sm" data-connect="jira">Connect ↗</button></div>
          <div class="config-row"><span>Confluence</span><button type="button" class="btn sm" data-connect="confluence">Connect ↗</button></div>
        </div>
        <div class="form-block"><h3>Capabilities</h3>
          <p>MCP Registry lives under Settings → Capabilities in product.</p>
          <button type="button" class="btn sm" data-nav="mcp">Open MCP Registry</button>
          <button type="button" class="btn sm" data-nav="secrets" style="margin-left:8px">Secrets</button>
        </div>
      </div>
    </div>`;
  }
  function bindSettings() {
    $("#btn-svc")?.addEventListener("click", () => toast("Service accounts for automation attribution (docs)"));
    $$("[data-connect=jira],[data-connect=confluence]").forEach((b) => b.addEventListener("click", () => toast("OAuth for " + b.dataset.connect + " (complete in browser)")));
    $$(".form-block [data-nav]").forEach((b) => b.addEventListener("click", () => navigate(b.dataset.nav)));
  }

  function viewPhilosophy() {
    return `<div class="page wide">
      <div class="page-header"><div><h1>Design philosophy</h1>
      <p class="sub">Cosmos is not a chatbot bolted onto git. It is the operating system that turns agents and humans into one coordinated team across the SDLC.</p></div></div>
      <div class="callout"><strong>Thesis:</strong> Your engineers have agents. Your organization doesn’t. Individual adoption is not organizational transformation — the bottleneck moved from generation to coordination.</div>
      <h2 class="philo-h2">Product thesis</h2>
      <div class="philo-grid">
        <div class="philo-card"><h3>OS, not a single agent</h3><p>Experts, Environments, Triggers, Files, and humans compose into a system that owns the full loop.</p></div>
        <div class="philo-card"><h3>Agentic full SDLC</h3><p>Triage → Author → Review → Verify → feedback. Agents hand off; people enter at judgment checkpoints.</p></div>
        <div class="philo-card"><h3>Small humans, large agents</h3><p>Throughput comes from coordination and memory, not more browser tabs of chat.</p></div>
        <div class="philo-card"><h3>Four platform levers</h3><p><strong>Prism</strong> · <strong>BYOK</strong> · <strong>Context Engine</strong> · <strong>Shared experts</strong>.</p></div>
      </div>
      <h2 class="philo-h2">Interaction philosophy</h2>
      <div class="philo-list">
        <div class="philo-row"><span class="philo-num">01</span><div><strong>Advisor-first</strong><p>Describe setup in language. Forms are fallback.</p></div></div>
        <div class="philo-row"><span class="philo-num">02</span><div><strong>Safe by default</strong><p>Triggers deploy disarmed. Try Experts from Home first.</p></div></div>
        <div class="philo-row"><span class="philo-num">03</span><div><strong>Human at judgment</strong><p>Agents own the loop; humans for architecture, risk, merge, policy.</p></div></div>
        <div class="philo-row"><span class="philo-num">04</span><div><strong>Meet the work</strong><p>Web, Slack, Linear, CLI — not only the IDE.</p></div></div>
        <div class="philo-row"><span class="philo-num">05</span><div><strong>Shared memory</strong><p>Org/User Files and Skills carry conventions forward.</p></div></div>
        <div class="philo-row"><span class="philo-num">06</span><div><strong>Specialized fleets</strong><p>Reusable Experts + workers — not one mega-prompt.</p></div></div>
      </div>
      <h2 class="philo-h2">Visual philosophy</h2>
      <div class="philo-grid">
        <div class="philo-card"><h3>High contrast, low chrome</h3><p>Near-black / near-white. Status beats decoration.</p></div>
        <div class="philo-card"><h3>Dense but calm</h3><p>Engineering density with consistent spacing.</p></div>
        <div class="philo-card"><h3>One primary action</h3><p>Each screen: one black/white primary control.</p></div>
        <div class="philo-card"><h3>System truth in mono</h3><p>IDs, paths, tool calls — monospaced.</p></div>
      </div>
      <div class="row gap-8" style="margin-top:24px">
        <button type="button" class="btn primary" id="philo-advisor">Try Advisor setup →</button>
        <button type="button" class="btn ghost" id="philo-home">Home</button>
        <button type="button" class="btn ghost" id="philo-showcase">Showcase</button>
      </div>
    </div>`;
  }
  function bindPhilosophy() {
    $("#philo-advisor")?.addEventListener("click", () => {
      state.selectedExpertId = "advisor";
      state.promptDraft = "Help me set up Cosmos for ticket-to-PR. Deploy Experts with triggers off so I can dry-run first.";
      navigate("home");
    });
    $("#philo-home")?.addEventListener("click", () => navigate("home"));
    $("#philo-showcase")?.addEventListener("click", () => { state.showcase = true; syncShowcase(); toast("Showcase on"); });
  }

  /* ========== POPOVERS ========== */
  function hidePopovers() {
    ["model-dd", "env-dd", "space-dd", "user-dd", "create-env-dd"].forEach((id) => {
      const el = $("#" + id);
      if (el) {
        el.hidden = true;
        el.classList.remove("popover-up", "popover-down");
        el.style.top = "";
        el.style.left = "";
        el.style.maxHeight = "";
      }
    });
  }
  /**
   * Place popover so it is never clipped by the viewport bottom.
   * Composer sits near the bottom → prefer open upward when space below is tight.
   */
  function placePopover(el, anchor, opts = {}) {
    const gap = opts.gap ?? 6;
    const preferUp = opts.preferUp === true;
    const r = anchor.getBoundingClientRect();
    el.hidden = false;
    el.classList.remove("popover-up", "popover-down");
    /* measure after unhide */
    const pad = 8;
    const maxH = Math.min(opts.maxHeight || 360, window.innerHeight - pad * 2);
    el.style.maxHeight = maxH + "px";
    el.style.overflowY = "auto";
    const pr = el.getBoundingClientRect();
    const h = pr.height || 200;
    const w = Math.max(pr.width || 240, 240);
    const spaceBelow = window.innerHeight - r.bottom - gap - pad;
    const spaceAbove = r.top - gap - pad;
    /* Product: env/tools open DOWN under the chip. Only flip up if viewport would clip. */
    let openUp = preferUp;
    if (opts.preferDown) openUp = false;
    if (!preferUp && !opts.preferDown) {
      openUp = spaceBelow < Math.min(h + 8, 140) && spaceAbove > spaceBelow;
    }
    if (!openUp && spaceBelow < h + 8 && spaceAbove > spaceBelow) openUp = true;

    let top;
    if (openUp) {
      top = Math.max(pad, r.top - h - gap);
      el.classList.add("popover-up");
    } else {
      top = r.bottom + gap;
      /* if still overflows bottom, clamp height instead of covering anchor */
      if (top + h > window.innerHeight - pad) {
        const allow = window.innerHeight - pad - top;
        if (allow >= 100) el.style.maxHeight = allow + "px";
        else {
          openUp = true;
          top = Math.max(pad, r.top - h - gap);
          el.classList.remove("popover-down");
          el.classList.add("popover-up");
        }
      }
      if (!openUp) el.classList.add("popover-down");
    }
    let left = r.left;
    /* align right edge for right-side anchors */
    if (opts.align === "end") left = r.right - w;
    left = Math.min(Math.max(pad, left), window.innerWidth - w - pad);
    el.style.left = left + "px";
    el.style.top = top + "px";
  }
  function openModelDd(anchor) {
    hidePopovers();
    const dd = $("#model-dd");
    let html = "", last = "";
    MODELS.forEach((m) => {
      if (m.group !== last) { html += `<div class="dd-label">${esc(m.group)}</div>`; last = m.group; }
      html += `<button type="button" class="dd-opt ${state.modelId === m.id ? "active" : ""}" data-model="${m.id}">
        ${m.prism ? `<span class="prism-stack"><span class="prism-dot dot-claude" style="width:14px;height:14px;font-size:7px">C</span><span class="prism-dot dot-gemini" style="width:14px;height:14px;font-size:7px">G</span></span>` : `<span class="prism-dot" style="width:14px;height:14px;background:#555;color:#fff;font-size:7px">M</span>`}
        <div><div class="dd-opt-name">${esc(m.name)}</div><div class="dd-opt-sub">${esc(m.sub)}</div></div></button>`;
    });
    dd.innerHTML = html;
    /* Model sits on composer-bar (upper half of card) — open down like product */
    placePopover(dd, anchor, { preferDown: true, maxHeight: 320 });
    $$("#model-dd [data-model]").forEach((btn) => btn.addEventListener("click", () => {
      state.modelId = btn.dataset.model;
      hidePopovers();
      toast(`Model → ${model(state.modelId).name}`);
      state.promptDraft = $("#prompt")?.value || state.promptDraft;
      render();
    }));
  }
  function openEnvDd(anchor) {
    hidePopovers();
    const dd = $("#env-dd");
    /* Product screenshot: name + "Cloud · TypeScript 6.0" under the chip, opens DOWN */
    dd.innerHTML = ENVIRONMENTS.map((e) => `<button type="button" class="dd-opt env-dd-opt ${state.envId === e.id ? "active" : ""}" data-env="${e.id}">
      <div class="env-dd-body">
        <div class="dd-opt-name">${esc(e.name)}</div>
        <div class="dd-opt-sub">${esc(e.kind)} · ${esc(e.image)}</div>
      </div></button>`).join("");
    placePopover(dd, anchor, { preferDown: true, maxHeight: 280 });
    $$("#env-dd [data-env]").forEach((btn) => btn.addEventListener("click", () => {
      state.envId = btn.dataset.env;
      hidePopovers();
      state.promptDraft = $("#prompt")?.value || state.promptDraft;
      toast(`Environment → ${env(state.envId).name}`);
      render();
    }));
  }
  function openCreateEnvDd(anchor) {
    /* Product: Create an environment ▾ → Cloud Machine · Daemon Pool · Connect daemon */
    hidePopovers();
    const dd = $("#create-env-dd");
    dd.innerHTML = `
      <button type="button" class="dd-opt" data-create="cloud">
        ${I.cloud}
        <div><div class="dd-opt-name">Cloud Machine</div><div class="dd-opt-sub">Augment-hosted VM snapshot</div></div>
      </button>
      <button type="button" class="dd-opt" data-create="pool">
        ${I.daemon}
        <div><div class="dd-opt-name">Daemon Pool</div><div class="dd-opt-sub">Group of self-hosted daemons</div></div>
      </button>
      <button type="button" class="dd-opt" data-create="connect">
        ${I.daemon}
        <div><div class="dd-opt-name">Connect daemon</div><div class="dd-opt-sub">auggie daemon on your machine</div></div>
      </button>`;
    placePopover(dd, anchor, { preferDown: true, align: "end" });
    $$("#create-env-dd [data-create]").forEach((b) => b.addEventListener("click", () => {
      hidePopovers();
      const kind = b.dataset.create;
      if (kind === "cloud") {
        const name = prompt("Cloud environment name", "my-env");
        if (!name) return;
        const id = "env-" + Date.now().toString(36);
        ENVIRONMENTS.unshift({
          id, name, kind: "Cloud", size: "2 CPU · 4GB", repos: [], note: "",
          creator: "AV", built: "Just now", mine: true,
        });
        state.envId = id;
        toast(`Cloud Machine “${name}” created`);
        render();
      } else if (kind === "pool") {
        toast("Daemon Pool setup — group hosts for session routing (prototype)");
      } else {
        toast("Connect daemon: run `auggie daemon` on your host (docs)");
      }
    }));
  }

  /* ========== SHARE / CONFIRM ========== */
  function openShare(kind) {
    /* Product Share expert modal: search · Accounts with access · General access · Org access · Cancel/Save */
    state.shareKind = kind;
    const isExpert = kind === "expert";
    $("#share-title").textContent = isExpert ? "Share expert" : "Share session";
    const modal = $("#share-backdrop .modal");
    if (modal) modal.classList.add("share-modal");

    /* Product typeahead: bobby-benchmark · Service account pill · Phillip + email */
    const people = [
      { name: "bobby-benchmark-1", sub: "Service account", kind: "sa", initials: "B1" },
      { name: "bobby-benchmark-2", sub: "Service account", kind: "sa", initials: "B2" },
      { name: "Phillip Booth", sub: "phillip.booth2015@gmail.com", kind: "user", initials: "PB" },
      { name: "Triage-Bot", sub: "Service account", kind: "sa", initials: "TB" },
    ];
    if (!state.shareMembers) {
      state.shareMembers = [{ name: "You", sub: "Owner", initials: "SR", role: "Owner", locked: true }];
    }

    const renderMembers = () => state.shareMembers.map((m, i) => `
      <div class="share-access-row">
        <div class="share-account">
          <div class="avatar">${esc(m.initials || "??")}</div>
          <div>
            <strong style="font-weight:500">${esc(m.name)}</strong>
            ${m.sub && m.sub !== "Owner" ? `<div class="muted" style="font-size:12px">${esc(m.sub)}</div>` : ""}
          </div>
        </div>
        <div class="share-role-wrap">
          <select class="field-select share-role-sel" data-share-i="${i}" ${m.locked ? "disabled" : ""}>
            <option ${m.role === "Viewer" ? "selected" : ""}>Viewer</option>
            <option ${m.role === "Editor" ? "selected" : ""}>Editor</option>
            <option ${m.role === "Owner" ? "selected" : ""}>Owner</option>
          </select>
          ${m.locked
            ? ""
            : `<button type="button" class="icon-btn sm-ico" data-share-rm="${i}" title="Remove">×</button>`}
        </div>
      </div>`).join("");

    $("#share-body").innerHTML = `
      <div class="share-typeahead" id="share-typeahead">
        <div class="share-search-wrap" id="share-search-wrap">
          <span class="share-search-ico">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="6" r="3.2"/><path d="M4 11.5c1.2-1.2 2.8-1.8 4-1.5M10.5 10.5l2.8 2.8"/><circle cx="11" cy="5.5" r="2.2"/></svg>
          </span>
          <input class="field share-search-input" id="share-search" placeholder="Add people or service accounts…" autocomplete="off"/>
        </div>
        <div id="share-results" class="share-results" hidden></div>
      </div>

      <div id="share-below-search">
        <div class="share-section-label">Accounts with access</div>
        <div id="share-members">${renderMembers()}</div>

        <div class="share-section-label" style="margin-top:18px">General access</div>
        <div class="share-access-row org-access">
          <div>
            <div class="share-org-title">Organization access</div>
            <div class="muted" style="font-size:12.5px;margin-top:2px">Your team has editor access to this ${isExpert ? "expert" : "session"}.</div>
          </div>
          <select class="field-select share-role-sel" id="share-org-role">
            <option>None</option>
            <option>Viewer</option>
            <option selected>Editor</option>
            <option>Owner</option>
          </select>
        </div>
      </div>

      <div class="row gap-8 end" style="margin-top:20px">
        <button type="button" class="btn ghost" data-close="share-backdrop">Cancel</button>
        <button type="button" class="btn primary" id="share-save">Save</button>
      </div>`;

    $("#share-backdrop").hidden = false;
    setTimeout(() => $("#share-search")?.focus(), 0);

    const bindMemberUi = () => {
      $$("[data-share-rm]").forEach((btn) => btn.addEventListener("click", () => {
        state.shareMembers.splice(+btn.dataset.shareRm, 1);
        $("#share-members").innerHTML = renderMembers();
        bindMemberUi();
      }));
      $$("[data-share-i]").forEach((sel) => sel.addEventListener("change", () => {
        const m = state.shareMembers[+sel.dataset.shareI];
        if (m && !m.locked) m.role = sel.value;
      }));
    };
    bindMemberUi();

    const setResultsOpen = (open) => {
      const wrap = $("#share-search-wrap");
      const box = $("#share-results");
      const below = $("#share-below-search");
      if (wrap) wrap.classList.toggle("focused", open);
      if (box) box.hidden = !open;
      /* Product: when typing, results list replaces middle content */
      if (below) below.hidden = open;
    };

    $("#share-search")?.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim();
      const box = $("#share-results");
      if (!q) {
        setResultsOpen(false);
        box.innerHTML = "";
        return;
      }
      setResultsOpen(true);
      const hits = people
        .filter((p) => p.name.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q))
        .filter((p) => !state.shareMembers.some((m) => m.name === p.name));
      box.innerHTML = hits.length
        ? hits.map((p) => `
          <button type="button" class="share-hit" data-add-name="${esc(p.name)}" data-add-sub="${esc(p.sub)}" data-add-ini="${esc(p.initials)}" data-add-kind="${esc(p.kind)}">
            <div class="share-hit-main">
              <div class="share-hit-name">${esc(p.name)}</div>
              ${p.kind === "user" ? `<div class="share-hit-email">${esc(p.sub)}</div>` : ""}
            </div>
            ${p.kind === "sa" ? `<span class="share-sa-tag">Service account</span>` : ""}
          </button>`).join("")
        : `<div class="share-empty">No matches</div>`;
      $$(".share-hit").forEach((b) => b.addEventListener("click", () => {
        state.shareMembers.push({
          name: b.dataset.addName,
          sub: b.dataset.addKind === "sa" ? "Service account" : b.dataset.addSub,
          initials: b.dataset.addIni,
          role: "Viewer",
          locked: false,
        });
        $("#share-search").value = "";
        box.innerHTML = "";
        setResultsOpen(false);
        $("#share-members").innerHTML = renderMembers();
        bindMemberUi();
        toast(`Added ${b.dataset.addName} as Viewer`);
      }));
    });
    $("#share-search")?.addEventListener("focus", () => {
      if (($("#share-search").value || "").trim()) setResultsOpen(true);
    });
    $("#share-save")?.addEventListener("click", () => {
      toast(`${isExpert ? "Expert" : "Session"} sharing saved`);
      $("#share-backdrop").hidden = true;
    });
  }

  let confirmCb = null;
  function openConfirm(msg, cb) {
    $("#confirm-msg").textContent = msg;
    $("#confirm-backdrop").hidden = false;
    confirmCb = cb;
  }

  /* ========== CMD / SHORTCUTS ========== */
  function cmdItems(q) {
    const query = (q || "").toLowerCase();
    const items = [
      { kind: "Command", label: "New session", action: () => navigate("home") },
      { kind: "Command", label: "Sessions", action: () => navigate("sessions") },
      { kind: "Command", label: "Files · Organization", action: () => navigate("files-org") },
      { kind: "Command", label: "Files · User", action: () => navigate("files-user") },
      { kind: "Command", label: "Experts", action: () => navigate("experts") },
      { kind: "Command", label: "Environments", action: () => navigate("environments") },
      { kind: "Command", label: "Integrations", action: () => navigate("integrations") },
      { kind: "Command", label: "Automations", action: () => { state.autoPanel = "list"; navigate("automations"); } },
      { kind: "Command", label: "Event Log", action: () => { state.autoPanel = "events"; navigate("automations"); } },
      { kind: "Command", label: "Run History", action: () => { state.autoPanel = "runs"; navigate("automations"); } },
      { kind: "Command", label: "MCP Registry", action: () => navigate("mcp") },
      { kind: "Command", label: "Webhooks", action: () => navigate("webhooks") },
      { kind: "Command", label: "Secrets", action: () => navigate("secrets") },
      { kind: "Command", label: "Settings", action: () => navigate("settings") },
      { kind: "Command", label: "Design philosophy", action: () => navigate("philosophy") },
      { kind: "Command", label: "Toggle showcase", action: () => toggleShowcase() },
      { kind: "Command", label: "Toggle theme", action: () => $("#btn-theme").click() },
      { kind: "Command", label: "Keyboard shortcuts", action: () => openShortcuts() },
      ...EXPERTS.map((e) => ({ kind: "Expert", label: e.name, action: () => { state.selectedExpertId = e.id; navigate("expert-detail"); } })),
      ...SESSIONS.map((s) => ({ kind: "Session", label: s.title, action: () => openSession(s.id) })),
      ...SESSIONS.flatMap((s) => (s.artifacts || []).map((a) => ({
        kind: "Artifact",
        label: a.type + ": " + a.label,
        action: () => openSession(s.id),
      }))),
    ];
    return query ? items.filter((i) => i.label.toLowerCase().includes(query)) : items;
  }
  function openCmd() {
    $("#cmd-backdrop").hidden = false;
    $("#cmd-input").value = "";
    state.cmdIndex = 0;
    renderCmd();
    setTimeout(() => $("#cmd-input").focus(), 0);
  }
  function closeCmd() { $("#cmd-backdrop").hidden = true; }
  function renderCmd() {
    const items = cmdItems($("#cmd-input").value);
    if (state.cmdIndex >= items.length) state.cmdIndex = 0;
    $("#cmd-results").innerHTML = items.map((it, i) =>
      `<button type="button" class="cmd-item ${i === state.cmdIndex ? "active" : ""}" data-cmd="${i}"><span class="label">${esc(it.label)}</span><span class="kind">${esc(it.kind)}</span></button>`
    ).join("");
    $$("[data-cmd]").forEach((btn) => btn.addEventListener("click", () => {
      cmdItems($("#cmd-input").value)[+btn.dataset.cmd]?.action();
      closeCmd();
    }));
  }
  function openShortcuts() {
    $("#shortcuts-body").innerHTML = SHORTCUTS.map((g) =>
      `<div class="sc-group"><h4>${esc(g.title)}</h4>${g.rows.map(([n, k]) => `<div class="sc-row"><span>${esc(n)}</span><kbd>${esc(k)}</kbd></div>`).join("")}</div>`
    ).join("");
    $("#shortcuts-backdrop").hidden = false;
  }

  function toggleShowcase() {
    state.showcase = !state.showcase;
    syncShowcase();
    toast(state.showcase ? "Docs hero showcase on" : "Showcase off");
  }
  function syncShowcase() {
    const sc = $("#showcase");
    if (!sc) return;
    sc.hidden = !state.showcase;
    sc.setAttribute("aria-hidden", state.showcase ? "false" : "true");
    $("#btn-showcase")?.classList.toggle("on", state.showcase);
    const apps = $("#float-apps");
    if (apps) {
      const team = INTEGRATIONS.filter((i) => i.group === "Team Apps");
      const personal = INTEGRATIONS.filter((i) => i.group === "Personal Apps");
      apps.innerHTML = `<div class="fc-section">Team Apps</div>` +
        team.map((i) => `<div class="app-row"><span class="app-ico">${I[i.icon] || I.hex}</span> ${esc(i.name)}
          <button type="button" class="toggle ${i.connected ? "" : "off"}" data-integ="${i.id}"><span class="toggle-knob"></span></button></div>`).join("") +
        `<div class="fc-section">Personal Apps</div>` +
        personal.map((i) => `<div class="app-row"><span class="app-ico">${I[i.icon] || I.hex}</span> ${esc(i.name)}
          ${i.connected
            ? `<button type="button" class="toggle" data-integ="${i.id}"><span class="toggle-knob"></span></button>`
            : `<button type="button" class="text-btn sm" data-connect="${i.id}">Connect ↗</button>`}</div>`).join("");
      // re-wire without double
      $$("#float-apps [data-integ], #float-apps [data-connect]").forEach((b) => { delete b.dataset.wired; });
      wireIntegScoped($("#float-apps"));
    }
  }
  function wireIntegScoped(root) {
    if (!root) return;
    root.querySelectorAll("[data-integ]").forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = "1";
      const item = INTEGRATIONS.find((i) => i.id === btn.dataset.integ);
      if (item) btn.classList.toggle("off", !item.connected);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const it = INTEGRATIONS.find((i) => i.id === btn.dataset.integ);
        if (!it) return;
        it.connected = !it.connected;
        toast(`${it.name} ${it.connected ? "connected" : "disconnected"}`);
        if (state.route === "integrations") render();
        else syncShowcase();
      });
    });
    root.querySelectorAll("[data-connect]").forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", () => {
        const it = INTEGRATIONS.find((i) => i.id === btn.dataset.connect);
        if (it) { it.connected = true; toast(`${it.name} connected`); render(); }
      });
    });
  }

  function updateThemeIcon() {
    const btn = $("#btn-theme");
    if (!btn) return;
    const dark = document.documentElement.classList.contains("dark");
    btn.innerHTML = dark ? I.sun : I.moon;
    btn.title = dark ? "Light theme" : "Dark theme";
  }

  /* ========== INIT ========== */
  function init() {
    renderSidebarNav();
    $$("[data-nav]").forEach((el) => {
      if (el.closest("#sb-nav")) return;
      el.addEventListener("click", () => navigate(el.dataset.nav));
    });
    $(".sb-new")?.addEventListener("click", () => navigate("home"));
    const syncSidebarCollapsed = () => {
      const collapsed = $("#app")?.classList.contains("sidebar-collapsed");
      state.sidebarCollapsed = !!collapsed;
      const openBtn = $("#btn-open-sidebar");
      const hideBtn = $("#btn-toggle-sidebar");
      if (openBtn) {
        openBtn.hidden = !collapsed;
        openBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      }
      if (hideBtn) hideBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      try { localStorage.setItem("cosmos-sidebar", collapsed ? "collapsed" : "open"); } catch (_) {}
    };
    const setSidebarCollapsed = (collapsed) => {
      $("#app")?.classList.toggle("sidebar-collapsed", !!collapsed);
      syncSidebarCollapsed();
    };
    $("#btn-toggle-sidebar")?.addEventListener("click", () => setSidebarCollapsed(!$("#app").classList.contains("sidebar-collapsed")));
    $("#btn-open-sidebar")?.addEventListener("click", () => setSidebarCollapsed(false));
    /* restore last sidebar state; never leave user stuck collapsed without a control */
    try {
      if (localStorage.getItem("cosmos-sidebar") === "collapsed") setSidebarCollapsed(true);
      else syncSidebarCollapsed();
    } catch (_) { syncSidebarCollapsed(); }
    $("#btn-cmd")?.addEventListener("click", openCmd);
    $("#btn-shortcuts")?.addEventListener("click", openShortcuts);
    $("#btn-showcase")?.addEventListener("click", toggleShowcase);
    $("#btn-theme")?.addEventListener("click", () => {
      document.documentElement.classList.toggle("dark");
      localStorage.setItem("cosmos-theme", document.documentElement.classList.contains("dark") ? "dark" : "light");
      updateThemeIcon();
      toast(document.documentElement.classList.contains("dark") ? "Dark theme" : "Light theme");
    });
    const pref = localStorage.getItem("cosmos-theme");
    if (pref === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark"); // live product UI is light
    updateThemeIcon();
    $("#btn-shortcuts").innerHTML = I.keyboard;

    $("#btn-space")?.addEventListener("click", (e) => {
      e.stopPropagation();
      hidePopovers();
      const dd = $("#space-dd");
      const spaces = state.spaces || ["Engineering", "Data Science", "On-call", "Default"];
      const renderSpaceList = (filter = "") => {
        const q = filter.toLowerCase();
        const list = spaces.filter((s) => !q || s.toLowerCase().includes(q));
        dd.innerHTML = `
          <div style="padding:6px 8px 4px"><input class="field" id="space-search" placeholder="Search spaces…" value="${esc(filter)}" style="padding:7px 10px;font-size:13px"/></div>
          ${list.map((s) => `<button type="button" class="dd-opt" data-space="${esc(s)}"><div class="dd-opt-name">${s === state.space ? "✓ " : ""}${esc(s)}</div><div class="dd-opt-sub">${s === "Default" ? "Cannot delete" : "Team space"}</div></button>`).join("") || `<div class="muted" style="padding:10px">No matches</div>`}
          <div style="border-top:1px solid var(--border);margin-top:4px;padding:6px 8px">
            <button type="button" class="dd-opt" id="space-create"><div class="dd-opt-name">${I.plus} Create space</div><div class="dd-opt-sub">Type name in search + Enter</div></button>
          </div>`;
        placePopover(dd, e.currentTarget);
        const inp = $("#space-search");
        inp?.focus();
        inp?.addEventListener("input", () => renderSpaceList(inp.value));
        inp?.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" && inp.value.trim()) {
            const name = inp.value.trim();
            if (!spaces.includes(name)) {
              spaces.push(name);
              state.spaces = spaces;
            }
            state.space = name;
            hidePopovers();
            toast(`Space → ${name} (new resources default here)`);
            render();
          }
        });
        $$("#space-dd [data-space]").forEach((btn) => btn.addEventListener("click", () => {
          state.space = btn.dataset.space;
          hidePopovers();
          toast(`Space → ${state.space}`);
          render();
        }));
        $("#space-create")?.addEventListener("click", () => {
          const name = prompt("Space name (unique in org)");
          if (!name) return;
          if (!spaces.includes(name)) spaces.push(name);
          state.spaces = spaces;
          state.space = name;
          hidePopovers();
          toast(`Created Space “${name}” — you are owner`);
          render();
        });
      };
      if (!state.spaces) state.spaces = spaces;
      renderSpaceList();
    });

    $("#btn-user-menu")?.addEventListener("click", (e) => {
      e.stopPropagation();
      hidePopovers();
      const dd = $("#user-dd");
      dd.innerHTML = `
        <button type="button" class="dd-opt" data-u="account"><div class="dd-opt-name">Account</div></button>
        <button type="button" class="dd-opt" data-u="spaces"><div class="dd-opt-name">Spaces</div></button>
        <button type="button" class="dd-opt" data-u="settings"><div class="dd-opt-name">Settings</div><div class="dd-opt-sub">Personal + organization</div></button>
        <button type="button" class="dd-opt" data-u="linked"><div class="dd-opt-name">Linked Accounts</div><div class="dd-opt-sub">Jira · Confluence · GitHub</div></button>
        <button type="button" class="dd-opt" data-u="theme"><div class="dd-opt-name">Toggle theme</div></button>
        <button type="button" class="dd-opt" data-u="signout"><div class="dd-opt-name">Sign out</div></button>`;
      placePopover(dd, e.currentTarget);
      $$("#user-dd [data-u]").forEach((btn) => btn.addEventListener("click", () => {
        hidePopovers();
        if (btn.dataset.u === "theme") $("#btn-theme").click();
        else if (btn.dataset.u === "spaces") $("#btn-space").click();
        else if (btn.dataset.u === "settings") navigate("settings");
        else if (btn.dataset.u === "linked") navigate("integrations");
        else toast(btn.textContent.trim() + " (prototype)");
      }));
    });

    $("#cmd-input")?.addEventListener("input", () => { state.cmdIndex = 0; renderCmd(); });
    $("#cmd-input")?.addEventListener("keydown", (e) => {
      const items = cmdItems($("#cmd-input").value);
      if (e.key === "ArrowDown") { e.preventDefault(); state.cmdIndex = (state.cmdIndex + 1) % Math.max(items.length, 1); renderCmd(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); state.cmdIndex = (state.cmdIndex - 1 + items.length) % Math.max(items.length, 1); renderCmd(); }
      else if (e.key === "Enter") { e.preventDefault(); items[state.cmdIndex]?.action(); closeCmd(); }
      else if (e.key === "Escape") closeCmd();
    });
    $("#cmd-backdrop")?.addEventListener("click", (e) => { if (e.target.id === "cmd-backdrop") closeCmd(); });
    $$("[data-close]").forEach((btn) => btn.addEventListener("click", () => { $(`#${btn.dataset.close}`).hidden = true; }));
    $("#shortcuts-backdrop")?.addEventListener("click", (e) => { if (e.target.id === "shortcuts-backdrop") e.target.hidden = true; });
    $("#share-backdrop")?.addEventListener("click", (e) => { if (e.target.id === "share-backdrop") e.target.hidden = true; });
    $("#confirm-backdrop")?.addEventListener("click", (e) => { if (e.target.id === "confirm-backdrop") e.target.hidden = true; });
    $("#ev-filter-backdrop")?.addEventListener("click", (e) => { if (e.target.id === "ev-filter-backdrop") e.target.hidden = true; });
    $("#auto-create-backdrop")?.addEventListener("click", () => closeCreateAutomation());
    $("#mcp-add-backdrop")?.addEventListener("click", (e) => {
      if (e.target.id === "mcp-add-backdrop") {
        e.target.hidden = true;
        state.mcpAdd = null;
      }
    });
    $("#confirm-ok")?.addEventListener("click", () => {
      $("#confirm-backdrop").hidden = true;
      if (confirmCb) confirmCb();
      confirmCb = null;
    });

    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-action='share-session']")) openShare("session");
      if (e.target.closest("[data-action='copy-session-link']")) {
        const s = SESSIONS.find((x) => x.id === state.activeSessionId);
        navigator.clipboard?.writeText(`https://cosmos.augmentcode.com/s/${s?.sessionId || "01KPPH32EJGEKRNC2AT1M4GCCM"}`);
        toast("Link copied");
      }
      if (!e.target.closest(".popover") && !e.target.closest("#model-btn") && !e.target.closest("#sess-model") && !e.target.closest("#env-btn") && !e.target.closest("#btn-space") && !e.target.closest("#btn-user-menu") && !e.target.closest("#btn-create-env")) {
        hidePopovers();
      }
      /* Collapse horizontal tools row when clicking outside */
      if (state.toolsOpen && !e.target.closest("#tools-wrap") && !e.target.closest("#tools-chip")) {
        state.toolsOpen = false;
        if (state.route === "home") render();
      }
    });

    document.addEventListener("keydown", (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") { e.preventDefault(); openCmd(); }
      if (meta && e.key === ".") {
        e.preventDefault();
        if (e.shiftKey) {
          setRightbar(!state.rightbarOpen);
          if (state.rightbarOpen && state.route === "session") {
            const s = SESSIONS.find((x) => x.id === state.activeSessionId);
            renderRightbar(s);
          }
          render();
        } else {
          const app = $("#app");
          if (app) {
            app.classList.toggle("sidebar-collapsed");
            const collapsed = app.classList.contains("sidebar-collapsed");
            const openBtn = $("#btn-open-sidebar");
            if (openBtn) openBtn.hidden = !collapsed;
            try { localStorage.setItem("cosmos-sidebar", collapsed ? "collapsed" : "open"); } catch (_) {}
          }
        }
      }
      if (meta && e.key === "/") { e.preventDefault(); openShortcuts(); }
      if (meta && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); navigate("home"); }
      if (meta && e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); navigate("sessions"); }
      if (meta && e.shiftKey && e.key.toLowerCase() === "e") { e.preventDefault(); navigate("files-org"); }
      if (meta && e.shiftKey && e.key === ",") { e.preventDefault(); navigate("settings"); }
      if (meta && e.key.toLowerCase() === "e" && !e.shiftKey) {
        e.preventDefault();
        const ta = $("#session-prompt") || $("#prompt");
        if (ta && ta.value.trim()) {
          ta.value += "\n\nInclude file paths, test plan, acceptance criteria, and risk notes.";
          toast("Prompt enhanced (⌘E)");
          ta.dispatchEvent(new Event("input"));
        }
      }
      if (meta && e.key.toLowerCase() === "p" && !e.shiftKey) {
        e.preventDefault();
        navigate("files-org");
        setTimeout(() => toast("Search files (⌘P) — filter in Files"), 0);
      }
      if (e.key === "Escape") {
        closeCmd();
        hidePopovers();
        closeCreateAutomation();
        ["shortcuts-backdrop", "share-backdrop", "confirm-backdrop", "ev-filter-backdrop", "artifact-backdrop", "webhook-create-backdrop", "mcp-add-backdrop"].forEach((id) => {
          const el = $("#" + id); if (el) el.hidden = true;
        });
        if (state.mcpAdd) state.mcpAdd = null;
        if (state.eventDetail) { state.eventDetail = null; if (state.route === "automations") render(); }
      }
      if (e.altKey && e.key >= "1" && e.key <= "9") {
        const s = SESSIONS[parseInt(e.key, 10) - 1];
        if (s) { e.preventDefault(); openSession(s.id); }
      }
    });

    // Real product defaults: light ops UI optional; home = expert grid
    state.selectedExpertId = null;
    state.modelId = "prism";
    state.envId = "augment";
    // Real product screenshots are light; default light when no saved pref
    if (!localStorage.getItem("cosmos-theme")) {
      document.documentElement.classList.remove("dark");
      updateThemeIcon();
    }
    render();
  }

  init();
})();
