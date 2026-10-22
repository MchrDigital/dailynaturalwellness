

(function () {
	var host = window.location.hostname.replace(/^www\./, "");
	var BASE = window.location.protocol + "//lp." + host;

	document.querySelectorAll("a.buylink[data-offer]").forEach(function (a) {
		a.href = BASE + "/click/" + a.getAttribute("data-offer");
	});
})();
