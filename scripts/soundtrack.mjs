#!/usr/bin/env node
// Soundtrack selection for roto.
//
//   node scripts/soundtrack.mjs list
//   node scripts/soundtrack.mjs fetch <track>
//   node scripts/soundtrack.mjs status
//   node scripts/soundtrack.mjs use silent
//   node scripts/soundtrack.mjs use <source> --file <path> [--title T] [--artist A] [--url U]
//
// Wiring audio by hand means four things drift apart: the file in assets/, the
// clip duration in index.html, adapt.json's audioDuration, and the attribution
// record. This does all four from one command, or refuses.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const at = p => path.resolve(root, p);

// Licence terms below are the sources' own published terms. For the aggregators
// (perItem: true) the licence is set per track by whoever uploaded it, so the
// catalogue can only tell you where to look - it cannot tell you what a given
// track is licensed under. Always open the track page and read it.
const BUILT_IN = [
  {
    id: 'musopen', name: 'Musopen', url: 'https://musopen.org/',
    licence: 'Public domain / CC0 recordings of public-domain classical works',
    attribution: 'not required', perItem: true,
    note: 'Deep catalogue of orchestral and solo recordings. Some recordings are CC-BY rather than CC0 - the recording and the composition are licensed separately.',
  },
  {
    id: 'incompetech', name: 'Incompetech (Kevin MacLeod)', url: 'https://incompetech.com/music/royalty-free/music.html',
    licence: 'CC-BY 4.0', attribution: 'REQUIRED', perItem: false,
    note: 'Large, well-organised library filterable by mood and tempo. Attribution text is specified per track on its page and must appear in your credits.',
  },
  {
    id: 'pixabay', name: 'Pixabay Music', url: 'https://pixabay.com/music/',
    licence: 'Pixabay Content Licence', attribution: 'not required', perItem: false,
    note: 'Free for commercial use. Prohibits redistributing the track as a standalone file - fine inside a rendered video, not fine committed to a public repo.',
  },
  {
    id: 'fma', name: 'Free Music Archive', url: 'https://freemusicarchive.org/',
    licence: 'per track: CC0, CC-BY, CC-BY-SA, CC-BY-NC and others', attribution: 'depends on track',
    perItem: true,
    note: 'Filter by licence before browsing. NC-licensed tracks rule out commercial use; SA propagates its terms to your video.',
  },
  {
    id: 'ccmixter', name: 'ccMixter', url: 'https://ccmixter.org/',
    licence: 'per track: mostly CC-BY or CC-BY-NC', attribution: 'usually REQUIRED', perItem: true,
    note: 'Remix-oriented. The dig.ccmixter.org front end has a filter for tracks cleared for commercial use.',
  },
  {
    id: 'freesound', name: 'Freesound', url: 'https://freesound.org/',
    licence: 'per sound: CC0, CC-BY, CC-BY-NC', attribution: 'depends on sound', perItem: true,
    note: 'Better for beds, textures and one-shot SFX than for finished music.',
  },
  {
    id: 'archive', name: 'Internet Archive audio', url: 'https://archive.org/details/audio',
    licence: 'per item, includes public domain and CC', attribution: 'depends on item', perItem: true,
    note: 'Includes genuinely public-domain historic recordings. Item metadata is user-supplied and sometimes wrong; verify before relying on it.',
  },
  {
    id: 'uppbeat', name: 'Uppbeat', url: 'https://uppbeat.io/',
    licence: 'free tier with credit, or paid tier without', attribution: 'REQUIRED on the free tier',
    perItem: false,
    note: 'Free tier issues a per-track credit string you must include. Account required.',
  },
  {
    id: 'openverse', name: 'Openverse', url: 'https://openverse.org/',
    licence: 'per item, CC and public domain', attribution: 'depends on item', perItem: true,
    note: 'Aggregator across several sources - useful for searching many libraries at once.',
  },
  {
    id: 'generated', name: 'Generated for this project', url: null,
    licence: 'per the generating service\'s terms', attribution: 'usually not required', perItem: false,
    note: 'Route through /media-use, which owns music generation. Check the service\'s commercial-use terms and record them here.',
  },
  {
    id: 'own', name: 'Your own or separately licensed track', url: null,
    licence: 'whatever you hold', attribution: 'per your licence', perItem: false,
    note: 'Record the licence and its scope, including whether it covers the platforms you will publish on.',
  },
  {
    id: 'reference', name: "The reference video's own soundtrack", url: null,
    licence: 'almost never established', attribution: 'n/a', perItem: false,
    warn: true,
    note: 'Permission to adapt a reference\'s visuals does not carry its music: the original designer licensed that track for their piece, not for yours. Only use this where the rights are genuinely established, or for a local artifact you will not publish.',
  },
];

// Individually verified tracks, each downloaded and hash-pinned from Wikimedia
// Commons, with the licence read off the file's own page. `fetch` pulls one on
// demand: nothing is vendored into the skill, so nothing is redistributed.
// Durations are the source file's; loop or trim to fit your composition.
const TRACKS = [
  {
    id: 'odyssey', title: 'Odyssey', artist: 'Kevin MacLeod',
    licence: 'CC BY 3.0', licenceUrl: 'https://creativecommons.org/licenses/by/3.0',
    attribution: 'REQUIRED', duration: 306.08, codec: 'mp3',
    page: 'https://commons.wikimedia.org/wiki/File:Odyssey_(ISRC_USUAN1500012).mp3',
    url: 'https://upload.wikimedia.org/wikipedia/commons/5/55/Odyssey_%28ISRC_USUAN1500012%29.mp3',
    sha256: '8d565a53f9280f5df6929dbfabe8794aa0c38ac7f57c21ee80f404d404239462',
    note: 'Wide cinematic build. Incompetech; the standard Kevin MacLeod credit applies.',
  },
  {
    id: 'lucid-coma', title: 'Lucid Coma', artist: 'Kevin Hartnell',
    licence: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0',
    attribution: 'REQUIRED', duration: 173.31, codec: 'vorbis',
    page: 'https://commons.wikimedia.org/wiki/File:Kevin_Hartnell_-_05_-_Lucid_Coma.ogg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/a/a2/Kevin_Hartnell_-_05_-_Lucid_Coma.ogg',
    sha256: '4fcf3466e9961149d9fda86081cf61d668d578cf3f3144040502c36356c2ee06',
    note: 'Slow ambient bed. Sits under narration without competing with it.',
  },
  {
    id: 'cha-cha-loop', title: '126 cha cha loop', artist: 'Bauchamp',
    licence: 'CC0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'not required', duration: 26.72, codec: 'vorbis',
    page: 'https://commons.wikimedia.org/wiki/File:Bauchamp_-_126_cha_cha_loop.ogg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/6/61/Bauchamp_-_126_cha_cha_loop.ogg',
    sha256: '930002d0d66d866132b2741a170edea7a20373fca38c5ee235580c64c91b6e0b',
    note: 'Short rhythmic loop at 126 BPM. Seamless, so it tiles under a short piece.',
  },
  {
    id: 'clair-de-lune', title: 'Clair de Lune (1905 piano roll)', artist: 'Claude Debussy',
    licence: 'Public domain', licenceUrl: '',
    attribution: 'not required', duration: 275.85, codec: 'opus',
    page: 'https://commons.wikimedia.org/wiki/File:Clair_de_Lune_by_Claude_Debussy_(1905,_piano_solo).opus',
    url: 'https://upload.wikimedia.org/wikipedia/commons/6/67/Clair_de_Lune_by_Claude_Debussy_%281905%2C_piano_solo%29.opus',
    sha256: '84040bf8138e81aca757501a342ada6fd12d594e75d322288cafd5c86a0aee1b',
    note: 'Both composition and this recording are public domain. Solo piano, unhurried.',
  },
  {
    id: 'casio-mt40', title: 'Casio MT-40 drum pattern', artist: 'rec. Maximilian Schoenherr',
    licence: 'Public domain', licenceUrl: '',
    attribution: 'not required', duration: 19.34, codec: 'mp3',
    page: 'https://commons.wikimedia.org/wiki/File:Casio_MT-40_Drumpattern.mp3',
    url: 'https://upload.wikimedia.org/wikipedia/commons/0/0c/Casio_MT-40_Drumpattern.mp3',
    sha256: '25ca17f9feab68968eddb75b32cb679c9009ffb9dba91adf532cb36a32c98e59',
    note: 'Bare drum machine pattern. Percussion only, useful as a rhythmic underlay.',
  },
];

function catalogue() {
  const local = at('soundtrack-catalog.json');
  if (!fs.existsSync(local)) return BUILT_IN;
  const extra = JSON.parse(fs.readFileSync(local, 'utf8'));
  const merged = new Map(BUILT_IN.map(e => [e.id, e]));
  for (const entry of extra.sources ?? []) merged.set(entry.id, {...merged.get(entry.id), ...entry});
  return [...merged.values()];
}

const flag = (args, name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

function list() {
  console.log('\nSoundtrack sources. Licences are per track wherever marked (per-item);');
  console.log('open the track page and read its licence before committing to it.\n');
  for (const s of catalogue()) {
    console.log(`  ${s.warn ? '! ' : '  '}${s.id.padEnd(12)} ${s.name}`);
    console.log(`    ${'licence:'.padEnd(12)} ${s.licence}${s.perItem ? '  (per item)' : ''}`);
    console.log(`    ${'attribution:'.padEnd(12)} ${s.attribution}`);
    if (s.url) console.log(`    ${'browse:'.padEnd(12)} ${s.url}`);
    console.log(`    ${s.note}\n`);
  }
  console.log('  silent       No soundtrack. Always available, never wrong.\n');
  console.log('Ready-to-fetch tracks (verified, hash-pinned):\n');
  for (const k of TRACKS) {
    console.log(`    ${k.id.padEnd(14)} ${k.title} - ${k.artist}`);
    console.log(`    ${''.padEnd(14)} ${k.licence}${k.attribution.includes('REQUIRED') ? ', credit required' : ''}`
      + `, ${Math.round(k.duration)}s`);
    console.log(`    ${''.padEnd(14)} ${k.note}\n`);
  }
  console.log('  node scripts/soundtrack.mjs fetch <track>        download, verify and wire one');
  console.log('  node scripts/soundtrack.mjs use <source> --file <path> --url <page>   your own find');
  console.log('  node scripts/soundtrack.mjs use silent\n');
}

function probeDuration(file) {
  const out = execFileSync('ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    {encoding: 'utf8'}).trim();
  const seconds = Number(out);
  if (!Number.isFinite(seconds)) throw new Error(`could not read a duration from ${file}`);
  return Math.round(seconds * 1e6) / 1e6;
}

// index.html owns playback, so the clip's duration must be the real stream
// duration - a soundtrack that outruns the visual loop is normal, and rounding
// it down to the visual duration truncates the tail.
function setClip(src, duration) {
  const p = at('index.html');
  let html = fs.readFileSync(p, 'utf8');
  const existing = /\n?[ \t]*<audio\b[^>]*class="clip"[\s\S]*?<\/audio>\n?/;
  if (src === null) {
    if (!existing.test(html)) return 'no audio clip to remove';
    fs.writeFileSync(p, html.replace(existing, '\n'));
    return 'removed the audio clip';
  }
  const tracks = [...html.matchAll(/data-track-index="(\d+)"/g)].map(m => Number(m[1]));
  const index = existing.test(html)
    ? Number(html.match(/<audio[\s\S]*?data-track-index="(\d+)"/)[1])
    : Math.max(-1, ...tracks) + 1;
  const clip = `  <audio id="soundtrack" src="${src}"\n` +
    `         class="clip" data-start="0" data-duration="${duration}" data-track-index="${index}"\n` +
    `         preload="auto"></audio>\n`;
  if (existing.test(html)) {
    fs.writeFileSync(p, html.replace(existing, '\n' + clip));
    return 'updated the audio clip';
  }
  if (!html.includes('</main>')) throw new Error('index.html has no </main> to insert the clip before');
  fs.writeFileSync(p, html.replace('</main>', clip + '</main>'));
  return 'inserted an audio clip';
}

function compositionDuration() {
  const html = fs.readFileSync(at('index.html'), 'utf8');
  const m = html.match(/<main\b[^>]*\bdata-duration="([\d.]+)"/);
  return m ? Number(m[1]) : null;
}

// A five-minute track under a fifteen-second piece would leave the container
// running long after the last video frame. Trimming the asset itself - rather
// than passing -shortest at encode time - keeps the asset and the output's
// audio identical, so render.mjs's packet-hash check still means something.
function fitToComposition(dest) {
  const comp = compositionDuration();
  const duration = probeDuration(at(dest));
  if (!comp || duration <= comp + 0.25) return {duration, trimmed: false};
  const cut = `${dest}.cut.m4a`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', at(dest), '-t', String(comp),
    '-c:a', 'copy', at(cut)], {stdio: 'inherit'});
  fs.rmSync(at(dest));
  fs.renameSync(at(cut), at(dest));
  const after = probeDuration(at(dest));
  console.log(`  trimmed ${duration.toFixed(2)}s -> ${after.toFixed(2)}s to fit the ${comp}s composition`);
  return {duration: after, trimmed: true, from: duration};
}

function writeConfig(mutate) {
  const p = at('adapt.json');
  const config = JSON.parse(fs.readFileSync(p, 'utf8'));
  mutate(config);
  fs.writeFileSync(p, JSON.stringify(config, null, 2) + '\n');
}

function record(entry) {
  fs.writeFileSync(at('soundtrack.json'), JSON.stringify(entry, null, 2) + '\n');
  const lines = ['- **Soundtrack:** '];
  if (entry.source === 'silent') {
    lines[0] += 'none. Rendered silent.';
  } else {
    const bits = [entry.title && `"${entry.title}"`, entry.artist && `by ${entry.artist}`]
      .filter(Boolean).join(' ');
    lines[0] += `${bits || entry.file} - ${entry.name}${entry.url ? ` (${entry.url})` : ''}. ` +
      `Licence: ${entry.licence}. Attribution: ${entry.attribution}.` +
      (entry.trackUrl ? ` Source: ${entry.trackUrl}.` : '');
  }
  console.log('\nAttribution record written to soundtrack.json. Line for THIRD_PARTY.md:\n');
  console.log(lines[0] + '\n');
}

function use(args) {
  const id = args[0];
  if (id === 'silent') {
    console.log(setClip(null));
    writeConfig(c => { delete c.audio; delete c.audioDuration; });
    record({source: 'silent'});
    console.log('Re-pin and re-render: node scripts/hashes.mjs make && node scripts/render.mjs');
    return;
  }
  const entry = catalogue().find(s => s.id === id);
  if (!entry) throw new Error(`unknown source "${id}". Run: node scripts/soundtrack.mjs list`);

  const file = flag(args, 'file');
  if (!file) throw new Error(`--file is required. Download the track first, then point at it.`);
  const from = path.resolve(process.cwd(), file);
  if (!fs.existsSync(from)) throw new Error(`no such file: ${from}`);

  const title = flag(args, 'title');
  const artist = flag(args, 'artist');
  const trackUrl = flag(args, 'url');
  if (entry.attribution.includes('REQUIRED') && !(artist && trackUrl)) {
    throw new Error(`${entry.name} requires attribution: pass --artist and --url so the ` +
      `credit can be recorded. Attribution you cannot reconstruct later is attribution you will not give.`);
  }
  if (entry.perItem && !trackUrl) {
    throw new Error(`${entry.name} licenses per track, so the catalogue cannot vouch for this one. ` +
      `Pass --url pointing at the track page whose licence you read.`);
  }

  const dest = `assets/${path.basename(from)}`;
  fs.mkdirSync(at('assets'), {recursive: true});
  fs.copyFileSync(from, at(dest));
  const codec = codecOf(at(dest));
  if (codec !== 'aac' && codec !== 'mp3') {
    console.log(`! ${codec} does not play reliably from an MP4. Convert to AAC first: ` +
      `ffmpeg -i <in> -vn -c:a aac -b:a 192k <out>.m4a`);
  }
  const {duration} = fitToComposition(dest);

  console.log(setClip(dest, duration));
  writeConfig(c => { c.audio = dest; c.audioDuration = duration; });
  record({source: id, name: entry.name, url: entry.url, licence: entry.licence,
          attribution: entry.attribution, file: dest, duration, title, artist, trackUrl});
  if (entry.warn) {
    console.log('! This source is flagged: see the note in `list`. Do not publish without ' +
      'establishing the rights.\n');
  }
  console.log(`${dest} is ${duration}s. Re-pin and re-render:`);
  console.log('  node scripts/hashes.mjs make && node scripts/render.mjs');
}

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

function codecOf(file) {
  return execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name', '-of', 'default=nw=1:nk=1', file], {encoding: 'utf8'}).trim();
}

async function fetchTrack(args) {
  const track = TRACKS.find(t => t.id === args[0]);
  if (!track) {
    throw new Error(`unknown track "${args[0] ?? ''}". Run: node scripts/soundtrack.mjs list`);
  }
  console.log(`${track.title} - ${track.artist}  (${track.licence})`);
  console.log(`  ${track.page}`);
  const response = await fetch(track.url, {signal: AbortSignal.timeout(120000)});
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256(bytes) !== track.sha256) {
    throw new Error('downloaded bytes do not match the pinned hash. Refusing to wire an ' +
      'unverified file - the upstream file may have been replaced.');
  }
  console.log(`  ${(bytes.length / 1048576).toFixed(1)} MB, hash verified`);

  fs.mkdirSync(at('assets'), {recursive: true});
  const original = `assets/source-${track.id}.${track.url.split('.').pop().split('?')[0]}`;
  fs.writeFileSync(at(original), bytes);

  // Normalise to AAC unless it already is. FFmpeg will happily mux Vorbis or
  // Opus into MP4 and the file will not play in Safari or QuickTime, so
  // "-c:a copy worked" is not evidence the audio is usable. Transcoding once
  // here keeps the render's copy step, and its packet-hash check, meaningful.
  let dest = original;
  const codec = codecOf(at(original));
  if (codec !== 'aac') {
    dest = `assets/${track.id}.m4a`;
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', at(original),
      '-vn', '-c:a', 'aac', '-b:a', '192k', at(dest)], {stdio: 'inherit'});
    fs.rmSync(at(original));
    console.log(`  transcoded ${codec} -> aac (MP4-safe); source hash recorded in soundtrack.json`);
  }

  const fit = fitToComposition(dest);
  const duration = fit.duration;
  console.log(setClip(dest, duration));
  writeConfig(c => { c.audio = dest; c.audioDuration = duration; });
  record({source: 'commons', name: 'Wikimedia Commons', url: track.page,
          trimmedFromSeconds: fit.trimmed ? fit.from : undefined,
          licence: `${track.licence}${track.licenceUrl ? ` (${track.licenceUrl})` : ''}`,
          attribution: track.attribution, file: dest, duration,
          title: track.title, artist: track.artist, trackUrl: track.page,
          sourceSha256: track.sha256, sourceCodec: codec});
  const comp = compositionDuration();
  if (comp && duration < comp - 0.5) {
    console.log(`! ${duration.toFixed(1)}s of audio under a ${comp}s composition. Loop or extend ` +
      'it, or the piece ends in silence.\n');
  }
  console.log(`${dest} is ${duration}s. Re-pin and re-render:`);
  console.log('  node scripts/hashes.mjs make && node scripts/render.mjs');
}

function status() {
  const config = JSON.parse(fs.readFileSync(at('adapt.json'), 'utf8'));
  const rec = fs.existsSync(at('soundtrack.json'))
    ? JSON.parse(fs.readFileSync(at('soundtrack.json'), 'utf8')) : null;
  if (!config.audio) {
    console.log('audio: none (silent)');
  } else {
    console.log(`audio:     ${config.audio}`);
    console.log(`duration:  ${config.audioDuration}s`);
    console.log(`exists:    ${fs.existsSync(at(config.audio))}`);
  }
  console.log(rec ? `provenance: ${rec.source} - ${rec.licence ?? 'n/a'}`
                  : 'provenance: NOT RECORDED - run `use` so the attribution is written down');
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'list') list();
  else if (command === 'fetch') await fetchTrack(args);
  else if (command === 'use') use(args);
  else if (command === 'status') status();
  else {
    console.error('usage: soundtrack.mjs list | status | fetch <track> | ' +
      'use <source|silent> [--file P --title T --artist A --url U]');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
