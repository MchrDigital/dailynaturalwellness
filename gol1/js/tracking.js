// Tracking loader - dominio dinamico (pego da URL atual)
// Gera: <script src="https://lp.{host}/track.js"></script> no subdominio lp.
(function () {
	var host = window.location.hostname.replace(/^www\./, "");
	var s = document.createElement("script");
	s.type = "text/javascript";
	s.src = window.location.protocol + "//lp." + host + "/track.js";
	document.head.appendChild(s);
})();
