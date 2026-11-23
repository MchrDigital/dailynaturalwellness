(function(){
  var PING_URL="https://status.healthcleannow.us/api/live/presence";
  var INTERVAL=15000;
  var KEY='wave_live_sid';
  function sid(){
    try{
      var v=localStorage.getItem(KEY);
      if(!v){v=Math.random().toString(36).slice(2)+Date.now();localStorage.setItem(KEY,v);}
      return v;
    }catch(e){
      /* localStorage bloqueado (modo privado, cookie de terceiro): id por carregamento. A aba
         conta como uma pessoa enquanto estiver aberta, que é o comportamento desejado. */
      if(!window.__waveLiveSid)window.__waveLiveSid=Math.random().toString(36).slice(2)+Date.now();
      return window.__waveLiveSid;
    }
  }
  function body(){
    var q;
    try{q=new URLSearchParams(location.search);}catch(e){q=new URLSearchParams();}
    return JSON.stringify({
      sessionId:sid(),
      rtkcmpid:q.get('rtkcmpid')||q.get('cmpid')||'',
      pageUrl:location.href||'',
      path:location.pathname||'',
      referrer:document.referrer||''
    });
  }
  function ping(){
    try{
      fetch(PING_URL,{method:'POST',headers:{'Content-Type':'text/plain'},body:body(),keepalive:true,mode:'no-cors'}).catch(function(){});
    }catch(e){}
  }
  function beacon(){
    try{
      if(navigator.sendBeacon)navigator.sendBeacon(PING_URL,new Blob([body()],{type:'text/plain'}));
    }catch(e){}
  }
  ping();
  setInterval(ping,INTERVAL);
  document.addEventListener('visibilitychange',function(){
    if(document.visibilityState==='visible')ping();
    else beacon();
  });
})();