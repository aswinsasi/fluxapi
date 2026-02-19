// ═══════════════════════════════════════════════════════════════
// FluxAPI DevTools Panel — Professional Edition
// Self-contained: uses chrome.devtools.network API only
// ═══════════════════════════════════════════════════════════════

var scanning = false, scanStart = 0, requests = [], timer = null, report = null;

// Wire everything after DOM is ready
window.onload = function() {
  document.getElementById('scanBtn').onclick = toggleScan;
  document.getElementById('exportHtmlBtn').onclick = doExportHtml;
  document.getElementById('exportJsonBtn').onclick = doExportJson;
  document.getElementById('clearBtn').onclick = doClear;

  document.querySelectorAll('.tab').forEach(function(t) {
    t.onclick = function() {
      document.querySelectorAll('.tab').forEach(function(x) { x.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function(x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.getElementById(t.dataset.tab + 'Panel').classList.add('active');
    };
  });

  console.log('[FluxAPI] Panel ready');

  // Event delegation for dynamically created elements
  document.addEventListener('click', function(e) {
    // Violation card toggle
    var toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      var id = toggle.getAttribute('data-toggle');
      var card = document.getElementById(id);
      if (card) card.classList.toggle('expanded');
      return;
    }
    // Copy fix button
    var copyBtn = e.target.closest('[data-copyfix]');
    if (copyBtn) {
      var idx = copyBtn.getAttribute('data-copyfix');
      cpFix(parseInt(idx));
      return;
    }
  });
};

// ═══════════ SCAN CONTROL ═══════════

function toggleScan() { scanning ? stopScan() : startScan(); }

function startScan() {
  scanning = true; scanStart = Date.now(); requests = []; report = null;

  var btn = document.getElementById('scanBtn');
  btn.className = 'scan-btn stop'; btn.textContent = '■ STOP';
  document.getElementById('exportHtmlBtn').style.display = 'none'; document.getElementById('exportJsonBtn').style.display = 'none';
  document.getElementById('clearBtn').style.display = 'none';
  document.getElementById('tabBar').style.display = 'none';

  showPanel('livePanel');
  renderLive();

  chrome.devtools.network.onRequestFinished.addListener(onReq);
}

function stopScan() {
  scanning = false;
  chrome.devtools.network.onRequestFinished.removeListener(onReq);
  if (timer) { clearInterval(timer); timer = null; }

  var btn = document.getElementById('scanBtn');
  btn.className = 'scan-btn analyzing'; btn.textContent = '⏳ ANALYZING';
  var elapsed = Math.round((Date.now() - scanStart) / 1000);
  document.getElementById('status').textContent = requests.length + ' reqs · ' + elapsed + 's';

  setTimeout(function() { analyze(); }, 100);
}

function onReq(har) {
  if (!scanning) return;
  var url = har.request.url;
  if (url.indexOf('chrome') === 0 || url.indexOf('data:') === 0 || url.indexOf('blob:') === 0) return;

  var st = new Date(har.startedDateTime).getTime();
  var dur = Math.round(har.time || 0);
  var method = har.request.method;
  var rh = {};
  if (har.response && har.response.headers) {
    har.response.headers.forEach(function(h) { rh[h.name.toLowerCase()] = h.value; });
  }

  var seq = requests.length + 1;
  requests.push({
    id: 'fx' + seq, url: url, method: method, urlParts: parseUrl(url),
    headers: {}, bodySize: har.request.bodySize || 0, bodyHash: null,
    startTime: st, ttfb: st + Math.round(dur * 0.3), endTime: st + dur, duration: dur,
    response: har.response ? {
      status: har.response.status, statusText: har.response.statusText || '', headers: rh,
      bodySize: har.response.content ? har.response.content.size || 0 : 0,
      contentType: har.response.content ? har.response.content.mimeType || null : null,
      cacheHeaders: {
        cacheControl: rh['cache-control'] || null, etag: rh['etag'] || null,
        lastModified: rh['last-modified'] || null, expires: rh['expires'] || null,
        age: rh['age'] || null, acceptEncoding: false, contentEncoding: rh['content-encoding'] || null,
      },
      bodyHash: 'h' + seq, jsonFieldCount: null, fromCache: har.response.status === 304,
    } : null,
    initiator: { stackTrace: [], componentName: null, componentFile: null, rawStack: '' },
    navigationContext: { currentRoute: '/', previousRoute: null, timeSinceNavigation: 0, pageState: 'complete' },
    type: classify(url, method), source: 'devtools', error: null, sequence: seq,
  });
}

// ═══════════ ANALYSIS ═══════════

function analyze() {
  var apiReqs = requests.filter(function(r) { return r.type === 'api-rest' || r.type === 'api-graphql'; });
  var violations = [];
  var effScore = 100, cacheScore = 100;

  // E1: Waterfall detection
  if (apiReqs.length >= 3) {
    var sorted = apiReqs.slice().sort(function(a,b) { return a.startTime - b.startTime; });
    var chains = []; var chain = [sorted[0]];
    for (var i = 1; i < sorted.length; i++) {
      var prev = chain[chain.length - 1];
      var gap = sorted[i].startTime - (prev.startTime + prev.duration);
      if (gap >= -20 && gap <= 50 && sorted[i].startTime >= prev.startTime + prev.duration * 0.8) {
        chain.push(sorted[i]);
      } else {
        if (chain.length >= 3) chains.push(chain.slice());
        chain = [sorted[i]];
      }
    }
    if (chain.length >= 3) chains.push(chain);
    chains.forEach(function(c) {
      var totalTime = c.reduce(function(s,r) { return s + r.duration; }, 0);
      var maxTime = Math.max.apply(null, c.map(function(r) { return r.duration; }));
      violations.push({
        ruleId: 'E1', severity: 'critical',
        title: c.length + ' sequential requests (waterfall)',
        description: c.length + ' API calls run one after another. Use Promise.all or useSuspenseQueries to parallelize.',
        endpoints: c.map(function(r) { return r.method + ' ' + (r.urlParts.pathname || r.url); }),
        impact: { timeSavedMs: totalTime - maxTime, requestsEliminated: 0, bandwidthSavedBytes: 0 },
        fix: 'const results = await Promise.all([\n' + c.map(function(r) { return '  fetch(\'' + r.url.replace(/'/g,"\\'") + '\'),'; }).join('\n') + '\n]);',
      });
      effScore -= Math.min(20, c.length * 5);
    });
  }

  // E2: Duplicates
  var sigs = {};
  apiReqs.forEach(function(r) {
    var sig = r.method + '|' + (r.urlParts.pathPattern);
    if (!sigs[sig]) sigs[sig] = [];
    sigs[sig].push(r);
  });
  Object.keys(sigs).forEach(function(sig) {
    var g = sigs[sig];
    if (g.length >= 2) {
      var s = g.slice().sort(function(a,b) { return a.startTime - b.startTime; });
      if (s[s.length-1].startTime - s[0].startTime <= 3000) {
        violations.push({
          ruleId: 'E2', severity: 'critical',
          title: sig.split('|')[1] + ' called ' + g.length + 'x',
          description: 'Same endpoint hit ' + g.length + ' times within ' + Math.round(s[s.length-1].startTime - s[0].startTime) + 'ms. Extract a shared useQuery hook.',
          endpoints: g.map(function(r) { return r.method + ' ' + (r.urlParts.pathname || r.url); }),
          impact: { timeSavedMs: (g.length - 1) * Math.round(g.reduce(function(s,r){return s+r.duration},0) / g.length), requestsEliminated: g.length - 1, bandwidthSavedBytes: 0 },
          fix: 'export function use' + hookName(sig.split('|')[1]) + '() {\n  return useQuery({\n    queryKey: [\'' + sig.split('|')[1].replace(/\//g,'-').replace(/^-/,'') + '\'],\n    queryFn: () => fetch(\'' + g[0].url + '\').then(r => r.json()),\n    staleTime: 30_000,\n  });\n}',
        });
        effScore -= Math.min(15, g.length * 4);
      }
    }
  });

  // E3: N+1
  var pats = {};
  apiReqs.forEach(function(r) {
    var p = r.urlParts.pathPattern;
    if (p.indexOf(':id') !== -1 || p.indexOf(':uuid') !== -1) {
      var k = r.method + '|' + p;
      if (!pats[k]) pats[k] = [];
      pats[k].push(r);
    }
  });
  Object.keys(pats).forEach(function(k) {
    var g = pats[k];
    if (g.length >= 5) {
      violations.push({
        ruleId: 'E3', severity: 'critical',
        title: 'N+1: ' + g.length + '× ' + k.split('|')[1],
        description: g.length + ' individual requests to a parameterized endpoint. Batch with a single request.',
        endpoints: g.slice(0, 5).map(function(r) { return r.urlParts.pathname; }),
        impact: { timeSavedMs: Math.round(g.reduce(function(s,r){return s+r.duration},0) * 0.85), requestsEliminated: g.length - 1, bandwidthSavedBytes: 0 },
        fix: '// Batch endpoint\nfetch(\'/api' + k.split('|')[1].replace(':id','') + '?ids=' + g.slice(0,3).map(function(r){return r.urlParts.pathname.split('/').pop()}).join(',') + ',...\')',
      });
      effScore -= Math.min(15, g.length * 2);
    }
  });

  // C1: No cache
  var eps = {};
  apiReqs.filter(function(r) { return r.method === 'GET' && r.response; }).forEach(function(r) {
    var k = r.urlParts.pathPattern;
    if (!eps[k]) eps[k] = [];
    eps[k].push(r);
  });
  Object.keys(eps).forEach(function(ep) {
    var g = eps[ep];
    if (g.length >= 2) {
      var uncached = g.every(function(r) {
        var c = r.response.cacheHeaders;
        return !c.cacheControl && !c.etag && !c.lastModified;
      });
      if (uncached) {
        violations.push({
          ruleId: 'C1', severity: 'critical',
          title: 'No cache: ' + ep + ' (' + g.length + '×)',
          description: 'No Cache-Control, ETag, or Last-Modified. Every mount triggers a network request.',
          endpoints: [ep],
          impact: { timeSavedMs: (g.length-1) * Math.round(g.reduce(function(s,r){return s+r.duration},0)/g.length), requestsEliminated: g.length - 1, bandwidthSavedBytes: g.reduce(function(s,r){return s+(r.response.bodySize||0)},0) },
          fix: '// Add to your query\nuseQuery({\n  queryKey: [\'' + ep.replace(/\//g,'-').replace(/^-/,'') + '\'],\n  queryFn: fetchFn,\n  staleTime: 30_000,  // 30 seconds\n  gcTime: 5 * 60_000, // 5 minutes\n});',
        });
        cacheScore -= Math.min(20, g.length * 4);
      }
    }
  });

  effScore = Math.max(0, effScore);
  cacheScore = Math.max(0, cacheScore);
  var overall = Math.round(effScore * 0.6 + cacheScore * 0.4);
  var grade = overall >= 90 ? 'excellent' : overall >= 70 ? 'good' : overall >= 50 ? 'needs-work' : 'poor';
  var crits = violations.filter(function(v){return v.severity==='critical'}).length;
  var warns = violations.filter(function(v){return v.severity==='warning'}).length;
  var infos = violations.filter(function(v){return v.severity==='info'}).length;

  report = {
    score: { overall: overall, grade: grade, efficiency: effScore, caching: cacheScore, patterns: 100 },
    violations: violations,
    summary: { criticalCount: crits, warningCount: warns, infoCount: infos, totalViolations: violations.length },
    requests: requests,
    apiRequests: apiReqs,
    metadata: { totalRequests: requests.length, apiRequests: apiReqs.length, duration: Math.round((Date.now() - scanStart) / 1000) },
  };

  renderResults();
}

// ═══════════ RENDER ═══════════

function renderLive() {
  document.getElementById('livePanel').innerHTML =
    '<div class="live"><div class="live-num" id="liveNum">0</div>' +
    '<div class="live-label">requests captured</div>' +
    '<div class="live-timer" id="liveTime">00:00</div>' +
    '<div class="live-bar"><div class="live-bar-fill"></div></div>' +
    '<div class="live-feed" id="liveFeed"></div></div>';

  timer = setInterval(function() {
    var el = Math.round((Date.now() - scanStart) / 1000);
    var mm = String(Math.floor(el/60)).padStart(2,'0');
    var ss = String(el%60).padStart(2,'0');
    document.getElementById('liveTime').textContent = mm + ':' + ss;
    document.getElementById('liveNum').textContent = requests.length;

    // Show last 8 requests in feed
    var feed = document.getElementById('liveFeed');
    var recent = requests.slice(-8).reverse();
    feed.innerHTML = recent.map(function(r) {
      var path = r.urlParts.pathname || r.url;
      if (path.length > 50) path = '...' + path.slice(-47);
      return '<div class="live-req"><span class="m">' + r.method + '</span><span class="u">' + esc(path) + '</span><span class="t">' + r.duration + 'ms</span></div>';
    }).join('');
  }, 200);
}

function renderResults() {
  var r = report;
  var btn = document.getElementById('scanBtn');
  btn.className = 'scan-btn start'; btn.textContent = '▶ RESCAN';
  document.getElementById('exportHtmlBtn').style.display = ''; document.getElementById('exportJsonBtn').style.display = '';
  document.getElementById('clearBtn').style.display = '';
  document.getElementById('tabBar').style.display = 'flex';

  // Update badges
  var vb = document.getElementById('vBadge');
  vb.style.display = r.violations.length > 0 ? '' : 'none';
  vb.textContent = r.violations.length;
  if (r.summary.criticalCount > 0) vb.className = 'badge critical';
  document.getElementById('rBadge').textContent = r.metadata.apiRequests;

  renderOverview();
  renderViolations();
  renderRequests();
  renderWaterfall();

  // Show overview
  showPanel('overviewPanel');
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active')});
  document.querySelector('[data-tab="overview"]').classList.add('active');
}

function renderOverview() {
  var r = report, s = r.score;
  var color = s.overall >= 90 ? 'var(--green)' : s.overall >= 70 ? 'var(--blue)' : s.overall >= 50 ? 'var(--orange)' : 'var(--red)';
  var dash = Math.round((s.overall / 100) * 251);

  var totalTime = r.violations.reduce(function(a,v){return a+(v.impact.timeSavedMs||0)},0);
  var totalReqs = r.violations.reduce(function(a,v){return a+(v.impact.requestsEliminated||0)},0);
  var totalBw = r.violations.reduce(function(a,v){return a+(v.impact.bandwidthSavedBytes||0)},0);

  var h = '';

  // Score + stats
  h += '<div class="score-row">';
  h += '<div class="score-gauge"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="40"/><circle class="value" cx="50" cy="50" r="40" stroke-dasharray="' + dash + ' 251" style="stroke:' + color + '"/></svg><div class="num"><span class="n" style="color:' + color + '">' + s.overall + '</span><span class="g" style="color:' + color + '">' + s.grade + '</span></div></div>';
  h += '<div class="score-details"><h3>API Health Score</h3><div style="font-size:11px;color:var(--fg3)">' + r.metadata.apiRequests + ' API calls captured in ' + r.metadata.duration + 's</div>';
  h += '<div class="stat-grid">';
  h += '<div class="stat-card red"><div class="num">' + r.summary.criticalCount + '</div><div class="label">Critical</div></div>';
  h += '<div class="stat-card orange"><div class="num">' + r.summary.warningCount + '</div><div class="label">Warnings</div></div>';
  h += '<div class="stat-card blue"><div class="num">' + r.metadata.apiRequests + '</div><div class="label">API Calls</div></div>';
  h += '</div></div></div>';

  // Impact banner
  if (totalTime > 0 || totalReqs > 0) {
    h += '<div class="impact">';
    if (totalTime > 0) h += '<div class="impact-item"><div class="val" style="color:var(--blue)">⚡ ' + fmtMs(totalTime) + '</div><div class="lbl">Time Saved</div></div>';
    if (totalReqs > 0) h += '<div class="impact-item"><div class="val" style="color:var(--green)">📉 ' + totalReqs + '</div><div class="lbl">Fewer Requests</div></div>';
    if (totalBw > 0) h += '<div class="impact-item"><div class="val" style="color:var(--orange)">💾 ' + fmtBytes(totalBw) + '</div><div class="lbl">Bandwidth</div></div>';
    h += '</div>';
  }

  // Category bars
  h += '<div class="cat-section">';
  var cats = [
    { icon: '⚡', name: 'Efficiency', score: s.efficiency, color: s.efficiency >= 70 ? 'var(--green)' : s.efficiency >= 50 ? 'var(--orange)' : 'var(--red)' },
    { icon: '💾', name: 'Caching', score: s.caching, color: s.caching >= 70 ? 'var(--green)' : s.caching >= 50 ? 'var(--orange)' : 'var(--red)' },
    { icon: '🔄', name: 'Patterns', score: s.patterns, color: 'var(--green)' },
  ];
  cats.forEach(function(c) {
    h += '<div class="cat-row"><span class="cat-icon">' + c.icon + '</span><span class="cat-name">' + c.name + '</span>';
    h += '<div class="cat-track"><div class="cat-fill" style="width:' + c.score + '%;background:' + c.color + '"></div></div>';
    h += '<span class="cat-pct" style="color:' + c.color + '">' + c.score + '%</span></div>';
  });
  h += '</div>';

  // Top violations preview
  if (r.violations.length > 0) {
    h += '<div style="font-size:11px;font-weight:700;color:var(--fg2);margin-bottom:6px">Top Issues</div>';
    r.violations.slice(0, 3).forEach(function(v) {
      h += '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:11px">';
      h += '<span class="v-sev ' + v.severity + '" style="width:5px;height:5px"></span>';
      h += '<span style="color:var(--fg3);font-family:var(--mono);font-size:10px;width:20px">' + v.ruleId + '</span>';
      h += '<span style="flex:1">' + esc(v.title) + '</span>';
      if (v.impact.timeSavedMs > 0) h += '<span style="color:var(--blue);font-size:10px">⚡' + fmtMs(v.impact.timeSavedMs) + '</span>';
      h += '</div>';
    });
  } else {
    h += '<div style="text-align:center;color:var(--green);padding:16px;font-size:14px;font-weight:700">✨ No API issues found!</div>';
  }

  document.getElementById('overviewPanel').innerHTML = h;
}

function renderViolations() {
  var h = '';
  if (report.violations.length === 0) {
    h = '<div class="empty-state"><div class="icon">✨</div><p>No violations detected</p></div>';
  } else {
    report.violations.forEach(function(v, i) {
      h += '<div class="v-card" id="vc' + i + '">';
      h += '<div class="v-head" data-toggle="vc' + i + '">';
      h += '<span class="v-sev ' + v.severity + '"></span>';
      h += '<span class="v-rule">' + v.ruleId + '</span>';
      h += '<span class="v-title">' + esc(v.title) + '</span>';
      h += '<div class="v-pills">';
      if (v.impact.timeSavedMs > 0) h += '<span class="v-pill time">⚡' + fmtMs(v.impact.timeSavedMs) + '</span>';
      if (v.impact.requestsEliminated > 0) h += '<span class="v-pill reqs">📉' + v.impact.requestsEliminated + '</span>';
      if (v.impact.bandwidthSavedBytes > 0) h += '<span class="v-pill bw">💾' + fmtBytes(v.impact.bandwidthSavedBytes) + '</span>';
      h += '</div></div>';
      h += '<div class="v-expand">';
      h += '<div class="v-desc">' + esc(v.description) + '</div>';
      if (v.fix) {
        h += '<div class="v-fix"><div class="v-fix-head"><span class="lang">Fix</span><button class="copy-btn" data-copyfix="' + i + '">Copy</button></div>';
        h += '<pre id="fix' + i + '">' + esc(v.fix) + '</pre></div>';
      }
      h += '</div></div>';
    });
  }
  document.getElementById('violationsPanel').innerHTML = h;
}

function renderRequests() {
  var apiReqs = report.apiRequests;
  if (apiReqs.length === 0) {
    document.getElementById('requestsPanel').innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>No API requests captured. Make sure to browse your app during the scan.</p></div>';
    return;
  }

  var h = '<table class="req-table"><thead><tr><th>Method</th><th>Path</th><th>Status</th><th>Duration</th><th>Size</th><th>Cache</th></tr></thead><tbody>';
  apiReqs.slice().sort(function(a,b){return a.startTime-b.startTime}).forEach(function(r) {
    var path = r.urlParts.pathname || r.url;
    if (path.length > 60) path = path.slice(0, 57) + '...';
    var status = r.response ? r.response.status : 0;
    var statusClass = status >= 200 && status < 400 ? 'status-ok' : 'status-err';
    var size = r.response ? r.response.bodySize : 0;
    var cc = r.response ? r.response.cacheHeaders.cacheControl : null;
    var cacheTag = cc ? '<span class="type-tag">' + esc(cc.slice(0, 20)) + '</span>' : '<span style="color:var(--red)">none</span>';

    h += '<tr><td class="method">' + r.method + '</td><td title="' + esc(r.url) + '">' + esc(path) + '</td>';
    h += '<td class="' + statusClass + '">' + status + '</td>';
    h += '<td class="dur">' + r.duration + 'ms</td>';
    h += '<td>' + fmtBytes(size) + '</td>';
    h += '<td>' + cacheTag + '</td></tr>';
  });
  h += '</tbody></table>';
  document.getElementById('requestsPanel').innerHTML = h;
}

function renderWaterfall() {
  var apiReqs = report.apiRequests;
  if (apiReqs.length === 0) {
    document.getElementById('waterfallPanel').innerHTML = '<div class="empty-state"><div class="icon">📊</div><p>No requests to visualize</p></div>';
    return;
  }

  var sorted = apiReqs.slice().sort(function(a,b){return a.startTime-b.startTime});
  var minTime = sorted[0].startTime;
  var maxTime = Math.max.apply(null, sorted.map(function(r){return r.endTime}));
  var range = maxTime - minTime || 1;

  var h = '<div style="font-size:11px;color:var(--fg3);margin-bottom:8px">Request Timeline (' + fmtMs(range) + ' total)</div>';
  h += '<div class="wf-container">';
  sorted.slice(0, 40).forEach(function(r) {
    var left = ((r.startTime - minTime) / range * 100).toFixed(1);
    var width = Math.max(1, (r.duration / range * 100)).toFixed(1);
    var path = r.urlParts.pathname || r.url;
    var short = path.length > 18 ? '...' + path.slice(-15) : path;
    var isApi = r.type === 'api-rest' || r.type === 'api-graphql';

    h += '<div class="wf-bar-row">';
    h += '<span class="wf-label" title="' + esc(path) + '">' + esc(short) + '</span>';
    h += '<div class="wf-track"><div class="wf-seg ' + (isApi ? 'api' : 'static') + '" style="left:' + left + '%;width:' + width + '%"></div></div>';
    h += '<span class="wf-time">' + r.duration + 'ms</span>';
    h += '</div>';
  });
  if (sorted.length > 40) h += '<div style="text-align:center;color:var(--fg3);font-size:11px;padding:8px">+' + (sorted.length - 40) + ' more requests</div>';
  h += '</div>';

  document.getElementById('waterfallPanel').innerHTML = h;
}

// ═══════════ ACTIONS ═══════════

function doExportJson() {
  if (!report) return;
  var data = JSON.stringify(report, null, 2);
  var blob = new Blob([data], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'fluxapi-report-' + Date.now() + '.json';
  a.click();
}

function doExportHtml() {
  if (!report) return;
  var s = report.score;
  var v = report.violations;
  var m = report.metadata;
  var color = s.overall >= 90 ? '#3dd68c' : s.overall >= 70 ? '#5ba8f5' : s.overall >= 50 ? '#f0a84a' : '#f06b7e';
  var dash = Math.round((s.overall / 100) * 251);
  var totalTime = v.reduce(function(a,x){return a+(x.impact.timeSavedMs||0)},0);
  var totalReqs = v.reduce(function(a,x){return a+(x.impact.requestsEliminated||0)},0);
  var totalBw = v.reduce(function(a,x){return a+(x.impact.bandwidthSavedBytes||0)},0);
  var net = document.getElementById('netSel').value;
  var ts = new Date().toLocaleString();

  var html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FluxAPI Report — Score ' + s.overall + '/100</title><style>';
  html += ':root{--bg:#0e0e1a;--bg2:#13132a;--bg3:#1c1c3a;--fg:#e2e4f0;--fg2:#9ca3bf;--fg3:#636b83;--accent:#7c6afc;--green:#3dd68c;--red:#f06b7e;--orange:#f0a84a;--blue:#5ba8f5;--border:rgba(255,255,255,0.06);--mono:"SF Mono","Fira Code","JetBrains Mono",Consolas,monospace}';
  html += '*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--fg);padding:32px;max-width:800px;margin:0 auto;font-size:14px;line-height:1.6}';
  html += 'h1{font-size:24px;font-weight:900;margin-bottom:4px;display:flex;align-items:center;gap:10px}';
  html += '.sub{color:var(--fg3);font-size:13px;margin-bottom:24px}';
  html += '.score-row{display:flex;gap:24px;align-items:center;margin-bottom:24px}';
  html += '.gauge{position:relative;width:120px;height:120px;flex-shrink:0}';
  html += '.gauge svg{width:100%;height:100%;transform:rotate(-90deg)}.gauge .track{fill:none;stroke:var(--bg3);stroke-width:8}.gauge .val{fill:none;stroke-width:8;stroke-linecap:round}';
  html += '.gauge .num{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}.gauge .n{font-size:36px;font-weight:900}.gauge .g{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px}';
  html += '.cats{margin-bottom:24px}.cat{display:flex;align-items:center;gap:10px;margin-bottom:8px}.cat-name{width:80px;font-size:13px;font-weight:600;color:var(--fg2)}.cat-track{flex:1;height:8px;background:var(--bg3);border-radius:99px;overflow:hidden}.cat-fill{height:100%;border-radius:99px}.cat-pct{width:40px;text-align:right;font-size:13px;font-weight:800;font-family:var(--mono)}';
  html += '.impact{display:flex;gap:16px;padding:16px;border-radius:10px;background:var(--bg2);border:1px solid var(--border);margin-bottom:24px}.impact-item{flex:1;text-align:center}.impact-item .v{font-size:20px;font-weight:900}.impact-item .l{font-size:10px;color:var(--fg3);text-transform:uppercase;letter-spacing:0.5px;margin-top:2px}';
  html += '.section{font-size:16px;font-weight:800;margin:24px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--border)}';
  html += '.card{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:8px}';
  html += '.card-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}.sev{width:8px;height:8px;border-radius:50%}.sev-c{background:var(--red)}.sev-w{background:var(--orange)}.sev-i{background:var(--blue)}';
  html += '.rule{font-size:11px;font-weight:800;font-family:var(--mono);color:var(--fg3)}.title{font-size:13px;font-weight:700;flex:1}';
  html += '.pills{display:flex;gap:6px;margin-bottom:8px}.pill{font-size:11px;padding:2px 8px;border-radius:99px;background:var(--bg3);color:var(--fg2)}';
  html += '.desc{font-size:12px;color:var(--fg3);margin-bottom:10px}';
  html += '.fix{background:var(--bg);border:1px solid var(--border);border-radius:8px;overflow:hidden}.fix-head{padding:6px 10px;background:rgba(255,255,255,0.02);border-bottom:1px solid var(--border);font-size:11px;color:var(--fg3);font-family:var(--mono)}';
  html += '.fix pre{padding:12px;font-size:12px;font-family:var(--mono);color:var(--fg2);line-height:1.6;overflow-x:auto;white-space:pre}';
  html += '.req-table{width:100%;border-collapse:collapse;margin-top:8px}';
  html += '.req-table th{text-align:left;padding:6px 10px;font-size:11px;color:var(--fg3);text-transform:uppercase;border-bottom:1px solid var(--border);font-weight:700}';
  html += '.req-table td{padding:4px 10px;font-size:12px;font-family:var(--mono);border-bottom:1px solid var(--border)}';
  html += '.method{color:var(--accent)}.ok{color:var(--green)}.err{color:var(--red)}.dur{color:var(--orange)}';
  html += '.footer{text-align:center;color:var(--fg3);font-size:11px;margin-top:32px;padding-top:16px;border-top:1px solid var(--border)}';
  html += '</style></head><body>';

  // Header
  html += '<h1><svg width="28" height="28" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="8" fill="#7c6afc"/><path d="M8 10h16M8 16h12M8 22h8" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg> FluxAPI Report</h1>';
  html += '<div class="sub">' + ts + ' · ' + m.apiRequests + ' API calls · ' + m.duration + 's scan · Network: ' + esc(net) + '</div>';

  // Score + gauge
  html += '<div class="score-row"><div class="gauge"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="40"/><circle class="val" cx="50" cy="50" r="40" stroke-dasharray="' + dash + ' 251" style="stroke:' + color + '"/></svg><div class="num"><span class="n" style="color:' + color + '">' + s.overall + '</span><span class="g" style="color:' + color + '">' + s.grade + '</span></div></div>';
  html += '<div style="flex:1"><div style="font-size:18px;font-weight:800;margin-bottom:8px">API Health Score</div>';

  // Category bars
  html += '<div class="cats">';
  var cats = [{n:'Efficiency',s:s.efficiency,i:'⚡'},{n:'Caching',s:s.caching,i:'💾'},{n:'Patterns',s:s.patterns,i:'🔄'}];
  cats.forEach(function(c) {
    var cc = c.s >= 70 ? 'var(--green)' : c.s >= 50 ? 'var(--orange)' : 'var(--red)';
    html += '<div class="cat"><span style="width:18px;text-align:center">' + c.i + '</span><span class="cat-name">' + c.n + '</span><div class="cat-track"><div class="cat-fill" style="width:' + c.s + '%;background:' + cc + '"></div></div><span class="cat-pct" style="color:' + cc + '">' + c.s + '%</span></div>';
  });
  html += '</div></div></div>';

  // Impact
  if (totalTime > 0 || totalReqs > 0 || totalBw > 0) {
    html += '<div class="impact">';
    if (totalTime > 0) html += '<div class="impact-item"><div class="v" style="color:var(--blue)">⚡ ' + fmtMs(totalTime) + '</div><div class="l">Time Saved</div></div>';
    if (totalReqs > 0) html += '<div class="impact-item"><div class="v" style="color:var(--green)">📉 ' + totalReqs + '</div><div class="l">Fewer Requests</div></div>';
    if (totalBw > 0) html += '<div class="impact-item"><div class="v" style="color:var(--orange)">💾 ' + fmtBytes(totalBw) + '</div><div class="l">Bandwidth Saved</div></div>';
    html += '</div>';
  }

  // Violations
  if (v.length > 0) {
    html += '<div class="section">Issues Found (' + v.length + ')</div>';
    v.forEach(function(vi) {
      html += '<div class="card"><div class="card-head"><span class="sev sev-' + vi.severity.charAt(0) + '"></span><span class="rule">' + vi.ruleId + '</span><span class="title">' + esc(vi.title) + '</span></div>';
      html += '<div class="pills">';
      if (vi.impact.timeSavedMs > 0) html += '<span class="pill">⚡ ' + fmtMs(vi.impact.timeSavedMs) + ' faster</span>';
      if (vi.impact.requestsEliminated > 0) html += '<span class="pill">📉 ' + vi.impact.requestsEliminated + ' fewer</span>';
      if (vi.impact.bandwidthSavedBytes > 0) html += '<span class="pill">💾 ' + fmtBytes(vi.impact.bandwidthSavedBytes) + '</span>';
      html += '</div>';
      html += '<div class="desc">' + esc(vi.description) + '</div>';
      if (vi.fix) {
        html += '<div class="fix"><div class="fix-head">Suggested Fix</div><pre>' + esc(vi.fix) + '</pre></div>';
      }
      html += '</div>';
    });
  } else {
    html += '<div style="text-align:center;color:var(--green);padding:24px;font-size:18px;font-weight:700">✨ No API issues found!</div>';
  }

  // Request table
  var apiReqs = report.apiRequests || [];
  if (apiReqs.length > 0) {
    html += '<div class="section">API Requests (' + apiReqs.length + ')</div>';
    html += '<table class="req-table"><thead><tr><th>Method</th><th>Path</th><th>Status</th><th>Duration</th><th>Size</th></tr></thead><tbody>';
    apiReqs.slice().sort(function(a,b){return a.startTime-b.startTime}).forEach(function(r) {
      var path = r.urlParts.pathname || r.url;
      if (path.length > 60) path = path.slice(0, 57) + '...';
      var st = r.response ? r.response.status : 0;
      var sc = st >= 200 && st < 400 ? 'ok' : 'err';
      var sz = r.response ? r.response.bodySize : 0;
      html += '<tr><td class="method">' + r.method + '</td><td>' + esc(path) + '</td><td class="' + sc + '">' + st + '</td><td class="dur">' + r.duration + 'ms</td><td>' + fmtBytes(sz) + '</td></tr>';
    });
    html += '</tbody></table>';
  }

  html += '<div class="footer">Generated by FluxAPI · ' + ts + '</div>';
  html += '</body></html>';

  var blob = new Blob([html], { type: 'text/html' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'fluxapi-report-' + Date.now() + '.html';
  a.click();
}

function doClear() {
  report = null; requests = [];
  document.getElementById('tabBar').style.display = 'none';
  document.getElementById('exportHtmlBtn').style.display = 'none'; document.getElementById('exportJsonBtn').style.display = 'none';
  document.getElementById('clearBtn').style.display = 'none';
  document.getElementById('status').textContent = '';
  showPanel('idlePanel');
}

function cpFix(i) {
  var el = document.getElementById('fix' + i);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(function() {
    var btn = el.parentElement.querySelector('.copy-btn');
    btn.textContent = '✓ Copied';
    setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
  });
}

// ═══════════ HELPERS ═══════════

function showPanel(id) {
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  document.getElementById(id).classList.add('active');
}

function parseUrl(raw) {
  try {
    var u = new URL(raw);
    var segs = u.pathname.split('/').filter(Boolean);
    var pat = '/' + segs.map(function(s) {
      if (/^\d+$/.test(s)) return ':id';
      if (/^[0-9a-f]{8}-/.test(s)) return ':uuid';
      if (/^[a-f0-9]{24}$/.test(s)) return ':objectId';
      return s;
    }).join('/');
    return { host: u.host, pathPattern: pat, pathname: u.pathname, pathSegments: segs };
  } catch(e) { return { host: '', pathPattern: raw, pathname: raw, pathSegments: [] }; }
}

function classify(url, method) {
  var l = url.toLowerCase();
  if (l.indexOf('/graphql') !== -1) return 'api-graphql';
  if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map)(\?|$)/.test(l)) return 'static';
  if (/\.(html?)(\?|$)/.test(l)) return 'document';
  if (l.indexOf('/api/') !== -1 || l.indexOf('/v1/') !== -1 || l.indexOf('/v2/') !== -1 || (method && method !== 'GET') || l.indexOf('.json') !== -1) return 'api-rest';
  return 'other';
}

function hookName(path) {
  return path.split('/').filter(Boolean).map(function(s) {
    if (s.charAt(0) === ':') return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }).join('');
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtMs(ms) { return ms >= 1000 ? (ms/1000).toFixed(1) + 's' : Math.round(ms) + 'ms'; }
function fmtBytes(b) { return b >= 1048576 ? (b/1048576).toFixed(1)+'MB' : b >= 1024 ? (b/1024).toFixed(1)+'KB' : b+'B'; }
