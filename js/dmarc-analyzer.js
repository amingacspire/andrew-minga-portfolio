(function () {
  'use strict';

  var form = document.getElementById('dra-form');
  if (!form) return;

  var status = document.getElementById('dra-status');
  var results = document.getElementById('dra-results');

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  // ── File decoding: xml, xml.gz, zip ──────────────────────────
  function decompress(buf, format) {
    var ds = new DecompressionStream(format);
    var stream = new Blob([buf]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer();
  }

  function bufToText(buf) {
    return new TextDecoder('utf-8').decode(buf);
  }

  // Minimal ZIP reader: walks the central directory, inflates entries.
  // Hardened against hostile archives: bounded offsets, entry/size caps,
  // local-header signature validation, explicit ZIP64 rejection.
  var ZIP_MAX_ENTRIES = 100;
  var ZIP_MAX_ENTRY_BYTES = 30 * 1024 * 1024;   // per-entry, compressed or declared uncompressed
  var ZIP_MAX_TOTAL_BYTES = 100 * 1024 * 1024;  // total declared uncompressed across entries
  var ZIP64_SENTINEL = 0xFFFFFFFF;

  function unzip(buf) {
    try {
      var view = new DataView(buf);
      var bytes = new Uint8Array(buf);
      var size = buf.byteLength;
      // Find end-of-central-directory (signature 0x06054b50), search from end
      var eocd = -1;
      for (var i = size - 22; i >= 0 && i > size - 65558; i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
      }
      if (eocd === -1) return Promise.reject(new Error('not a valid zip file'));
      var count = view.getUint16(eocd + 10, true);
      var cdOffset = view.getUint32(eocd + 16, true);
      if (count > ZIP_MAX_ENTRIES) return Promise.reject(new Error('zip has too many entries (max ' + ZIP_MAX_ENTRIES + ')'));
      if (cdOffset === ZIP64_SENTINEL) return Promise.reject(new Error('ZIP64 archives are not supported'));
      if (cdOffset >= size) return Promise.reject(new Error('corrupt zip (central directory out of bounds)'));

      var entries = [];
      var totalDeclared = 0;
      var p = cdOffset;
      for (var e = 0; e < count; e++) {
        if (p + 46 > size || view.getUint32(p, true) !== 0x02014b50) break;
        var method = view.getUint16(p + 10, true);
        var compSize = view.getUint32(p + 20, true);
        var uncompSize = view.getUint32(p + 24, true);
        var nameLen = view.getUint16(p + 28, true);
        var extraLen = view.getUint16(p + 30, true);
        var commentLen = view.getUint16(p + 32, true);
        var localOffset = view.getUint32(p + 42, true);
        if (compSize === ZIP64_SENTINEL || uncompSize === ZIP64_SENTINEL || localOffset === ZIP64_SENTINEL) {
          return Promise.reject(new Error('ZIP64 archives are not supported'));
        }
        if (compSize > ZIP_MAX_ENTRY_BYTES || uncompSize > ZIP_MAX_ENTRY_BYTES) {
          return Promise.reject(new Error('zip entry too large (max 30 MB)'));
        }
        totalDeclared += uncompSize;
        if (totalDeclared > ZIP_MAX_TOTAL_BYTES) {
          return Promise.reject(new Error('zip contents too large (max 100 MB total)'));
        }
        if (p + 46 + nameLen > size) break;
        var name = bufToText(bytes.slice(p + 46, p + 46 + nameLen).buffer);
        entries.push({ name: name, method: method, compSize: compSize, localOffset: localOffset });
        p += 46 + nameLen + extraLen + commentLen;
      }

      return Promise.all(entries.filter(function (en) {
        return /\.xml$/i.test(en.name);
      }).map(function (en) {
        // Local header: signature + 30 bytes fixed + name + extra
        var lp = en.localOffset;
        if (lp + 30 > size || view.getUint32(lp, true) !== 0x04034b50) {
          return Promise.reject(new Error('corrupt zip (bad local header for ' + en.name + ')'));
        }
        var lNameLen = view.getUint16(lp + 26, true);
        var lExtraLen = view.getUint16(lp + 28, true);
        var dataStart = lp + 30 + lNameLen + lExtraLen;
        if (dataStart + en.compSize > size) {
          return Promise.reject(new Error('corrupt zip (entry data out of bounds)'));
        }
        var data = buf.slice(dataStart, dataStart + en.compSize);
        if (en.method === 0) return Promise.resolve(bufToText(data));
        if (en.method === 8) return decompress(data, 'deflate-raw').then(bufToText);
        return Promise.reject(new Error('unsupported zip compression method ' + en.method));
      }));
    } catch (err) {
      return Promise.reject(new Error('not a valid zip file'));
    }
  }

  function fileToXmlTexts(file) {
    return file.arrayBuffer().then(function (buf) {
      var name = file.name.toLowerCase();
      var bytes = new Uint8Array(buf);
      var isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
      var isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
      if (isGzip || name.endsWith('.gz')) return decompress(buf, 'gzip').then(function (b) { return [bufToText(b)]; });
      if (isZip || name.endsWith('.zip')) return unzip(buf);
      return [bufToText(buf)];
    });
  }

  // ── XML parsing (RFC 7489 aggregate report) ──────────────────
  function text(el, tag) {
    var n = el ? el.querySelector(tag) : null;
    return n ? n.textContent.trim() : '';
  }

  function parseReport(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('XML did not parse; is this a DMARC aggregate report?');
    var fb = doc.querySelector('feedback');
    if (!fb) throw new Error('no <feedback> root; not a DMARC aggregate report');

    var meta = fb.querySelector('report_metadata');
    var pol = fb.querySelector('policy_published');
    var range = meta ? meta.querySelector('date_range') : null;

    var records = [];
    fb.querySelectorAll('record').forEach(function (rec) {
      var row = rec.querySelector('row');
      var pe = row ? row.querySelector('policy_evaluated') : null;
      var auth = rec.querySelector('auth_results');
      records.push({
        ip: text(row, 'source_ip'),
        count: parseInt(text(row, 'count'), 10) || 0,
        disposition: text(pe, 'disposition') || 'none',
        dkimAligned: text(pe, 'dkim') === 'pass',
        spfAligned: text(pe, 'spf') === 'pass',
        headerFrom: text(rec.querySelector('identifiers'), 'header_from'),
        rawSpf: auth ? Array.prototype.map.call(auth.querySelectorAll('spf'), function (s) {
          return text(s, 'domain') + ':' + text(s, 'result');
        }).join(', ') : '',
        rawDkim: auth ? Array.prototype.map.call(auth.querySelectorAll('dkim'), function (d) {
          return text(d, 'domain') + ':' + text(d, 'result');
        }).join(', ') : ''
      });
    });

    return {
      org: text(meta, 'org_name'),
      reportId: text(meta, 'report_id'),
      begin: parseInt(text(range, 'begin'), 10) || null,
      end: parseInt(text(range, 'end'), 10) || null,
      domain: text(pol, 'domain'),
      policy: text(pol, 'p'),
      pct: text(pol, 'pct'),
      records: records
    };
  }

  // ── Analysis + rendering ─────────────────────────────────────
  function fmtDate(unix) {
    return unix ? new Date(unix * 1000).toISOString().slice(0, 10) : '?';
  }

  function analyze(reports) {
    var allRecords = [];
    reports.forEach(function (r) { allRecords = allRecords.concat(r.records); });
    if (allRecords.length === 0) throw new Error('reports parsed but contained no records');

    var total = 0, passed = 0, wouldReject = 0;
    var bySource = {};
    allRecords.forEach(function (r) {
      total += r.count;
      var pass = r.dkimAligned || r.spfAligned;
      if (pass) passed += r.count; else wouldReject += r.count;
      var key = r.ip;
      if (!bySource[key]) bySource[key] = { ip: r.ip, count: 0, pass: 0, fail: 0, dispositions: {}, rawSpf: r.rawSpf, rawDkim: r.rawDkim };
      bySource[key].count += r.count;
      bySource[key][pass ? 'pass' : 'fail'] += r.count;
      bySource[key].dispositions[r.disposition] = (bySource[key].dispositions[r.disposition] || 0) + r.count;
    });

    var sources = Object.keys(bySource).map(function (k) { return bySource[k]; })
      .sort(function (a, b) { return b.count - a.count; });

    var orgs = reports.map(function (r) { return r.org; }).filter(Boolean);
    var domains = reports.map(function (r) { return r.domain; }).filter(Boolean);
    var begins = reports.map(function (r) { return r.begin; }).filter(Boolean);
    var ends = reports.map(function (r) { return r.end; }).filter(Boolean);

    return {
      reports: reports.length,
      orgs: orgs.filter(function (v, i) { return orgs.indexOf(v) === i; }),
      domains: domains.filter(function (v, i) { return domains.indexOf(v) === i; }),
      dateFrom: begins.length ? fmtDate(Math.min.apply(null, begins)) : '?',
      dateTo: ends.length ? fmtDate(Math.max.apply(null, ends)) : '?',
      policies: reports.map(function (r) { return r.policy; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; }),
      total: total,
      passed: passed,
      wouldReject: wouldReject,
      sources: sources
    };
  }

  function ptrEnrich(sources) {
    // Reverse DNS for the top sources, best effort
    var top = sources.slice(0, 20);
    return Promise.all(top.map(function (s) {
      var name;
      if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s.ip)) {
        name = s.ip.split('.').reverse().join('.') + '.in-addr.arpa';
      } else if (s.ip.indexOf(':') !== -1) {
        var halves = s.ip.toLowerCase().split('::');
        var left = halves[0] ? halves[0].split(':') : [];
        var right = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
        if (halves.length > 1) while (left.length + right.length < 8) left.push('0');
        var hextets = left.concat(right);
        if (hextets.length !== 8) return Promise.resolve();
        name = hextets.map(function (h) { return ('0000' + h).slice(-4); }).join('')
          .split('').reverse().join('.') + '.ip6.arpa';
      } else {
        return Promise.resolve();
      }
      return fetch('https://cloudflare-dns.com/dns-query?name=' + name + '&type=PTR',
        { headers: { Accept: 'application/dns-json' } })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var a = (d.Answer || []).filter(function (x) { return x.type === 12; });
          if (a.length) s.host = a[0].data.replace(/\.$/, '');
        }).catch(function () {});
    }));
  }

  function render(a) {
    var passRate = a.total ? Math.round((a.passed / a.total) * 100) : 0;
    var chips =
      '<div class="checker__summary">' +
      '<span class="checker__summary-chip checker__summary-chip--' + (passRate >= 98 ? 'pass' : passRate >= 90 ? 'warn' : 'fail') + '">' + passRate + '% DMARC PASS</span>' +
      '<span class="checker__summary-chip checker__summary-chip--info">' + a.total.toLocaleString() + ' MESSAGES</span>' +
      '<span class="checker__summary-chip checker__summary-chip--info">' + a.sources.length + ' SOURCES</span>' +
      '</div>';

    var metaTable = '<table class="tool-table"><tbody>' +
      '<tr><th>Domain</th><td>' + esc(a.domains.join(', ') || '?') + '</td></tr>' +
      '<tr><th>Reports</th><td>' + a.reports + ' (' + esc(a.orgs.join(', ')) + ')</td></tr>' +
      '<tr><th>Date range</th><td>' + esc(a.dateFrom) + ' to ' + esc(a.dateTo) + '</td></tr>' +
      '<tr><th>Published policy</th><td>p=' + esc(a.policies.join(', ') || '?') + '</td></tr>' +
      '</tbody></table>';

    var impact;
    if (a.wouldReject === 0) {
      impact = '<div class="check-card check-card--pass"><div class="check-card__head">' +
        '<span class="check-card__chip">PASS</span><span class="check-card__title">Nothing breaks at p=reject</span></div>' +
        '<p class="check-card__note">Every message in these reports passed DMARC alignment. If this holds over a few weeks of reports, tightening policy is low risk.</p></div>';
    } else {
      var failSources = a.sources.filter(function (s) { return s.fail > 0; });
      impact = '<div class="check-card check-card--warn"><div class="check-card__head">' +
        '<span class="check-card__chip">WARN</span><span class="check-card__title">' + a.wouldReject.toLocaleString() +
        ' message(s) from ' + failSources.length + ' source(s) failed alignment</span></div>' +
        '<p class="check-card__note">These would be quarantined or rejected under an enforcing policy. Check whether they are legitimate senders needing SPF/DKIM setup (marked in the table below) or spoofing attempts that enforcement should stop.</p></div>';
    }

    var rows = a.sources.map(function (s) {
      var host = s.host ? '<br><span style="opacity:.7">' + esc(s.host) + '</span>' : '';
      var verdict = s.fail === 0
        ? '<span class="checker__summary-chip checker__summary-chip--pass">PASS</span>'
        : s.pass === 0
          ? '<span class="checker__summary-chip checker__summary-chip--fail">FAIL</span>'
          : '<span class="checker__summary-chip checker__summary-chip--warn">MIXED</span>';
      return '<tr><td class="tool-table__data">' + esc(s.ip) + host + '</td>' +
        '<td>' + s.count.toLocaleString() + '</td>' +
        '<td>' + verdict + '</td>' +
        '<td class="tool-table__data">' + esc(s.rawSpf || '—') + '</td>' +
        '<td class="tool-table__data">' + esc(s.rawDkim || '—') + '</td></tr>';
    }).join('');

    var table = '<h2 class="tool-subhead">Sending sources (by volume)</h2>' +
      '<div style="overflow-x:auto"><table class="tool-table">' +
      '<thead><tr><th>Source IP</th><th>Msgs</th><th>DMARC</th><th>SPF (raw)</th><th>DKIM (raw)</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';

    results.innerHTML = chips + metaTable + impact + table;
    results.hidden = false;
  }

  function run(xmlTexts) {
    var reports = [];
    var errors = [];
    xmlTexts.forEach(function (t) {
      try { reports.push(parseReport(t)); } catch (e) { errors.push(e.message); }
    });
    if (reports.length === 0) {
      throw new Error(errors[0] || 'no parseable reports found');
    }
    var a = analyze(reports);
    status.textContent = 'Resolving source hostnames…';
    return ptrEnrich(a.sources).then(function () {
      render(a);
      status.textContent = errors.length ? errors.length + ' file(s) skipped as unparseable.' : '';
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var files = document.getElementById('dra-files').files;
    var pasted = document.getElementById('dra-paste').value.trim();
    results.hidden = true;

    if (!files.length && !pasted) {
      status.textContent = 'Choose report files or paste XML first.';
      return;
    }
    status.textContent = 'Reading reports…';

    var jobs = Array.prototype.map.call(files, fileToXmlTexts);
    Promise.all(jobs).then(function (nested) {
      var texts = [];
      nested.forEach(function (arr) { texts = texts.concat(arr); });
      if (pasted) texts.push(pasted);
      return run(texts);
    }).catch(function (err) {
      status.textContent = 'Analysis failed: ' + err.message;
    });
  });

  // Sample report so anyone can try the tool instantly
  document.getElementById('dra-sample').addEventListener('click', function () {
    var sample =
      '<?xml version="1.0" encoding="UTF-8" ?>\n<feedback>\n' +
      '  <report_metadata><org_name>google.com</org_name><report_id>1234567890</report_id>' +
      '<date_range><begin>1752105600</begin><end>1752192000</end></date_range></report_metadata>\n' +
      '  <policy_published><domain>example.com</domain><adkim>r</adkim><aspf>r</aspf><p>none</p><pct>100</pct></policy_published>\n' +
      '  <record><row><source_ip>209.85.220.41</source_ip><count>412</count>' +
      '<policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated></row>' +
      '<identifiers><header_from>example.com</header_from></identifiers>' +
      '<auth_results><dkim><domain>example.com</domain><result>pass</result><selector>google</selector></dkim>' +
      '<spf><domain>example.com</domain><result>pass</result></spf></auth_results></record>\n' +
      '  <record><row><source_ip>198.51.100.24</source_ip><count>37</count>' +
      '<policy_evaluated><disposition>none</disposition><dkim>fail</dkim><spf>fail</spf></policy_evaluated></row>' +
      '<identifiers><header_from>example.com</header_from></identifiers>' +
      '<auth_results><dkim><domain>example.com</domain><result>fail</result></dkim>' +
      '<spf><domain>mailer.example.net</domain><result>pass</result></spf></auth_results></record>\n' +
      '</feedback>';
    document.getElementById('dra-paste').value = sample;
    status.textContent = 'Sample loaded (one healthy source, one failing). Click Analyze.';
  });
})();
