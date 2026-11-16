// Builds episodes.json: full episodes from official anime YouTube channels
// that are embeddable and allowed to play in Kenya.
// Runs daily in GitHub Actions. Needs the YT_API_KEY secret.
import { writeFileSync } from "node:fs";

const KEY = process.env.YT_API_KEY;
if (!KEY) { console.error("YT_API_KEY is missing"); process.exit(1); }

const REGION = "KE";
const MIN_MINUTES = 15;        // shorter than this is a trailer, clip or PV
const PAGES_PER_CHANNEL = 6;   // 50 uploads per page, newest first

// Official rights holder channels. Unknown handles are skipped and logged.
// handle is tried first; if it is not found, the name is searched instead.
const CHANNELS = [
  { handle: "@GundamInfo", name: "GUNDAM.INFO" },
  { handle: "@MuseAsia", name: "Muse Asia" },
  { handle: "@AniOneAsia", name: "Ani-One Asia" },
  { handle: "@Crunchyroll", name: "Crunchyroll" },
  { handle: "@TOEIANIMATIONofficial", name: "Toei Animation" },
  { handle: "@TMSAnimeOfficial", name: "TMS Entertainment anime" },
  { handle: "@ponycanyonanime", name: "Pony Canyon anime" },
  { handle: "@AnimeOnegaiOficial", name: "Anime Onegai" },
  { handle: "@DiscotekMediaOfficial", name: "Discotek Media" },
  { handle: "@RetroCrushTV", name: "RetroCrush" },
  { handle: "@TokyoMXAnime", name: "Tokyo MX anime" },
  { handle: "@animelog", name: "Anime Log full episodes" },
];

const API = "https://www.googleapis.com/youtube/v3/";
async function yt(path, params) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries({ ...params, key: KEY })) url.searchParams.set(k, v);
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error?.message || r.status}`);
  return j;
}

function minutes(iso) {
  if (!iso) return 0;
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
  return (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) + (+m[4] || 0) / 60;
}

function allowedHere(rr) {
  if (!rr) return true;
  if (rr.allowed) return rr.allowed.includes(REGION);
  if (rr.blocked) return !rr.blocked.includes(REGION);
  return true;
}

const out = [];
const report = [];

for (const { handle, name } of CHANNELS) {
  try {
    let ch = await yt("channels", { part: "snippet,contentDetails", forHandle: handle });
    let c = ch.items?.[0], how = "handle";
    if (!c) {
      const s = await yt("search", { part: "snippet", type: "channel", q: name, maxResults: 1 });
      const id = s.items?.[0]?.snippet?.channelId;
      if (id) {
        ch = await yt("channels", { part: "snippet,contentDetails", id });
        c = ch.items?.[0]; how = "search";
      }
    }
    if (!c) { report.push(`${handle}: not found`); continue; }
    const uploads = c.contentDetails.relatedPlaylists.uploads;
    let token = "", ids = [];
    for (let p = 0; p < PAGES_PER_CHANNEL; p++) {
      const pl = await yt("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: 50, ...(token && { pageToken: token }) });
      ids.push(...pl.items.map(i => i.contentDetails.videoId));
      token = pl.nextPageToken;
      if (!token) break;
    }
    let kept = 0;
    for (let i = 0; i < ids.length; i += 50) {
      const v = await yt("videos", { part: "snippet,contentDetails,status", id: ids.slice(i, i + 50).join(",") });
      for (const x of v.items) {
        if (!x.contentDetails || !x.status || !x.snippet) continue;
        const mins = minutes(x.contentDetails.duration);
        if (mins < MIN_MINUTES) continue;
        if (!x.status.embeddable || x.status.privacyStatus !== "public") continue;
        if (x.snippet.liveBroadcastContent !== "none") continue;
        if (!allowedHere(x.contentDetails.regionRestriction)) continue;
        out.push({
          id: x.id,
          title: x.snippet.title,
          channel: c.snippet.title,
          published: x.snippet.publishedAt,
          minutes: Math.round(mins),
          lang: x.snippet.defaultAudioLanguage || x.snippet.defaultLanguage || "",
        });
        kept++;
      }
    }
    report.push(`${handle} -> ${c.snippet.title} (via ${how}): ${ids.length} uploads checked, ${kept} episodes playable in ${REGION}`);
  } catch (e) {
    report.push(`${handle}: error ${e.message}`);
  }
}

out.sort((a, b) => b.published.localeCompare(a.published));
writeFileSync("episodes.json", JSON.stringify({ updated: new Date().toISOString(), region: REGION, episodes: out }));
console.log(report.join("\n"));
console.log(`Total: ${out.length} episodes`);
