(function () {
  'use strict';

  var form = document.getElementById('checker-form');
  if (!form) return;

  var statusEl = document.getElementById('checker-status');
  var resultsEl = document.getElementById('checker-results');
  var cardsEl = document.getElementById('result-cards');
  var domainLabel = document.getElementById('result-domain');
  var btn = document.getElementById('check-btn');

  var DOH = 'https://cloudflare-dns.com/dns-query';

  function dohQuery(name, type) {
    return fetch(DOH + '?name=' + encodeURIComponent(name) + '&type=' + type, {
      headers: { Accept: 'application/dns-json' }
    }).then(function (r) {
      if (!r.ok) throw new Error('DNS query failed (' + r.status + ')');
      return r.json();
    });
  }

  function txtRecords(data) {
    if (!data.Answer) return [];
    return data.Answer
      .filter(function (a) { return a.type === 16; })
      .map(function (a) { return a.data.replace(/^"|"$/g, '').replace(/"\s+"/g, ''); });
  }

  function cleanDomain(raw) {
    var d = raw.trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0];
    return d;
  }

  function esc(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function card(status, title, value, note) {
    var chip = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' }[status];
    return '<div class="check-card check-card--' + status + '">' +
      '<div class="check-card__head">' +
      '<span class="check-card__chip">' + chip + '</span>' +
      '<span class="check-card__title">' + esc(title) + '</span>' +
      '</div>' +
      (value ? '<code class="check-card__value">' + esc(value) + '</code>' : '') +
      '<p class="check-card__note">' + note + '</p>' +
      '</div>';
  }

  // ── SPF ──────────────────────────────────────────────────────
  function checkSpf(domain) {
    return dohQuery(domain, 'TXT').then(function (data) {
      var spf = txtRecords(data).filter(function (t) { return t.indexOf('v=spf1') === 0; });
      if (spf.length === 0) {
        return card('fail', 'SPF', null,
          'No SPF record. Anyone can spoof mail from this domain and receiving servers have no way to check. Publish a TXT record starting with <code>v=spf1</code> listing your legitimate senders.');
      }
      if (spf.length > 1) {
        return card('fail', 'SPF', spf.join('  |  '),
          'Multiple SPF records found. RFC 7208 says receivers treat this as a permanent error, which can fail ALL your mail. Merge them into one record.');
      }
      var rec = spf[0];
      if (rec.indexOf('-all') !== -1) {
        return card('pass', 'SPF', rec,
          'SPF present with a hard fail (<code>-all</code>). Unauthorized senders are rejected.');
      }
      if (rec.indexOf('~all') !== -1) {
        return card('warn', 'SPF', rec,
          'SPF present but soft fail (<code>~all</code>): spoofed mail is marked, not rejected. After confirming all legitimate senders are listed, tighten to <code>-all</code>.');
      }
      if (rec.indexOf('?all') !== -1 || rec.indexOf('+all') !== -1) {
        return card('fail', 'SPF', rec,
          'SPF ends in <code>' + (rec.indexOf('+all') !== -1 ? '+all' : '?all') + '</code>, which permits everyone. This is effectively no protection. Change to <code>~all</code> or <code>-all</code>.');
      }
      return card('warn', 'SPF', rec,
        'SPF record found but no <code>all</code> mechanism detected. Receivers fall back to neutral. End the record with <code>-all</code> or <code>~all</code>.');
    });
  }

  // ── DMARC ────────────────────────────────────────────────────
  function checkDmarc(domain) {
    return dohQuery('_dmarc.' + domain, 'TXT').then(function (data) {
      var recs = txtRecords(data).filter(function (t) { return t.indexOf('v=DMARC1') === 0; });
      if (recs.length === 0) {
        return card('fail', 'DMARC', null,
          'No DMARC record. Receivers have no policy for handling mail that fails SPF/DKIM, and you get no visibility into spoofing attempts. Start with <code>v=DMARC1; p=none; rua=mailto:you@yourdomain</code> to collect reports, then move to enforcement.');
      }
      var rec = recs[0];
      var p = (rec.match(/p=([a-z]+)/i) || [])[1] || '';
      var hasRua = /rua=/.test(rec);
      if (p === 'reject') {
        return card('pass', 'DMARC', rec,
          'DMARC at full enforcement (<code>p=reject</code>). Spoofed mail failing authentication is rejected outright.' + (hasRua ? '' : ' Consider adding <code>rua=</code> reporting to keep visibility.'));
      }
      if (p === 'quarantine') {
        return card('pass', 'DMARC', rec,
          'DMARC enforcing (<code>p=quarantine</code>): failing mail goes to spam. The last step is <code>p=reject</code> once reports look clean.');
      }
      if (p === 'none') {
        return card('warn', 'DMARC', rec,
          'DMARC is in monitoring mode (<code>p=none</code>). This is visibility, not protection; spoofed mail still lands in inboxes. Review your reports for 2&ndash;4 weeks, then move to <code>p=quarantine</code>.');
      }
      return card('warn', 'DMARC', rec, 'DMARC record found but the policy tag could not be parsed. Verify the record syntax.');
    });
  }

  // ── DKIM ─────────────────────────────────────────────────────
  function checkDkimSelector(domain, selector) {
    var name = selector + '._domainkey.' + domain;
    return dohQuery(name, 'TXT').then(function (data) {
      if (!data.Answer) return null;
      // DoH follows CNAME chains; look for a key in any TXT answer
      var txts = txtRecords(data);
      var hasKey = txts.some(function (t) { return /k=|p=/.test(t); });
      var isCname = data.Answer.some(function (a) { return a.type === 5; });
      if (hasKey || isCname) return selector;
      return null;
    }).catch(function () { return null; });
  }

  function checkDkim(domain, userSelector) {
    var selectors = userSelector ? [userSelector] : ['selector1', 'selector2'];
    return Promise.all(selectors.map(function (s) { return checkDkimSelector(domain, s); }))
      .then(function (results) {
        var found = results.filter(Boolean);
        if (found.length > 0) {
          return card('pass', 'DKIM', 'selector(s): ' + found.join(', '),
            'DKIM key published for ' + esc(found.join(' and ')) + '. Outbound mail can be cryptographically signed.');
        }
        if (userSelector) {
          return card('warn', 'DKIM', 'selector tried: ' + userSelector,
            'No DKIM key found on that selector. Double-check the selector name with your mail platform; a wrong selector is the most common false alarm in DKIM checks.');
        }
        return card('warn', 'DKIM', 'selectors tried: selector1, selector2',
          'No DKIM key on the Microsoft 365 default selectors. <strong>Not conclusive</strong>: the domain may sign with a custom selector (Google uses <code>google</code>, many platforms use their own). If you know the selector, re-run with it. If mail comes from M365 and these are empty, enable DKIM signing in Defender portal &gt; Email authentication settings.');
      });
  }

  // ── MX ───────────────────────────────────────────────────────
  function checkMx(domain) {
    return dohQuery(domain, 'MX').then(function (data) {
      if (!data.Answer || data.Answer.length === 0) {
        return card('warn', 'MX', null,
          'No MX records: this domain does not receive mail. If that is intentional (a web-only domain), best practice is still an SPF record of <code>v=spf1 -all</code> and a reject DMARC so nobody can spoof it.');
      }
      var hosts = data.Answer
        .filter(function (a) { return a.type === 15; })
        .map(function (a) { return a.data; });
      return card('pass', 'MX', hosts.join('  |  '),
        'Mail routing is configured.' + (hosts.join(' ').indexOf('protection.outlook.com') !== -1 ? ' This domain uses Microsoft 365.' : ''));
    });
  }

  // ── Run ──────────────────────────────────────────────────────
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var domain = cleanDomain(document.getElementById('domain-input').value);
    var selector = document.getElementById('selector-input').value.trim();

    if (!/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      statusEl.textContent = 'That does not look like a valid domain. Try something like example.com.';
      resultsEl.hidden = true;
      return;
    }

    btn.disabled = true;
    statusEl.textContent = 'Checking ' + domain + '…';
    resultsEl.hidden = true;

    Promise.all([
      checkSpf(domain),
      checkDmarc(domain),
      checkDkim(domain, selector || null),
      checkMx(domain)
    ]).then(function (cards) {
      cardsEl.innerHTML = cards.join('');
      domainLabel.textContent = domain;
      statusEl.textContent = '';
      resultsEl.hidden = false;
      btn.disabled = false;
    }).catch(function (err) {
      statusEl.textContent = 'Check failed: ' + err.message + '. The DNS resolver may be unreachable from your network; try again in a moment.';
      btn.disabled = false;
    });
  });
})();
