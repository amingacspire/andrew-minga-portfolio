(function () {
  'use strict';

  var DOH = 'https://cloudflare-dns.com/dns-query';

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function doh(name, type, resolver) {
    var base = resolver || DOH;
    return fetch(base + '?name=' + encodeURIComponent(name) + '&type=' + type,
      { headers: { Accept: 'application/dns-json' } })
      .then(function (r) { if (!r.ok) throw new Error('DNS ' + r.status); return r.json(); });
  }

  function txt(data) {
    return (data.Answer || [])
      .filter(function (a) { return a.type === 16; })
      .map(function (a) { return a.data.replace(/^"|"$/g, '').replace(/"\s+"/g, ''); });
  }

  function card(status, title, value, note) {
    var chip = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', info: 'INFO' }[status];
    return '<div class="check-card check-card--' + status + '"><div class="check-card__head">' +
      '<span class="check-card__chip">' + chip + '</span>' +
      '<span class="check-card__title">' + esc(title) + '</span></div>' +
      (value ? '<code class="check-card__value">' + esc(value) + '</code>' : '') +
      '<p class="check-card__note">' + note + '</p></div>';
  }

  function cleanDomain(raw) {
    return raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0];
  }
  function validDomain(d) { return /^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(d); }

  // ══════════════════════════════════════════════════════════════
  // SPF Policy Tree — recursive expansion with the 10-lookup budget
  // ══════════════════════════════════════════════════════════════
  var spfForm = document.getElementById('spftree-form');
  if (spfForm) {
    var LOOKUP_MECHS = ['include', 'a', 'mx', 'ptr', 'exists', 'redirect'];
    spfForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var domain = cleanDomain(document.getElementById('spftree-domain').value);
      var status = document.getElementById('spftree-status');
      var out = document.getElementById('spftree-results');
      if (!validDomain(domain)) { status.textContent = 'Enter a valid domain.'; out.hidden = true; return; }
      status.textContent = 'Expanding SPF for ' + domain + '…';
      out.hidden = true;

      var lookups = 0, voidLookups = 0, lines = [], warnings = [], seen = {};

      function getSpf(d) {
        return doh(d, 'TXT').then(function (data) {
          var recs = txt(data).filter(function (t) { return t.indexOf('v=spf1') === 0; });
          if (recs.length === 0) return null;
          if (recs.length > 1) warnings.push('Multiple SPF records on ' + d + ' — receivers permerror on this.');
          return recs[0];
        });
      }

      // depth-first expansion; each include/redirect/a/mx/ptr/exists costs one lookup
      function expand(d, record, depth) {
        var indent = new Array(depth + 1).join('   ');
        var tokens = record.split(/\s+/).filter(Boolean);
        lines.push(indent + esc(d) + ': ' + esc(record));
        var chain = Promise.resolve();
        tokens.forEach(function (tok) {
          var t = tok.replace(/^[+\-~?]/, '');
          var mech = t.split(':')[0].split('=')[0].toLowerCase();
          if (LOOKUP_MECHS.indexOf(mech) === -1) return;
          if (mech === 'include' || mech === 'redirect') {
            var target = t.split(/[:=]/)[1];
            if (!target) return;
            lookups++;
            chain = chain.then(function () {
              if (lookups > 10) return;
              if (seen[target]) { lines.push(indent + '   ' + esc(target) + ': (already expanded)'); return; }
              seen[target] = true;
              return getSpf(target).then(function (rec) {
                if (!rec) { voidLookups++; lines.push(indent + '   ' + esc(target) + ': NO SPF RECORD (void lookup)'); return; }
                return expand(target, rec, depth + 1);
              }).catch(function () { voidLookups++; lines.push(indent + '   ' + esc(target) + ': lookup failed'); });
            });
          } else {
            lookups++; // a, mx, ptr, exists each cost a lookup but we don't recurse them
            lines.push(indent + '   [' + esc(mech) + '] counts as 1 DNS lookup');
          }
        });
        return chain;
      }

      seen[domain] = true;
      getSpf(domain).then(function (rec) {
        if (!rec) { status.textContent = 'No SPF record found for ' + domain + '.'; return; }
        return expand(domain, rec, 0).then(function () {
          var cards = [];
          var lookStatus = lookups > 10 ? 'fail' : lookups > 8 ? 'warn' : 'pass';
          cards.push(card(lookStatus, 'DNS lookups: ' + lookups + ' of 10',
            null, lookups > 10 ? 'Over the RFC 7208 limit. Receivers will return permerror and SPF fails entirely.'
              : lookups > 8 ? 'Approaching the limit. Each new include risks tipping over 10.'
              : 'Within the 10-lookup limit.'));
          if (voidLookups > 0) cards.push(card('warn', 'Void lookups: ' + voidLookups, null,
            'Mechanisms resolving to no record. RFC 7208 recommends failing after 2 void lookups.'));
          warnings.forEach(function (w) { cards.push(card('warn', 'Warning', null, esc(w))); });
          out.innerHTML = cards.join('') +
            '<h2 class="tool-subhead">Expansion tree</h2><pre class="tool-record">' + lines.join('\n') + '</pre>';
          status.textContent = '';
          out.hidden = false;
        });
      }).catch(function (err) { status.textContent = 'Lookup failed: ' + err.message; });
    });
  }

  // ══════════════════════════════════════════════════════════════
  // DNS Propagation / Resolver Comparison
  // ══════════════════════════════════════════════════════════════
  var propForm = document.getElementById('prop-form');
  if (propForm) {
    var RESOLVERS = [
      { name: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query' },
      { name: 'Google', url: 'https://dns.google/resolve' },
      { name: 'Quad9', url: 'https://dns.quad9.net:5053/dns-query' }
    ];
    propForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = cleanDomain(document.getElementById('prop-name').value);
      var type = document.getElementById('prop-type').value;
      var status = document.getElementById('prop-status');
      var out = document.getElementById('prop-results');
      if (!validDomain(name)) { status.textContent = 'Enter a valid domain.'; out.hidden = true; return; }
      status.textContent = 'Querying ' + RESOLVERS.length + ' resolvers…';
      out.hidden = true;

      Promise.all(RESOLVERS.map(function (res) {
        return doh(name, type, res.url).then(function (d) {
          var answers = (d.Answer || []).filter(function (a) { return String(a.type) === typeNum(type) || true; })
            .map(function (a) { return a.data; });
          return { name: res.name, ok: true, status: d.Status, answers: answers, ad: d.AD };
        }).catch(function (err) { return { name: res.name, ok: false, err: err.message }; });
      })).then(function (results) {
        var sets = results.filter(function (r) { return r.ok; }).map(function (r) { return r.answers.slice().sort().join('|'); });
        var consistent = sets.length > 1 && sets.every(function (s) { return s === sets[0]; });
        var rows = results.map(function (r) {
          if (!r.ok) return '<tr><td>' + esc(r.name) + '</td><td colspan="2">error: ' + esc(r.err) + '</td></tr>';
          var st = r.status === 0 ? 'NOERROR' : r.status === 3 ? 'NXDOMAIN' : 'status ' + r.status;
          return '<tr><td>' + esc(r.name) + '</td><td>' + esc(st) + (r.ad ? ' <span style="color:var(--color-accent)">DNSSEC✓</span>' : '') +
            '</td><td class="tool-table__data">' + (r.answers.length ? esc(r.answers.join(', ')) : '—') + '</td></tr>';
        }).join('');
        out.innerHTML = card(consistent ? 'pass' : 'warn',
          consistent ? 'Consistent across resolvers' : 'Answers differ between resolvers',
          null, consistent ? 'All resolvers returned the same answer set — propagation is complete.'
            : 'Resolvers disagree. Either the record changed recently and is still propagating, or a resolver has a stale cached value.') +
          '<div style="overflow-x:auto"><table class="tool-table"><thead><tr><th>Resolver</th><th>Status</th><th>Answers</th></tr></thead><tbody>' +
          rows + '</tbody></table></div>';
        status.textContent = '';
        out.hidden = false;
      });
    });
    function typeNum(t) { return { A: '1', AAAA: '28', CNAME: '5', MX: '15', TXT: '16', NS: '2' }[t] || '0'; }
  }

  // ══════════════════════════════════════════════════════════════
  // IPv6 Subnet Calculator (BigInt)
  // ══════════════════════════════════════════════════════════════
  var v6Form = document.getElementById('v6-form');
  if (v6Form) {
    function expandV6(ip) {
      var s = ip.toLowerCase();
      var halves = s.split('::');
      if (halves.length > 2) return null;
      var left = halves[0] ? halves[0].split(':') : [];
      var right = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
      var missing = 8 - left.length - right.length;
      if (halves.length > 1) { if (missing < 1) return null; while (missing-- > 0) left.push('0'); }
      var h = left.concat(right);
      if (h.length !== 8 || !h.every(function (x) { return /^[0-9a-f]{1,4}$/.test(x); })) return null;
      return h.map(function (x) { return ('0000' + x).slice(-4); });
    }
    function toBig(hextets) {
      return hextets.reduce(function (acc, x) { return (acc << 16n) + BigInt(parseInt(x, 16)); }, 0n);
    }
    function fromBig(n) {
      var h = [];
      for (var i = 0; i < 8; i++) { h.unshift((n & 0xffffn).toString(16)); n >>= 16n; }
      return h;
    }
    function compress(hextets) {
      var full = hextets.map(function (x) { return x.replace(/^0+/, '') || '0'; }).join(':');
      return full.replace(/\b(?:0:){2,}0\b/, '::').replace(/^0::/, '::').replace(/::0$/, '::') || '::';
    }
    v6Form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = document.getElementById('v6-input').value.trim();
      var status = document.getElementById('v6-status');
      var out = document.getElementById('v6-results');
      var rows = document.getElementById('v6-rows');
      var m = input.match(/^([0-9a-fA-F:]+)\/(\d{1,3})$/);
      if (!m) { status.textContent = 'Enter an address and prefix, e.g. 2001:db8::/48'; out.hidden = true; return; }
      var prefix = Number(m[2]);
      var hextets = expandV6(m[1]);
      if (!hextets || prefix > 128) { status.textContent = 'Invalid IPv6 address or prefix (0-128).'; out.hidden = true; return; }
      var addr = toBig(hextets);
      var mask = prefix === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - prefix)) - 1n);
      var network = addr & mask;
      var last = network | ((1n << BigInt(128 - prefix)) - 1n);
      var count = 1n << BigInt(128 - prefix);
      var pairs = [
        ['Full address', hextets.join(':')],
        ['Compressed', compress(hextets)],
        ['Network', compress(fromBig(network)) + '/' + prefix],
        ['First address', compress(fromBig(network))],
        ['Last address', compress(fromBig(last))],
        ['Addresses in block', count.toLocaleString('en-US')],
        ['Reverse (ip6.arpa)', fromBig(network).join('').split('').reverse().join('.') + '.ip6.arpa']
      ];
      rows.innerHTML = pairs.map(function (p) {
        return '<tr><th>' + p[0] + '</th><td class="tool-table__data">' + esc(p[1]) + '</td></tr>';
      }).join('');
      status.textContent = '';
      out.hidden = false;
    });
  }

  // ══════════════════════════════════════════════════════════════
  // JWT Inspector (local decode only — never verifies/sends)
  // ══════════════════════════════════════════════════════════════
  var jwtForm = document.getElementById('jwt-form');
  if (jwtForm) {
    function b64urlDecode(str) {
      str = str.replace(/-/g, '+').replace(/_/g, '/');
      while (str.length % 4) str += '=';
      return decodeURIComponent(Array.prototype.map.call(atob(str), function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
    }
    var CLAIM_NOTES = {
      iss: 'Issuer', aud: 'Audience', sub: 'Subject', tid: 'Entra tenant ID', appid: 'Application (client) ID',
      scp: 'Delegated scopes', roles: 'App roles', amr: 'Auth methods used', acr: 'Auth context class',
      exp: 'Expires', nbf: 'Not valid before', iat: 'Issued at', azp: 'Authorized party'
    };
    jwtForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var token = document.getElementById('jwt-input').value.trim();
      var status = document.getElementById('jwt-status');
      var out = document.getElementById('jwt-results');
      var parts = token.split('.');
      if (parts.length < 2) { status.textContent = 'That does not look like a JWT (expected header.payload.signature).'; out.hidden = true; return; }
      var header, payload;
      try { header = JSON.parse(b64urlDecode(parts[0])); payload = JSON.parse(b64urlDecode(parts[1])); }
      catch (err) { status.textContent = 'Could not decode token: ' + err.message; out.hidden = true; return; }

      var now = Math.floor(Date.now() / 1000);
      var cards = [];
      if (payload.exp) {
        var expd = new Date(payload.exp * 1000);
        cards.push(card(payload.exp < now ? 'fail' : 'pass',
          payload.exp < now ? 'Expired' : 'Valid (not yet expired)',
          expd.toISOString(), payload.exp < now ? 'This token is no longer valid.' : 'Expires ' + expd.toLocaleString() + '.'));
      }
      if (payload.nbf && payload.nbf > now) cards.push(card('warn', 'Not yet valid', new Date(payload.nbf * 1000).toISOString(), 'The nbf (not-before) claim is in the future.'));
      cards.push(card('info', 'Algorithm: ' + (header.alg || '?'), header.typ || '',
        header.alg === 'none' ? 'alg=none means the token is unsigned — never trust one.' : 'Signature is NOT verified by this tool; decode only.'));

      function claimRows(obj) {
        return Object.keys(obj).map(function (k) {
          var v = obj[k];
          if ((k === 'exp' || k === 'nbf' || k === 'iat') && typeof v === 'number') v = v + '  (' + new Date(v * 1000).toISOString() + ')';
          else if (typeof v === 'object') v = JSON.stringify(v);
          var note = CLAIM_NOTES[k] ? ' <span style="opacity:.6">' + esc(CLAIM_NOTES[k]) + '</span>' : '';
          return '<tr><th>' + esc(k) + note + '</th><td class="tool-table__data">' + esc(v) + '</td></tr>';
        }).join('');
      }
      out.innerHTML = cards.join('') +
        '<h2 class="tool-subhead">Payload claims</h2><div style="overflow-x:auto"><table class="tool-table"><tbody>' + claimRows(payload) + '</tbody></table></div>' +
        '<h2 class="tool-subhead">Header</h2><div style="overflow-x:auto"><table class="tool-table"><tbody>' + claimRows(header) + '</tbody></table></div>';
      status.textContent = '';
      out.hidden = false;
    });
  }

  // ══════════════════════════════════════════════════════════════
  // Pwned Password Checker (HIBP k-anonymity; password never sent)
  // ══════════════════════════════════════════════════════════════
  var pwForm = document.getElementById('pw-form');
  if (pwForm) {
    function sha1Hex(str) {
      var enc = new TextEncoder().encode(str);
      return crypto.subtle.digest('SHA-1', enc).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('').toUpperCase();
      });
    }
    pwForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var pw = document.getElementById('pw-input').value;
      var status = document.getElementById('pw-status');
      var out = document.getElementById('pw-results');
      if (!pw) { status.textContent = 'Enter a password to check.'; out.hidden = true; return; }
      status.textContent = 'Hashing locally and checking the range…';
      out.hidden = true;
      sha1Hex(pw).then(function (hash) {
        var prefix = hash.slice(0, 5), suffix = hash.slice(5);
        return fetch('https://api.pwnedpasswords.com/range/' + prefix).then(function (r) {
          if (!r.ok) throw new Error('HIBP ' + r.status);
          return r.text();
        }).then(function (body) {
          var hit = body.split('\n').map(function (l) { return l.trim().split(':'); })
            .filter(function (p) { return p[0] === suffix; })[0];
          if (hit) {
            out.innerHTML = card('fail', 'Found in ' + Number(hit[1]).toLocaleString() + ' breaches', null,
              'This exact password appears in known data breaches. Do not use it anywhere. If you use it now, change it.');
          } else {
            out.innerHTML = card('pass', 'Not found in any known breach', null,
              'This password does not appear in the Have I Been Pwned dataset. That is good, but "not breached" is not the same as "strong" — length and uniqueness still matter.');
          }
          status.textContent = '';
          out.hidden = false;
          document.getElementById('pw-input').value = '';
        });
      }).catch(function (err) { status.textContent = 'Check failed: ' + err.message; });
    });
  }

  // ══════════════════════════════════════════════════════════════
  // M365 Onboarding Readiness
  // ══════════════════════════════════════════════════════════════
  var m365Form = document.getElementById('m365-form');
  if (m365Form) {
    m365Form.addEventListener('submit', function (e) {
      e.preventDefault();
      var domain = cleanDomain(document.getElementById('m365-domain').value);
      var status = document.getElementById('m365-status');
      var out = document.getElementById('m365-results');
      if (!validDomain(domain)) { status.textContent = 'Enter a valid domain.'; out.hidden = true; return; }
      status.textContent = 'Checking M365 DNS for ' + domain + '…';
      out.hidden = true;

      Promise.all([
        doh(domain, 'MX').then(function (d) {
          var hosts = (d.Answer || []).filter(function (a) { return a.type === 15; }).map(function (a) { return a.data; });
          var m365 = hosts.some(function (h) { return /protection\.outlook\.com/i.test(h); });
          return m365 ? card('pass', 'MX', hosts.join(', '), 'Points to Exchange Online (mail.protection.outlook.com).')
            : hosts.length ? card('warn', 'MX', hosts.join(', '), 'Mail is routed somewhere other than Exchange Online. Fine if intentional (third-party filtering), otherwise incomplete for M365.')
            : card('fail', 'MX', null, 'No MX records — mail will not deliver.');
        }),
        doh('autodiscover.' + domain, 'CNAME').then(function (d) {
          var c = (d.Answer || []).filter(function (a) { return a.type === 5; }).map(function (a) { return a.data; });
          var ok = c.some(function (x) { return /autodiscover\.outlook\.com/i.test(x); });
          return ok ? card('pass', 'Autodiscover', c.join(', '), 'CNAME to autodiscover.outlook.com — Outlook client setup will work.')
            : card('warn', 'Autodiscover', c.join(', ') || null, 'No autodiscover CNAME to Outlook. Modern Outlook often works without it, but older clients and some setups need it.');
        }),
        doh(domain, 'TXT').then(function (d) {
          var spf = txt(d).filter(function (t) { return t.indexOf('v=spf1') === 0; })[0];
          return spf && /include:spf\.protection\.outlook\.com/i.test(spf) ?
            card('pass', 'SPF', spf, 'Includes the Exchange Online SPF.')
            : spf ? card('warn', 'SPF', spf, 'SPF exists but does not include spf.protection.outlook.com.')
            : card('fail', 'SPF', null, 'No SPF record.');
        }),
        doh('_dmarc.' + domain, 'TXT').then(function (d) {
          var dm = txt(d).filter(function (t) { return t.indexOf('v=DMARC1') === 0; })[0];
          return dm ? card('pass', 'DMARC', dm, 'DMARC record present.') : card('warn', 'DMARC', null, 'No DMARC record. Add one (start at p=none).');
        }),
        doh('selector1._domainkey.' + domain, 'CNAME').then(function (d) {
          var ok = (d.Answer || []).some(function (a) { return a.type === 5 && /onmicrosoft\.com/i.test(a.data); });
          return ok ? card('pass', 'DKIM', 'selector1', 'M365 DKIM CNAME published.')
            : card('warn', 'DKIM', null, 'M365 DKIM selector1 CNAME not found. Enable DKIM in the Defender portal and publish the two CNAMEs.');
        }),
        doh('_sip._tls.' + domain, 'SRV').then(function (d) {
          var ok = (d.Answer || []).some(function (a) { return a.type === 33; });
          return ok ? card('info', 'Teams/Skype SRV', 'present', 'Legacy SIP federation records present. Not required for modern Teams; safe to ignore unless you use SIP federation.')
            : card('info', 'Teams/Skype SRV', null, 'No SIP SRV records. Not needed for modern Teams — informational only.');
        })
      ]).then(function (cards) {
        var pass = (cards.join('').match(/check-card--pass/g) || []).length;
        out.innerHTML = card('info', domain + ': ' + pass + ' of 6 checks green', null,
          'A readiness snapshot for hosting email/Teams on Microsoft 365. INFO items are optional.') + cards.join('');
        status.textContent = '';
        out.hidden = false;
      }).catch(function (err) { status.textContent = 'Check failed: ' + err.message; });
    });
  }

  // ══════════════════════════════════════════════════════════════
  // Config Diff + Redactor (fully local)
  // ══════════════════════════════════════════════════════════════
  var diffForm = document.getElementById('diff-form');
  if (diffForm) {
    function redact(text) {
      return text
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[GUID]')
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IPv4]')
        .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[EMAIL]');
    }
    // Longest-common-subsequence line diff
    function lineDiff(a, b) {
      var A = a.split('\n'), B = b.split('\n');
      var n = A.length, m = B.length;
      var dp = [];
      for (var i = 0; i <= n; i++) { dp[i] = []; for (var j = 0; j <= m; j++) dp[i][j] = 0; }
      for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--)
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      var out = [], x = 0, y = 0;
      while (x < n && y < m) {
        if (A[x] === B[y]) { out.push([' ', A[x]]); x++; y++; }
        else if (dp[x + 1][y] >= dp[x][y + 1]) { out.push(['-', A[x]]); x++; }
        else { out.push(['+', B[y]]); y++; }
      }
      while (x < n) out.push(['-', A[x++]]);
      while (y < m) out.push(['+', B[y++]]);
      return out;
    }
    diffForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var a = document.getElementById('diff-a').value;
      var b = document.getElementById('diff-b').value;
      var doRedact = document.getElementById('diff-redact').checked;
      var out = document.getElementById('diff-results');
      if (doRedact) { a = redact(a); b = redact(b); }
      var d = lineDiff(a, b);
      var added = d.filter(function (x) { return x[0] === '+'; }).length;
      var removed = d.filter(function (x) { return x[0] === '-'; }).length;
      var html = d.map(function (row) {
        var cls = row[0] === '+' ? 'diff-add' : row[0] === '-' ? 'diff-del' : 'diff-ctx';
        return '<div class="' + cls + '">' + esc(row[0] + ' ' + row[1]) + '</div>';
      }).join('');
      out.innerHTML = card(added || removed ? 'info' : 'pass',
        (added + removed === 0) ? 'Identical' : added + ' added, ' + removed + ' removed',
        null, doRedact ? 'GUIDs, IPv4 addresses, and email addresses were redacted before diffing.' : 'Raw diff (no redaction).') +
        '<div class="diff-view">' + html + '</div>';
      out.hidden = false;
    });
  }

  // ══════════════════════════════════════════════════════════════
  // File & Text Hasher (Web Crypto)
  // ══════════════════════════════════════════════════════════════
  var hashForm = document.getElementById('hash-form');
  if (hashForm) {
    function hashBuf(algo, buf) {
      return crypto.subtle.digest(algo, buf).then(function (d) {
        return Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      });
    }
    function run(buf) {
      var status = document.getElementById('hash-status');
      var out = document.getElementById('hash-results');
      var rows = document.getElementById('hash-rows');
      status.textContent = 'Hashing…';
      Promise.all([hashBuf('SHA-256', buf), hashBuf('SHA-1', buf), hashBuf('SHA-384', buf), hashBuf('SHA-512', buf)])
        .then(function (h) {
          var labels = ['SHA-256', 'SHA-1', 'SHA-384', 'SHA-512'];
          rows.innerHTML = labels.map(function (l, i) {
            return '<tr><th>' + l + '</th><td class="tool-table__data">' + h[i] + '</td></tr>';
          }).join('');
          status.textContent = '';
          out.hidden = false;
        }).catch(function (err) { status.textContent = 'Hash failed: ' + err.message; });
    }
    hashForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = document.getElementById('hash-text').value;
      var file = document.getElementById('hash-file').files[0];
      if (file) file.arrayBuffer().then(run);
      else if (text) run(new TextEncoder().encode(text).buffer);
      else document.getElementById('hash-status').textContent = 'Enter text or choose a file.';
    });
    document.getElementById('hash-note-md5') && (document.getElementById('hash-note-md5').textContent =
      'MD5 is intentionally omitted — Web Crypto does not provide it, and it is cryptographically broken. SHA-256 is the right default for integrity checks.');
  }
})();
