const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const DEFAULT_BIBLE = 'NIV';

function isValidVersion(code) {
  return /^[A-Z0-9-]{2,12}$/.test(String(code || '').toUpperCase());
}

function sanitizeHtml(html) {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<sup[^>]*>(\s*\d+\s*)<\/sup>/gi, '<sup class="verse-number">$1<\/sup>');
  s = s.replace(/<sup(?![^>]*class=\"verse-number\")[^>]*>.*?<\/sup>/gi, '');
  s = s.replace(/<span[^>]*class=\"footnote\"[^>]*>.*?<\/span>/gi, '');
  s = s.replace(/<(?:sup|span|a|div)[^>]*class=\"[^\"]*(footnote|crossref)[^\"]*\"[^>]*>[\s\S]*?<\/(?:sup|span|a|div)>/gi, '');
  s = s.replace(/<(?:sup|span|a|div)[^>]*id=\"[^\"]*(footnote|crossref)[^\"]*\"[^>]*>[\s\S]*?<\/(?:sup|span|a|div)>/gi, '');
  s = s.replace(/<(?:sup|span|a|div)[^>]*data-[^=]*=\"[^\"]*(footnote|crossref)[^\"]*\"[^>]*>[\s\S]*?<\/(?:sup|span|a|div)>/gi, '');
  s = s.replace(/<span[^>]*class=\"crossreference\"[^>]*>.*?<\/span>/gi, '');
  s = s.replace(/<div[^>]*class=\"crossreference\"[^>]*>[\s\S]*?<\/div>/gi, '');
  s = s.replace(/<div[^>]*class=\"crossrefs\"[^>]*>[\s\S]*?<\/div>/gi, '');
  s = s.replace(/<div[^>]*class=\"[^\"]*footnotes?[^\"]*\"[^>]*>[\s\S]*?<\/div>/gi, '');
  s = s.replace(/<(?:ol|ul)[^>]*class=\"[^\"]*footnotes?[^\"]*\"[^>]*>[\s\S]*?<\/(?:ol|ul)>/gi, '');
  s = s.replace(/<li[^>]*id=\"footnote-[^\"]+\"[^>]*>[\s\S]*?<\/li>/gi, '');
  s = s.replace(/<a[^>]*href=\"#[^\"]*(footnote|crossref)[^\"]*\"[^>]*>[\s\S]*?<\/a>/gi, '');
  s = s.replace(/<a[^>]*href=\"#[^\"]*(fn|fen|fnt|cr)[^\"]*\"[^>]*>[\s\S]*?<\/a>/gi, '');
  s = s.replace(/<a[^>]*>(\s*[\[\(]?[a-zA-Z0-9*†]{1,2}[\]\)]?\s*)<\/a>/gi, '');
  s = s.replace(/\[[a-zA-Z0-9*†]\]/g, '');
  s = s.replace(/\([a-zA-Z0-9*†]\)/g, '');
  s = s.replace(/[†*]/g, '');
    if (!/<sup class=\"verse-number\">\s*1\s*<\/sup>/i.test(s)) {
      s = s.replace(/<span[^>]*class=\"chapternum\"[^>]*>\s*\d+\s*<\/span>/i, '<sup class="verse-number">1<\/sup> ');
    }
  s = s.replace(/\b(Hebrew|Greek|Aramaic|That\s+is|Or|Septuagint|LXX)\b[\s\S]*?(?=(<sup class=\"verse-number\">)|$)/gi, '');
    s = s.replace(/<a[^>]*>\s*Read\s+full\s+chapter[\s\S]*?<\/a>/gi, '');
    s = s.replace(/\bRead\s+full\s+chapter\b[\s\S]*?(?=<|$)/gi, '');
  s = s.replace(/<h[1-6][^>]*>\s*Footnotes\s*<\/h[1-6]>[\s\S]*$/i, '');
      s = s.replace(/\b(?:[1-3]\s*)?[A-Za-z]+(?:\s+[A-Za-z]+)*\s+\d+:\d+\s*:/gi, '');
      s = s.replace(/\b(?:[1-3]\s*)?[A-Za-z]+(?:\s+[A-Za-z]+)*\s+\d+:\d+(?:-\d+)?\s+(Hebrew|Or|That\s+is|Septuagint|LXX)[^<]+/gi, '');
    s = s.replace(/\s*:\s*(?:[1-3]\s*)?[A-Za-z]+(?:\s+[A-Za-z]+)*\s+\d+:\d+(?:-\d+)?/gi, '');
    s = s.replace(/\s+(?:[1-3]\s*)?[A-Za-z]+(?:\s+[A-Za-z]+)*\s+\d+:\d+(?:-\d+)?\b/gi, '');
    s = s.replace(/(?:\s*:\s*(?:[1-3]\s*)?[A-Za-z]+(?:\s+[A-Za-z]+)*\s+\d+:\d+(?:-\d+)?)+\s*$/gi, '');
    s = s.replace(/\s*\b\d+:\d+\b\s*$/gi, '');
  s = s.replace(/\s*in\s+all\s+english\s+translations[\s\S]*$/i, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function fetchBibleGateway(query, version) {
  const url = `https://www.biblegateway.com/passage/?search=${encodeURIComponent(query)}&version=${encodeURIComponent(version || DEFAULT_BIBLE)}`;
  return new Promise((resolve, reject) => {
    https.get(url, resp => {
      let data = '';
      resp.on('data', chunk => (data += chunk));
      resp.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function extractPassage(html) {
  try {
    const startIdx = html.search(/<div[^>]*class=\"passage-text\"/i);
    if (startIdx < 0) return { content: [], verses: [] };
    const openTagEnd = html.indexOf('>', startIdx);
    if (openTagEnd < 0) return { content: [], verses: [] };
    let pos = openTagEnd + 1;
    let depth = 1;
    while (pos < html.length && depth > 0) {
      const nextOpen = html.indexOf('<div', pos);
      const nextClose = html.indexOf('</div>', pos);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        pos = nextOpen + 4;
      } else {
        depth -= 1;
        pos = nextClose + 6;
      }
    }
    const rawBlock = html.slice(startIdx, pos);
    const cleaned = sanitizeHtml(rawBlock);

    // Build structured verses from preserved markers
    const verses = [];
    const re = /<sup class=\"verse-number\">\s*(\d+)\s*<\/sup>\s*([\s\S]*?)(?=(<sup class=\"verse-number\">)|$)/gi;
    let match;
    while ((match = re.exec(cleaned)) !== null) {
      const num = parseInt(match[1], 10);
      const text = String(match[2] || '').trim();
      if (!isNaN(num) && text) {
        verses.push({ verse: num, text });
      }
    }

    return { content: [cleaned], verses };
  } catch {
    return { content: [], verses: [] };
  }
}

// Versions endpoint
const knownEnglishVersions = [
  'NIV','KJV','ESV','NASB','NLT','CSB','NKJV','RSV','MSG','AMP','CEB','WEB','YLT','ASV','GNV','DARBY','NET','ERV','HCSB','MEV','NOG','TLB','GW','EXB','ICB','NIRV','NLV','EHV','LSB','LEB','TLV','CJB','OJB','RGT','BST','TPT','PHILLIPS','JUB','GNB','GNT','CEV','NCV','NIVUK','NRSVUE','RSVCE','NABRE','ESVUK'
];

app.get('/api/versions', (req, res) => {
  res.json({ gatewayVersions: knownEnglishVersions });
});

app.get('/api/english-versions', (req, res) => {
  res.json({ englishVersions: knownEnglishVersions });
});

// Passage search
app.get('/api/passage', async (req, res) => {
  const query = String(req.query.query || '').trim();
  const version = String(req.query.version || DEFAULT_BIBLE).toUpperCase();
  if (!query) return res.status(400).json({ error: 'Please enter a passage or keyword.' });
  if (!isValidVersion(version)) return res.status(400).json({ error: "That translation isn't available. Please choose another." });
  try {
    const html = await fetchBibleGateway(query, version);
    const { content, verses } = extractPassage(html);
    res.json({ verse: query, version, content, verses });
  } catch (e) {
    res.status(500).json({ error: "We couldn't complete the request. Please try again." });
  }
});

// CHAPTER
app.get('/api/chapter', async (req, res) => {
  const reference = String(req.query.reference || '').trim();
  const version = String(req.query.version || DEFAULT_BIBLE).toUpperCase();
  if (!reference) return res.status(400).json({ error: 'Please enter a passage or keyword.' });
  if (!isValidVersion(version)) return res.status(400).json({ error: "That translation isn't available. Please choose another." });
  try {
    const html = await fetchBibleGateway(reference, version);
    const { content, verses } = extractPassage(html);
    // Attempt to extract heading/title
    const titleMatch = html.match(/<h1[^>]*class="passage-title"[^>]*>(.*?)<\/h1>/i);
    const title = titleMatch ? sanitizeHtml(titleMatch[1]) : '';
    res.json({ reference, version, title, content, verses });
  } catch (e) {
    res.status(500).json({ error: "We couldn't complete the request. Please try again." });
  }
});

// Verse of the Day
app.get('/api/votd', async (req, res) => {
  const version = String(req.query.version || DEFAULT_BIBLE).toUpperCase();
  const query = 'John 3:16';
  try {
    const html = await fetchBibleGateway(query, version);
    const { content, verses } = extractPassage(html);
    res.json({ verse: query, version, content, verses });
  } catch (e) {
    res.status(500).json({ error: "We couldn't complete the request. Please try again." });
  }
});

// Root -> index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

function startServer(port) {
  const server = http.createServer(app);

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      const next = port + 1;
      console.warn(`Port ${port} is in use. Trying ${next}...`);
      startServer(next);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer(DEFAULT_PORT);