/* engine-cbs.js — runtime hospedado no R2 (servido por w2n.dev).
 * Responsável por: PostHog (autocapture + heatmap + eventos VSL), heartbeat
 * (usuários ao vivo + dwell), reveal da oferta no pitch, e tagging dos links
 * de checkout com template/sub (atribuição que sobrevive ao redirect).
 *
 * Config vem de window.__ADP__ (definido inline na página) e window.__VARIANT__,
 * incluindo posthogKey/posthogHost (project key é PÚBLICA, client-side).
 * Carregar com `defer` DEPOIS do player (não bloqueia playrate).
 */
(function () {
  'use strict';
  var CFG = window.__ADP__ || {};
  var VARIANT = window.__VARIANT__ || document.documentElement.getAttribute('data-variant') || 'default';
  // TEMPLATE = identificador descritivo de atribuição (ex.: cbsnews-claude-light); fallback p/ variante curta
  var TEMPLATE = window.__TEMPLATE__ || VARIANT;
  var PAGE_ID = CFG.pageId || 'unknown';
  var PITCH = Number(CFG.pitchSeconds) || 0;
  var SUB_PARAM = CFG.subParam || 'sub17';
  // 'postback' (default): CTA tagging + postbacks RedTrack. 'forwarder': click-id forwarder novo.
  var TRACK_MODE = CFG.trackingMode || 'postback';
  var POSTHOG_KEY = CFG.posthogKey || '__POSTHOG_KEY__';
  var POSTHOG_HOST = CFG.posthogHost || 'https://us.i.posthog.com';

  // ---------- PostHog (snippet oficial) ----------
  !(function (t, e) { var o, n, p, r; e.__SV || (window.posthog = e, e._i = [], e.init = function (i, s, a) { function g(t, e) { var o = e.split('.'); 2 == o.length && (t = t[o[0]], e = o[1]), t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); }; } (p = t.createElement('script')).type = 'text/javascript', p.crossOrigin = 'anonymous', p.async = !0, p.src = s.api_host.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js', (r = t.getElementsByTagName('script')[0]).parentNode.insertBefore(p, r); var u = e; for (void 0 !== a ? u = e[a] = [] : a = 'posthog', u.people = u.people || [], u.toString = function (t) { var e = 'posthog'; return 'posthog' !== a && (e += '.' + a), t || (e += ' (stub)'), e; }, u.people.toString = function () { return u.toString(1) + '.people (stub)'; }, o = 'init capture register register_once unregister identify setPersonProperties reset group get_distinct_id get_session_id onFeatureFlags reloadFeatureFlags getFeatureFlag isFeatureEnabled startSessionRecording stopSessionRecording'.split(' '), n = 0; n < o.length; n++)g(u, o[n]); e._i.push([i, s, a]); }, e.__SV = 1); })(document, window.posthog || []);

  try {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      person_profiles: 'identified_only', // não cria profile p/ anônimo (custo)
      autocapture: true,
      capture_pageview: true,
      capture_heatmaps: true,            // heatmap = prioridade
      disable_session_recording: false, // replay LIGADO; controle de volume via sample rate no PostHog
    });
    posthog.register({ template: TEMPLATE, variant: VARIANT, page_id: PAGE_ID });
  } catch (e) {}

  function track(event, props) {
    var base = { template: TEMPLATE, variant: VARIANT, page_id: PAGE_ID };
    if (props) for (var k in props) base[k] = props[k];
    try { if (window.posthog && posthog.capture) posthog.capture(event, base); } catch (e) {}
  }

  // ---------- Estado do vídeo (para replay e heartbeat) ----------
  // O session replay do PostHog usa rrweb, que grava o DOM -- e o conteudo de um <video>
  // NAO e DOM. No replay o player aparece como um retangulo parado, entao nao da pra saber
  // se a pessoa estava assistindo ou so deixou a aba aberta. Duas saidas, ambas aqui:
  //   1. console.log periodico -> o projeto tem capture_console_log_opt_in ligado, entao os
  //      logs entram no TIMELINE do replay, sincronizados com o que a pessoa fazia na tela.
  //   2. as mesmas medidas viram propriedades do heartbeat (evento que ja dispara, entao
  //      isso NAO aumenta o volume) -> da pra ver em massa onde as pessoas param.
  // "Tocando" e medido pelo AVANCO do currentTime entre dois ticks, e nao por .paused: o
  // instances[0].video e um stub e nao da pra confiar nas flags dele (mesma razao pela qual
  // o reveal usa onTime nativo). Se avancou desde a ultima leitura, esta tocando.
  var lastVideoT = -1, lastState = null, lastStateAt = 0;
  function videoState() {
    var now = Date.now();
    // Cache curto: o log (10s) e o heartbeat (15s) as vezes caem quase juntos. Sem isto, a
    // 2a leitura veria um avanco de milissegundos e reportaria "parado" com o video rodando.
    if (lastState && now - lastStateAt < 3000) return lastState;
    try {
      var sp = window.smartplayer, v = sp && sp.instances && sp.instances[0] && sp.instances[0].video;
      var t = v && Number(v.currentTime);
      if (!(t >= 0)) return null;
      var advanced = lastVideoT >= 0 && t > lastVideoT + 0.25;
      var st = {
        video_time: Math.round(t),
        video_playing: lastVideoT < 0 ? null : advanced,          // 1o tick nao tem com o que comparar
        video_pct: EFFECTIVE_PITCH > 0 ? Math.round(t / EFFECTIVE_PITCH * 100) : null, // % ate o PITCH
        video_speed: (function () { try { var c = document.querySelector('vturb-smartplayer').config; return (c.turbo && c.turbo.speed) || null; } catch (e) { return null; } })(),
      };
      lastVideoT = t; lastState = st; lastStateAt = now;
      return st;
    } catch (e) { return null; }
  }
  function mmss(s) { var m = Math.floor(s / 60); return m + ':' + ('0' + Math.round(s % 60)).slice(-2); }
  function logVideo(tag) {
    var s = videoState();
    try {
      if (!s) { console.log('[adp] ' + (tag || '') + ' sem player | ' + VARIANT); return; }
      console.log('[adp] ' + (tag ? tag + ' ' : '') + mmss(s.video_time) + ' / ' + mmss(EFFECTIVE_PITCH) +
        ' (pitch) · ' + (s.video_playing === null ? 'primeiro tick' : s.video_playing ? 'PLAYING' : 'parado') +
        ' · ' + VARIANT + (s.video_speed ? ' · ' + s.video_speed + 'x' : ''));
    } catch (e) {}
  }
  // Cadencia do log: 10s em producao; ?qa_log=2 aperta pra QA (util quando se acelera o
  // video com extensao -- a 16x, 10s de relogio sao quase 3 minutos de VSL e o log fica
  // grosso demais pra ver o instante do pitch).
  var LOG_EVERY = 10;
  try { var qs = new URLSearchParams(location.search).get('qa_log'); if (qs && +qs >= 1) LOG_EVERY = +qs; } catch (e) {}
  setInterval(function () { if (document.visibilityState === 'visible') logVideo(); }, LOG_EVERY * 1000);

  // ---------- O VIDEO CRUZOU O PITCH? (independente do reveal) ----------
  // Esta e a peca do diagnostico: marca o instante em que o VIDEO passa do pitchTime,
  // sem depender de quem revela a oferta. Se aparecer "CRUZOU O PITCH" e nao aparecer
  // logo depois "OFERTA REVELADA", o problema esta no reveal -- e nao no tempo do video.
  (function watchPitchCrossing() {
    var avisou = false, aberta = false;
    setInterval(function () {
      var vs = videoState();
      if (!vs) return;
      if (!avisou && EFFECTIVE_PITCH > 0 && vs.video_time >= EFFECTIVE_PITCH) {
        avisou = true;
        console.log('[adp] >>> CRUZOU O PITCH: video em ' + mmss(vs.video_time) +
          ' (pitch ' + mmss(EFFECTIVE_PITCH) + ') — a oferta deve abrir AGORA');
      }
      if (!aberta) {
        var p = document.getElementById('pote');
        var vis = p && getComputedStyle(p).display !== 'none' && p.getBoundingClientRect().height > 20;
        if (vis) {
          aberta = true;
          var atraso = avisou ? ' (' + Math.max(0, Math.round(vs.video_time - EFFECTIVE_PITCH)) + 's depois de cruzar)' : ' ANTES de cruzar o pitch';
          console.log('[adp] >>> OFERTA REVELADA com o video em ' + mmss(vs.video_time) + atraso +
            ' | cards: ' + document.querySelectorAll('#pote .buylink').length +
            ' | countdown: ' + (document.getElementById('knvClaim') && getComputedStyle(document.getElementById('knvClaim')).display !== 'none' ? 'sim' : 'NAO'));
        }
      }
    }, 1000);
  })();

  // ---------- Console de QA: window.QA ----------
  // Atalhos pra testar sem esperar a VSL inteira. Ficam sempre disponiveis (nao expoem nada
  // sensivel -- so mexem no player que ja esta na pagina).
  window.QA = {
    seek: function (s) { try { document.querySelector('vturb-smartplayer').seek(s); logVideo('seek -> ' + mmss(s)); return 'seek para ' + mmss(s); } catch (e) { return 'falhou: ' + e.message; } },
    pitch: function (antes) { var s = Math.max(0, EFFECTIVE_PITCH - (antes == null ? 15 : antes)); return window.QA.seek(s); },
    speed: function (n) { try { var v = window.smartplayer.instances[0].video; v.playbackRate = n; return 'velocidade ' + n + 'x'; } catch (e) { return 'falhou: ' + e.message; } },
    play: function () { try { document.querySelector('vturb-smartplayer').play(); return 'play'; } catch (e) { return 'falhou'; } },
    state: function () { var vs = videoState(); return { video: vs ? mmss(vs.video_time) : '?', pitch: mmss(EFFECTIVE_PITCH), tocando: vs ? vs.video_playing : null, velocidade: vs ? vs.video_speed : null, variante: VARIANT, oferta_aberta: !!(document.getElementById('pote') && getComputedStyle(document.getElementById('pote')).display !== 'none' && document.getElementById('pote').getBoundingClientRect().height > 20), cards: document.querySelectorAll('#pote .buylink').length }; },
    reset: function () { try { localStorage.clear(); sessionStorage.clear(); return 'storage limpo — recarregue (F5) para testar do zero'; } catch (e) { return 'falhou'; } },
  };

  // ---------- Heartbeat (usuários ao vivo + dwell) ----------
  var visibleMs = 0, lastTick = Date.now(), exited = false;
  function visibleSeconds() {
    if (document.visibilityState === 'visible') visibleMs += Date.now() - lastTick;
    lastTick = Date.now();
    return Math.round(visibleMs / 1000);
  }
  setInterval(function () {
    if (document.visibilityState === 'visible') {
      // As props do video viajam no heartbeat, que JA dispara -> zero evento novo, e passa a
      // dar em massa o que o replay nao mostra: onde o video estava e se estava andando.
      var props = { seconds_on_page: visibleSeconds() };
      var vs = videoState();
      if (vs) for (var k in vs) props[k] = vs[k];
      track('heartbeat', props);
    } else lastTick = Date.now();
  }, 15000);
  function onExit() {
    if (exited) return; exited = true;
    track('page_exit', { seconds_on_page: visibleSeconds() });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') visibleSeconds();
    lastTick = Date.now();
  });
  window.addEventListener('pagehide', onExit);

  // ---------- VTurb: reveal no pitch (método NATIVO) + tracking ----------
  function qparam(n) { try { var v = new URLSearchParams(location.search).get(n); return (v != null && v !== '' && !isNaN(+v)) ? +v : null; } catch (e) { return null; } }
  var QA_PITCH = qparam('qa_pitch');   // segundos DE VÍDEO — testa o mecanismo real (precisa dar play)
  var QA_REVEAL = qparam('qa_reveal');  // segundos wall-clock — conveniência (sem precisar dar play)
  // Pitch: a fonte PRIMARIA e o proprio player (config.pitchTime, vindo do painel do VTurb),
  // nao o valor baked na pagina -- o VTurb tem teste A/B de velocidade, entao o pitch pode
  // mudar la sem ninguem republicar a pagina. CFG.pitchSeconds vira so fallback (player que
  // ainda nao respondeu, ou pitchTime nao configurado). ?qa_pitch sempre vence.
  // Atualizado por resolvePitch() quando o player entrega a config.
  var EFFECTIVE_PITCH = QA_PITCH != null ? QA_PITCH : PITCH;
  function resolvePitch(el, event) {
    if (QA_PITCH != null) return QA_PITCH;
    try {
      var detail = (event && event.detail) || {};
      var cfg = detail.config || (detail.player && detail.player.config) || (el && el.config) || {};
      var fromPlayer = Number(cfg.pitchTime) || 0;
      if (fromPlayer > 0) {
        EFFECTIVE_PITCH = fromPlayer;
        window.__ADP_PITCH__ = { seconds: fromPlayer, source: 'player.config.pitchTime', baked: PITCH };
        return fromPlayer;
      }
    } catch (e) {}
    window.__ADP_PITCH__ = { seconds: EFFECTIVE_PITCH, source: 'build fallback', baked: PITCH };
    return EFFECTIVE_PITCH;
  }
  var fired = { play: false, p25: false, p50: false, p75: false, pitch: false, done: false };

  function scrollToOffer() {
    var pote = document.getElementById('pote');
    var target = document.getElementById('knvClaim') || pote; // mira o claim (topo da oferta) se existir
    if (!target) return;
    if (pote) pote.classList.add('knv-delay-revealed');
    try { var top = target.getBoundingClientRect().top + window.pageYOffset - 18; window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }); } catch (e) {}
  }
  function revealOffer() {
    document.querySelectorAll('.hide').forEach(function (el) { el.classList.remove('hide'); });
    scrollToOffer();
  }
  // observa quando a oferta fica visível (revelada pelo VTurb) -> scroll + evento vsl_pitch
  function watchOfferReveal() {
    var pote = document.getElementById('pote'); if (!pote) return;
    var t0 = Date.now(), iv = setInterval(function () {
      var visible = getComputedStyle(pote).display !== 'none' && pote.getBoundingClientRect().height > 20;
      if (visible) { clearInterval(iv); if (!fired.pitch) { fired.pitch = true; track('vsl_pitch'); logVideo('PITCH: oferta revelada'); } scrollToOffer(); }
      else if (Date.now() - t0 > (EFFECTIVE_PITCH + 120) * 1000) clearInterval(iv);
    }, 400);
  }

  // REVEAL: usa o displayHiddenElements NATIVO do VTurb (mesmo mecanismo do model-1.html,
  // baseado no tempo do vídeo). É o que funciona — instances[0].video pode não existir.
  (function initReveal() {
    var el = document.querySelector('vturb-smartplayer');
    if (!el) { setTimeout(initReveal, 300); return; }
    var armed = false, armTries = 0, t0arm = Date.now();
    function arm(event) {
      if (armed) return;
      if (++armTries > 900) return; // ~6min de tentativas no máximo (defensivo)
      if (typeof el.displayHiddenElements !== 'function') { setTimeout(function () { arm(event); }, 400); return; }
      var pitch = resolvePitch(el, event);
      // Ainda sem o pitch do player? Espera a config chegar em vez de armar com o valor
      // baked -- senao a primeira tentativa (que roda antes do player:ready) venceria e o
      // pitch do painel do VTurb nunca seria usado. Fail-open: passados 8s, arma no fallback.
      if (QA_PITCH == null && window.__ADP_PITCH__.source !== 'player.config.pitchTime' && Date.now() - t0arm < 8000) {
        setTimeout(function () { arm(event); }, 400);
        return;
      }
      try {
        el.displayHiddenElements(pitch, ['.hide'], { persist: true });
        armed = true;        // só marca armado se NÃO deu erro (store do player pronto)
        watchOfferReveal();
      } catch (e) {
        setTimeout(function () { arm(event); }, 400); // store undefined = player ainda não pronto -> retenta
      }
    }
    el.addEventListener('player:ready', arm);
    arm(); // começa já; o retry-on-error espera o store ficar pronto
  })();

  // QA wall-clock: ?qa_reveal=N revela após N s sem precisar dar play
  if (QA_REVEAL != null) setTimeout(function () { if (!fired.pitch) { fired.pitch = true; track('vsl_pitch'); } revealOffer(); }, QA_REVEAL * 1000);

  // ---------- TETO por RELOGIO (CFG.revealAtSeconds) ----------
  // Quando a VSL roda em velocidade FIXA, o pitch cai sempre no mesmo minuto de relogio
  // (ex.: 3826s de video / 1.2 = 3188s = 53:08). Este teto revela a oferta nesse minuto
  // caso o mecanismo do VTurb nao tenha revelado -- rede de seguranca, nao substituto: o
  // displayHiddenElements continua armado e, se ele revelar antes, este timer nao faz nada.
  //
  // O relogio conta a partir do PLAY, nao do load: quem demora 2 minutos pra dar play tem o
  // video 2 minutos atrasado, e contar do load abriria a oferta cedo pra essa pessoa.
  //
  // LIMITE CONHECIDO: relogio nao enxerga PAUSA. Se o visitante pausar 10 minutos, o timer
  // segue correndo e pode revelar antes do pitch no conteudo. Por isso, quando da pra ler o
  // tempo do video, exigimos tambem que ele esteja perto do pitch (>= 85%) -- sem leitura
  // disponivel, o teto vale sozinho.
  // ?qa_ceiling=N testa o teto sem esperar os 53 minutos reais
  var CEILING = qparam('qa_ceiling') != null ? qparam('qa_ceiling') : (CFG.revealAtSeconds || 0);
  if (CEILING > 0) {
    (function clockCeiling() {
      var started = 0;
      var iv = setInterval(function () {
        if (fired.pitch) { clearInterval(iv); return; }              // VTurb ja revelou: nada a fazer
        var vs = videoState();
        if (!started) {
          if (vs && vs.video_time > 0) started = Date.now() - vs.video_time * 1000 / (vs.video_speed || 1);
          return;                                                     // ainda sem play
        }
        var decorrido = (Date.now() - started) / 1000;
        if (decorrido < CEILING) return;
        // Anti-pausa: o video precisa ter andado o que se espera para este teto. Compara
        // com o ESPERADO (teto x velocidade), nao com o pitch absoluto -- assim a regra vale
        // igual em producao e num teste com ?qa_ceiling=25.
        var esperado = CEILING * (vs && vs.video_speed ? vs.video_speed : 1);
        if (vs && vs.video_time > 0 && vs.video_time < esperado * 0.85) return;
        clearInterval(iv);
        fired.pitch = true;
        track('vsl_pitch', { source: 'clock_ceiling', after_s: Math.round(decorrido) });
        logVideo('PITCH pelo TETO de relogio (' + CEILING + 's)');
        revealOffer();
      }, 2000);
    })();
  }

  // TRACKING (best-effort): play/pause/progress via instances[0].video quando existir
  function onTime(cur, dur) {
    if (dur > 0) {
      var pct = cur / dur;
      if (!fired.p25 && pct >= 0.25) { fired.p25 = true; track('vsl_progress', { milestone: 25 }); }
      if (!fired.p50 && pct >= 0.50) { fired.p50 = true; track('vsl_progress', { milestone: 50 }); }
      if (!fired.p75 && pct >= 0.75) { fired.p75 = true; track('vsl_progress', { milestone: 75 }); }
    }
  }
  function wirePlayer() {
    var sp = window.smartplayer;
    if (!sp || !sp.instances || !sp.instances.length) return false;
    var v = sp.instances[0].video;
    if (!v || typeof v.addEventListener !== 'function') return false; // v pode existir mas não ser um <video> real ainda
    v.addEventListener('play', function () { if (!fired.play) { fired.play = true; track('vsl_play'); } });
    v.addEventListener('playing', function () { if (!fired.play) { fired.play = true; track('vsl_play'); } });
    v.addEventListener('pause', function () { if (!v.ended) track('vsl_pause', { at: Math.round(v.currentTime) }); });
    v.addEventListener('ended', function () { if (!fired.done) { fired.done = true; track('vsl_complete'); } });
    v.addEventListener('timeupdate', function () { onTime(v.currentTime || 0, v.duration || 0); });
    return true;
  }
  var _tries = 0, _poll = setInterval(function () { if (wirePlayer() || ++_tries > 240) clearInterval(_poll); }, 500);

  // ---------- CTA: tagging de atribuição + clique ----------
  // 'ttrk.io/click' = OFFER CLICK do RedTrack: o botao vai pro tracker, que registra o
  // clique na oferta e redireciona pro checkout. Sem isto aqui o link nem seria
  // reconhecido como CTA -> sem clickid, sem cta_click no PostHog.
  var CHECKOUT = ['clickbank.net', '/hop/', 'buygoods', 'digistore24', 'ds24', 'cartpanda', 'useneurodyne', '/checkout', 'ttrk.io/click'];
  function isCheckout(href) { href = (href || '').toLowerCase(); return CHECKOUT.some(function (p) { return href.indexOf(p) >= 0; }); }
  // click id do RedTrack: chega na URL da página como cid/rtkupdclickid (fallback cookie)
  function getCookie(n) { try { var r = document.cookie.split('; ').find(function (x) { return x.indexOf(n + '=') === 0; }); return r ? decodeURIComponent(r.split('=')[1]) : null; } catch (e) { return null; } }
  // Macro NAO substituido ("{clickid}", "%7Bclickid%7D") nao e clickid -- e o que sobra
  // quando a URL nao passou por quem deveria preencher. Aceitar contamina cookie, postback
  // e o cid do checkout (medido na _noredirect com a URL de anuncio colada na mao).
  function realId(v) { return (v && v.trim() && !/[{}]|%7[bd]/i.test(v)) ? v.trim() : null; }
  // Fallback de cookie: `_adp_cid` PRIMEIRO -- e o nosso, gravado pelo rt-tracker, e nao
  // depende de script de terceiro. O `rtkclickid-store` so existe onde o universal script do
  // RedTrack roda (hoje, so a _noredirect); sem esta ordem, um reload sem params perderia a
  // atribuicao nas paginas onde o script foi removido.
  function getClickId() { try { var p = new URLSearchParams(location.search), ks = ['cid', 'rtkupdclickid', 'rtkcid', 'tid', 'subid', 'sub_id']; for (var i = 0; i < ks.length; i++) { var v = realId(p.get(ks[i])); if (v) return v; } return realId(getCookie('_adp_cid')) || realId(getCookie('rtkclickid-store')); } catch (e) { return null; } }
  var CLICK_ID = getClickId();
  function tagHref(a) {
    if (!a || !a.href || a.dataset.adpTagged) return;
    if (!isCheckout(a.href) && !a.hasAttribute('data-cta')) return;
    try {
      var u = new URL(a.href);
      // 'template' e param RESERVADO em alguns checkouts (ClickBank/getglucozen usam
      // template=glucozenN) -> setar aqui sobrescreve o deles e quebra a atribuicao da
      // venda. CFG.ctaOmitTemplate=true pula o template no checkout (a variante segue no
      // SUB_PARAM, e o template continua na URL da landing p/ o VTurb ler).
      if (!CFG.ctaOmitTemplate) u.searchParams.set('template', TEMPLATE);
      u.searchParams.set(SUB_PARAM, TEMPLATE);
      // OFFER CLICK do RedTrack (ttrk.io/click/N): aqui o destino NAO e o checkout -- e o
      // tracker, que registra o clique na oferta e so entao redireciona. O param que esse
      // endpoint le e `clickid` (o mesmo que o universal script injetaria); cid/rtkupdclickid
      // sao do checkout final, que agora quem monta e a oferta cadastrada no RedTrack.
      if (/ttrk\.io\/click\//i.test(a.href)) {
        if (CLICK_ID) u.searchParams.set('clickid', CLICK_ID);
        a.href = u.toString();
        a.dataset.adpTagged = '1';
        return;
      }
      // CFG.ctaForwardParams: repassa os params da URL da landing pro checkout (utm_*, sub*,
      // fbclid, placement...). Checkout como o CartPanda monta o relatorio de campanha com
      // isso, e sem repasse a venda chega "orfa".
      //   true          = tudo, menos a denylist abaixo
      //   ['a','b']     = so os listados
      // Duas regras que evitam o estrago que o affiliate-trackcontrol fazia:
      //   1. NAO sobrescreve o que ja existe no href do checkout (afid, package, hid...)
      //      -- o link do produtor tem precedencia sobre a query da landing.
      //   2. NUNCA repassa params de QA/interno (force_template, qa_*, rt_debug, template):
      //      eles ja vazaram pro RedTrack uma vez e sujam o relatorio.
      if (CFG.ctaForwardParams) {
        try {
          var DENY = /^(force_template|qa_|rt_debug|template$|_)/i;
          var lista = Array.isArray(CFG.ctaForwardParams) ? CFG.ctaForwardParams : null;
          new URLSearchParams(location.search).forEach(function (val, key) {
            if (!val) return;
            if (lista ? lista.indexOf(key) < 0 : DENY.test(key)) return;
            if (u.searchParams.has(key)) return;                 // href do produtor manda
            u.searchParams.set(key, val);
          });
        } catch (e) {}
      }
      // click id do RedTrack -> injeta em TODOS os checkouts (ds24/Digistore E useneurodyne).
      // Antes era só ds24 ("useneurodyne repassava sozinho" via utm-transfer do produtor, que
      // removemos no clone). Agora o engine GARANTE cid + rtkupdclickid no link de checkout.
      // cam só se ainda for o placeholder (caso ds24).
      if (CLICK_ID) {
        u.searchParams.set('cid', CLICK_ID);
        u.searchParams.set('rtkupdclickid', CLICK_ID);
        if (u.searchParams.get('cam') === 'CAMPAIGNKEY') u.searchParams.set('cam', CLICK_ID);
      }
      a.href = u.toString();
      a.dataset.adpTagged = '1';
    } catch (e) {}
  }
  function tagAll() { document.querySelectorAll('a[href]').forEach(tagHref); }
  // link injection só no modo postback (no forwarder, o script de click-id já repassa todos os params)
  if (TRACK_MODE !== 'forwarder') {
    tagAll();
    var mo = new MutationObserver(tagAll); // re-tag quando a oferta é revelada
    try { mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }); } catch (e) {}

    // MODO NO-REDIRECT do RedTrack: o clickid NAO vem na URL. O universal script chama o
    // RedTrack, recebe o clickid e so ENTAO grava o cookie -- depois deste script rodar.
    // Sem esperar por ele, todo CTA sairia sem atribuicao (medido: acontecia). Observa o
    // cookie e, quando o clickid chegar, re-tagueia o que ja foi marcado.
    if (!CLICK_ID) {
      var cidTries = 0;
      var cidPoll = setInterval(function () {
        var late = getClickId();
        if (late) {
          clearInterval(cidPoll);
          CLICK_ID = late;
          try { document.querySelectorAll('a[data-adp-tagged]').forEach(function (a) { delete a.dataset.adpTagged; }); } catch (e) {}
          tagAll();
          track('clickid_late', { after_ms: cidTries * 300 });   // quanto o clickid demorou
        } else if (++cidTries > 50) clearInterval(cidPoll);      // desiste em ~15s
      }, 300);
    }
  }
  document.body.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (a && (isCheckout(a.href) || a.hasAttribute('data-cta'))) {
      if (TRACK_MODE !== 'forwarder') tagHref(a);
      // qual kit foi clicado: o widget usa .kit1/.kit2/.kit3, e o title tem "6 Bottles" etc.
      var kit = (a.className.match(/kit\d/) || [])[0] || a.getAttribute('title') || '?';
      track('cta_click', { href: a.href, kit: kit });
      logVideo('CLICOU NO CTA (' + kit + ')');
    }
  }, true);

  // ---------- A oferta entrou na TELA? ----------
  // vsl_pitch diz que a oferta ABRIU; nao diz que o visitante chegou a VE-LA (ela abre
  // abaixo do video, e quem esta no topo pode nunca rolar ate la). Sem isso, "revelou" e
  // "viu" viram a mesma coisa na leitura -- e nao sao: e justamente entre os dois que se
  // perde gente. Dispara uma vez, quando o bloco encosta na viewport.
  (function watchOfferSeen() {
    var pote = document.getElementById('pote');
    if (!pote) { setTimeout(watchOfferSeen, 1000); return; }
    if (typeof IntersectionObserver !== 'function') return;
    var seen = false;
    var io = new IntersectionObserver(function (entries) {
      if (seen) return;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          seen = true; io.disconnect();
          track('offer_viewed', { seconds_on_page: visibleSeconds() });
          logVideo('OFERTA NA TELA (viu o botao)');
          return;
        }
      }
    }, { threshold: 0.15 });
    io.observe(pote);
  })();

  // ---------- Clique no player/badge de play (intenção de play; o play em si é autoplay-mudo) ----------
  (function () {
    var firedClick = false;
    document.addEventListener('click', function (e) {
      if (firedClick) return;
      var t = e.target; if (!t || !t.closest) return;
      if (t.closest('vturb-smartplayer') || t.closest('.knv-video-badge') || t.closest('.knv-click-cue')) {
        firedClick = true; track('video_play_click', { seconds_on_page: visibleSeconds() }); logVideo('clicou no PLAY');
      }
    }, true);
  })();

  // ---------- Scroll até o fim da página (fim do conteúdo / chegou na oferta) ----------
  (function () {
    var firedBottom = false, ticking = false;
    function check() {
      if (firedBottom) return;
      var scrolled = window.pageYOffset + window.innerHeight;
      var full = document.documentElement.scrollHeight;
      if (full > 400 && scrolled >= full * 0.9) {
        firedBottom = true;
        track('scroll_bottom', { depth_pct: Math.round((scrolled / full) * 100), seconds_on_page: visibleSeconds() }); logVideo('rolou ate o FIM');
        window.removeEventListener('scroll', onScroll);
      }
    }
    function onScroll() { if (ticking) return; ticking = true; requestAnimationFrame(function () { ticking = false; check(); }); }
    window.addEventListener('scroll', onScroll, { passive: true });
  })();

  // ---------- "Watching Now" + heat meter (prova social simulada) ----------
  (function () {
    var countEl = document.getElementById('knvViewerCount'),
      pill = document.getElementById('knvLivePill'),
      meter = document.getElementById('knvLiveMeter');
    if (!countEl) return;
    var current = 11800 + Math.floor(Math.random() * 900), anim = null;
    function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
    function rand(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
    function smoothTo(next) {
      var start = current, delta = next - start, duration = rand(2200, 4200), t0 = performance.now();
      if (anim) cancelAnimationFrame(anim);
      countEl.classList.add('updating');
      function step(t) {
        var p = Math.min(1, (t - t0) / duration), e = 1 - Math.pow(1 - p, 3);
        current = start + delta * e; countEl.textContent = fmt(current);
        if (p < 1) anim = requestAnimationFrame(step);
        else { current = next; countEl.textContent = fmt(current); countEl.classList.remove('updating'); }
      }
      anim = requestAnimationFrame(step);
    }
    function recalc() {
      var drift = rand(-140, 180), micro = rand(-35, 35);
      smoothTo(Math.max(9300, Math.min(13800, current + drift + micro)));
      if (pill) pill.classList.toggle('hot', Math.random() > 0.58);
      if (meter) meter.style.width = (58 + Math.random() * 25).toFixed(1) + '%';
      setTimeout(recalc, rand(5000, 15000));
    }
    countEl.textContent = fmt(current);
    setTimeout(recalc, rand(2500, 6000));
  })();

  // ---------- Claim countdown (5min) — inicia quando o bloco é revelado ----------
  (function () {
    var el = document.getElementById('knvClaimTimer'), box = document.getElementById('knvClaim');
    if (!el || !box) return;
    var started = false, total = 5 * 60;
    function fmt(s) { var m = Math.floor(s / 60), r = s % 60; return ('0' + m).slice(-2) + ':' + ('0' + r).slice(-2); }
    function start() {
      if (started) return; started = true;
      var left = total; el.textContent = fmt(left);
      var iv = setInterval(function () { left = Math.max(0, left - 1); el.textContent = fmt(left); if (left <= 0) clearInterval(iv); }, 1000);
    }
    var t = setInterval(function () {
      if (getComputedStyle(box).display !== 'none' && box.getBoundingClientRect().height > 10) { clearInterval(t); start(); }
    }, 400);
  })();

  // ---------- Comentários "ao vivo" sincronizados ao vídeo (V2) ----------
  // Sync NATIVO: player.onTime(t, cb, {once}) — mesmo agendador interno do
  // displayHiddenElements. Fallback: poll do instances[0].video. Fail-open sempre:
  // rede lenta/sem player = só os seeds (ou nada); o play NUNCA espera por isto.
  (function () {
    var CC = CFG.comments;
    if (!CC || !CC.url) return;
    // gate aceita string ('v2') ou lista (['v2','v21'])
    if (CC.gate && [].concat(CC.gate).indexOf(VARIANT) < 0) return;
    // bubble overlay por variante: CC.bubbleFor lista quem tem popup (default: todas as gateadas)
    var BUBBLE_ON = !CC.bubbleFor || [].concat(CC.bubbleFor).indexOf(VARIANT) >= 0;
    // janelas por variante (segundos de vídeo): bubbleUntil = popup só até X; stopAfter = nenhum
    // comentário novo depois de X (estudo de retenção: estímulo só onde ele soma)
    var BUBBLE_UNTIL = (CC.bubbleUntil && CC.bubbleUntil[VARIANT] != null) ? CC.bubbleUntil[VARIANT] : Infinity;
    var STOP_AFTER = (CC.stopAfter && CC.stopAfter[VARIANT] != null) ? CC.stopAfter[VARIANT] : Infinity;
    // curadoria de popup: nas variantes listadas, só comentários com b:1 no JSON viram bubble
    var CURATED = !!(CC.curatedBubblesFor && [].concat(CC.curatedBubblesFor).indexOf(VARIANT) >= 0);
    // curadoria de LISTA: nas variantes listadas (ex.: v23), só os comentários b:1 aparecem
    // (replies de um crítico entram junto; seeds sempre ficam)
    var LIST_CURATED = !!(CC.curatedCommentsFor && [].concat(CC.curatedCommentsFor).indexOf(VARIANT) >= 0);
    var sec = document.getElementById('knvComments');
    var list = document.getElementById('knvCmList');
    if (!sec || !list) return;

    var LS_KEY = '_c_' + PAGE_ID;
    var st = { maxT: 0, liked: {}, ovOff: false };
    try { var raw0 = localStorage.getItem(LS_KEY); if (raw0) { var o0 = JSON.parse(raw0); if (o0) { st.maxT = +o0.maxT || 0; st.liked = o0.liked || {}; st.ovOff = !!o0.ovOff; } } } catch (e) {}
    var saveT = null;
    function save() { clearTimeout(saveT); saveT = setTimeout(function () { try { localStorage.setItem(LS_KEY, JSON.stringify(st)); } catch (e) {} }, 400); }

    var AV = CC.avatars || '';
    var byId = {}, startedEvt = false;

    // Janela de visíveis (sem scroll interno): N no topo + botão "View more".
    // No pitch colapsa pra 3 (mínimo de distração; CTA é a estrela) e para os bubbles.
    var LIMIT_NORMAL = 6, LIMIT_PITCH = 0, limit = LIMIT_NORMAL, extra = 0, moreBtn = null, closeBtn = null, pitched = false;
    function applyWindow() {
      var tops = Array.prototype.filter.call(list.children, function (el) { return el.classList && el.classList.contains('knv-c'); });
      var max = limit + extra, hidden = 0;
      tops.forEach(function (el, i) {
        var hide = i >= max;
        el.style.display = hide ? 'none' : '';
        if (hide) hidden++;
      });
      if (!moreBtn) {
        moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'knv-cm-more';
        moreBtn.addEventListener('click', function () { extra += 8; applyWindow(); track('comments_expand'); });
        list.parentNode.appendChild(moreBtn);
        closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'knv-cm-close';
        closeBtn.textContent = 'Close comments';
        closeBtn.addEventListener('click', function () { extra = 0; applyWindow(); track('comments_close'); });
        list.parentNode.appendChild(closeBtn);
      }
      moreBtn.textContent = (max === 0 ? 'View comments (' : 'View more comments (') + hidden + ')';
      moreBtn.style.display = hidden > 0 ? '' : 'none';
      closeBtn.style.display = extra > 0 ? '' : 'none';
    }
    function offerVisible() {
      // não confia só na flag do engine: o persist do VTurb pode pré-revelar o #pote
      // (visitante que volta pós-pitch) sem o watchOfferReveal ter armado
      if (fired && fired.pitch) return true;
      try {
        var po = document.getElementById('pote');
        return !!(po && getComputedStyle(po).display !== 'none' && po.getBoundingClientRect().height > 20);
      } catch (e) { return false; }
    }
    setInterval(function () {
      if (!pitched && offerVisible()) { pitched = true; limit = LIMIT_PITCH; extra = 0; applyWindow(); }
    }, 800);

    function vtLabel(t) { var m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + ('0' + s).slice(-2); }
    function makeRow(c, isReply) {
      var d = document.createElement('div');
      d.className = 'knv-c';
      var liked = !!st.liked[c.id];
      var vt = c.t >= 0 ? '<span>&middot;</span><span class="knv-c-vt">&#9656; ' + vtLabel(c.t) + '</span>' : '';
      d.innerHTML = '<img class="knv-c-av" loading="lazy" alt="">' +
        '<div class="knv-c-main"><div class="knv-c-bubble"><p class="knv-c-name"></p><p class="knv-c-text"></p></div>' +
        '<div class="knv-c-meta"><span class="knv-c-like' + (liked ? ' liked' : '') + '">Like</span><span class="knv-c-likes">' + (c.likes + (liked ? 1 : 0)) + '</span>' +
        '<span>&middot;</span><span class="knv-c-reply">Reply</span>' + (isReply ? '' : '<span class="knv-c-rc"></span>') +
        '<span>&middot;</span><time>' + (c.t < 0 ? (c.ago || '1h') : 'Just now') + '</time>' + vt + '</div>' +
        (isReply ? '' : '<div class="knv-c-replies" style="display:none"></div>') + '</div>';
      d.querySelector('.knv-c-av').src = AV + c.avatar;
      d.querySelector('.knv-c-name').textContent = c.name;
      d.querySelector('.knv-c-text').textContent = c.text;
      var likeEl = d.querySelector('.knv-c-like'), likesEl = d.querySelector('.knv-c-likes');
      likeEl.addEventListener('click', function () {
        var on = !st.liked[c.id];
        if (on) st.liked[c.id] = 1; else delete st.liked[c.id];
        likeEl.classList.toggle('liked', on);
        likesEl.textContent = c.likes + (on ? 1 : 0);
        save();
        if (on) track('comment_like', { comment_id: c.id });
      });
      return d;
    }

    function show(c, instant) {
      if (byId[c.id]) return;
      var isReply = !!c.replyTo;
      var row = makeRow(c, isReply);
      byId[c.id] = { c: c, el: row, at: Date.now() };
      if (!instant) row.classList.add('knv-c-new');
      if (isReply) {
        var parent = byId[c.replyTo];
        var rep = parent && parent.el.querySelector('.knv-c-replies');
        if (rep) {
          rep.style.display = ''; rep.appendChild(row);
          var rc = parent.el.querySelector('.knv-c-rc');
          if (rc) rc.textContent = rep.children.length; // contador junto do Reply
        }
        else list.insertBefore(row, list.firstChild);
      } else {
        list.insertBefore(row, list.firstChild);
      }
      if (!instant) {
        if (!startedEvt) { startedEvt = true; track('comments_started'); }
        maybeBubble(c);
      }
      if (c.t > st.maxT) { st.maxT = c.t; save(); }
      applyWindow();
    }

    // bubble overlay (só quando a seção está fora da viewport; × desativa de vez)
    var secVisible = false;
    try {
      new IntersectionObserver(function (en) { secVisible = !!(en[0] && en[0].isIntersecting); }, { threshold: 0.05 }).observe(sec);
    } catch (e) { secVisible = true; }
    var bubbleEl = null, bubbleT = null;
    function killBubble(now) {
      clearTimeout(bubbleT);
      if (!bubbleEl) return;
      var b = bubbleEl; bubbleEl = null;
      if (now) { b.remove(); return; }
      b.classList.add('out'); setTimeout(function () { b.remove(); }, 320);
    }
    function maybeBubble(c) {
      if (!BUBBLE_ON) return; // variante sem popup (ex.: v21)
      if (CURATED && !c.b) return; // modo curado: só os comentários marcados como críticos
      if (c.t >= 0 && c.t > BUBBLE_UNTIL) return; // popup só até a janela (ex.: v22 até 17min)
      if (pitched || (fired && fired.pitch)) return; // pitch: zero distração de overlay
      if (st.ovOff || secVisible || document.visibilityState !== 'visible') return;
      killBubble(true);
      var b = document.createElement('div');
      b.className = 'knv-cbubble';
      b.innerHTML = '<img alt=""><div><p class="knv-cb-name"></p><p class="knv-cb-text"></p></div><span class="knv-cb-x">&times;</span>';
      b.querySelector('img').src = AV + c.avatar;
      b.querySelector('.knv-cb-name').textContent = c.name;
      b.querySelector('.knv-cb-text').textContent = c.text;
      b.querySelector('.knv-cb-x').addEventListener('click', function (e) {
        e.stopPropagation();
        st.ovOff = true; save(); killBubble();
        track('overlay_dismissed');
      });
      document.body.appendChild(b);
      bubbleEl = b;
      bubbleT = setTimeout(function () { killBubble(); }, 6000);
    }

    // labels envelhecem ("Just now" -> "3m" -> "1h")
    setInterval(function () {
      var now = Date.now();
      for (var k in byId) {
        var it = byId[k]; if (it.c.t < 0) continue;
        var el = it.el.querySelector('time'); if (!el) continue;
        var min = Math.floor((now - it.at) / 60000);
        el.textContent = min < 1 ? 'Just now' : (min < 60 ? min + 'm' : Math.floor(min / 60) + 'h');
      }
    }, 45000);

    function startSync(data) {
      var cs = (data && data.comments) || [];
      var cnt = document.getElementById('knvCmCount');
      if (cnt && data.countLabel) cnt.textContent = '\u00B7 ' + data.countLabel; // middot via escape (ASCII-safe)
      var seeds = cs.filter(function (c) { return c.t < 0; });
      var synced = cs.filter(function (c) { return c.t >= 0 && c.t <= STOP_AFTER; }).sort(function (a, b) { return a.t - b.t; });
      if (LIST_CURATED) {
        var critIds = {};
        synced.forEach(function (c) { if (c.b) critIds[c.id] = 1; });
        synced = synced.filter(function (c) { return c.b || (c.replyTo && critIds[c.replyTo]); });
      }
      // seeds: top-level em ordem reversa (mais antigo embaixo), depois as replies
      var tops = seeds.filter(function (c) { return !c.replyTo; });
      for (var i = tops.length - 1; i >= 0; i--) show(tops[i], true);
      seeds.forEach(function (c) { if (c.replyTo) show(c, true); });
      // catch-up do cache (reload): o que já passou aparece instantâneo
      synced.forEach(function (c) { if (c.t <= st.maxT) show(c, true); });

      var player = document.querySelector('vturb-smartplayer');

      // camada 1: onTime nativo (registra todos; {once:true}; show() é idempotente)
      var armed = false, tries = 0;
      function armNative() {
        if (armed || !player || typeof player.onTime !== 'function') return false;
        try {
          synced.forEach(function (c) {
            player.onTime(c.t, function () { show(c, false); }, { once: true });
          });
          armed = true; return true;
        } catch (e) { return false; }
      }
      (function tryArm() {
        if (armNative()) return;
        if (++tries < 150) setTimeout(tryArm, 400);
      })();

      // camada 2: poll do <video> (paralelo, idempotente; pega catch-up de resume tb)
      setInterval(function () {
        try {
          var sp = window.smartplayer;
          var v = sp && sp.instances && sp.instances[0] && sp.instances[0].video;
          if (v && v.currentTime > 0) {
            var t = v.currentTime;
            synced.forEach(function (c) { if (!byId[c.id] && c.t <= t) show(c, (t - c.t) > 8); });
          }
        } catch (e) {}
      }, 1000);
    }

    // lazy: depois do player (player:ready) ou 4s, em idle, fetch com timeout
    function fetchData() {
      var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var to = ctl && setTimeout(function () { try { ctl.abort(); } catch (e) {} }, 8000);
      fetch(CC.url, ctl ? { signal: ctl.signal } : {})
        .then(function (r) { return r.json(); })
        .then(function (d) { if (to) clearTimeout(to); startSync(d); })
        .catch(function () { /* fail-open: sem comentários, página segue normal */ });
    }
    var kicked = false;
    function kickOnce() {
      if (kicked) return; kicked = true;
      if ('requestIdleCallback' in window) requestIdleCallback(fetchData, { timeout: 4000 });
      else setTimeout(fetchData, 2000);
    }
    var p0 = document.querySelector('vturb-smartplayer');
    if (p0) p0.addEventListener('player:ready', kickOnce);
    setTimeout(kickOnce, 4000);
  })();
})();

/* =====================================================================
 * RedTrack postbacks (do parceiro) — VERBATIM, fan-out.
 * Só o gatilho do PageView foi adaptado (roda na hora se o DOM já estiver
 * pronto), porque o engine carrega deferido e o DOMContentLoaded já passou.
 * ===================================================================== */

/* InitiateCheckout — OPT-IN por página: só roda com window.__ADP__.pbInitiateCheckout = true.
 * Ligado na Lipobliss (BuyGoods não tem um bom IC nativo); nas neurodyne segue DESLIGADO
 * (foi removido a pedido). Versão nova do William (2026-07): TTL 1 dia, padrões de checkout
 * mais amplos, keyword "order", e anti-falso-positivo no touch (descarta scroll/long press). */
(function () {
  "use strict";
  if ((window.__ADP__ || {}).pbInitiateCheckout !== true) return;
  if ((window.__ADP__ || {}).trackingMode === 'forwarder') return;

  const POSTBACK_URL = "https://zgxlp.ttrk.io/postback";
  const EVENT_TYPE = "InitiateCheckout";
  const DEBOUNCE_MS = 1500;
  const FIRED_TTL_DAYS = 1;
  const STORAGE_KEY = "_pb_fired_" + EVENT_TYPE.toLowerCase();

  // Proteções contra falso positivo no touchend mobile
  const TAP_MAX_MOVEMENT_PX = 10;  // descarta scroll/swipe
  const TAP_MAX_DURATION_MS = 500; // descarta long press

  const CHECKOUT_PATTERNS = ["clickbank", "/click", "jvz", "buygoods", "ds24", "checkout"];
  const CTA_KEYWORDS = /\b(get|buy|offer|now|order)\b/i;
  const BUTTON_LIKE = "button, a, [role='button'], input[type='button'], input[type='submit']";
  const SMARTPLAYER_SELECTOR = ".smartplayer-anchor-button";

  let lastFireTs = 0;
  let touchStart = null;

  function getCookie(name) { const row = document.cookie.split('; ').find(r => r.startsWith(name + '=')); return row ? decodeURIComponent(row.split('=')[1]) : null; }
  function setCookie(name, value, ttlMs) { const expires = new Date(Date.now() + ttlMs).toUTCString(); const secure = location.protocol === "https:" ? "; Secure" : ""; document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax${secure}`; }
  function getClickId() { const p = new URLSearchParams(window.location.search); return p.get("rtkcid") || p.get("tid") || p.get("subid") || p.get("cid") || getCookie("rtkclickid-store"); }
  function alreadyFired() { if (getCookie(STORAGE_KEY)) return true; try { const ts = localStorage.getItem(STORAGE_KEY); if (ts) { const ageMs = Date.now() - parseInt(ts, 10); if (ageMs >= 0 && ageMs < FIRED_TTL_DAYS * 86400000) return true; } } catch (_) {} return false; }
  function markFired() { const ttlMs = FIRED_TTL_DAYS * 86400000; setCookie(STORAGE_KEY, "1", ttlMs); try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch (_) {} }
  function firePostback() { const now = Date.now(); if (now - lastFireTs < DEBOUNCE_MS) return; lastFireTs = now; if (alreadyFired()) return; const clickid = getClickId(); if (!clickid) { console.error("ClickID não encontrado."); return; } const fullUrl = `${POSTBACK_URL}?${new URLSearchParams({ clickid, type: EVENT_TYPE })}`; const sent = navigator.sendBeacon && navigator.sendBeacon(fullUrl); if (!sent) { fetch(fullUrl, { method: "GET", keepalive: true }).catch(err => console.error("Erro no postback:", err)); } markFired(); }
  function isCheckoutLink(el) { const link = el.closest && el.closest("a"); if (!link || !link.href) return false; const href = link.href.toLowerCase(); return CHECKOUT_PATTERNS.some(p => href.includes(p)); }
  function isSmartplayerButton(el) { return !!(el.closest && el.closest(SMARTPLAYER_SELECTOR)); }
  function isCtaButton(el) { const btn = el.closest && el.closest(BUTTON_LIKE); if (!btn) return false; const text = (btn.textContent || btn.value || "").trim(); return CTA_KEYWORDS.test(text); }
  function shouldFire(target) { if (!target || !target.closest) return false; return isCheckoutLink(target) || isSmartplayerButton(target) || isCtaButton(target); }

  function init() {
    document.body.addEventListener("click", (e) => { if (shouldFire(e.target)) firePostback(); }, true);
    document.body.addEventListener("auxclick", (e) => { if (e.button === 1 && shouldFire(e.target)) firePostback(); }, true);
    document.body.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) { touchStart = null; return; }
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    }, true);
    document.body.addEventListener("touchend", (e) => {
      if (!touchStart) return;
      const touchEnd = e.changedTouches[0];
      const dx = Math.abs(touchEnd.clientX - touchStart.x);
      const dy = Math.abs(touchEnd.clientY - touchStart.y);
      const duration = Date.now() - touchStart.t;
      touchStart = null;
      if (dx > TAP_MAX_MOVEMENT_PX || dy > TAP_MAX_MOVEMENT_PX) return;
      if (duration > TAP_MAX_DURATION_MS) return;
      if (shouldFire(e.target)) firePostback();
    }, true);
    document.body.addEventListener("touchcancel", () => { touchStart = null; }, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();

/* PageView — só no modo postback */
(function () {
  if ((window.__ADP__ || {}).trackingMode === 'forwarder') return;
  // Páginas com rtTracker:true delegam TODOS os postbacks ao rt-tracker standalone
  // (w2n.dev/rt/v1.js), que já manda PageView com event id estável. Sem este guard o
  // mesmo PageView sairia duas vezes por visita.
  if ((window.__ADP__ || {}).rtTracker === true) return;
  function getParameterByName(name) { const url = window.location.href; const nameRegex = name.replace(/[[\]]/g, "\\$&"); const regex = new RegExp("[?&]" + nameRegex + "(=([^&#]*)|&|#|$)"); const results = regex.exec(url); return results && results[2] ? decodeURIComponent(results[2].replace(/\+/g, " ")) : null; }
  function getCookie(name) { const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)")); return match ? decodeURIComponent(match[2]) : null; }
  function sendPostback(url) { if (navigator.sendBeacon) { navigator.sendBeacon(url); } else { fetch(url, { keepalive: true }).catch(error => console.error("Error sending postback:", error.message)); } }
  function handleVSLViewPostback() { if (sessionStorage.getItem("vslview_sent")) return; let clickid = getParameterByName("rtkcid") || getParameterByName("cid") || getParameterByName("tid") || getParameterByName("subid") || getCookie("rtkclickid-store"); if (clickid) { const url = `https://zgxlp.ttrk.io/postback?clickid=${encodeURIComponent(clickid)}&type=PageView`; sendPostback(url); sessionStorage.setItem("vslview_sent", "true"); } }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", handleVSLViewPostback); else handleVSLViewPostback();
})();

/* =====================================================================
 * Click-id forwarder (modo 'forwarder') — VERBATIM do usuário.
 * Repassa click-id + TODOS os params da URL (incl. template/sub17) pros
 * links de checkout. Substitui CTA tagging + postbacks neste modo.
 * ===================================================================== */
(function () {
  if ((window.__ADP__ || {}).trackingMode !== 'forwarder') return;
  const COOKIE_NAME = "rtkclickid-store";
  const CLICKID_SOURCES = ["rtkcid", "tid", "subid", "cid"];
  const CLICKID_TARGETS = ["tid", "cid", "subid"];
  const POLL_INTERVAL = 100;
  const POLL_TIMEOUT = 5000;

  let resolvedClickid = null;

  function getCookie(name) {
    const row = document.cookie.split('; ').find(r => r.startsWith(name + '='));
    return row ? decodeURIComponent(row.split('=')[1]) : null;
  }

  function resolveFromUrl() {
    const params = new URL(window.location.href).searchParams;
    for (const key of CLICKID_SOURCES) {
      const value = params.get(key);
      if (value && value.trim()) return value.trim();
    }
    return null;
  }

  function injectIntoUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    if (rawUrl.startsWith('#') || rawUrl.startsWith('javascript:') ||
        rawUrl.startsWith('mailto:') || rawUrl.startsWith('tel:')) return rawUrl;
    try {
      const url = new URL(rawUrl, window.location.href);
      if (!url.protocol.startsWith('http')) return rawUrl;

      const currentParams = new URL(window.location.href).searchParams;
      currentParams.forEach((value, key) => {
        if (!url.searchParams.has(key)) url.searchParams.set(key, value);
      });

      if (resolvedClickid) {
        CLICKID_TARGETS.forEach(target => {
          url.searchParams.set(target, resolvedClickid);
        });
      }

      return url.toString();
    } catch (e) {
      return rawUrl;
    }
  }

  let _syncing = false;
  function syncAllLinks() {
    if (_syncing) return;
    _syncing = true;
    document.querySelectorAll('a[href]').forEach(link => {
      try {
        const rawHref = link.getAttribute('href');
        if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') ||
            rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) return;
        const newHref = injectIntoUrl(link.href);
        if (newHref && newHref !== link.href) link.href = newHref;
      } catch (e) {}
    });
    _syncing = false;
  }

  function applyClickid(value) {
    resolvedClickid = value;
    const url = new URL(window.location.href);
    let changed = false;
    CLICKID_TARGETS.forEach(target => {
      if (url.searchParams.get(target) !== value) {
        url.searchParams.set(target, value);
        changed = true;
      }
    });
    if (changed) window.history.replaceState({}, "", url.toString());
    syncAllLinks();
  }

  try {
    const hrefDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href') ||
                     Object.getOwnPropertyDescriptor(window.location, 'href');
    if (hrefDesc && hrefDesc.set && hrefDesc.get) {
      Object.defineProperty(Location.prototype, 'href', {
        set: function (value) { hrefDesc.set.call(this, injectIntoUrl(value)); },
        get: function () { return hrefDesc.get.call(this); },
        configurable: true
      });
    }
  } catch (e) {}

  try {
    const _assign = Location.prototype.assign;
    Location.prototype.assign = function (url) { return _assign.call(this, injectIntoUrl(url)); };
  } catch (e) {}

  try {
    const _replace = Location.prototype.replace;
    Location.prototype.replace = function (url) { return _replace.call(this, injectIntoUrl(url)); };
  } catch (e) {}

  try {
    const _open = window.open;
    window.open = function (url, ...rest) {
      return _open.call(this, url ? injectIntoUrl(url) : url, ...rest);
    };
  } catch (e) {}

  document.addEventListener('submit', function (e) {
    const form = e.target;
    if (!form || form.tagName !== 'FORM' || !form.action) return;
    try {
      const newAction = injectIntoUrl(form.action);
      if (newAction && newAction !== form.action) form.action = newAction;
    } catch (e) {}
  }, true);

  const observer = new MutationObserver(syncAllLinks);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      syncAllLinks();
    }
  }, 500);

  syncAllLinks();

  const fromUrl = resolveFromUrl();
  if (fromUrl) { applyClickid(fromUrl); return; }

  const fromCookie = getCookie(COOKIE_NAME);
  if (fromCookie && fromCookie.trim()) { applyClickid(fromCookie.trim()); return; }

  const start = Date.now();
  const interval = setInterval(() => {
    const cookie = getCookie(COOKIE_NAME);
    if (cookie && cookie.trim()) {
      clearInterval(interval);
      applyClickid(cookie.trim());
      return;
    }
    if (Date.now() - start > POLL_TIMEOUT) clearInterval(interval);
  }, POLL_INTERVAL);
})();
