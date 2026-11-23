;(function () {
    try {
        if (window.__rtkMetaCapiLoading) return;
        window.__rtkMetaCapiLoading = true;
        function runMetaCapi() {
            try {
                var lib = window.clientParamBuilder;
                if (lib && typeof lib.processAndCollectAllParams === 'function') {
                    lib.processAndCollectAllParams(window.location.href);
                }
            } catch (e) {}
        }
        if (window.clientParamBuilder) { runMetaCapi(); return; }
        var s = document.createElement('script');
        s.src = 'https://unpkg.com/meta-capi-param-builder-clientjs/dist/clientParamBuilder.bundle.js';
        s.async = true;
        s.onload = runMetaCapi;
        (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
})();

function getCookie(name) {
    var value = "; " + document.cookie;
    var parts = value.split("; " + name + "=");
    if (parts.length === 2) {
        return parts.pop().split(";").shift();
    }
}

function rtkPlatformValue(c) {
    var v = getCookie(c.cookie);
    if (!v && c.storage) {
        try { v = window.localStorage.getItem(c.storage); } catch (e) {}
    }
    return v || null;
}

var campaignID = "";
var cachebuster = Math.round(new Date().getTime() / 1000);
var rtkClickID;
var rtkPlatformCookies = [{"cookie":"_fbp","param":"rtkfbp","key":"fbp"},{"cookie":"_fbc","param":"rtkfbc","key":"fbc"},{"cookie":"_wuid","param":"rtkwuid","key":"wuid","storage":"_wuid"}];
var rtkPlatformParams = rtkPlatformCookies.map(function (c) {
    var v = rtkPlatformValue(c);
    return v ? "&" + c.param + "=" + encodeURIComponent(v) : "";
}).join("");
var locSearch = window.location.search;
var urlParams = new URLSearchParams(locSearch);
var pixelParams = "&" + locSearch.substr(1) + rtkPlatformParams
if (campaignID == "") {
    campaignID = urlParams.get('rtkcmpid')
}
var initialSrc = "https://1vuyt.ttrk.io/" + campaignID + "?format=json";

function stripTrailingSlash(str) {
    return str.replace(/\/$/, "");
}

var rawData;

function fixHrefWithClick(
    _rawData,
    _cachebuster,
    _rtkClickID
) {
    document.querySelectorAll('a').forEach(function (el) {
        if (el.href.indexOf("1vuyt.ttrk.io/click") > -1) {
            if (el.href.indexOf('?') > -1) {
                el.href = stripTrailingSlash(el.href) + "&clickid=" + (_rtkClickID || _rawData.clickid) + "&rtkck=" + _cachebuster
            } else {
                el.href = stripTrailingSlash(el.href) + "?clickid=" + (_rtkClickID || _rawData.clickid) + "&rtkck=" + _cachebuster
            }
        }
        if (el.href.indexOf("clickid={clickid}") > -1) {
            el.href = el.href.replace(/{clickid}/, _rawData.clickid) + "&rtkck=" + _cachebuster;
        }
    });
}

setTimeout(function () {
    if (!urlParams.get('rtkcid')) {
        xhr = new XMLHttpRequest;
        xhr.onreadystatechange = function () {
            if (xhr.readyState == 4 && xhr.status == 200) {
                rawData = JSON.parse(xhr.responseText);
                rtkClickID = rawData.clickid
                setCookie();
                // fixHrefWithClick(rawData, cachebuster)
                document.querySelectorAll('a').forEach(function (el) {
                    if (el.href.indexOf("1vuyt.ttrk.io/click") > -1) {
                        if (el.href.indexOf('?') > -1) {
                            el.href = stripTrailingSlash(el.href) + "&clickid=" + rawData.clickid + "&rtkck=" + cachebuster
                        } else {
                            el.href = stripTrailingSlash(el.href) + "?clickid=" + rawData.clickid + "&rtkck=" + cachebuster
                        }
                    }
                    if (el.href.indexOf("clickid={clickid}") > -1) {
                        el.href = el.href.replace(/{clickid}/, rawData.clickid) + "&rtkck=" + cachebuster;
                    }
                });
                xhrr = new XMLHttpRequest;
                xhrr.open("GET", "https://1vuyt.ttrk.io/view?clickid=" + rawData.clickid)
                xhrr.send();
            }
        }
        xhr.open("GET", initialSrc + pixelParams)
        xhr.send();
    } else {
        rtkClickID = urlParams.get('rtkcid')
        setCookie();
        xhrTrack = new XMLHttpRequest;
        xhrTrack.open("GET", "https://1vuyt.ttrk.io/view?clickid=" + rtkClickID)
        xhrTrack.send();
        // fixHrefWithClick(rawData, cachebuster, rtkClickID)
        document.querySelectorAll('a').forEach(function (el) {
            if (el.href.indexOf("1vuyt.ttrk.io/click") > -1) {
                if (el.href.indexOf('?') > -1) {
                    el.href = stripTrailingSlash(el.href) + "&clickid=" + rtkClickID + "&rtkck=" + cachebuster
                } else {
                    el.href = stripTrailingSlash(el.href) + "?clickid=" + rtkClickID + "&rtkck=" + cachebuster
                }
            }
            if (el.href.indexOf("clickid={clickid}") > -1) {
                el.href = el.href.replace(/{clickid}/, rawData.clickid) + "&rtkck=" + cachebuster;
            }
        });
    }
}, 5e1)

function setCookie() {
    var cookieName = "rtkclickid-store", cookieValue = rtkClickID, expirationTime = 86400 * 30 * 1000,
        date = new Date(), dateTimeNow = date.getTime();
    date.setTime(dateTimeNow + expirationTime);
    var date = date.toUTCString();
    document.cookie = cookieName + "=" + cookieValue + "; expires=" + date + "; path=/;"
}

;(function () {
    try {
        let attempt = 0
        const maxAttempts = 10 // = 10s (with 1s interval)
        const sent = {}
        const interval = setInterval(() => {
            try {
                attempt++
                const clickId = getCookie('rtkclickid-store')
                const fresh = clickId ? rtkPlatformCookies.filter(function (c) {
                    const v = rtkPlatformValue(c)
                    return v && v !== sent[c.key]
                }) : []

                if (fresh.length) {
                    const url = new URL('https://1vuyt.ttrk.io/clickupd/' + clickId)
                    fresh.forEach(function (c) {
                        const v = rtkPlatformValue(c)
                        url.searchParams.set(c.key, v)
                        sent[c.key] = v
                    })

                    const xhr = new XMLHttpRequest()
                    xhr.open('GET', url.href)
                    xhr.send()
                }
                if (attempt >= maxAttempts || rtkPlatformCookies.every(function (c) { return sent[c.key] })) {
                    clearInterval(interval)
                }
            } catch (e) {
                clearInterval(interval)
            }
        }, 1000)
    } catch (e) {}
})();