/* rt-tracker.js - tracker RedTrack STANDALONE.
 *
 * Hospedado no R2 (URL estavel: https://w2n.dev/rt/v1.js). Editar o arquivo e
 * subir de novo propaga para TODAS as paginas sem re-paste.
 *
 * Colar em qualquer pagina (nossa, Atomicat original, ou de terceiro):
 *
 *   <script src="https://w2n.dev/rt/v1.js" defer></script>
 *
 * ...e ele se vira sozinho: acha o player VTurb, le o `config` do PROPRIO ELEMENTO
 * (pitchTime + pixels do painel) e dispara os postbacks nos tempos certos do VIDEO.
 *
 * A fonte e o elemento, e nao o player.js pela rede, porque `scripts.converteai.net`
 * NAO manda Access-Control-Allow-Origin: o `fetch` do player.js morre em CORS
 * ("TypeError: Failed to fetch") em pagina de outro dominio -- medido em producao.
 * O fetch continua no codigo apenas como reserva.
 *
 * Overrides opcionais na propria tag (so quando a auto-deteccao nao servir - por
 * exemplo pitch diferente do configurado no VTurb, ou pagina sem player):
 *
 *   <script src="https://w2n.dev/rt/v1.js" defer
 *           data-pitch="63:10"                      <- pitch: "mm:ss", "hh:mm:ss" ou segundos
 *           data-domain="rtk.goodnewsforyou.online" <- dominio de tracking RedTrack
 *           data-page="glucozen-hero"               <- id da pagina (rollout + analytics)
 *           data-events="pageview,play,minute,pitch,cta"></script>
 *
 * Tambem le window.__RT__ = {...} e window.__ADP__ = {...} (paginas do pipeline).
 *
 * QA: `window.__RT_TRACKER__` no console mostra o que ele resolveu (pitch, de onde
 * veio, eventos ativos, clickid, o que ja disparou). `?rt_debug=1` na URL loga
 * cada postback.
 *
 * Eventos enviados - nomes CASE-SENSITIVE, iguais aos Conversion types ja
 * cadastrados na conta (Tools > Conversion tracking > Conversion types):
 *
 *   PageView         load da pagina                  1x por clickid
 *   VSLPlay          1s de VIDEO assistido           1x por clickid
 *   VSL1min          60s de VIDEO assistido          1x por clickid
 *   VSLPitch         segundo do pitch (oferta abre)  1x por clickid
 *   PageButtonClick  clique em botao de compra/CTA   TODOS os cliques
 *
 * Dedup: o RedTrack ignora postback repetido do mesmo clickid, a menos que o
 * modo do tipo seja "Ignore duplicate postbacks by event id" - ai ele compara o
 * `rdtk_event_id`. Entao:
 *   - eventos 1x       -> event id ESTAVEL (clickid:tipo) => repetido e ignorado
 *                         mesmo com localStorage limpo, 2 abas ou volta no dia seguinte.
 *   - PageButtonClick  -> event id UNICO por clique => cada clique entra como um
 *                         registro, que e o objetivo (comparar com o InitiateCheckout
 *                         que vem por S2S e achar o que se perde no caminho).
 * Os 5 tipos precisam estar em "Ignore duplicate postbacks by event id".
 */
(function () {
  'use strict';

  // guard: nunca roda duas vezes na mesma pagina (engine + paste manual, etc.).
  // O objeto tambem e o painel de QA: abra o console e digite __RT_TRACKER__
  // para ver a config que ELE resolveu (pitch detectado, eventos, clickid...).
  if (window.__RT_TRACKER__) return;
  var ST = window.__RT_TRACKER__ = { v: 1, sent: [] };

  // ---------------------------------------------------------------- rollout
  // Onde o tracker esta ATIVO e QUAIS eventos ele manda ali. Vive AQUI, no
  // arquivo do R2 -> ligar/desligar pagina e um deploy do tracker, sem tocar em
  // nenhuma landing.
  //   chave  : pageId (window.__ADP__.pageId ou data-page). '*' = default das nao listadas
  //   valor  : '*' (todos os eventos) | 'pageview,play,minute,pitch,cta' | null/ausente (desligado)
  //
  // ATENCAO: o pixel do VTurb ja manda VSLPlay/VSLPitch nos players onde esta
  // ligado, com ESTES MESMOS nomes. Ligar o evento aqui sem desligar o pixel de
  // la = evento contado duas vezes. Por isso o rollout comeca assim:
  //   - cbs-nd-hero-c2b : player com pixels DESLIGADOS -> tracker manda tudo
  //   - demais          : pixel ainda manda VSLPlay -> aqui so o que falta la
  // Conforme desligar cada pixel no painel do VTurb, troque a linha por '*'.
  var ROLLOUT = {
    'cbs-nd-hero-c2b': '*',
    'mpr-hero-1': 'pageview,minute,pitch,cta',
    'mpr-vsl-1': 'pageview,minute,pitch,cta',
    'cbs-spy-cognizil-1': 'pageview,minute,pitch,cta',
    'cbs-spy-neurotyde-1': 'pageview,minute,pitch,cta',
    'cbs-spy-neurotyde-c2': 'pageview,minute,pitch,cta',
    // ironwood: play LIGADO no tracker (player novo SEM Pixel RedTrack no painel VTurb --
    // nao configurar o Pixel la tambem, senao VSLPlay conta 2x)
    'dtc-ironwood-1': 'pageview,play,minute,pitch,cta',
    'dtc-vigorox-1': 'pageview,play,minute,pitch,cta',
    'dtc-vigorox-2': 'pageview,play,minute,pitch,cta',
    // glucozen HERO servida pela VERCEL (projeto adp-sales-pages-manager), fora do
    // Atomicat. play/pitch em modo AUTO ('?'): enquanto o player 6a61acc0 tiver os Pixels
    // no painel do VTurb (VSLPlay @1s, VSLPitch @3623s), o tracker NAO manda -- nao duplica.
    // Assim que os Pixels sairem de la, ele assume sozinho, e ai o VSLPitch passa a sair no
    // pitch do PLAYER (3790s hoje) em vez dos 3623s digitados a mao, que estao 2:47
    // adiantados e nao acompanham o teste A/B de velocidade do VTurb.
    'glz-hero-vc1': 'pageview,play?,minute,pitch?,cta',
    // clone da anterior testando o modo NO-REDIRECT do RedTrack (universal script com a
    // campanha embutida, trafego chegando sem ?cid na URL). Mesmos eventos, pra dar pra
    // comparar os dois modos lado a lado.
    'glz-hero-vc1-nr': 'pageview,play?,minute,pitch?,cta',
    // clone com checkout CartPanda e a VSL 2.0 (player [CP], pitch 3826s). Mesmo esquema:
    // play/pitch em AUTO, porque este player tambem tem os dois Pixels no painel do VTurb.
    'glz-hero-cp': 'pageview,play?,minute,pitch?,cta',
    // irma da anterior: VSL reeditada (pitch 3217s) e outro afiliado no CartPanda.
    'glz-hero-cp1': 'pageview,play?,minute,pitch?,cta',
    // mesma VSL da _cp (player clone [HW]), checkout H&W v2 no cc.getglucozen.
    'glz-hero-hw2': 'pageview,play?,minute,pitch?,cta',
    // clone H&W v2 com a VSL William Li (pitch real 3193s). O player herdou Pixels
    // VSLPlay @1s e VSLPitch @3623s; AUTO evita duplicar e assume quando sairem do painel.
    'glz-wl-hw2': 'pageview,play?,minute,pitch?,cta',
    // mesma VSL William Li (pitch 3193s), produto GLYCOEDEN e checkout Digistore24. Player
    // proprio, com os mesmos Pixels herdados (@1s e @3623s) -> AUTO tambem aqui.
    'gly-wl-ds24': 'pageview,play?,minute,pitch?,cta',
  };

  var DEFAULT_DOMAIN = 'zgxlp.ttrk.io'; // dominio default RedTrack (fallback)
  var EVENT = { pageview: 'PageView', play: 'VSLPlay', minute: 'VSL1min', pitch: 'VSLPitch', cta: 'PageButtonClick' };
  var PLAY_AT = 1;      // segundos de video que contam como "deu play"
  var MINUTE_AT = 60;   // retencao do primeiro minuto
  var TTL_MS = 30 * 24 * 3600 * 1000;

  // ---------------------------------------------------------------- config
  var TAG = document.currentScript || document.querySelector('script[src*="/rt/v"]');
  function attr(n, d) { try { var v = TAG && TAG.getAttribute('data-' + n); return (v == null || v === '') ? d : v; } catch (e) { return d; } }
  var RT = window.__RT__ || {}, ADP = window.__ADP__ || {};

  // pitch aceita segundos (3620) ou relogio ("1:00:20", "63:10") - o mesmo jeito
  // que a gente le o tempo do pitch na VSL.
  function toSeconds(v) {
    if (v == null || v === '') return 0;
    var s = String(v).trim();
    if (/^\d+$/.test(s)) return +s;
    var p = s.split(':').map(Number);
    if (p.some(isNaN)) return 0;
    if (p.length === 2) return p[0] * 60 + p[1];
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    return 0;
  }

  var CFG = {
    domain: String(attr('domain', RT.domain || ADP.rtDomain || DEFAULT_DOMAIN)).replace(/^https?:\/\//, '').replace(/\/$/, ''),
    pageId: String(attr('page', RT.pageId || ADP.pageId || location.pathname)),
    pitch: toSeconds(attr('pitch', RT.pitchSeconds || ADP.pitchSeconds || 0)),
  };
  var DEBUG = /[?&]rt_debug=1/.test(location.search);
  function log() { if (DEBUG) try { console.log.apply(console, ['[rt]'].concat([].slice.call(arguments))); } catch (e) {} }

  // eventos ativos = o que o ROLLOUT libera para a pagina, restringido pelo
  // data-events da tag (a tag so pode tirar, nunca ligar o que o rollout nao deu).
  // Sufixo '?' num evento = modo AUTO: manda so se o Pixel do VTurb NAO estiver mandando
  // o mesmo evento (ex.: 'pitch?'). O tracker descobre isso lendo os pixels do player.js,
  // entao ligar/desligar o Pixel no painel do VTurb passa a valer sozinho, sem re-deploy e
  // sem janela de contagem dupla. Use quando o Pixel for sair do painel: deixa 'pitch?' aqui
  // e, no instante em que o Pixel some de la, o tracker assume -- no tempo do PLAYER, que e
  // dinamico (o tempo do Pixel e digitado a mao e nao acompanha teste A/B de velocidade).
  var ALL = ['pageview', 'play', 'minute', 'pitch', 'cta'];
  var AUTO = {};
  function list(v) {
    return String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      .map(function (s) {
        if (s.slice(-1) === '?') { var n = s.slice(0, -1); AUTO[n] = true; return n; }
        return s;
      });
  }
  var allow = (ROLLOUT[CFG.pageId] != null) ? ROLLOUT[CFG.pageId] : ROLLOUT['*'];
  if (allow == null) return;                                  // pagina fora do rollout
  var EVENTS = (allow === '*') ? ALL.slice() : list(allow);
  var asked = attr('events', RT.events || null);
  if (asked) EVENTS = list(asked).filter(function (e) { return EVENTS.indexOf(e) >= 0; });
  function on(name) { return EVENTS.indexOf(name) >= 0; }
  if (!EVENTS.length) return;
  ST.pageId = CFG.pageId; ST.domain = CFG.domain; ST.events = EVENTS;

  // ---------------------------------------------------------------- click id
  // UMA fonte de verdade (o codigo antigo tinha 5 ordens diferentes). Le a URL,
  // depois o nosso cookie, depois o do universal script do RedTrack (se existir).
  var URL_KEYS = ['cid', 'rtkcid', 'rtkupdclickid', 'tid', 'subid', 'sub_id', 'clickid'];
  var OWN_COOKIE = '_adp_cid';

  function getCookie(n) {
    try { var m = document.cookie.match(new RegExp('(^| )' + n + '=([^;]+)')); return m ? decodeURIComponent(m[2]) : null; } catch (e) { return null; }
  }
  function setCookie(n, v) {
    try {
      var exp = new Date(Date.now() + TTL_MS).toUTCString();
      var sec = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = n + '=' + encodeURIComponent(v) + '; expires=' + exp + '; path=/; SameSite=Lax' + sec;
    } catch (e) {}
  }
  // Macro NAO substituido ("{clickid}", "%7Bclickid%7D") NAO e clickid: e o que sobra numa
  // URL que nao passou por quem deveria preencher (link de anuncio colado na mao, macro
  // errado no painel). Aceitar isso e pior que nao ter clickid -- vira postback com
  // "{clickid}", cookie envenenado e, no modo no-redirect, faz o universal script achar que
  // ja tem clickid e nem chamar a campanha. Medido na _noredirect.
  function realId(v) { return (v && String(v).trim() && !/[{}]|%7[bd]/i.test(v)) ? String(v).trim() : null; }
  var CID = (function () {
    var v = null;
    try {
      var p = new URLSearchParams(location.search);
      for (var i = 0; i < URL_KEYS.length; i++) { var x = realId(p.get(URL_KEYS[i])); if (x) { v = x; break; } }
    } catch (e) {}
    if (!v) v = realId(getCookie(OWN_COOKIE)) || realId(getCookie('rtkclickid-store'));
    // persiste: sem isto o clickid vive so na query string e some no primeiro
    // reload/volta pelo historico -> atribuicao perdida em silencio.
    if (v) setCookie(OWN_COOKIE, v);
    return v;
  })();
  ST.clickid = CID;

  // ---------------------------------------------------------------- envio
  function firedKey(type) { return '_rt_' + type + '_' + (CID || ''); }
  function alreadyFired(type) {
    try { var t = localStorage.getItem(firedKey(type)); return !!t && (Date.now() - +t) < TTL_MS; } catch (e) { return false; }
  }
  function markFired(type) { try { localStorage.setItem(firedKey(type), String(Date.now())); } catch (e) {} }

  // espelho no PostHog quando a pagina tiver (nao cria dependencia): e daqui que
  // sai a metrica de vazamento - quantos visitantes chegam SEM clickid.
  function mirror(type, props) {
    try {
      if (window.posthog && posthog.capture) {
        var b = { rt_type: type, has_clickid: !!CID, page_id: CFG.pageId };
        if (props) for (var k in props) b[k] = props[k];
        posthog.capture('rt_postback', b);
      }
    } catch (e) {}
  }

  var seq = 0;
  function send(type, opts) {
    opts = opts || {};
    if (!CID) { mirror(type, { sent: false, reason: 'no_clickid' }); return; }
    if (!opts.dup && alreadyFired(type)) { mirror(type, { sent: false, reason: 'deduped' }); return; }

    // rdtk_event_id sempre presente (modo "Ignore duplicate postbacks by event id"):
    //   estavel  -> RedTrack ignora o repetido, mesmo com storage limpo/2 abas
    //   unico    -> cada clique no botao entra como um registro proprio
    var eid = opts.dup
      ? CID + ':' + type + ':' + Date.now().toString(36) + '-' + (++seq)
      : CID + ':' + type;

    var url = 'https://' + CFG.domain + '/postback?clickid=' + encodeURIComponent(CID) +
      '&type=' + encodeURIComponent(type) + '&format=img' +
      '&rdtk_event_id=' + encodeURIComponent(eid);

    var ok = false;
    try { var img = new Image(); img.src = url; ok = true; } catch (e) {}       // GET classico, sem CORS
    if (!ok) { try { ok = !!(navigator.sendBeacon && navigator.sendBeacon(url)); } catch (e) {} }
    if (!ok) { try { fetch(url, { mode: 'no-cors', keepalive: true }); ok = true; } catch (e) {} }

    if (!opts.dup) markFired(type);
    mirror(type, { sent: ok, dup: !!opts.dup, event_id: eid });
    ST.sent.push(type);
    log('->', type, url);
  }

  // ---------------------------------------------------------------- LP view
  // O `/view` e a metrica NATIVA de "visualizacao da landing" do RedTrack -- coisa
  // DIFERENTE do postback `type=PageView`, que e uma conversao. Quem mandava isso era o
  // universal script (`<dominio>/track.js`), removido das paginas porque, alem de pesar,
  // podia gerar clickid a toa. A metrica em si e util, entao ela vem pra ca: mesma chamada,
  // sem script de terceiro e sem risco de criar clique.
  // 1x por clickid (o markFired/alreadyFired ja cuida disso).
  function sendLpView() {
    if (!CID || alreadyFired('LPView')) return;
    var url = 'https://' + CFG.domain + '/view?clickid=' + encodeURIComponent(CID);
    var ok = false;
    try { var img = new Image(); img.src = url; ok = true; } catch (e) {}
    if (!ok) { try { ok = !!(navigator.sendBeacon && navigator.sendBeacon(url)); } catch (e) {} }
    if (!ok) { try { fetch(url, { mode: 'no-cors', keepalive: true }); ok = true; } catch (e) {} }
    markFired('LPView');
    mirror('LPView', { sent: ok, native_view: true });
    log('-> LP view', url);
  }

  // ---------------------------------------------------------------- PageView
  if (on('pageview')) { send(EVENT.pageview); sendLpView(); }

  // MODO NO-REDIRECT: sem redirecionador, o clickid NAO vem na URL -- o universal script
  // chama o RedTrack, recebe o clickid e so ENTAO grava o cookie, depois deste arquivo ja
  // ter rodado. Sem esperar, a pagina inteira ficaria sem postback ('no_clickid'). Observa
  // o cookie por ~15s e, quando o clickid aparecer, refaz o PageView e segue normal (os
  // eventos de video usam CID na hora de enviar, entao pegam o valor novo sozinhos).
  if (!CID) {
    var lateTries = 0;
    var latePoll = setInterval(function () {
      var v = realId(getCookie(OWN_COOKIE)) || realId(getCookie('rtkclickid-store'));
      if (v) {
        clearInterval(latePoll);
        CID = v; ST.clickid = CID; ST.clickidLate = lateTries * 300;
        setCookie(OWN_COOKIE, v);
        log('clickid chegou depois (' + (lateTries * 300) + 'ms):', v);
        if (on('pageview')) { send(EVENT.pageview); sendLpView(); }
      } else if (++lateTries > 50) clearInterval(latePoll);
    }, 300);
  }

  // ---------------------------------------------------------------- CTA click
  // Sem dedup de proposito: o objetivo e contar QUANTOS cliques houve, para
  // comparar com o InitiateCheckout que vem por S2S da plataforma.
  if (on('cta')) {
    // CFG.domain + '/click' = OFFER CLICK do RedTrack: o botao aponta pro proprio tracker
    // (ex.: zgxlp.ttrk.io/click/2), que registra o clique na oferta e redireciona pro
    // checkout. Sem isto, pagina nesse flow nao dispararia PageButtonClick -- o href nao
    // parece checkout nenhum. Montado a partir do dominio configurado, entao vale tambem
    // pra quem usa dominio de tracking proprio (rtk.goodnewsforyou.online etc.).
    var CHECKOUT = ['clickbank.net', '/hop/', 'buygoods', 'digistore24', 'ds24', 'cartpanda', 'checkout', 'jvz', 'pay.', CFG.domain + '/click'];
    function isCta(el) {
      if (!el || !el.closest) return false;
      var a = el.closest('a[href]');
      if (a) {
        var h = (a.href || '').toLowerCase();
        for (var i = 0; i < CHECKOUT.length; i++) if (h.indexOf(CHECKOUT[i]) >= 0) return true;
        if (a.hasAttribute('data-cta')) return true;
      }
      if (el.closest('.smartplayer-anchor-button')) return true;   // botao do proprio player
      var b = el.closest("button, [role='button'], input[type='submit'], .buylink, .vc-offer");
      if (b && /\b(buy|get|order|claim|now|add to cart)\b/i.test((b.textContent || b.value || ''))) return true;
      return false;
    }
    var lastClick = 0;
    function onCta(e) {
      var now = Date.now();
      if (now - lastClick < 400) return; // so anti-duplo-evento (click+touchend), nao anti-clique
      if (!isCta(e.target)) return;
      lastClick = now;
      send(EVENT.cta, { dup: true });
    }
    document.addEventListener('click', onCta, true);
    document.addEventListener('auxclick', function (e) { if (e.button === 1) onCta(e); }, true);
    document.addEventListener('touchend', onCta, true);
  }

  // ---------------------------------------------------------------- video
  if (!(on('play') || on('minute') || on('pitch'))) return;

  // Descobre o pitch: config explicita > player.js do ConverteAI (a pagina ja
  // baixou esse arquivo, entao o fetch sai do cache) > desiste do VSL_Pitch.
  function playerScriptSrc() {
    var s = document.querySelector('script[src*="scripts.converteai.net"][src*="/players/"]');
    if (s && s.src) return s.src;
    // fallback: monta a URL a partir do id do elemento, se a conta estiver em algum script da pagina
    var el = document.querySelector('vturb-smartplayer');
    var pid = el && (el.id || '').replace(/^vid-/, '');
    var any = document.documentElement.innerHTML.match(/scripts\.converteai\.net\/([a-f0-9-]{20,})\//);
    if (pid && any) return 'https://scripts.converteai.net/' + any[1] + '/players/' + pid + '/v4/player.js';
    return null;
  }
  // Pixels do VTurb configurados NO PAINEL (por player). Vem no mesmo player.js, como
  // {dispatchIn:<segundos>, dispatchType:"time", customHtml:<base64 de um <script> que
  // dispara o postback>}. Decodificando o base64 da pra saber QUAL type ele manda e QUANDO
  // -- e ai o tracker sabe de quem e a responsabilidade de cada evento.
  function parsePixels(t) {
    var out = {}, dec = (typeof atob === 'function') ? atob : null;
    if (!dec) return out;
    try {
      // customHtml pode vir entre aspas ou crase, dependendo de como o VTurb serializa
      var re = /dispatchIn:(\d+)[\s\S]{0,120}?customHtml:(["'`])([\s\S]*?)\2/g, m;
      while ((m = re.exec(t))) {
        var secs = +m[1], html = '';
        try { html = dec(m[3].replace(/\s+/g, '')); } catch (e) { continue; }
        var ty = html.match(/type=([A-Za-z0-9_]+)/);
        if (ty) out[ty[1]] = secs;
      }
    } catch (e) {}
    return out;
  }
  // FONTE PRIMARIA: o proprio elemento <vturb-smartplayer>, que expoe `config` com
  // pitchTime E pixels ja desserializados. Sem rede, sem CORS -- e o `scripts.converteai.net`
  // NAO manda Access-Control-Allow-Origin, entao o fetch do player.js falha
  // ("TypeError: Failed to fetch") em pagina de outro dominio. Ele fica como reserva porque
  // ainda serve onde o elemento demora ou nao existe.
  function readFromElement() {
    try {
      var el = document.querySelector('vturb-smartplayer');
      var c = el && el.config;
      if (!c) return null;
      var out = { pitch: Number(c.pitchTime) || 0, pixels: {} };
      var px = c.pixels;
      // pixels.active=false = desligado no painel -> vale como "nao tem pixel"
      if (px && px.active && px.items && px.items.length) {
        var dec = (typeof atob === 'function') ? atob : null;
        for (var i = 0; i < px.items.length; i++) {
          var it = px.items[i];
          if (!it || it.dispatchType !== 'time' || !dec) continue;
          var html = '';
          try { html = dec(String(it.customHtml || '').replace(/\s+/g, '')); } catch (e) { continue; }
          var ty = html.match(/type=([A-Za-z0-9_]+)/);
          if (ty) out.pixels[ty[1]] = Number(it.dispatchIn);
        }
      }
      return out;
    } catch (e) { return null; }
  }
  function detectPlayer(cb) {
    var tries = 0;
    (function poll() {
      var el = readFromElement();
      if (el) {
        ST.playerSource = 'elemento vturb-smartplayer';
        return cb(CFG.pitch > 0 ? CFG.pitch : el.pitch, el.pixels);
      }
      // So espera se o elemento EXISTE e ainda nao tem config (player bootando). Pagina sem
      // player nenhum (advertorial so texto) nao tem o que esperar -- vai direto pro fim.
      if (document.querySelector('vturb-smartplayer') && ++tries < 30) return setTimeout(poll, 400);
      // reserva: player.js pela rede (costuma falhar por CORS, mas nao custa tentar)
      var src = playerScriptSrc();
      if (!src || typeof fetch !== 'function') return cb(CFG.pitch || 0, null);
      fetch(src)
        .then(function (r) { return r.text(); })
        .then(function (t) {
          var m = t.match(/pitchTime:(\d+)/);
          ST.playerSource = 'player.js (fetch)';
          cb(CFG.pitch > 0 ? CFG.pitch : (m ? +m[1] : 0), parsePixels(t));
        })
        .catch(function () { ST.playerSource = 'nao lido (CORS/sem player)'; cb(CFG.pitch || 0, null); });
    })();
  }

  // Agenda um callback num segundo do VIDEO. Primario: player.onTime() NATIVO do
  // VTurb (mesmo agendador do displayHiddenElements). Reserva: poll do <video>.
  var scheduled = [];
  function atVideoTime(sec, cb) {
    if (!(sec > 0)) return;
    scheduled.push({ at: sec, cb: cb, done: false });
  }
  function armNative() {
    var el = document.querySelector('vturb-smartplayer');
    if (!el || typeof el.onTime !== 'function') return false;
    try {
      scheduled.forEach(function (s) {
        el.onTime(s.at, function () { if (!s.done) { s.done = true; s.cb(); } }, { once: true });
      });
      return true;
    } catch (e) { return false; }
  }
  function startVideoWatch() {
    var tries = 0, armed = false;
    (function tryArm() {
      if (!armed) armed = armNative();
      if (!armed && ++tries < 150) setTimeout(tryArm, 400);
    })();
    // reserva (roda sempre, idempotente): pega tambem o resume de quem volta
    var poll = setInterval(function () {
      try {
        var sp = window.smartplayer;
        var v = sp && sp.instances && sp.instances[0] && sp.instances[0].video;
        var t = v && v.currentTime;
        if (!(t > 0)) return;
        var pend = 0;
        scheduled.forEach(function (s) { if (!s.done && t >= s.at) { s.done = true; s.cb(); } if (!s.done) pend++; });
        if (!pend) clearInterval(poll);
      } catch (e) {}
    }, 1000);
  }

  detectPlayer(function (pitch, pixels) {
    ST.pitch = pitch;
    ST.pitchSource = CFG.pitch > 0 ? 'config (data-pitch/__ADP__)' : (pitch ? (ST.playerSource || 'player do VTurb') : 'nao encontrado');
    ST.vturbPixels = pixels;                                    // QA: o que o painel manda
    log('pitch =', pitch, 's via', ST.pitchSource, '| eventos:', EVENTS.join(','), '| clickid:', CID || '(nenhum)');

    // O Pixel do VTurb ja manda este evento? Entao o tracker fica quieto -- so vale para
    // evento marcado com '?' no rollout (os demais seguem o que esta escrito la).
    function pixelHandles(name, type) {
      if (!AUTO[name]) return false;
      if (!pixels || pixels[type] == null) return false;
      mirror(type, { sent: false, reason: 'pixel_do_vturb_ativo', pixel_at: pixels[type] });
      log(type, 'nao enviado: Pixel do VTurb ja manda em', pixels[type] + 's');
      return true;
    }
    // O tempo do Pixel e digitado a mao no painel e nao acompanha o pitch do player --
    // quando os dois discordam, quem esta certo e o player (fonte do reveal da oferta).
    if (pixels && pixels[EVENT.pitch] != null && pitch > 0 && Math.abs(pixels[EVENT.pitch] - pitch) > 5) {
      ST.warn = 'Pixel VSLPitch do painel dispara em ' + pixels[EVENT.pitch] + 's, mas o pitch do player e ' + pitch + 's';
      log('AVISO:', ST.warn);
    }

    if (on('play') && !pixelHandles('play', EVENT.play)) atVideoTime(PLAY_AT, function () { send(EVENT.play); });
    if (on('minute')) atVideoTime(MINUTE_AT, function () { send(EVENT.minute); });
    if (on('pitch') && !pixelHandles('pitch', EVENT.pitch)) {
      if (pitch > 0) atVideoTime(pitch, function () { send(EVENT.pitch); });
      else mirror(EVENT.pitch, { sent: false, reason: 'pitch_desconhecido' });
    }
    startVideoWatch();
  });
})();
