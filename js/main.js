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

  // ── Terminal typing animation ──────────────────────────────────
  const terminalEl = document.getElementById('terminal-code');
  if (terminalEl) {
    const snippets = [
      '# Deploy Azure Virtual Desktop host pool\n$pool = @{\n  Name              = \'csb-avd-pool\'\n  ResourceGroupName = \'rg-avd-prod\'\n  HostPoolType      = \'Pooled\'\n  MaxSessionLimit   = 10\n}\nNew-AzWvdHostPool @pool',
      '# Enforce MFA via Conditional Access\n$policy = @{\n  DisplayName = \'Require-MFA-AllUsers\'\n  State       = \'enabled\'\n  Conditions  = @{\n    Users        = @{ IncludeUsers = @(\'All\') }\n    Applications = @{ IncludeApplications = @(\'All\') }\n  }\n}\nNew-MgIdentityConditionalAccessPolicy @policy',
      '// host-pool.bicep\nresource pool \'Microsoft.DesktopVirtualization/hostPools@2022-09-09\' = {\n  name: \'csb-avd-pool\'\n  location: resourceGroup().location\n  properties: {\n    hostPoolType:     \'Pooled\'\n    maxSessionLimit:  10\n    loadBalancerType: \'BreadthFirst\'\n  }\n}'
    ];

    if (prefersReducedMotion) {
      terminalEl.textContent = snippets[0];
    } else {
      let si = 0, ci = 0;
      function typeChar() {
        const text = snippets[si];
        if (ci <= text.length) {
          terminalEl.textContent = text.slice(0, ci++);
          setTimeout(typeChar, ci === 1 ? 900 : 28 + Math.random() * 16);
        } else {
          setTimeout(function () {
            terminalEl.textContent = '';
            ci = 0;
            si = (si + 1) % snippets.length;
            setTimeout(typeChar, 500);
          }, 2600);
        }
      }
      typeChar();
    }
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
