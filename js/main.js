(function () {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Footer year ────────────────────────────────────────────────
  const yearEl = document.getElementById('footer-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // ── Headshot fallback (CSS avatar if image fails) ─────────────
  const headshot = document.querySelector('.about__img');
  if (headshot) {
    headshot.addEventListener('error', () => {
      headshot.style.display = 'none';
      headshot.parentElement.classList.add('about__photo--fallback');
    }, { once: true });
  }

  // ── Sticky nav on scroll ───────────────────────────────────────
  const header = document.querySelector('.site-header');
  function onScroll() {
    header.classList.toggle('is-scrolled', window.scrollY > 10);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ── Active section highlight (IntersectionObserver) ───────────
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav__links a');

  function setActive(id) {
    navLinks.forEach(link => {
      const matches = link.getAttribute('href') === '#' + id;
      link.classList.toggle('is-active', matches);
      link.setAttribute('aria-current', matches ? 'location' : 'false');
    });
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    },
    { threshold: 0.35 }
  );

  sections.forEach(sec => observer.observe(sec));

  // ── Smooth scroll (respects prefers-reduced-motion) ───────────
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      if (prefersReducedMotion) {
        target.scrollIntoView();
      } else {
        target.scrollIntoView({ behavior: 'smooth' });
      }
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    });
  });

  // ── Hero canvas particle network ──────────────────────────────
  const heroCanvas = document.querySelector('.hero__canvas');
  if (heroCanvas && !prefersReducedMotion) {
    const ctx = heroCanvas.getContext('2d');
    const COUNT = 60;
    const MAX_DIST = 140;
    let pts = [];

    function resizeCanvas() {
      heroCanvas.width = heroCanvas.offsetWidth;
      heroCanvas.height = heroCanvas.offsetHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    for (let i = 0; i < COUNT; i++) {
      pts.push({
        x: Math.random() * heroCanvas.width,
        y: Math.random() * heroCanvas.height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4
      });
    }

    function drawCanvas() {
      ctx.clearRect(0, 0, heroCanvas.width, heroCanvas.height);
      pts.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > heroCanvas.width)  p.vx *= -1;
        if (p.y < 0 || p.y > heroCanvas.height) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,192,243,0.3)';
        ctx.fill();
      });
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[i].x - pts[j].x;
          const dy = pts[i].y - pts[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < MAX_DIST) {
            ctx.beginPath();
            ctx.moveTo(pts[i].x, pts[i].y);
            ctx.lineTo(pts[j].x, pts[j].y);
            ctx.strokeStyle = 'rgba(0,192,243,' + (0.1 * (1 - d / MAX_DIST)) + ')';
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(drawCanvas);
    }
    drawCanvas();
  }

  // ── Terminal: typing animation + interactive mode ──────────────
  const terminalEl = document.getElementById('terminal-code');
  if (terminalEl) {
    const snippets = [
      '# Deploy Azure Virtual Desktop host pool\n$pool = @{\n  Name              = \'csb-avd-pool\'\n  ResourceGroupName = \'rg-avd-prod\'\n  HostPoolType      = \'Pooled\'\n  MaxSessionLimit   = 10\n}\nNew-AzWvdHostPool @pool',
      '# Enforce MFA via Conditional Access\n$policy = @{\n  DisplayName = \'Require-MFA-AllUsers\'\n  State       = \'enabled\'\n  Conditions  = @{\n    Users        = @{ IncludeUsers = @(\'All\') }\n    Applications = @{ IncludeApplications = @(\'All\') }\n  }\n}\nNew-MgIdentityConditionalAccessPolicy @policy',
      '// host-pool.bicep\nresource pool \'Microsoft.DesktopVirtualization/hostPools@2022-09-09\' = {\n  name: \'csb-avd-pool\'\n  location: resourceGroup().location\n  properties: {\n    hostPoolType:     \'Pooled\'\n    maxSessionLimit:  10\n    loadBalancerType: \'BreadthFirst\'\n  }\n}'
    ];

    let animating = false;
    let animTimer = null;

    function startAnimation() {
      if (prefersReducedMotion) {
        terminalEl.textContent = snippets[0] + '\n\n# Click here to try interactive mode';
        return;
      }
      animating = true;
      let si = 0, ci = 0;
      function typeChar() {
        if (!animating) return;
        const text = snippets[si];
        if (ci <= text.length) {
          terminalEl.textContent = text.slice(0, ci++);
          animTimer = setTimeout(typeChar, ci === 1 ? 900 : 28 + Math.random() * 16);
        } else {
          animTimer = setTimeout(function () {
            if (!animating) return;
            terminalEl.textContent = '';
            ci = 0;
            si = (si + 1) % snippets.length;
            animTimer = setTimeout(typeChar, 500);
          }, 2600);
        }
      }
      typeChar();
    }

    function stopAnimation() {
      animating = false;
      if (animTimer) clearTimeout(animTimer);
    }

    // ── Interactive mode ─────────────────────────────────────────
    const PROMPT = 'PS C:\\visitors\\you> ';
    const terminal = terminalEl.closest('.terminal');
    const termBody = terminalEl.closest('.terminal__body');
    let interactive = false;
    let lines = [];
    let buffer = '';
    let hiddenInput = null;

    function print(text) {
      lines = lines.concat(text.split('\n'));
      if (lines.length > 60) lines = lines.slice(lines.length - 60);
    }

    function render() {
      const head = lines.length ? lines.join('\n') + '\n' : '';
      terminalEl.textContent = head + PROMPT + buffer;
      if (termBody) termBody.scrollTop = termBody.scrollHeight;
    }

    function goTo(hash, label) {
      print('Opening ' + label + '...');
      setTimeout(function () {
        const target = document.querySelector(hash);
        if (target) target.scrollIntoView(prefersReducedMotion ? {} : { behavior: 'smooth' });
      }, 400);
    }

    // ── Hidden Star Wars holocron puzzle (Option A: solver contacts Andrew) ──
    var quest = 0; // 0 idle, 1-3 awaiting that trial's answer, 99 solved
    var TRIALS = [
      { prompt: 'TRIAL 1 of 3\n"From exile on Ahch-To, I trained the one who would bring balance to the Force. Name me."\n\nType your answer. (`abort` leaves the trial.)',
        accept: ['luke', 'luke skywalker', 'skywalker'] },
      { prompt: 'Correct. The holocron glows brighter.\n\nTRIAL 2 of 3\n"The galaxy knew him as Senator, then Emperor Palpatine. The Sith knew him by another name. Speak it."',
        accept: ['darth sidious', 'sidious'] },
      { prompt: 'Correct. One seal remains.\n\nTRIAL 3 of 3\n"Name the command that turned the clone army against the Jedi and ended the Order."',
        accept: ['order 66', 'order sixtysix', 'order sixty six', '66'] }
    ];
    function startQuest() {
      quest = 1;
      print('A hidden transmission crackles to life...\n\nThe Force is strong with you — few find this channel. Three trials guard the holocron.\n\n' + TRIALS[0].prompt);
    }
    function answerTrial(input) {
      var norm = input.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
      if (TRIALS[quest - 1].accept.indexOf(norm) === -1) {
        print('"' + input + '"\nThe holocron stays dark. Focus, and try again. (`abort` to leave.)');
        return;
      }
      if (quest < TRIALS.length) {
        quest++;
        print(TRIALS[quest - 1].prompt);
      } else {
        quest = 99;
        print([
          '',
          '   *** HOLOCRON UNLOCKED ***',
          '',
          'You have the patience of a Jedi and the curiosity of a slicer.',
          'That is exactly the kind of person I like to hear from.',
          '',
          '   Passphrase:  THE-FORCE-WILL-BE-WITH-YOU-ALWAYS',
          '',
          'Send it to me on LinkedIn (linkedin.com/in/andrew-minga-ba933587)',
          'or through the Contact section, and mention you unlocked the holocron.',
          'Reach the end of this and you have earned a reply. Let us talk.',
          '',
          "Type 'exit' to leave the terminal."
        ].join('\n'));
      }
    }

    const commands = {
      'help': function () {
        print([
          'Available commands:',
          '  whoami      who runs this site',
          '  projects    jump to automation projects',
          '  skills      jump to skills and certs',
          '  resume      download the resume (PDF)',
          '  contact     jump to contact options',
          '  blog        open the blog',
          '  tools       open the tools hub',
          '  clear       clear the screen',
          '  exit        return to the demo loop'
        ].join('\n'));
      },
      'whoami': function () {
        print('Andrew Minga. IT leader, Azure Solutions Architect Expert,\nManager of Customer Experience Engineering at C Spire Business.\nBuilds MSP automation and AI tooling.\n\nStar Wars fan — and the Force is unusually strong in this terminal.');
      },
      'projects': function () { goTo('#projects', 'projects'); },
      'skills': function () { goTo('#skills', 'skills'); },
      'contact': function () { goTo('#contact', 'contact'); },
      'resume': function () {
        print('Downloading Andrew_Minga_Resume_2026.pdf ...');
        const a = document.createElement('a');
        a.href = 'assets/Andrew_Minga_Resume_2026.pdf';
        a.download = 'Andrew_Minga_Resume_2026.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
      },
      'blog': function () {
        print('Opening blog...');
        setTimeout(function () { window.location.href = 'blog/index.html'; }, 400);
      },
      'tools': function () {
        print('Opening tools hub...');
        setTimeout(function () { window.location.href = 'tools/index.html'; }, 400);
      },
      'clear': function () { lines = []; },
      'exit': function () {
        interactive = false;
        if (hiddenInput) hiddenInput.blur();
        startAnimation();
      },
      'ls': function () { print('about/  experience/  skills/  projects/  blog/  tools/  interests/  contact/'); },
      'sudo': function () { print('visitor is not in the sudoers file. This incident will be reported.'); },
      'starwars': function () { print('May the Force be with you. Always.\nA Jedi does not simply speak of the Force — a Jedi will use the force.'); },
      'hello': function () { print('Hello there. (General Kenobi!)'); },
      'force': function () { print('The Force flows through this terminal. But knowing about it is not enough — you must *use* it.'); },
      'use the force': startQuest,
      'use force': startQuest
    };
    commands['cls'] = commands['clear'];
    commands['dir'] = commands['ls'];
    commands['get-help'] = commands['help'];

    function runCommand(raw) {
      const cmd = raw.trim().toLowerCase();
      lines.push(PROMPT + raw);
      if (cmd === '') { if (interactive) render(); return; }
      // Inside an active trial, route input to the puzzle (help/clear/exit still work)
      if (quest >= 1 && quest <= TRIALS.length) {
        if (cmd === 'abort') { quest = 0; print('You step back from the holocron; it dims. (`use the force` to try again.)'); }
        else if (cmd === 'exit') { commands.exit(); }
        else if (cmd === 'help') { commands.help(); }
        else if (cmd === 'clear' || cmd === 'cls') { lines = []; }
        else { answerTrial(raw); }
        if (interactive) render();
        return;
      }
      if (commands[cmd]) {
        commands[cmd]();
      } else {
        print("The term '" + raw.trim() + "' is not recognized as the name of a cmdlet,\nfunction, script file, or operable program. Type 'help' for options.");
      }
      if (interactive) render();
    }

    function enterInteractive() {
      if (interactive) return;
      stopAnimation();
      interactive = true;
      quest = 0;
      lines = ["Interactive mode. Type 'help' to see commands, 'exit' to leave."];
      buffer = '';

      if (!hiddenInput) {
        hiddenInput = document.createElement('input');
        hiddenInput.type = 'text';
        hiddenInput.setAttribute('aria-label', 'Terminal command input');
        hiddenInput.autocapitalize = 'off';
        hiddenInput.autocomplete = 'off';
        hiddenInput.style.cssText = 'position:absolute;opacity:0;height:1px;width:1px;';
        terminal.appendChild(hiddenInput);

        hiddenInput.addEventListener('input', function () {
          buffer = hiddenInput.value;
          render();
        });
        hiddenInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            const cmd = buffer;
            buffer = '';
            hiddenInput.value = '';
            runCommand(cmd);
          } else if (e.key === 'Escape') {
            commands['exit']();
          }
        });
      }
      hiddenInput.value = '';
      hiddenInput.focus({ preventScroll: true });
      render();
    }

    if (terminal) {
      terminal.style.cursor = 'text';
      terminal.setAttribute('title', 'Click to interact');
      terminal.addEventListener('click', function () {
        enterInteractive();
        if (hiddenInput) hiddenInput.focus({ preventScroll: true });
      });
    }

    startAnimation();
  }

  // ── Stat counters (animate on scroll into view) ────────────────
  const statNumbers = document.querySelectorAll('.stat__number[data-target]');
  if (statNumbers.length) {
    const statObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !entry.target.dataset.counted) {
          entry.target.dataset.counted = '1';
          const target = parseInt(entry.target.dataset.target, 10);
          const t0 = performance.now();
          const dur = 1400;
          (function tick(now) {
            const p = Math.min((now - t0) / dur, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            entry.target.textContent = Math.round(eased * target);
            if (p < 1) requestAnimationFrame(tick);
          }(t0));
        }
      });
    }, { threshold: 0.6 });
    statNumbers.forEach(function (el) { statObs.observe(el); });
  }

  // ── Mobile hamburger menu ──────────────────────────────────────
  const hamburger = document.querySelector('.nav__hamburger');
  const mobileNav = document.getElementById('mobile-nav');

  if (!hamburger || !mobileNav) return;

  function getFocusableLinks() {
    return Array.from(mobileNav.querySelectorAll('a'));
  }

  function openMenu() {
    hamburger.setAttribute('aria-expanded', 'true');
    hamburger.setAttribute('aria-label', 'Close navigation menu');
    mobileNav.classList.add('is-open');
    const links = getFocusableLinks();
    if (links.length) links[0].focus();
  }

  function closeMenu(returnFocus) {
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.setAttribute('aria-label', 'Open navigation menu');
    mobileNav.classList.remove('is-open');
    if (returnFocus) hamburger.focus();
  }

  function isMenuOpen() {
    return hamburger.getAttribute('aria-expanded') === 'true';
  }

  hamburger.addEventListener('click', () => {
    isMenuOpen() ? closeMenu(true) : openMenu();
  });

  // Escape key closes nav, returns focus to hamburger
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isMenuOpen()) closeMenu(true);
  });

  // Focus trap: Tab cycles within open nav links
  mobileNav.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const links = getFocusableLinks();
    if (!links.length) return;
    const first = links[0];
    const last = links[links.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // Outside click closes nav
  document.addEventListener('click', (e) => {
    if (isMenuOpen() && !hamburger.contains(e.target) && !mobileNav.contains(e.target)) {
      closeMenu(false);
    }
  });

  // Close nav when a link is clicked (single-page navigation)
  mobileNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => closeMenu(false));
  });

})();
