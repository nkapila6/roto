#!/usr/bin/env node
// Deterministic render for roto.
//
//   node scripts/render.mjs                 check -> lint -> render -> encode -> verify
//   node scripts/render.mjs verify [file]   probe an existing file
//   node scripts/render.mjs compare [a] [b] compare decoded video frames
//
// Settings come from adapt.json. See templates/adapt.example.json.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const config = {
  composition: '.', fps: 24, width: 1920, height: 1080,
  crf: 16, preset: 'medium', output: 'output/video.mp4',
  ...JSON.parse(fs.readFileSync(path.join(root, 'adapt.json'), 'utf8')),
};
const at = relative => path.resolve(root, relative);

// Determinism knobs: one worker, no GPU, no frame cache, no best-effort
// fallbacks. A parallel render with GPU compositing is faster and is not
// reproducible frame for frame.
const env = {
  ...process.env,
  HYPERFRAMES_NO_TELEMETRY: '1',
  PRODUCER_FORCE_SCREENSHOT: 'true',
  PRODUCER_EXPERIMENTAL_FAST_CAPTURE: 'false',
};
const CHROME = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
}[process.platform];
if (!env.HYPERFRAMES_BROWSER_PATH && CHROME && fs.existsSync(CHROME)) env.HYPERFRAMES_BROWSER_PATH = CHROME;
if (env.HYPERFRAMES_BROWSER_PATH) env.PRODUCER_HEADLESS_SHELL_PATH = env.HYPERFRAMES_BROWSER_PATH;

const run = (exe, args, options = {}) =>
  execFileSync(exe, args, {cwd: root, env, stdio: 'inherit', ...options});
const capture = (exe, args) =>
  execFileSync(exe, args, {cwd: root, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024}).trim();

const local = at('node_modules/hyperframes/bin/hyperframes.mjs');
const hyperframes = args => fs.existsSync(local)
  ? run(process.execPath, [local, ...args])
  : run('npx', ['hyperframes', ...args]);

function expectedFrames() {
  if (config.frames) return config.frames;
  if (config.duration) return Math.round(config.duration * config.fps);
  return null;
}

// Decoded-frame hash, not file hash: it survives container and encoder
// differences and still catches any change to a single pixel.
const videoHash = file =>
  capture('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'hash', '-hash', 'sha256', '-']);
const audioHash = file =>
  capture('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-c', 'copy', '-f', 'hash', '-hash', 'sha256', '-']);

function verify(file) {
  const target = at(file || config.output);
  const probe = JSON.parse(capture('ffprobe', ['-v', 'error', '-count_frames', '-show_entries',
    'stream=codec_type,width,height,avg_frame_rate,nb_read_frames,duration', '-of', 'json', target]));
  const video = probe.streams.find(s => s.codec_type === 'video');
  const audio = probe.streams.find(s => s.codec_type === 'audio');
  const frames = expectedFrames();

  if (!video) throw new Error('no video stream');
  if (video.width !== config.width || video.height !== config.height) {
    throw new Error(`expected ${config.width}x${config.height}, got ${video.width}x${video.height}`);
  }
  if (video.avg_frame_rate !== `${config.fps}/1`) {
    throw new Error(`expected ${config.fps} fps, got ${video.avg_frame_rate}`);
  }
  if (frames && Number(video.nb_read_frames) !== frames) {
    throw new Error(`expected ${frames} frames, got ${video.nb_read_frames}`);
  }
  // A truncated or re-encoded soundtrack is the failure this catches: the
  // reference audio must arrive in the output as the same packets it left as.
  if (config.audio) {
    if (!audio) throw new Error('audio configured but missing from the output');
    if (config.audioDuration && Math.abs(Number(audio.duration) - config.audioDuration) > 0.025) {
      throw new Error(`audio duration ${audio.duration}s, expected ${config.audioDuration}s`);
    }
    if (audioHash(target) !== audioHash(at(config.audio))) {
      throw new Error('audio packets changed - the soundtrack was re-encoded, not copied');
    }
  }
  run('ffmpeg', ['-v', 'error', '-xerror', '-i', target, '-f', 'null', '-']);

  const report = {
    file: path.relative(root, target),
    frames: Number(video.nb_read_frames),
    width: video.width, height: video.height, fps: config.fps,
    fullDecode: true,
    audioPacketsUnchanged: Boolean(config.audio),
    decodedVideoSha256: videoHash(target),
    fileSha256: createHash('sha256').update(fs.readFileSync(target)).digest('hex'),
  };
  fs.mkdirSync(at('output'), {recursive: true});
  fs.writeFileSync(at('output/verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  return report;
}

function compare(a, b) {
  const expected = videoHash(at(a || config.compare));
  const actual = videoHash(at(b || config.output));
  console.log(JSON.stringify({expected, actual, decodedFramesMatch: expected === actual}, null, 2));
  if (expected !== actual) {
    console.error('Decoded frames differ. Either the composition changed, or this platform ' +
      'rasterizes fonts differently - see the reproducibility notes in the README.');
    process.exitCode = 1;
  }
}

function render() {
  run(process.execPath, [at('scripts/hashes.mjs'), 'check']);
  run('ffmpeg', ['-version'], {stdio: 'ignore'});
  run('ffprobe', ['-version'], {stdio: 'ignore'});
  hyperframes(['lint', config.composition]);

  // A fresh work directory per render; a stale frame from a previous attempt
  // silently entering the sequence is the worst bug in this pipeline.
  fs.mkdirSync(at('output'), {recursive: true});
  const work = fs.mkdtempSync(at('output/render-'));
  const frameDir = path.join(work, 'frames');
  hyperframes(['render', config.composition, '--fps', String(config.fps),
    '--format', 'png-sequence', '--quality', 'high', '--workers', '1', '--low-memory-mode',
    '--frames-cache-dir', 'off', '--no-browser-gpu', '--no-best-effort', '--output', frameDir]);

  const files = fs.readdirSync(frameDir).filter(f => /^frame_\d{6}\.png$/.test(f)).sort();
  const frames = expectedFrames();
  if (frames && files.length !== frames) {
    throw new Error(`rendered ${files.length} frames, expected ${frames}`);
  }
  if (!files.length) throw new Error('no frames rendered');

  const partial = path.join(work, 'video.mp4');
  const args = ['-v', 'error', '-y', '-framerate', String(config.fps), '-start_number', '1',
    '-i', path.join(frameDir, 'frame_%06d.png')];
  if (config.audio) args.push('-i', at(config.audio));
  args.push('-map', '0:v:0');
  if (config.audio) args.push('-map', '1:a:0');
  args.push(
    // The PNG sequence is full-range RGB; H.264 delivery is limited-range
    // BT.709. Stating the conversion explicitly stops players from guessing.
    '-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p',
    '-c:v', 'libx264', '-crf', String(config.crf), '-preset', config.preset,
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    // FFmpeg's -color_primaries and -color_trc do not reach the H.264 VUI through
    // libx264 - probe a file encoded with them alone and both read back as
    // "unknown". Setting them on the encoder is what actually writes the tags.
    // They describe the frames rather than altering them, so the decoded-frame
    // hash is unchanged and comparisons against older renders still hold.
    '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv');
  if (config.audio) args.push('-c:a', 'copy');
  args.push('-movflags', '+faststart', partial);
  run('ffmpeg', args);

  const output = at(config.output);
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.copyFileSync(partial, output);
  verify(config.output);
  fs.rmSync(work, {recursive: true, force: true});
  console.log(`verified ${config.output}`);
  if (config.compare && fs.existsSync(at(config.compare))) compare();
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (!command || command === 'render') render();
  else if (command === 'verify') verify(rest[0]);
  else if (command === 'compare') compare(rest[0], rest[1]);
  else {
    console.error('usage: render.mjs [render|verify|compare]');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
