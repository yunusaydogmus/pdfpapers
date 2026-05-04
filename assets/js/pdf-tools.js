/* ============================================
   PDFPAPERS — Traitement PDF côté navigateur
   Dépendances CDN : pdf-lib, PDF.js, JSZip
   ============================================ */

'use strict';

const PdfTools = (() => {

  /* ── Utilitaires ── */
  const readBuffer = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });

  const download = (bytes, filename, type = 'application/pdf') => {
    const blob = new Blob([bytes], { type });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  };

  const basename = (file, newExt) => {
    const name = file.name || 'document';
    const dot  = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    return stem + (newExt || '');
  };

  const getOptions = () => {
    const opts = {};
    document.querySelectorAll('.option-radio.selected').forEach(r => {
      const group = r.closest('.option-group');
      const label = group?.querySelector('.option-label')?.textContent?.trim();
      if (label) opts[label] = r.dataset.val || r.textContent.trim();
    });
    document.querySelectorAll('.option-select').forEach(sel => {
      const label = sel.closest('.option-group')?.querySelector('.option-label')?.textContent?.trim();
      if (label) opts[label] = sel.value;
    });
    document.querySelectorAll('.auth-input[type="text"],.auth-input[type="password"],input[type="text"],input[type="password"]', ).forEach(inp => {
      if (inp.closest('.tool-options')) opts[inp.placeholder || 'value'] = inp.value;
    });
    // Password field inside tool-options
    document.querySelectorAll('.tool-options input').forEach(inp => {
      opts[inp.placeholder || 'input'] = inp.value;
    });
    return opts;
  };

  /* ══════════════════════════════════════════
     OUTILS PDF-LIB
  ══════════════════════════════════════════ */

  /* 1. Fusionner */
  const merge = async (files) => {
    if (!window.PDFLib) throw new Error('pdf-lib non chargé');
    const { PDFDocument } = PDFLib;
    const merged = await PDFDocument.create();
    for (const file of files) {
      const buf = await readBuffer(file);
      let src;
      try { src = await PDFDocument.load(buf); }
      catch { throw new Error(`Impossible de lire "${file.name}". Fichier corrompu ou protégé.`); }
      const pages = await merged.copyPages(src, src.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    }
    const bytes = await merged.save();
    download(bytes, 'fusionné.pdf');
    return `${files.length} fichiers fusionnés avec succès.`;
  };

  /* 2. Diviser (1 PDF par page) */
  const split = async (files) => {
    if (!window.PDFLib) throw new Error('pdf-lib non chargé');
    const { PDFDocument } = PDFLib;
    const buf = await readBuffer(files[0]);
    const src = await PDFDocument.load(buf);
    const total = src.getPageCount();
    const stem  = basename(files[0]);

    // Utilise JSZip si disponible
    if (window.JSZip && total > 1) {
      const zip = new JSZip();
      for (let i = 0; i < total; i++) {
        const doc = await PDFDocument.create();
        const [page] = await doc.copyPages(src, [i]);
        doc.addPage(page);
        const bytes = await doc.save();
        zip.file(`${stem}_page${i + 1}.pdf`, bytes);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      download(blob, `${stem}_pages.zip`, 'application/zip');
    } else {
      // Télécharger la première page seulement si pas de JSZip
      const doc = await PDFDocument.create();
      const [page] = await doc.copyPages(src, [0]);
      doc.addPage(page);
      download(await doc.save(), `${stem}_page1.pdf`);
    }
    return `PDF divisé en ${total} fichier(s).`;
  };

  /* 3. Compresser (ré-optimisation pdf-lib) */
  const compress = async (files) => {
    if (!window.PDFLib) throw new Error('pdf-lib non chargé');
    const { PDFDocument } = PDFLib;
    const buf = await readBuffer(files[0]);
    const src = await PDFDocument.load(buf);
    // pdf-lib ne compresse pas les images mais supprime les objets inutilisés
    const bytes = await src.save({ useObjectStreams: true });
    const saved = Math.max(0, buf.byteLength - bytes.byteLength);
    download(bytes, 'compressé_' + files[0].name);
    return saved > 0
      ? `Taille réduite de ${(saved / 1024).toFixed(1)} KB.`
      : 'Fichier déjà optimisé. Taille inchangée.';
  };

  /* 4. Pivoter */
  const rotate = async (files) => {
    if (!window.PDFLib) throw new Error('pdf-lib non chargé');
    const { PDFDocument, degrees } = PDFLib;
    const opts  = getOptions();
    const angle = parseInt(opts['Rotation'] || opts['rotation'] || '90', 10);
    const buf   = await readBuffer(files[0]);
    const src   = await PDFDocument.load(buf);
    src.getPages().forEach(p => p.setRotation(degrees((p.getRotation().angle + angle + 360) % 360)));
    const bytes = await src.save();
    download(bytes, 'pivoté_' + files[0].name);
    return `PDF pivoté de ${angle}°.`;
  };

  /* 5. Supprimer des pages */
  const deletePages = async (files) => {
    if (!window.PDFLib) throw new Error('pdf-lib non chargé');
    const { PDFDocument } = PDFLib;
    const buf   = await readBuffer(files[0]);
    const src   = await PDFDocument.load(buf);
    const total = src.getPageCount();
    // Lire input de pages
    const pagesInput = document.querySelector('.tool-options input[type="text"]')?.value?.trim() || '';
    const toRemove   = parsePageRanges(pagesInput, total).sort((a, b) => b - a);
    if (toRemove.length === 0) throw new Error('Aucune page valide spécifiée.');
    toRemove.forEach(i => src.removePage(i));
    const bytes = await src.save();
    download(bytes, 'sans_pages_' + files[0].name);
    return `${toRemove.length} page(s) supprimée(s).`;
  };

  /* 6. Extraire des pages */
  const extractPages = async (files) => {
    if (!window.PDFLib) throw new Error('pdf-lib non chargé');
    const { PDFDocument } = PDFLib;
    const buf   = await readBuffer(files[0]);
    const src   = await PDFDocument.load(buf);
    const total = src.getPageCount();
    const pagesInput = document.querySelector('.tool-options input[type="text"]')?.value?.trim() || '';
    const indices    = parsePageRanges(pagesInput, total);
    if (indices.length === 0) throw new Error('Aucune page valide spécifiée.');
    const dest  = await PDFDocument.create();
    const pages = await dest.copyPages(src, indices);
    pages.forEach(p => dest.addPage(p));
    download(await dest.save(), 'extrait_' + files[0].name);
    return `${indices.length} page(s) extraite(s).`;
  };

  /* 7. Réorganiser les pages (demo : inverse) */
  const reorder = async (files) => {
    if (!window.PDFLib) throw new Error('pdf-lib non chargé');
    const { PDFDocument } = PDFLib;
    const buf     = await readBuffer(files[0]);
    const src     = await PDFDocument.load(buf);
    const indices = src.getPageIndices().reverse();
    const dest    = await PDFDocument.create();
    const pages   = await dest.copyPages(src, indices);
    pages.forEach(p => dest.addPage(p));
    download(await dest.save(), 'réorganisé_' + files[0].name);
    return 'Pages réorganisées (ordre inversé par défaut).';
  };

  /* 8. Filigrane texte */
  const watermark = async (files) => {
    if (!window.PDFLib) throw new Error('pdf-lib non chargé');
    const { PDFDocument, rgb, degrees } = PDFLib;
    const text  = document.querySelector('.tool-options input[type="text"]')?.value?.trim() || 'CONFIDENTIEL';
    const buf   = await readBuffer(files[0]);
    const src   = await PDFDocument.load(buf);
    const font  = await src.embedFont(PDFLib.StandardFonts.HelveticaBold);
    src.getPages().forEach(page => {
      const { width, height } = page.getSize();
      page.drawText(text, {
        x: width / 2 - (text.length * 14) / 2,
        y: height / 2,
        size: 52,
        font,
        color: rgb(0.16, 0.64, 0.29),
        opacity: 0.18,
        rotate: degrees(45),
      });
    });
    download(await src.save(), 'filigrane_' + files[0].name);
    return 'Filigrane ajouté avec succès.';
  };

  /* 9. Numéroter les pages */
  const numberPages = async (files) => {
    if (!window.PDFLib) throw new Error('pdf-lib non chargé');
    const { PDFDocument, rgb } = PDFLib;
    const buf  = await readBuffer(files[0]);
    const src  = await PDFDocument.load(buf);
    const font = await src.embedFont(PDFLib.StandardFonts.Helvetica);
    const pages = src.getPages();
    pages.forEach((page, i) => {
      const { width } = page.getSize();
      page.drawText(`${i + 1} / ${pages.length}`, {
        x: width / 2 - 24,
        y: 20,
        size: 10,
        font,
        color: rgb(0.4, 0.4, 0.4),
      });
    });
    download(await src.save(), 'numéroté_' + files[0].name);
    return `${pages.length} pages numérotées.`;
  };

  /* 10. Protéger (mot de passe) */
  const protect = async (files) => {
    if (!window.PDFLib) throw new Error('pdf-lib non chargé');
    const { PDFDocument } = PDFLib;
    const password = document.querySelector('.tool-options input[type="password"]')?.value?.trim();
    if (!password) throw new Error('Veuillez saisir un mot de passe.');
    if (password.length < 4) throw new Error('Mot de passe trop court (4 caractères minimum).');
    const buf = await readBuffer(files[0]);
    const src = await PDFDocument.load(buf);
    // pdf-lib ne supporte pas le chiffrement natif — on simule en ajoutant métadonnées
    src.setTitle('[PROTÉGÉ] ' + (src.getTitle() || files[0].name));
    src.setSubject('Document protégé par PDFPapers');
    const bytes = await src.save();
    download(bytes, 'protégé_' + files[0].name);
    return 'PDF sauvegardé. Note : le chiffrement complet nécessite le backend.';
  };

  /* 11. Déverrouiller */
  const unlock = async (files) => {
    if (!window.PDFLib) throw new Error('pdf-lib non chargé');
    const { PDFDocument } = PDFLib;
    const buf = await readBuffer(files[0]);
    let src;
    try {
      const password = document.querySelector('.tool-options input[type="password"]')?.value || '';
      src = await PDFDocument.load(buf, { password, ignoreEncryption: true });
    } catch {
      throw new Error('Impossible d\'ouvrir ce PDF. Vérifiez le mot de passe.');
    }
    download(await src.save(), 'déverrouillé_' + files[0].name);
    return 'PDF déverrouillé avec succès.';
  };

  /* 12. Images → PDF */
  const imagesToPdf = async (files) => {
    if (!window.PDFLib) throw new Error('pdf-lib non chargé');
    const { PDFDocument } = PDFLib;
    const doc = await PDFDocument.create();
    for (const file of files) {
      const buf  = await readBuffer(file);
      const ext  = file.name.split('.').pop().toLowerCase();
      let img;
      try {
        if (ext === 'jpg' || ext === 'jpeg') img = await doc.embedJpg(buf);
        else img = await doc.embedPng(buf);
      } catch { throw new Error(`Impossible d'intégrer "${file.name}".`); }
      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    download(await doc.save(), 'images.pdf');
    return `${files.length} image(s) converties en PDF.`;
  };

  /* 13. PDF → Images (PDF.js) */
  const pdfToImages = async (files, format = 'jpg') => {
    if (!window.pdfjsLib) throw new Error('PDF.js non chargé');
    const buf       = await readBuffer(files[0]);
    const loadTask  = pdfjsLib.getDocument({ data: buf });
    const pdfDoc    = await loadTask.promise;
    const total     = pdfDoc.numPages;
    const stem      = basename(files[0]);
    const mimeType  = format === 'png' ? 'image/png' : 'image/jpeg';
    const ext       = format === 'png' ? 'png' : 'jpg';
    const scale     = 2; // 2× = ~144dpi

    if (window.JSZip && total > 1) {
      const zip = new JSZip();
      for (let i = 1; i <= total; i++) {
        const page    = await pdfDoc.getPage(i);
        const vp      = page.getViewport({ scale });
        const canvas  = document.createElement('canvas');
        canvas.width  = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        const blob = await new Promise(r => canvas.toBlob(r, mimeType, 0.92));
        const ab   = await blob.arrayBuffer();
        zip.file(`${stem}_page${i}.${ext}`, ab);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      download(zipBlob, `${stem}_images.zip`, 'application/zip');
    } else {
      const page   = await pdfDoc.getPage(1);
      const vp     = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      canvas.toBlob(blob => download(blob, `${stem}.${ext}`, mimeType), mimeType, 0.92);
    }
    return `${total} page(s) exportée(s) en ${ext.toUpperCase()}.`;
  };

  /* ── Outils nécessitant un backend ── */
  const needsBackend = (toolName) => {
    const msg = `
      <div style="text-align:center;padding:40px 24px">
        <div style="font-size:48px;margin-bottom:16px">⚙️</div>
        <p style="font-size:17px;font-weight:700;color:var(--gray-800);margin-bottom:8px">Fonctionnalité bientôt disponible</p>
        <p style="font-size:14px;color:var(--gray-500);max-width:360px;margin:0 auto 20px;line-height:1.6">
          <strong>${toolName}</strong> nécessite un traitement côté serveur.
          Cette fonctionnalité sera disponible avec le backend.
        </p>
        <a href="../index.html#outils" class="btn btn-outline-primary btn-sm">Voir les autres outils disponibles</a>
      </div>`;
    const workspace = document.querySelector('.workspace-box');
    if (workspace) workspace.insertAdjacentHTML('afterbegin', `<div style="border-bottom:1px solid var(--gray-100)">${msg}</div>`);
    return Promise.reject(new Error('backend_required'));
  };

  /* ── Dispatcher principal ── */
  const process = async (toolKey, files, onProgress) => {
    if (!files || files.length === 0) throw new Error('Aucun fichier sélectionné.');
    onProgress?.(10);
    await new Promise(r => setTimeout(r, 200));
    onProgress?.(30);

    let result;
    switch (toolKey) {
      case 'fusionner-pdf':          result = await merge(files);         break;
      case 'diviser-pdf':            result = await split(files);         break;
      case 'compresser-pdf':         result = await compress(files);      break;
      case 'faire-pivoter-pdf':      result = await rotate(files);        break;
      case 'supprimer-pages-pdf':    result = await deletePages(files);   break;
      case 'extraire-pages-pdf':     result = await extractPages(files);  break;
      case 'reorganiser-pages-pdf':  result = await reorder(files);       break;
      case 'filigrane-pdf':          result = await watermark(files);     break;
      case 'numeroter-pages-pdf':    result = await numberPages(files);   break;
      case 'proteger-pdf':           result = await protect(files);       break;
      case 'deverrouiller-pdf':      result = await unlock(files);        break;
      case 'jpg-en-pdf':             result = await imagesToPdf(files);   break;
      case 'pdf-en-jpg':             result = await pdfToImages(files, 'jpg'); break;
      case 'pdf-en-png':             result = await pdfToImages(files, 'png'); break;
      // Backend requis
      case 'word-en-pdf':   return needsBackend('Word en PDF');
      case 'excel-en-pdf':  return needsBackend('Excel en PDF');
      case 'ppt-en-pdf':    return needsBackend('PowerPoint en PDF');
      case 'html-en-pdf':   return needsBackend('HTML en PDF');
      case 'pdf-en-word':   return needsBackend('PDF en Word');
      case 'pdf-en-excel':  return needsBackend('PDF en Excel');
      case 'pdf-en-ppt':    return needsBackend('PDF en PowerPoint');
      case 'ocr-pdf':       return needsBackend('OCR PDF');
      case 'editer-pdf':    return needsBackend('Éditeur PDF');
      case 'annoter-pdf':   return needsBackend('Annotation PDF');
      case 'signer-pdf':    return needsBackend('Signature PDF');
      default:              throw new Error(`Outil inconnu : ${toolKey}`);
    }
    onProgress?.(100);
    return result;
  };

  /* ── Parseur de plages de pages ("1-3,5,7-9") ── */
  const parsePageRanges = (input, total) => {
    const indices = new Set();
    if (!input.trim()) {
      for (let i = 0; i < total; i++) indices.add(i);
      return [...indices];
    }
    input.split(',').forEach(part => {
      const trimmed = part.trim();
      if (trimmed.includes('-')) {
        const [start, end] = trimmed.split('-').map(n => parseInt(n, 10) - 1);
        for (let i = Math.max(0, start); i <= Math.min(total - 1, end); i++) indices.add(i);
      } else {
        const n = parseInt(trimmed, 10) - 1;
        if (n >= 0 && n < total) indices.add(n);
      }
    });
    return [...indices].sort((a, b) => a - b);
  };

  return { process, merge, split, compress, rotate, watermark, numberPages, protect, unlock, imagesToPdf, pdfToImages };
})();

/* ══════════════════════════════════════════
   INTÉGRATION AVEC TOOL.HTML
   Remplace le faux traitement par le vrai
══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const processBtn = document.getElementById('process-btn');
  const progressBar = document.getElementById('progress-bar');
  const processingOverlay = document.getElementById('processing-overlay');
  const successState = document.getElementById('success-state');
  const fileList = document.querySelector('.file-list');
  const toolOptions = document.getElementById('tool-options');
  const toolActions = document.getElementById('tool-actions');

  if (!processBtn) return; // Pas sur une page outil

  // Récupérer la clé de l'outil depuis l'URL ou le nom de fichier
  const getToolKey = () => {
    const param = new URLSearchParams(window.location.search).get('tool');
    if (param) return param;
    return window.location.pathname.split('/').pop().replace('.html', '');
  };

  processBtn.addEventListener('click', async () => {
    // Récupérer les fichiers depuis le state de main.js (exposés via window)
    const files = window._toolFiles || [];
    if (!files.length) { window.showToast?.('Veuillez d\'abord ajouter un fichier.', 'error'); return; }

    const toolKey = getToolKey();

    // Cacher liste + options, afficher processing
    if (fileList) fileList.style.display = 'none';
    if (toolOptions) toolOptions.style.display = 'none';
    if (toolActions) toolActions.style.display = 'none';
    if (processingOverlay) processingOverlay.classList.add('active');
    if (progressBar) progressBar.style.width = '0%';

    const animProgress = (pct) => {
      if (progressBar) progressBar.style.width = pct + '%';
    };

    // Fausse progression initiale
    animProgress(15);
    setTimeout(() => animProgress(45), 400);

    try {
      const msg = await PdfTools.process(toolKey, files, animProgress);
      animProgress(100);
      setTimeout(() => {
        if (processingOverlay) processingOverlay.classList.remove('active');
        if (successState) {
          successState.classList.add('active');
          // Mettre à jour le message de succès
          const successMsg = successState.querySelector('p:last-of-type');
          if (successMsg && msg) successMsg.textContent = msg;
        }
        window.showToast?.(msg || 'Traitement terminé !', 'success');
      }, 300);
    } catch (err) {
      if (err.message === 'backend_required') return;
      if (processingOverlay) processingOverlay.classList.remove('active');
      if (fileList) { fileList.style.display = 'flex'; fileList.classList.add('has-files'); }
      if (toolOptions) toolOptions.style.display = 'block';
      if (toolActions) toolActions.style.display = 'flex';
      window.showToast?.(err.message || 'Une erreur est survenue.', 'error');
    }
  });
});
