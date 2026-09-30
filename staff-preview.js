// Staff preview (Scott 2026-09-29): Erica sees exactly what the customer sees,
// never counted, and nothing approves, requests changes or uploads from here.
(function(){ if(new URLSearchParams(location.search).get('staff')!=='1') return;
  var TXT='Staff preview: you see exactly what the customer sees. Not counted as them opening it; approve and change buttons do nothing.';
  var _f=window.fetch; window.fetch=function(u,o){ var m=String((o&&o.method)||'GET').toUpperCase(); if(m!=='GET'){ var b=document.getElementById('staffbar'); if(b){ b.textContent='Staff preview: nothing was sent.'; setTimeout(function(){ b.textContent=TXT; },3500); } return Promise.reject(new Error('Staff preview: nothing was sent.')); } return _f.apply(this,arguments); };
  var O=XMLHttpRequest.prototype.open, X=XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.open=function(m){ this._m=String(m||'GET').toUpperCase(); return O.apply(this,arguments); }; XMLHttpRequest.prototype.send=function(){ if(this._m&&this._m!=='GET') throw new Error('Staff preview: nothing was sent.'); return X.apply(this,arguments); };
  var b=document.createElement('div'); b.id='staffbar'; b.textContent=TXT; b.style.cssText='position:sticky;top:0;z-index:99999;background:#1f2937;color:#fde68a;font:600 13px -apple-system,Arial,sans-serif;text-align:center;padding:8px 12px';
  (document.body?document.body.insertBefore(b,document.body.firstChild):document.addEventListener('DOMContentLoaded',function(){document.body.insertBefore(b,document.body.firstChild);}));
})();
