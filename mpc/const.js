/*
 * Multi Poop Composer.
 *
 * Patterns (1/2/4/8 bars of 4/4) on their own page: synthesized 808/909 drums,
 * Fart and Queef piano roll, mixer, and a song timeline. The lab's hold-to-play
 * factories stay put — they are monophonic and start at "now", so this app
 * schedules its own voices.
 *
 * Patterns, kit, BPM, mix, and arrangement live in localStorage under fart-o-izer-mpc.
 */

export const STEPS = 16;
export const TICKS = 32;
export const PAGE_BARS = 4;
export const NOTE_LO = 48;
export const NOTE_HI = 71;
export const MAJOR = [0, 2, 4, 5, 7, 9, 11];
export const MINOR = [0, 2, 3, 5, 7, 8, 10];
export const STORAGE_KEY = 'fart-o-izer-mpc';
export const LIBRARY_KEY = 'fart-o-izer-mpc-songs';
export const DEFAULT_SONG = '__default__';
export const SONG_ID = 'SongID';
export const SONG_VERSION = 1;
export const SONG_NAME_MAX = 40;
export const EXPORT_MAX_S = 600;
export const POOP_LEFT = ['Wet', 'Ripe', 'Silent', 'Cheeky', 'Gaseous', 'Funky', 'Leaky', 'Thunderous', 'Sneaky', 'Pungent'];
export const POOP_RIGHT = ['Honk', 'Toot', 'Symphony', 'Clapz', 'Rumble', 'Squirt', 'Fugue', 'Trumpet', 'Poot', 'Overture'];
export const LOOKAHEAD_MS = 25;
export const HORIZON = 0.1;
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const INSTRUMENTS = [
  {
    id: 'fart', name: 'Fart', icon: 'fa-poo', color: '#e39a4a', ink: '#1c140c',
    voice: [
      ['legato', 'Legato', 'toggle'],
      ['slide', 'Slide', 0, 1, 0.01],
      ['noise', 'Splatter', 0, 1, 0.01],
      ['rumble', 'Rumble', 0, 1, 0.01]
    ]
  },
  {
    id: 'queef', name: 'Queef', icon: 'fa-wind', color: '#9dcc7a', ink: '#14210f',
    voice: [
      ['legato', 'Legato', 'toggle'],
      ['slide', 'Slide', 0, 1, 0.01],
      ['noise', 'Pink noise', 0, 1, 0.01],
      ['rumble', 'Vibrato', 0, 1, 0.01]
    ]
  }
];
export const PADS = [
  { id: 'kick', name: 'Kick', color: '#e39a4a', ink: '#1c140c' },
  { id: 'snare', name: 'Snare', color: '#9dcc7a', ink: '#14210f' },
  { id: 'clap', name: 'Clap', color: '#f4efe6', ink: '#1c1a17' },
  { id: 'hat', name: 'Closed Hat', color: '#7fbf62', ink: '#14210f' },
  { id: 'openhat', name: 'Open Hat', color: '#c6e2a8', ink: '#14210f' },
  { id: 'tomLow', name: 'Low Tom', color: '#c47a45', ink: '#1c140c' },
  { id: 'tomMid', name: 'Mid Tom', color: '#e0a45a', ink: '#1c140c' },
  { id: 'tomHigh', name: 'High Tom', color: '#f0d3b0', ink: '#1c140c' }
];
export const TOMS = { tomLow: 80, tomMid: 120, tomHigh: 180 };
export const MIX_PARAMS = [
  ['gain', 'Gain', -1, 1, 0.01],
  ['high', 'High', -12, 12, 0.1],
  ['mid', 'Mid', -12, 12, 0.1],
  ['low', 'Low', -12, 12, 0.1],
  ['filter', 'Filter', -1, 1, 0.01],
  ['pan', 'Pan', -1, 1, 0.01],
  ['level', 'Level', 0, 1, 0.01]
];
export const LPF_OPEN = 18000;
export const LPF_MIN = 200;
export const HPF_OPEN = 20;
export const HPF_MAX = 18000;

export const padPointers = new Map();
export const strips = new Map();
export const due = [];
export const meterSamples = new Float32Array(256);

export const rt = {
  state: null,
  ctx: null,
  noiseBuffer: null,
  playing: false,
  recording: false,
  timer: 0,
  nextTime: 0,
  stepIndex: 0,
  playhead: -1,
  drag: null,
  seqFolded: false,
  sideFolded: false,
  lastEditView: 'drums',
  tlDrag: null,
  patternPage: 0,
  hats: [],
  meterRaf: 0,
  snapshot: '',
  loadedFrom: DEFAULT_SONG,
  lastPitch: {}
};
