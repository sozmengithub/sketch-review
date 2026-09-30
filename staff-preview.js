// Staff preview (Scott 2026-09-29): Erica sees exactly what the customer sees,
// never counted, and nothing approves, requests changes or uploads from here.
//
// 2026-09-30: "&staff=1" alone is NOT enough any more. A staff link copied from the HubSpot card
// into a customer email turned off that customer's Approve button. Staff mode now also needs this browser to be a
// Show Off browser: the team password typed once (remembered on this device).
// A customer holding a staff link just gets the normal page with every button
// working. window.SO_STAFF is the one answer every script on the page reads.
(function(){
  var KEY='so_staff_ok', HASH='23ca53c7c3935c6db3adbf490c071c18b257af80f8187eaf5a5558b020674efb';
  var q=new URLSearchParams(location.search), asked=q.get('staff')==='1';
  var known=false; try{ known=localStorage.getItem(KEY)==='1'; }catch(e){}
  window.SO_STAFF = asked && known;

  function onReady(fn){ document.body ? fn() : document.addEventListener('DOMContentLoaded', fn); }
  function bar(html, bg, fg){ var b=document.createElement('div'); b.id='staffbar'; b.innerHTML=html; b.style.cssText='position:sticky;top:0;z-index:99999;background:'+bg+';color:'+fg+';font:600 13px -apple-system,Arial,sans-serif;text-align:center;padding:8px 12px'; onReady(function(){ document.body.insertBefore(b,document.body.firstChild); }); return b; }
  async function sha(s){ var d=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Array.from(new Uint8Array(d)).map(function(x){return x.toString(16).padStart(2,'0');}).join(''); }

  if(asked && !known){
    // Opened as the customer. Take the flag off the address so a bookmark or refresh stays clean.
    try{ q.delete('staff'); history.replaceState(null,'',location.pathname+(q.toString()?'?'+q.toString():'')+location.hash); }catch(e){}
    var b=bar('Show Off team? <a href="#" id="staffon" style="color:#0b5d3f">Turn on preview mode</a> (nothing you do will count or save).','#f1ede6','#3b423e');
    b.addEventListener('click', async function(e){
      if(!e.target.closest('#staffon')) return; e.preventDefault();
      var pw=window.prompt('Show Off team password:'); if(!pw) return;
      try{
        if(await sha(pw.trim())===HASH){ localStorage.setItem(KEY,'1'); q.set('staff','1'); location.replace(location.pathname+'?'+q.toString()+location.hash); }
        else alert('That password is not right.');
      }catch(err){ alert('Preview mode could not be turned on in this browser.'); }
    });
    return;
  }
  if(!window.SO_STAFF) return;

  var TXT='Staff preview: you see exactly what the customer sees. Not counted as them opening it; approve and change buttons do nothing.';
  var _f=window.fetch; window.fetch=function(u,o){ var m=String((o&&o.method)||'GET').toUpperCase(); if(m!=='GET'){ var s=document.getElementById('staffbar'); if(s){ s.textContent='Staff preview: nothing was sent.'; setTimeout(function(){ s.textContent=TXT; },3500); } return Promise.reject(new Error('Staff preview: nothing was sent.')); } return _f.apply(this,arguments); };
  var O=XMLHttpRequest.prototype.open, X=XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.open=function(m){ this._m=String(m||'GET').toUpperCase(); return O.apply(this,arguments); }; XMLHttpRequest.prototype.send=function(){ if(this._m&&this._m!=='GET') throw new Error('Staff preview: nothing was sent.'); return X.apply(this,arguments); };
  bar(TXT,'#1f2937','#fde68a');
})();
