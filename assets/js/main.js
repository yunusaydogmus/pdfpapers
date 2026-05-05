/* ============================================
   PDFPAPERS - JavaScript Principal
   ============================================ */

'use strict';

// ============================================
// NAVIGATION
// ============================================
const initNavbar = () => {
  const navbar = document.querySelector('.navbar');
  const mobileToggle = document.querySelector('.mobile-toggle');
  const mobileMenu = document.querySelector('.mobile-menu');

  // Sticky shadow on scroll
  if (navbar) {
    window.addEventListener('scroll', () => {
      navbar.classList.toggle('scrolled', window.scrollY > 20);
    });
  }

  // Mobile menu toggle
  if (mobileToggle && mobileMenu) {
    mobileToggle.addEventListener('click', () => {
      const isOpen = mobileMenu.classList.toggle('open');
      mobileToggle.setAttribute('aria-expanded', isOpen);
      // Animate hamburger to X
      const spans = mobileToggle.querySelectorAll('span');
      if (isOpen) {
        spans[0].style.transform = 'translateY(7px) rotate(45deg)';
        spans[1].style.opacity = '0';
        spans[2].style.transform = 'translateY(-7px) rotate(-45deg)';
      } else {
        spans.forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
      }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!navbar.contains(e.target)) {
        mobileMenu.classList.remove('open');
        const spans = mobileToggle.querySelectorAll('span');
        spans.forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
      }
    });
  }
};

// ============================================
// SCROLL ANIMATIONS
// ============================================
const initScrollAnimations = () => {
  const elements = document.querySelectorAll('.fade-up');
  if (!elements.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  elements.forEach(el => observer.observe(el));
};

// ============================================
// HERO UPLOAD ZONE (index page)
// ============================================
const initHeroUpload = () => {
  const uploadZone = document.querySelector('.upload-zone');
  const fileInput = document.getElementById('hero-file-input');
  if (!uploadZone || !fileInput) return;

  // Click to open file picker
  uploadZone.addEventListener('click', () => fileInput.click());

  // Drag & drop visual
  ['dragenter', 'dragover'].forEach(ev =>
    uploadZone.addEventListener(ev, (e) => {
      e.preventDefault();
      uploadZone.classList.add('dragging');
    })
  );

  ['dragleave', 'drop'].forEach(ev =>
    uploadZone.addEventListener(ev, (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragging');
    })
  );

  uploadZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length) handleHeroFiles(files);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleHeroFiles(fileInput.files);
  });

  function handleHeroFiles(files) {
    const file = files[0];
    const ext = file.name.split('.').pop().toLowerCase();

    // Redirect to appropriate tool based on file type
    const toolMap = {
      pdf: 'tool.html?tool=fusionner-pdf',
      doc: 'tool.html?tool=word-en-pdf',
      docx: 'tool.html?tool=word-en-pdf',
      xls: 'tool.html?tool=excel-en-pdf',
      xlsx: 'tool.html?tool=excel-en-pdf',
      ppt: 'tool.html?tool=ppt-en-pdf',
      pptx: 'tool.html?tool=ppt-en-pdf',
      jpg: 'tool.html?tool=jpg-en-pdf',
      jpeg: 'tool.html?tool=jpg-en-pdf',
      png: 'tool.html?tool=jpg-en-pdf',
    };

    const dest = toolMap[ext];
    if (dest) {
      // Store file info in sessionStorage for the tool page
      sessionStorage.setItem('pendingFile', JSON.stringify({
        name: file.name,
        size: file.size,
        type: file.type
      }));
      showToast(`Fichier "${file.name}" chargé — ouverture de l'outil...`, 'success');
      setTimeout(() => window.location.href = dest, 1000);
    } else {
      showToast('Format non supporté. Veuillez utiliser un fichier PDF, Word, Excel, PowerPoint ou image.', 'error');
    }
  }
};

// ============================================
// TOOLS TABS FILTER
// ============================================
const initToolsTabs = () => {
  const tabs = document.querySelectorAll('.tab-btn');
  const categories = document.querySelectorAll('.tool-category');
  if (!tabs.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const filter = tab.dataset.filter;

      // Update active tab
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Show/hide categories
      categories.forEach(cat => {
        if (filter === 'all' || cat.dataset.category === filter) {
          cat.style.display = 'block';
          cat.style.animation = 'fadeIn 0.3s ease';
        } else {
          cat.style.display = 'none';
        }
      });
    });
  });
};

// ============================================
// FAQ ACCORDION
// ============================================
const initFAQ = () => {
  const items = document.querySelectorAll('.faq-item');
  items.forEach(item => {
    const question = item.querySelector('.faq-question');
    question?.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      // Close all
      items.forEach(i => i.classList.remove('open'));
      // Toggle current
      if (!isOpen) item.classList.add('open');
    });
  });
};

// ============================================
// PRICING TOGGLE (mensuel/annuel)
// ============================================
const initPricingToggle = () => {
  const toggle = document.querySelector('.toggle-switch');
  const priceAmounts = document.querySelectorAll('.price-amount[data-monthly][data-yearly]');
  if (!toggle) return;

  let isYearly = false;

  toggle.addEventListener('click', () => {
    isYearly = !isYearly;
    toggle.classList.toggle('active', isYearly);

    priceAmounts.forEach(el => {
      el.textContent = isYearly ? el.dataset.yearly : el.dataset.monthly;
    });

    const periodEls = document.querySelectorAll('.price-period');
    periodEls.forEach(el => {
      el.textContent = isYearly ? '/an' : '/mois';
    });
  });
};

// ============================================
// TOOL PAGE - UPLOAD & FILE MANAGEMENT
// ============================================
const initToolPage = () => {
  const bigUpload    = document.querySelector('.big-upload-zone');
  const toolInput    = document.getElementById('tool-file-input');
  const fileList     = document.getElementById('file-list');
  const addMoreBtn   = document.querySelector('.add-more-btn');
  const processingOv = document.getElementById('processing-overlay');
  const successState = document.getElementById('success-state');
  const progressBar  = document.getElementById('progress-bar');
  // ← Bug fix : on cache le conteneur parent, pas juste le dashed-zone
  const uploadArea   = document.querySelector('.workspace-upload');

  if (!bigUpload || !toolInput) return;

  let files = [];
  window._toolFiles = files;

  // Pending file from homepage redirect
  const pending = sessionStorage.getItem('pendingFile');
  if (pending) {
    try {
      sessionStorage.removeItem('pendingFile');
      const pf = JSON.parse(pending);
      addFileToList({ name: pf.name, size: pf.size || 0 });
    } catch(e) { /* ignore */ }
  }

  // Click on upload area
  bigUpload.addEventListener('click', () => toolInput.click());
  addMoreBtn?.addEventListener('click', (e) => { e.stopPropagation(); toolInput.click(); });

  // Drag & drop visual
  bigUpload.addEventListener('dragover',  (e) => { e.preventDefault(); bigUpload.classList.add('dragging'); });
  bigUpload.addEventListener('dragleave', ()  => bigUpload.classList.remove('dragging'));
  bigUpload.addEventListener('drop', (e) => {
    e.preventDefault();
    bigUpload.classList.remove('dragging');
    Array.from(e.dataTransfer.files).forEach(addFileToList);
  });

  // File input change
  toolInput.addEventListener('change', () => {
    Array.from(toolInput.files).forEach(addFileToList);
    toolInput.value = '';
  });

  function addFileToList(file) {
    files.push(file);
    window._toolFiles = files;
    render();
  }

  function removeFileAt(index) {
    files.splice(index, 1);
    window._toolFiles = files;
    render();
  }

  function render() {
    if (!fileList) return;
    fileList.innerHTML = '';

    if (files.length === 0) {
      // Afficher la zone d'upload, cacher le reste
      if (uploadArea) uploadArea.style.display = '';
      fileList.style.display = 'none';
      const optEl = document.getElementById('tool-options');
      const actEl = document.getElementById('tool-actions');
      if (optEl) optEl.style.display = 'none';
      if (actEl) actEl.style.display = 'none';
      return;
    }

    // ── Cacher la zone d'upload, montrer la liste ──
    if (uploadArea) uploadArea.style.display = 'none';
    fileList.style.display = 'flex';
    fileList.style.flexDirection = 'column';
    fileList.style.gap = '10px';
    fileList.style.padding = '28px 40px';

    files.forEach((file, idx) => {
      const ext  = ((file.name || '').split('.').pop() || 'PDF').toUpperCase().slice(0, 4);
      const size = formatFileSize(file.size || 0);

      const item = document.createElement('div');
      item.className = 'file-item';
      item.style.cssText = 'display:flex;align-items:center;gap:12px;padding:14px 16px;border:1.5px solid var(--gray-100);border-radius:12px;background:var(--gray-50);transition:border-color .2s';
      item.innerHTML = `
        <div class="file-type-icon" style="background:var(--primary-lighter);color:var(--primary);width:40px;height:40px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;flex-shrink:0">${ext}</div>
        <span style="flex:1;font-size:14px;font-weight:500;color:var(--gray-700);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${file.name || 'Fichier'}</span>
        <span style="font-size:12px;color:var(--gray-400);flex-shrink:0">${size}</span>
        <button class="rm-btn" data-idx="${idx}" title="Retirer" style="width:28px;height:28px;border-radius:50%;background:transparent;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--gray-400);transition:all .2s;flex-shrink:0">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>`;
      fileList.appendChild(item);

      // Hover effect
      item.addEventListener('mouseenter', () => item.style.borderColor = 'var(--primary-light)');
      item.addEventListener('mouseleave', () => item.style.borderColor = 'var(--gray-100)');

      // Remove btn hover
      const rmBtn = item.querySelector('.rm-btn');
      rmBtn.addEventListener('mouseenter', () => { rmBtn.style.background = '#FEE2E2'; rmBtn.style.color = '#DC2626'; });
      rmBtn.addEventListener('mouseleave', () => { rmBtn.style.background = 'transparent'; rmBtn.style.color = 'var(--gray-400)'; });
      rmBtn.addEventListener('click', (e) => { e.stopPropagation(); removeFileAt(parseInt(rmBtn.dataset.idx)); });
    });

    // Afficher options + bouton d'action
    const optEl = document.getElementById('tool-options');
    const actEl = document.getElementById('tool-actions');
    const cntEl = document.getElementById('file-count-label');
    if (optEl) optEl.style.display = 'block';
    if (actEl) actEl.style.display = 'flex';
    if (cntEl) cntEl.textContent = `${files.length} fichier${files.length > 1 ? 's' : ''} prêt${files.length > 1 ? 's' : ''}`;
  }

  // Bouton "Réinitialiser" (après succès)
  document.querySelector('.reset-btn')?.addEventListener('click', () => {
    files = []; window._toolFiles = files;
    if (successState) successState.classList.remove('active');
    if (processingOv) processingOv.classList.remove('active');
    if (progressBar)  progressBar.style.width = '0%';
    render();
  });
};

// ============================================
// OPTION RADIO BUTTONS
// ============================================
const initOptionRadios = () => {
  document.querySelectorAll('.option-radio').forEach(radio => {
    radio.addEventListener('click', () => {
      const group = radio.closest('.option-radio-group');
      group?.querySelectorAll('.option-radio').forEach(r => r.classList.remove('selected'));
      radio.classList.add('selected');
    });
  });
};

// ============================================
// COUNTER ANIMATION
// ============================================
const initCounters = () => {
  const counters = document.querySelectorAll('.stat-number[data-count]');
  if (!counters.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = parseFloat(el.dataset.count);
      const suffix = el.dataset.suffix || '';
      const duration = 1800;
      const start = Date.now();

      const update = () => {
        const elapsed = Date.now() - start;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        const current = target * ease;

        el.textContent = (current >= 1 ? Math.floor(current) : current.toFixed(1)) + suffix;
        if (progress < 1) requestAnimationFrame(update);
      };

      requestAnimationFrame(update);
      observer.unobserve(el);
    });
  }, { threshold: 0.5 });

  counters.forEach(el => observer.observe(el));
};

// ============================================
// TOAST NOTIFICATIONS
// ============================================
const showToast = (message, type = 'info', duration = 4000) => {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ'
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span style="font-size:16px;font-weight:700">${icons[type]}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideInRight 0.3s ease reverse';
    setTimeout(() => toast.remove(), 300);
  }, duration);
};

// ============================================
// UTILITY FUNCTIONS
// ============================================
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

// Smooth scroll for anchor links
const initSmoothScroll = () => {
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
};

// ============================================
// SEARCH TOOLS
// ============================================
const initToolSearch = () => {
  const searchInput = document.querySelector('.tools-search-input');
  if (!searchInput) return;

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim();
    const cards = document.querySelectorAll('.tool-card');
    const categories = document.querySelectorAll('.tool-category');

    if (!q) {
      cards.forEach(c => c.style.display = '');
      categories.forEach(cat => cat.style.display = '');
      return;
    }

    categories.forEach(cat => {
      let hasVisible = false;
      cat.querySelectorAll('.tool-card').forEach(card => {
        const name = card.querySelector('.tool-card-name')?.textContent.toLowerCase() || '';
        const desc = card.querySelector('.tool-card-desc')?.textContent.toLowerCase() || '';
        const match = name.includes(q) || desc.includes(q);
        card.style.display = match ? '' : 'none';
        if (match) hasVisible = true;
      });
      cat.style.display = hasVisible ? '' : 'none';
    });
  });
};

// ============================================
// BACK TO TOP
// ============================================
const initBackToTop = () => {
  const btn = document.querySelector('.back-to-top');
  if (!btn) return;

  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 400);
  });

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
};

// ============================================
// INIT ALL
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initScrollAnimations();
  initHeroUpload();
  initToolsTabs();
  initFAQ();
  initPricingToggle();
  initToolPage();
  initOptionRadios();
  initCounters();
  initSmoothScroll();
  initToolSearch();
  initBackToTop();
});

// Expose showToast globally (usable in HTML)
window.showToast = showToast;
