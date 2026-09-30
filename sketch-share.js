// Save / Print / Share buttons for a customer's sketch (Scott 2026-09-30:
// "a simple download and print and share button next to the sketch").
// One file, used by the sketch page and the customer dashboard:
//   <div data-sketch-share="<HubSpot deal id>"></div>  +  SketchShare.mountAll()
// Only the sketch picture ever leaves: /api/sketch-file refuses files with
// internal pages, and never sends prices or order details.
(function () {
  if (window.SketchShare) return;
  var BASE = 'https://sketch-review.vercel.app';
  var fileUrl = function (id, dl) { return BASE + '/api/sketch-file?dealId=' + encodeURIComponent(id) + (dl ? '&dl=1' : ''); };
  var printUrl = function (id) { return BASE + '/print.html?dealId=' + encodeURIComponent(id); };

  var CSS = '' +
    '.sks{margin:14px 0 4px;font-family:inherit}' +
    '.sks-row{display:flex;gap:8px;flex-wrap:wrap}' +
    '.sks-btn{flex:1 1 0;min-width:92px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1.5px solid #d9d1c5;background:#fff;color:#14201b;border-radius:999px;padding:9px 14px;font:600 15px/1 -apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
    '.sks-btn:hover{border-color:#0f7a52;color:#0b5d3f}' +
    '.sks-btn:focus-visible{outline:3px solid rgba(15,122,82,.35);outline-offset:2px}' +
    '.sks-btn[disabled]{opacity:.5;cursor:default}' +
    '.sks-btn svg{flex:none}' +
    '.sks-note{margin:7px 2px 0;font:13px/1.45 -apple-system,"Segoe UI",Roboto,sans-serif;color:#77706a}' +
    '.sks-msg{margin:8px 2px 0;font:14px/1.45 -apple-system,"Segoe UI",Roboto,sans-serif;color:#14201b}' +
    '.sks-msg a{color:#0b5d3f;font-weight:600}' +
    '.sks-msg.err{color:#a8251a}' +
    '.sks-sheet{margin-top:10px;border:1px solid #e8e1d6;background:#fffdf9;border-radius:14px;padding:14px}' +
    '.sks-sheet h4{margin:0 0 4px;font:700 15px -apple-system,"Segoe UI",Roboto,sans-serif;color:#14201b}' +
    '.sks-sheet p{margin:0 0 10px;font:13px/1.45 -apple-system,"Segoe UI",Roboto,sans-serif;color:#77706a}' +
    '.sks-sheet .sks-row a,.sks-sheet .sks-row button{text-decoration:none}' +
    '.sks-close{float:right;border:0;background:none;font-size:22px;line-height:1;color:#77706a;cursor:pointer;padding:0 2px;min-width:32px;min-height:32px}';

  var ICON = {
    save: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>',
    print: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
    share: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>'
  };

  function css() {
    if (document.getElementById('sks-css')) return;
    var s = document.createElement('style'); s.id = 'sks-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function mount(el) {
    if (!el || el.getAttribute('data-sks-ready')) return;
    var id = String(el.getAttribute('data-sketch-share') || '').trim();
    if (!/^\d{6,15}$/.test(id)) return;
    el.setAttribute('data-sks-ready', '1');
    css();
    el.innerHTML = '<div class="sks" role="group" aria-label="Save, print or share the sketch">' +
      '<div class="sks-row">' +
        '<button type="button" class="sks-btn" data-a="save" disabled>' + ICON.save + 'Save</button>' +
        '<button type="button" class="sks-btn" data-a="print" disabled>' + ICON.print + 'Print</button>' +
        '<button type="button" class="sks-btn" data-a="share" disabled>' + ICON.share + 'Share</button>' +
      '</div>' +
      '<p class="sks-note">Checking the sketch file&hellip;</p>' +
      '<div class="sks-msg" role="status" aria-live="polite"></div>' +
      '<div class="sks-sheet" hidden></div>' +
    '</div>';
    var root = el.firstChild, note = root.querySelector('.sks-note'), msg = root.querySelector('.sks-msg'), sheet = root.querySelector('.sks-sheet');
    var btns = root.querySelectorAll('.sks-btn');
    var info = null, blob = null;

    function say(html, isErr) { msg.className = 'sks-msg' + (isErr ? ' err' : ''); msg.innerHTML = html || ''; }
    function enable(on) { for (var i = 0; i < btns.length; i++) btns[i].disabled = !on; }

    function check() {
      note.textContent = 'Checking the sketch file…'; say('');
      fetch(fileUrl(id) + '&check=1').then(function (r) { return r.json().catch(function () { return { ok: false, reason: 'unavailable' }; }); }).then(function (j) {
        if (j && j.ok) {
          info = j; enable(true);
          getBlob().catch(function () {});   // fetch now: iPhones only allow the share menu right after a tap, not after a wait
          note.textContent = j.kind === 'pdf' ? 'Save, print or share the sketch file. It has no prices on it.' : 'Save, print or share the sketch picture. It has no prices on it.';
        } else if (j && j.reason === 'no_sketch') {
          root.parentNode && (el.innerHTML = '');   // nothing to share yet: show nothing
        } else if (j && j.reason === 'not_shareable') {
          enable(false); note.textContent = '';
          say('This sketch file can’t be shared from here. Email <a href="mailto:support@showoffinc.com">support@showoffinc.com</a> and Erica will send you a copy you can share.');
        } else {
          enable(false); note.textContent = '';
          say('Saving and sharing aren’t working right now. <a href="#" data-retry="1">Try again</a>', true);
        }
      }).catch(function () {
        enable(false); note.textContent = '';
        say('Saving and sharing aren’t working right now. <a href="#" data-retry="1">Try again</a>', true);
      });
    }

    function getBlob() {
      if (blob) return Promise.resolve(blob);
      return fetch(fileUrl(id)).then(function (r) { if (!r.ok) throw new Error('file ' + r.status); return r.blob(); }).then(function (b) { if (!b || !b.size) throw new Error('empty'); blob = b; return b; });
    }

    function doSave() {
      say('Getting the file…');
      getBlob().then(function (b) {
        var a = document.createElement('a'); var u = URL.createObjectURL(b);
        a.href = u; a.download = info.name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
        say('Saved to your Downloads. Don’t see it? <a href="' + esc(fileUrl(id)) + '" target="_blank" rel="noopener">Open the ' + (info.kind === 'pdf' ? 'file' : 'picture') + '</a>' + (info.kind === 'pdf' ? ' and save it from there.' : ', then press and hold it (or right-click it) to save.'));
      }).catch(function () {
        window.open(fileUrl(id, true), '_blank');
        say('If nothing downloaded, <a href="' + esc(fileUrl(id)) + '" target="_blank" rel="noopener">open the ' + (info.kind === 'pdf' ? 'file' : 'picture') + '</a> and save it from there.');
      });
    }

    function doPrint() {
      var w = window.open(printUrl(id), '_blank');
      if (!w) say('Your browser blocked the print window. <a href="' + esc(printUrl(id)) + '" target="_blank" rel="noopener">Open the print page</a>.');
      else say('The print page opened in a new tab.');
    }

    function openSheet() {
      var link = fileUrl(id);
      var subject = 'Costume sketch';
      var body = 'Here is the costume sketch:\n' + link;
      sheet.innerHTML = '<button type="button" class="sks-close" aria-label="Close">&times;</button>' +
        '<h4>Send the sketch</h4>' +
        '<p>The link opens only the sketch ' + (info.kind === 'pdf' ? 'file' : 'picture') + '. No prices, no other order details. Anyone you send it to can open it.</p>' +
        '<div class="sks-row">' +
          '<button type="button" class="sks-btn" data-a="copy">Copy link</button>' +
          '<a class="sks-btn" href="mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body) + '">Email</a>' +
          '<a class="sks-btn" href="sms:?&body=' + encodeURIComponent(body) + '">Text</a>' +
        '</div>';
      sheet.hidden = false;
      var c = sheet.querySelector('.sks-close'); c && c.focus();
    }

    function doShare() {
      say('');
      var canFiles = navigator.canShare && navigator.share;
      if (!canFiles) { openSheet(); return; }
      var go = function (b) {
        var type = info.kind === 'pdf' ? 'application/pdf' : info.kind === 'png' ? 'image/png' : 'image/jpeg';
        var file;
        try { file = new File([b], info.name, { type: type }); } catch (_) { openSheet(); return; }
        if (!navigator.canShare({ files: [file] })) { openSheet(); return; }
        navigator.share({ files: [file], title: 'Costume sketch' }).then(function () { say('Sent.'); }, function (e) {
          if (e && e.name === 'AbortError') return;   // they closed the share menu
          openSheet();
        });
      };
      if (blob) go(blob);   // same tap: the share menu is allowed
      else getBlob().then(go, function () { openSheet(); });
    }

    function copyLink() {
      var link = fileUrl(id);
      var done = function () { say('Link copied. Paste it into a text or an email.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function () { window.prompt('Copy this link:', link); });
      else window.prompt('Copy this link:', link);
    }

    root.addEventListener('click', function (e) {
      var r = e.target.closest('[data-retry]'); if (r) { e.preventDefault(); check(); return; }
      if (e.target.closest('.sks-close')) { sheet.hidden = true; return; }
      var b = e.target.closest('[data-a]'); if (!b || b.disabled || !info && b.getAttribute('data-a') !== 'copy') return;
      var a = b.getAttribute('data-a');
      if (a === 'save') doSave(); else if (a === 'print') doPrint(); else if (a === 'share') doShare(); else if (a === 'copy') copyLink();
    });
    root.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sheet.hidden) { sheet.hidden = true; } });
    check();
  }

  window.SketchShare = {
    mount: mount,
    mountAll: function (scope) { var n = (scope || document).querySelectorAll('[data-sketch-share]'); for (var i = 0; i < n.length; i++) mount(n[i]); }
  };
})();
