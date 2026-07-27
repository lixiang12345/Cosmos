/* Cosmos 产品网站 — 渐进增强脚本（无依赖） */
(function () {
  'use strict';

  /* —— 顶栏移动端导航 —— */
  var navToggle = document.querySelector('.nav-toggle');
  var topNav = document.getElementById('site-nav');

  function setTopNav(open, returnFocus) {
    if (!topNav) return;
    topNav.classList.toggle('is-open', open);
    if (navToggle) navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open && returnFocus && navToggle) navToggle.focus();
  }

  if (navToggle && topNav) {
    navToggle.addEventListener('click', function () {
      setTopNav(!topNav.classList.contains('is-open'), false);
    });
    topNav.addEventListener('click', function (event) {
      if (event.target.closest('a')) {
        setTopNav(false, false);
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && topNav.classList.contains('is-open')) {
        setTopNav(false, true);
      }
    });
  }

  /* —— 使用手册：侧栏抽屉 —— */
  var docsToggle = document.querySelector('.docs-toggle');
  var docsNav = document.getElementById('docs-nav');
  var docsOverlay = document.querySelector('.docs-overlay');

  function setDocsNav(open) {
    if (!docsNav) return;
    docsNav.classList.toggle('is-open', open);
    if (docsOverlay) docsOverlay.classList.toggle('is-open', open);
    if (docsToggle) docsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  if (docsToggle && docsNav) {
    docsToggle.addEventListener('click', function () {
      setDocsNav(!docsNav.classList.contains('is-open'));
    });
    if (docsOverlay) docsOverlay.addEventListener('click', function () { setDocsNav(false); });
    docsNav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setDocsNav(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') setDocsNav(false);
    });
  }

  /* —— 使用手册：滚动高亮 —— */
  var navLinks = docsNav ? Array.prototype.slice.call(docsNav.querySelectorAll('a[href^="#"]')) : [];
  var sections = navLinks
    .map(function (link) { return document.getElementById(link.getAttribute('href').slice(1)); })
    .filter(Boolean);

  function markActive(id) {
    navLinks.forEach(function (link) {
      link.classList.toggle('is-active', link.getAttribute('href') === '#' + id);
    });
  }

  if (sections.length && 'IntersectionObserver' in window) {
    var visible = new Map();
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          visible.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
        });
        var best = null;
        var bestTop = Infinity;
        sections.forEach(function (section) {
          if ((visible.get(section.id) || 0) > 0) {
            var top = Math.abs(section.getBoundingClientRect().top);
            if (top < bestTop) { bestTop = top; best = section.id; }
          }
        });
        if (best) markActive(best);
      },
      { rootMargin: '-72px 0px -55% 0px', threshold: [0, 0.05] }
    );
    sections.forEach(function (section) { observer.observe(section); });
  }

  /* —— 语言切换：保持当前锚点 —— */
  document.querySelectorAll('.lang-switch a[data-lang-link]').forEach(function (link) {
    link.addEventListener('click', function () {
      if (window.location.hash) {
        link.href = link.href.split('#')[0] + window.location.hash;
      }
    });
  });

  /* —— 代码复制按钮 —— */
  document.querySelectorAll('.copy-btn[data-copy-target]').forEach(function (button) {
    button.addEventListener('click', function () {
      var target = document.getElementById(button.getAttribute('data-copy-target'));
      if (!target) return;
      var text = target.innerText.replace(/\n+$/, '');
      function done() {
        button.classList.add('is-copied');
        var label = button.querySelector('span');
        if (label) {
          var original = label.textContent;
          label.textContent = '已复制';
          setTimeout(function () {
            label.textContent = original;
            button.classList.remove('is-copied');
          }, 1600);
        }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {});
      }
    });
  });
})();
