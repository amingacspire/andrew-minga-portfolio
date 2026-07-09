(function () {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Footer year ────────────────────────────────────────────────
  const yearEl = document.getElementById('footer-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

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

  // ── Mobile hamburger menu ──────────────────────────────────────
  const hamburger = document.querySelector('.nav__hamburger');
  const mobileNav = document.getElementById('mobile-nav');

  if (!hamburger || !mobileNav) return;

  function getFocusableLinks() {
    return Array.from(mobileNav.querySelectorAll('a'));
  }

  function openMenu() {
    hamburger.setAttribute('aria-expanded', 'true');
    mobileNav.classList.add('is-open');
    const links = getFocusableLinks();
    if (links.length) links[0].focus();
  }

  function closeMenu(returnFocus) {
    hamburger.setAttribute('aria-expanded', 'false');
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
