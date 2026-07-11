// LinkedIn crosspost for new blog posts.
// Reads a post HTML file, extracts title/description/canonical URL from meta
// tags, and shares it on LinkedIn via the ugcPosts API.
//
// Required env:
//   LINKEDIN_ACCESS_TOKEN  - member token with w_member_social scope
//   LINKEDIN_AUTHOR_URN    - e.g. urn:li:person:XXXXXXXX
//   POST_FILE              - path to the blog post HTML file
//
// The token expires every 60 days and must be rotated manually.

import { readFileSync } from 'node:fs';

const token = process.env.LINKEDIN_ACCESS_TOKEN;
const author = process.env.LINKEDIN_AUTHOR_URN;
const postFile = process.env.POST_FILE;

if (!token || !author || !postFile) {
  console.error('Missing LINKEDIN_ACCESS_TOKEN, LINKEDIN_AUTHOR_URN, or POST_FILE');
  process.exit(1);
}

const html = readFileSync(postFile, 'utf8');

function extract(pattern, label) {
  const m = html.match(pattern);
  if (!m) {
    console.error(`Could not extract ${label} from ${postFile}`);
    process.exit(1);
  }
  return m[1].trim();
}

const title = extract(/<title>([^|<]+)/i, 'title');
const description = extract(/<meta name="description" content="([^"]+)"/i, 'description');
const url = extract(/<link rel="canonical" href="([^"]+)"/i, 'canonical URL');

const shareText = `New post: ${title}\n\n${description}\n\n${url}`;

const body = {
  author,
  lifecycleState: 'PUBLISHED',
  specificContent: {
    'com.linkedin.ugc.ShareContent': {
      shareCommentary: { text: shareText },
      shareMediaCategory: 'ARTICLE',
      media: [
        {
          status: 'READY',
          originalUrl: url,
          title: { text: title },
          description: { text: description },
        },
      ],
    },
  },
  visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
};

const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
  },
  body: JSON.stringify(body),
});

const text = await res.text();
if (!res.ok) {
  console.error(`LinkedIn API error ${res.status}: ${text}`);
  process.exit(1);
}

console.log(`Posted to LinkedIn: ${title}`);
console.log(text);
