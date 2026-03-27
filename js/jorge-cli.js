// jorge-cli — hidden terminal easter egg
// Open with backtick (`) key

(function () {
  'use strict';

  // ─── Data ────────────────────────────────────────────────────────────────────

  const BOOT_LINES = [
    'jorge-cli v1.0.0',
    'Copyright (c) ' + new Date().getFullYear() + ' Jorge Censi',
    'Type <span class="cli-key">help</span> to see available commands.',
    '',
  ];

  const COMMANDS = {
    help: cmdHelp,
    about: cmdAbout,
    skills: cmdSkills,
    projects: cmdProjects,
    blog: cmdBlog,
    contact: cmdContact,
    whoami: cmdWhoami,
    ls: cmdLs,
    clear: cmdClear,
    exit: cmdExit,
    coffee: cmdCoffee,
    matrix: cmdMatrix,
    'sudo hire jorge': cmdHire,
  };

  const HELP_TEXT = `
<span class="cli-comment"># Available commands</span>

  <span class="cli-key">about</span>       Who is Jorge?
  <span class="cli-key">skills</span>      Tech stack & expertise
  <span class="cli-key">projects</span>    Portfolio highlights
  <span class="cli-key">blog</span>        Latest posts
  <span class="cli-key">contact</span>     Get in touch
  <span class="cli-key">whoami</span>      You, dear visitor
  <span class="cli-key">ls</span>          List site pages
  <span class="cli-key">coffee</span>      Critical dependency
  <span class="cli-key">matrix</span>      You take the red pill
  <span class="cli-key">sudo hire jorge</span>   The most important command
  <span class="cli-key">clear</span>       Clear the terminal
  <span class="cli-key">exit</span>        Close this terminal
`;

  const ABOUT_TEXT = `
<span class="cli-comment"># jorge censi</span>

  Software engineer since 2010. Started on the Microsoft stack,
  moved to the web, now deep into AI integration.

  I help businesses build intelligent workflows — LLM pipelines,
  copilot assistants, automation that actually ships.

  Not buzzword-driven. Results-oriented.

  When not coding: movies, BBQ, craft beer, and arguing about
  whether a hot dog is a sandwich.
`;

  const SKILLS_TEXT = `
<span class="cli-comment"># tech stack</span>

  <span class="cli-accent">AI / LLM</span>
  ████████████████████  Claude, OpenAI, LangChain, RAG pipelines

  <span class="cli-accent">Backend</span>
  ██████████████████░░  .NET, Node.js, Python, REST APIs

  <span class="cli-accent">Frontend</span>
  ████████████████░░░░  JavaScript, Bootstrap, Jekyll, PWAs

  <span class="cli-accent">Cloud & DevOps</span>
  ██████████████░░░░░░  Azure, GitHub Actions, CI/CD

  <span class="cli-accent">Databases</span>
  █████████████░░░░░░░  SQL Server, PostgreSQL, vector stores
`;

  const PROJECTS_TEXT = `
<span class="cli-comment"># portfolio</span>

  <span class="cli-accent">GigHub</span>
    App for freelancers to manage gigs and clients
    <a href="https://github.com/jorgecensi" target="_blank" class="cli-link">github.com/jorgecensi</a>

  <span class="cli-accent">Marcador Canastra</span>
    Score tracker for the classic Brazilian card game
    Built with love (and a lot of testing at BBQs)

  <span class="cli-accent">Betania Trips</span>
    Travel agency website with booking flow

  <span class="cli-accent">Binary Puzzle</span>
    Logic puzzle PWA — works offline, installable
    <a href="/binary" class="cli-link">/binary</a>

  <span class="cli-accent">CrossFit Timer</span>
    AMRAP / EMOM / Tabata workout timer PWA
    <a href="/crossfit-timer" class="cli-link">/crossfit-timer</a>
`;

  const BLOG_TEXT = `
<span class="cli-comment"># latest posts</span>

  <span class="cli-accent">2026-03</span>  roadmap.sh — The Developer's GPS for Learning Tech
  <span class="cli-accent">2026-03</span>  NotebookLM — Google Gave AI Your Homework...
  <span class="cli-accent">2021-08</span>  How to Monitor Log Files - PowerShell
  <span class="cli-accent">2021-04</span>  Password Manager

  <a href="/blog" class="cli-link">→ Read all posts at /blog</a>
`;

  const CONTACT_TEXT = `
<span class="cli-comment"># get in touch</span>

  <span class="cli-accent">GitHub</span>    <a href="https://github.com/jorgecensi" target="_blank" class="cli-link">github.com/jorgecensi</a>
  <span class="cli-accent">LinkedIn</span>  <a href="https://linkedin.com/in/jorgecensi" target="_blank" class="cli-link">linkedin.com/in/jorgecensi</a>
  <span class="cli-accent">X</span>         <a href="https://x.com/jorgecensi" target="_blank" class="cli-link">x.com/jorgecensi</a>
`;

  const COFFEE_TEXT = `
        <span class="cli-accent">( (</span>
         <span class="cli-accent">) )</span>
      <span class="cli-accent">..........</span>
      <span class="cli-accent">|        |]</span>
      <span class="cli-accent">\\        /</span>
       <span class="cli-accent">\`--------'</span>

  Ah yes, the <span class="cli-accent">primary fuel source</span>.
  Running on craft beer after 6pm.
`;

  const HIRE_TEXT = `
  <span class="cli-accent">sudo</span>: password for recruiter: <span class="cli-muted">**********</span>

  Executing <span class="cli-accent">hire jorge</span>...

  ✓ Checking availability............. <span style="color:var(--color-green)">OPEN</span>
  ✓ Verifying skills.................. <span style="color:var(--color-green)">VERIFIED</span>
  ✓ Confirming AI expertise........... <span style="color:var(--color-green)">CONFIRMED</span>
  ✓ Calculating culture fit........... <span style="color:var(--color-green)">HIGH</span>

  <span class="cli-accent">Result:</span> Great idea. Reach out on LinkedIn.
  <a href="https://linkedin.com/in/jorgecensi" target="_blank" class="cli-link">→ linkedin.com/in/jorgecensi</a>
`;

  const LS_TEXT = `
<span class="cli-comment"># site map</span>

  drwxr  /            Home
  drwxr  /about        About
  drwxr  /portfolio    Portfolio
  drwxr  /apps         Apps
  drwxr  /blog         Blog
  drwxr  /binary       Binary Puzzle
  drwxr  /crossfit-timer  CrossFit Timer
  drwxr  /flappy       Flappy Bird
`;

  // ─── State ───────────────────────────────────────────────────────────────────

  let isOpen = false;
  let history = [];
  let historyIndex = -1;
  let matrixActive = false;
  let matrixFrame = null;

  // ─── DOM ─────────────────────────────────────────────────────────────────────

  function buildDOM() {
    const overlay = document.createElement('div');
    overlay.id = 'jorge-cli-overlay';
    overlay.innerHTML = `
      <div id="jorge-cli-window">
        <div id="jorge-cli-titlebar">
          <span class="cli-dot cli-dot-red"></span>
          <span class="cli-dot cli-dot-yellow"></span>
          <span class="cli-dot cli-dot-green"></span>
          <span id="jorge-cli-title">jorge-cli</span>
          <button id="jorge-cli-close" title="Close (Esc)">✕</button>
        </div>
        <div id="jorge-cli-output"></div>
        <div id="jorge-cli-inputline">
          <span class="cli-prompt">visitor@jorgecensi.com:~$</span>
          <input id="jorge-cli-input" type="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Terminal input" />
        </div>
        <canvas id="jorge-cli-matrix" style="display:none;position:absolute;inset:0;pointer-events:none;opacity:0.18;"></canvas>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.getElementById('jorge-cli-close').addEventListener('click', close);
    document.getElementById('jorge-cli-input').addEventListener('keydown', onInputKeydown);

    return overlay;
  }

  // ─── Open / Close ────────────────────────────────────────────────────────────

  function open() {
    if (isOpen) return;
    isOpen = true;
    const overlay = document.getElementById('jorge-cli-overlay') || buildDOM();
    overlay.classList.add('visible');
    const output = document.getElementById('jorge-cli-output');
    output.innerHTML = '';
    printBoot();
    focusInput();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    stopMatrix();
    const overlay = document.getElementById('jorge-cli-overlay');
    if (overlay) overlay.classList.remove('visible');
  }

  // ─── Boot sequence ───────────────────────────────────────────────────────────

  function printBoot() {
    const output = document.getElementById('jorge-cli-output');
    let i = 0;
    function next() {
      if (i >= BOOT_LINES.length) return;
      const line = document.createElement('div');
      line.className = 'cli-line cli-boot';
      line.innerHTML = BOOT_LINES[i];
      output.appendChild(line);
      scrollToBottom();
      i++;
      setTimeout(next, 60);
    }
    next();
  }

  // ─── Output helpers ──────────────────────────────────────────────────────────

  function print(html, className) {
    const output = document.getElementById('jorge-cli-output');
    const block = document.createElement('div');
    block.className = 'cli-block' + (className ? ' ' + className : '');
    block.innerHTML = html;
    output.appendChild(block);
    scrollToBottom();
  }

  function printCmd(cmd) {
    const output = document.getElementById('jorge-cli-output');
    const line = document.createElement('div');
    line.className = 'cli-line cli-echoed';
    line.innerHTML = '<span class="cli-prompt">visitor@jorgecensi.com:~$</span> ' + escapeHtml(cmd);
    output.appendChild(line);
    scrollToBottom();
  }

  function printError(msg) {
    print('<span class="cli-error">jorge-cli: ' + escapeHtml(msg) + ': command not found. Type <span class="cli-key">help</span> for a list of commands.</span>');
  }

  function scrollToBottom() {
    const output = document.getElementById('jorge-cli-output');
    if (output) output.scrollTop = output.scrollHeight;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─── Input ───────────────────────────────────────────────────────────────────

  function focusInput() {
    setTimeout(function () {
      const input = document.getElementById('jorge-cli-input');
      if (input) input.focus();
    }, 300);
  }

  function onInputKeydown(e) {
    const input = e.target;
    if (e.key === 'Enter') {
      const raw = input.value.trim();
      input.value = '';
      if (!raw) return;
      history.unshift(raw);
      historyIndex = -1;
      printCmd(raw);
      runCommand(raw.toLowerCase());
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex < history.length - 1) {
        historyIndex++;
        input.value = history[historyIndex];
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        historyIndex--;
        input.value = history[historyIndex];
      } else {
        historyIndex = -1;
        input.value = '';
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      autocomplete(input);
    }
  }

  function autocomplete(input) {
    const val = input.value.toLowerCase();
    if (!val) return;
    const keys = Object.keys(COMMANDS);
    const match = keys.find(function (k) { return k.startsWith(val); });
    if (match) input.value = match;
  }

  // ─── Command dispatcher ──────────────────────────────────────────────────────

  function runCommand(cmd) {
    if (COMMANDS[cmd]) {
      COMMANDS[cmd]();
    } else {
      printError(cmd);
    }
  }

  // ─── Commands ────────────────────────────────────────────────────────────────

  function cmdHelp()     { print(HELP_TEXT); }
  function cmdAbout()    { print(ABOUT_TEXT); }
  function cmdSkills()   { print(SKILLS_TEXT); }
  function cmdProjects() { print(PROJECTS_TEXT); }
  function cmdBlog()     { print(BLOG_TEXT); }
  function cmdContact()  { print(CONTACT_TEXT); }
  function cmdCoffee()   { print(COFFEE_TEXT); }
  function cmdHire()     { print(HIRE_TEXT); }
  function cmdLs()       { print(LS_TEXT); }

  function cmdWhoami() {
    const msgs = [
      'A curious developer exploring someone else\'s portfolio.',
      'Probably a recruiter. Hello! 👋',
      'Someone who knows about <code>`</code> keys.',
      'A fellow hacker. Respect.',
      'Unknown entity. Initiating charm sequence...',
    ];
    print('<span class="cli-accent">' + msgs[Math.floor(Math.random() * msgs.length)] + '</span>');
  }

  function cmdClear() {
    const output = document.getElementById('jorge-cli-output');
    if (output) output.innerHTML = '';
  }

  function cmdExit() {
    print('<span class="cli-muted">Goodbye. Come back anytime with <kbd>`</kbd></span>');
    setTimeout(close, 800);
  }

  function cmdMatrix() {
    if (matrixActive) {
      stopMatrix();
      print('<span class="cli-muted">Matrix deactivated. Welcome back to reality.</span>');
    } else {
      startMatrix();
      print('<span class="cli-accent">You took the red pill.</span> <span class="cli-muted">Run <span class="cli-key">matrix</span> again to exit.</span>');
    }
  }

  // ─── Matrix rain ─────────────────────────────────────────────────────────────

  function startMatrix() {
    matrixActive = true;
    const canvas = document.getElementById('jorge-cli-matrix');
    const win = document.getElementById('jorge-cli-window');
    canvas.style.display = 'block';
    canvas.width = win.offsetWidth;
    canvas.height = win.offsetHeight;
    const ctx = canvas.getContext('2d');
    const cols = Math.floor(canvas.width / 14);
    const drops = Array(cols).fill(1);
    const chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ';

    function draw() {
      ctx.fillStyle = 'rgba(12, 10, 26, 0.08)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#6366f1';
      ctx.font = '12px monospace';
      for (let i = 0; i < drops.length; i++) {
        const ch = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(ch, i * 14, drops[i] * 14);
        if (drops[i] * 14 > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
      matrixFrame = requestAnimationFrame(draw);
    }
    draw();
  }

  function stopMatrix() {
    matrixActive = false;
    if (matrixFrame) cancelAnimationFrame(matrixFrame);
    const canvas = document.getElementById('jorge-cli-matrix');
    if (canvas) {
      canvas.style.display = 'none';
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  // ─── Global keyboard listener ────────────────────────────────────────────────

  document.addEventListener('keydown', function (e) {
    // Backtick to toggle
    if (e.key === '`' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      isOpen ? close() : open();
    }
    // Escape to close
    if (e.key === 'Escape' && isOpen) {
      close();
    }
  });

  // ─── Hint in DevTools console ────────────────────────────────────────────────

  const styles = [
    'background: #0c0a1a; color: #6366f1; padding: 8px 12px; font-family: monospace; font-size: 14px; border-left: 3px solid #6366f1;',
    'background: #0c0a1a; color: #a5a2c8; padding: 4px 12px 8px; font-family: monospace; font-size: 12px;',
  ];
  console.log('%c jorge-cli %c Press ` (backtick) anywhere on the site to open the terminal', styles[0], styles[1]);

})();
