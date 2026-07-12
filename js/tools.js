(function () {
  'use strict';

  var DOH = 'https://cloudflare-dns.com/dns-query';
  var TYPE_NAMES = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA', 33: 'SRV', 43: 'DS', 48: 'DNSKEY', 46: 'RRSIG', 257: 'CAA' };

  function dohQuery(name, type) {
    return fetch(DOH + '?name=' + encodeURIComponent(name) + '&type=' + type, {
      headers: { Accept: 'application/dns-json' }
    }).then(function (r) {
      if (!r.ok) throw new Error('DNS query failed (' + r.status + ')');
      return r.json();
    });
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function isIpv4(s) { return /^(\d{1,3}\.){3}\d{1,3}$/.test(s); }

  function reverseName(ip) {
    return ip.split('.').reverse().join('.') + '.in-addr.arpa';
  }

  // ══════════════════════════════════════════════════════════════
  // DNS Lookup
  // ══════════════════════════════════════════════════════════════
  var dnsForm = document.getElementById('dns-form');
  if (dnsForm) {
    dnsForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = document.getElementById('dns-name').value.trim().toLowerCase()
        .replace(/^https?:\/\//, '').split('/')[0];
      var type = document.getElementById('dns-type').value;
      var status = document.getElementById('dns-status');
      var results = document.getElementById('dns-results');
      var rows = document.getElementById('dns-rows');

      if (type === 'PTR' && isIpv4(name)) name = reverseName(name);

      status.textContent = 'Querying ' + name + ' (' + type + ')…';
      results.hidden = true;

      dohQuery(name, type).then(function (data) {
        status.textContent = '';
        if (!data.Answer || data.Answer.length === 0) {
          status.textContent = 'No ' + type + ' records found for ' + name +
            (data.Status === 3 ? ' (domain does not exist)' : '') + '.';
          return;
        }
        rows.innerHTML = data.Answer.map(function (a) {
          return '<tr><td>' + esc(a.name) + '</td><td>' + esc(TYPE_NAMES[a.type] || a.type) +
            '</td><td>' + esc(a.TTL) + '</td><td class="tool-table__data">' + esc(a.data) + '</td></tr>';
        }).join('');
        results.hidden = false;
      }).catch(function (err) {
        status.textContent = 'Lookup failed: ' + err.message;
      });
    });
  }

  // ══════════════════════════════════════════════════════════════
  // WHOIS / RDAP
  // ══════════════════════════════════════════════════════════════
  var whoisForm = document.getElementById('whois-form');
  if (whoisForm) {
    whoisForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = document.getElementById('whois-input').value.trim().toLowerCase()
        .replace(/^https?:\/\//, '').split('/')[0];
      var status = document.getElementById('whois-status');
      var results = document.getElementById('whois-results');
      var rows = document.getElementById('whois-rows');
      var raw = document.getElementById('whois-raw');

      // IPs and domains are URL-safe as-is; encoding IPv6 colons breaks RDAP servers
      q = q.replace(/[^a-z0-9.:\-\/]/g, '');
      var isIp = isIpv4(q.split('/')[0]) || q.indexOf(':') !== -1;
      var endpoints = isIp
        ? ['https://rdap.org/ip/' + q, 'https://rdap.arin.net/registry/ip/' + q.split('/')[0]]
        : ['https://rdap.org/domain/' + q];

      status.textContent = 'Querying registry…';
      results.hidden = true;

      function tryEndpoint(i) {
        if (i >= endpoints.length) return Promise.reject(new Error('no registry answered'));
        return fetch(endpoints[i], { headers: { Accept: 'application/rdap+json' } }).then(function (r) {
          if (r.status === 404) throw new Error('not registered or not found in RDAP');
          if (!r.ok) {
            if (i + 1 < endpoints.length) return tryEndpoint(i + 1);
            throw new Error('registry returned ' + r.status);
          }
          return r.json();
        }).catch(function (err) {
          if (String(err.message).indexOf('not registered') !== -1) throw err;
          if (i + 1 < endpoints.length) return tryEndpoint(i + 1);
          throw err;
        });
      }

      tryEndpoint(0).then(function (d) {
        var out = [];
        function row(k, v) { if (v) out.push('<tr><th>' + esc(k) + '</th><td>' + v + '</td></tr>'); }

        row('Name', esc(d.ldhName || d.name || q));
        row('Handle', esc(d.handle || ''));
        if (d.status) row('Status', esc(d.status.join(', ')));
        (d.events || []).forEach(function (ev) {
          row(ev.eventAction.replace(/\b\w/g, function (c) { return c.toUpperCase(); }), esc(ev.eventDate));
        });
        if (d.nameservers) row('Nameservers', d.nameservers.map(function (n) { return esc(n.ldhName); }).join('<br>'));
        (d.entities || []).forEach(function (ent) {
          var role = (ent.roles || []).join(', ');
          var fn = '';
          if (ent.vcardArray && ent.vcardArray[1]) {
            ent.vcardArray[1].forEach(function (p) { if (p[0] === 'fn') fn = p[3]; });
          }
          if (role && fn) row(role.replace(/\b\w/g, function (c) { return c.toUpperCase(); }), esc(fn));
        });
        if (d.startAddress) row('Range', esc(d.startAddress + ' – ' + d.endAddress));
        if (d.country) row('Country', esc(d.country));

        rows.innerHTML = out.join('');
        raw.textContent = JSON.stringify(d, null, 2);
        status.textContent = '';
        results.hidden = false;
      }).catch(function (err) {
        status.textContent = 'Lookup failed: ' + err.message +
          '. Some registries (mostly country-code TLDs) do not allow browser queries.';
      });
    });
  }

  // ══════════════════════════════════════════════════════════════
  // Email Header Analyzer (fully local)
  // ══════════════════════════════════════════════════════════════
  var headerForm = document.getElementById('header-form');
  if (headerForm) {
    headerForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var rawText = document.getElementById('header-input').value;
      var status = document.getElementById('header-status');
      var results = document.getElementById('header-results');
      var summary = document.getElementById('header-summary');
      var hopsEl = document.getElementById('header-hops');

      // Unfold continuation lines (RFC 5322)
      var unfolded = rawText.replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ');
      var headers = [];
      unfolded.split('\n').forEach(function (line) {
        var m = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/);
        if (m) headers.push({ name: m[1].toLowerCase(), value: m[2] });
      });

      if (headers.length === 0) {
        status.textContent = 'No headers recognized. Paste the raw headers including field names like Received: and From:.';
        results.hidden = true;
        return;
      }

      function get(name) {
        var h = headers.filter(function (x) { return x.name === name; });
        return h.length ? h[0].value : '';
      }
      function extractAddr(v) {
        var m = v.match(/<([^>]+)>/);
        return (m ? m[1] : v).trim().toLowerCase();
      }
      function domainOf(addr) {
        var i = addr.lastIndexOf('@');
        return i === -1 ? '' : addr.slice(i + 1);
      }

      // Received chain: header order is newest-first; reverse for delivery order
      var received = headers.filter(function (h) { return h.name === 'received'; }).reverse();
      var hops = received.map(function (h) {
        var v = h.value;
        var from = (v.match(/from\s+([^\s;]+)/i) || [])[1] || '—';
        var by = (v.match(/by\s+([^\s;]+)/i) || [])[1] || '—';
        var semi = v.lastIndexOf(';');
        var when = semi !== -1 ? new Date(v.slice(semi + 1).trim()) : null;
        return { from: from, by: by, when: when && !isNaN(when) ? when : null };
      });

      hopsEl.innerHTML = hops.map(function (h, i) {
        var delay = '—';
        if (i > 0 && h.when && hops[i - 1].when) {
          var secs = Math.round((h.when - hops[i - 1].when) / 1000);
          delay = secs < 0 ? '0s (clock skew)' : secs >= 60 ? Math.round(secs / 60) + 'm ' + (secs % 60) + 's' : secs + 's';
          if (secs > 300) delay = '<strong>' + delay + '</strong>';
        }
        return '<tr><td>' + (i + 1) + '</td><td class="tool-table__data">' + esc(h.from) +
          '</td><td class="tool-table__data">' + esc(h.by) + '</td><td>' + delay + '</td></tr>';
      }).join('') || '<tr><td colspan="4">No Received headers found.</td></tr>';

      // Auth results + red flags
      var auth = get('authentication-results');
      var cards = [];
      function chipCard(status, label, note) {
        cards.push('<div class="check-card check-card--' + status + '"><div class="check-card__head">' +
          '<span class="check-card__chip">' + { pass: 'PASS', warn: 'WARN', fail: 'FAIL' }[status] + '</span>' +
          '<span class="check-card__title">' + esc(label) + '</span></div>' +
          '<p class="check-card__note">' + note + '</p></div>');
      }
      ['spf', 'dkim', 'dmarc'].forEach(function (mech) {
        var m = auth.match(new RegExp(mech + '=([a-z]+)', 'i'));
        if (!m) { chipCard('warn', mech.toUpperCase(), 'No result found in Authentication-Results.'); return; }
        var v = m[1].toLowerCase();
        chipCard(v === 'pass' ? 'pass' : (v === 'none' || v === 'neutral' ? 'warn' : 'fail'),
          mech.toUpperCase() + ': ' + v, 'From Authentication-Results header.');
      });

      var from = extractAddr(get('from'));
      var returnPath = extractAddr(get('return-path'));
      var replyTo = extractAddr(get('reply-to'));
      if (returnPath && from && domainOf(returnPath) !== domainOf(from)) {
        chipCard('warn', 'Return-Path mismatch',
          'From is <code>' + esc(domainOf(from)) + '</code> but bounces go to <code>' + esc(domainOf(returnPath)) +
          '</code>. Normal for mailing platforms, a red flag on mail claiming to be a person.');
      }
      if (replyTo && from && domainOf(replyTo) !== domainOf(from)) {
        chipCard('fail', 'Reply-To mismatch',
          'Replies are redirected to <code>' + esc(replyTo) + '</code>, a different domain than the sender. Classic phishing pattern; verify before trusting.');
      }

      var meta = '<table class="tool-table"><tbody>' +
        '<tr><th>From</th><td>' + esc(get('from') || '—') + '</td></tr>' +
        '<tr><th>Subject</th><td>' + esc(get('subject') || '—') + '</td></tr>' +
        '<tr><th>Date</th><td>' + esc(get('date') || '—') + '</td></tr>' +
        '<tr><th>Message-ID</th><td class="tool-table__data">' + esc(get('message-id') || '—') + '</td></tr>' +
        '<tr><th>Hops</th><td>' + hops.length + '</td></tr>' +
        '</tbody></table>';

      summary.innerHTML = meta + cards.join('');
      status.textContent = '';
      results.hidden = false;
    });
  }

  // ══════════════════════════════════════════════════════════════
  // SPF Generator
  // ══════════════════════════════════════════════════════════════
  var spfForm = document.getElementById('spf-form');
  if (spfForm) {
    spfForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var parts = ['v=spf1'];
      var lookups = 0;
      if (document.getElementById('spf-m365').checked) { parts.push('include:spf.protection.outlook.com'); lookups++; }
      if (document.getElementById('spf-google').checked) { parts.push('include:_spf.google.com'); lookups++; }
      document.getElementById('spf-includes').value.split('\n').forEach(function (l) {
        l = l.trim().replace(/^include:/, '');
        if (l) { parts.push('include:' + l); lookups++; }
      });
      document.getElementById('spf-ips').value.split('\n').forEach(function (l) {
        l = l.trim();
        if (!l) return;
        parts.push((l.indexOf(':') !== -1 ? 'ip6:' : 'ip4:') + l.replace(/^ip[46]:/, ''));
      });
      parts.push(document.getElementById('spf-all').value);

      var rec = parts.join(' ');
      document.getElementById('spf-record').textContent = rec;
      var lk = document.getElementById('spf-lookups');
      lk.textContent = '(' + lookups + ' of 10 allowed DNS lookups' +
        (lookups > 10 ? ' — OVER LIMIT, receivers will permerror' : lookups > 7 ? ' — getting close' : '') + ')';
      document.getElementById('spf-output').hidden = false;
    });
    document.getElementById('spf-copy').addEventListener('click', function () {
      navigator.clipboard.writeText(document.getElementById('spf-record').textContent);
      this.textContent = 'Copied';
      var b = this;
      setTimeout(function () { b.textContent = 'Copy'; }, 1500);
    });
  }

  // ══════════════════════════════════════════════════════════════
  // DMARC Generator
  // ══════════════════════════════════════════════════════════════
  var dmarcForm = document.getElementById('dmarc-form');
  if (dmarcForm) {
    dmarcForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var parts = ['v=DMARC1', 'p=' + document.getElementById('dmarc-policy').value];
      var rua = document.getElementById('dmarc-rua').value.trim();
      if (rua) parts.push('rua=mailto:' + rua);
      var pct = document.getElementById('dmarc-pct').value;
      if (pct && pct !== '100') parts.push('pct=' + pct);
      var sp = document.getElementById('dmarc-sp').value;
      if (sp) parts.push('sp=' + sp);
      if (document.getElementById('dmarc-adkim').checked) parts.push('adkim=s');
      if (document.getElementById('dmarc-aspf').checked) parts.push('aspf=s');

      document.getElementById('dmarc-record').textContent = parts.join('; ');
      document.getElementById('dmarc-output').hidden = false;
    });
    document.getElementById('dmarc-copy').addEventListener('click', function () {
      navigator.clipboard.writeText(document.getElementById('dmarc-record').textContent);
      this.textContent = 'Copied';
      var b = this;
      setTimeout(function () { b.textContent = 'Copy'; }, 1500);
    });
  }

  // ══════════════════════════════════════════════════════════════
  // Subnet Calculator (IPv4)
  // ══════════════════════════════════════════════════════════════
  var subnetForm = document.getElementById('subnet-form');
  if (subnetForm) {
    subnetForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = document.getElementById('subnet-ip').value.trim();
      var status = document.getElementById('subnet-status');
      var results = document.getElementById('subnet-results');
      var rows = document.getElementById('subnet-rows');

      var m = input.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
      if (!m) { status.textContent = 'Enter address/prefix, e.g. 192.168.10.0/24'; results.hidden = true; return; }
      var octets = m.slice(1, 5).map(Number);
      var prefix = Number(m[5]);
      if (octets.some(function (o) { return o > 255; }) || prefix > 32) {
        status.textContent = 'Octets must be 0-255 and prefix 0-32.'; results.hidden = true; return;
      }

      var ip = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
      var mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
      var network = (ip & mask) >>> 0;
      var broadcast = (network | (~mask >>> 0)) >>> 0;
      var hosts = prefix >= 31 ? (prefix === 31 ? 2 : 1) : Math.max(0, broadcast - network - 1);

      function fmt(n) {
        return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
      }

      var pairs = [
        ['Network', fmt(network) + '/' + prefix],
        ['Subnet mask', fmt(mask)],
        ['Wildcard mask', fmt((~mask) >>> 0)],
        ['Broadcast', prefix >= 31 ? 'n/a (point-to-point)' : fmt(broadcast)],
        ['First usable host', prefix >= 31 ? fmt(network) : fmt(network + 1)],
        ['Last usable host', prefix >= 31 ? fmt(broadcast) : fmt(broadcast - 1)],
        ['Usable hosts', hosts.toLocaleString()]
      ];
      rows.innerHTML = pairs.map(function (p) {
        return '<tr><th>' + p[0] + '</th><td class="tool-table__data">' + p[1] + '</td></tr>';
      }).join('');
      status.textContent = '';
      results.hidden = false;
    });
  }

  // ══════════════════════════════════════════════════════════════
  // What's My IP (own-domain Cloudflare trace, same-origin)
  // ══════════════════════════════════════════════════════════════
  var myipStatus = document.getElementById('myip-status');
  if (myipStatus && document.getElementById('myip-rows')) {
    fetch('/cdn-cgi/trace').then(function (r) { return r.text(); }).then(function (t) {
      var kv = {};
      t.trim().split('\n').forEach(function (l) {
        var i = l.indexOf('=');
        if (i !== -1) kv[l.slice(0, i)] = l.slice(i + 1);
      });
      var pairs = [
        ['Your public IP', kv.ip],
        ['Location (country)', kv.loc],
        ['Nearest edge (colo)', kv.colo],
        ['TLS version', kv.tls],
        ['HTTP version', kv.http],
        ['User agent', kv.uag]
      ].filter(function (p) { return p[1]; });
      document.getElementById('myip-rows').innerHTML = pairs.map(function (p) {
        return '<tr><th>' + esc(p[0]) + '</th><td class="tool-table__data">' + esc(p[1]) + '</td></tr>';
      }).join('');
      myipStatus.textContent = '';
      document.getElementById('myip-results').hidden = false;
    }).catch(function () {
      myipStatus.textContent = 'Could not read connection details from the edge.';
    });
  }
})();
