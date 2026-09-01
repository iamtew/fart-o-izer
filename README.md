# Fart-O-Izer 6000

**Play it live:** [https://fart.seshsofa.nl](https://fart.seshsofa.nl)

A fully client-side atmospheric sound lab built with HTML, CSS, and the Web Audio API. No samples, build step, or npm dependencies. The app is a shared lab shell that hosts self-contained instruments. Use the **Fart** | **Queef** picker below the masthead to switch instruments — only one is active at a time.

Fonts are loaded from a CDN for branding; all audio synthesis and UI logic run in the browser with no backend.

## Project structure

```text
index.html                          Lab shell (masthead, instrument picker, actions, recording)
style.css                           Shared layout, tokens, panel chrome, recording UI
app.js                              Lab controller — recording, panels, instrument switching
pcm_capture_worklet.js              Shared WAV capture worklet (repo root)
instruments/fart/
  fart.js                           Fart instrument — settings, FartID, hold/release, controls
  fart.css                          Fart play surface and control styling
  flatulence_factory.js             Flatulence Factory Web Audio engine
instruments/queef/
  queef.js                          Queef instrument — settings, QueefID, waveform picker
  queef.css                         Queef play surface and control styling
  queef_factory.js                  Melodic Queef Web Audio engine
img/                                Mascot and background assets (McButtface, QueenQueef, …)
docs/                               Design notes (PLAN.txt, PLAN_RECORDING.txt, FONTS.md)
```

The shell owns `#instrument-stage` (play surface) and `#instrument-controls` (advanced sliders). Each instrument mounts into those roots on demand and exposes a plug-in API: `mount`, `unmount`, `getAudio`, `share`, `reset`, `getGain`.

## Instruments

### Fart

The original low rumble. Sawtooth body, filtered noise, Cheek Clapz stutter, and Sphincter Shift pitch sweep. McButtface on the launch button. Share settings via `FartID` in the URL.

### Queef

A brighter, more melodic voice — higher pitch, bandpass resonance, vibrato and phrase drift, Flutter Gate, and Pitch Glide. Includes a **Waveform** picker (Sine, Triangle, Saw, Square) in Controls. QueenQueef on the launch button. Share settings via `QueefID` (and `instrument=queef`) in the URL.

## Audio architecture

**Lab shell (`app.js`)** handles status messages, the advanced panel, instrument switching, and WAV recording. It talks to the active instrument through `getAudio()` — never directly to Web Audio nodes.

**Fart** uses the Flatulence Factory (`flatulence_factory.js`): sawtooth oscillator, lowpass filter, noise, LFO wobble, optional gate stutter.

**Queef** uses the Queef Factory (`queef_factory.js`): selectable waveform body, sine shimmer layer, bandpass filter, vibrato + phrase LFOs, optional flutter gate.

Both factories start the audio context lazily after the first user gesture. Press and hold the play button to sustain; release to fade out. Recording taps the factory master output via `pcm_capture_worklet.js`.

## Run locally

Serve the project directory with any static file server, then open the displayed URL. For example, with Python installed:

```text
python -m http.server 8000
```

Open `http://localhost:8000/` — **Fart** loads by default. Browsers require the first audio context to start from a user gesture.

## Switch instruments

Use the **Fart** | **Queef** tabs under the tagline. Switching unmounts the current instrument and loads the other (controls, play surface, and share parameter all swap). The URL updates with `?instrument=queef` when Queef is selected; Fart omits the param for backward compatibility.

URL resolution:

- `?FartID=…` → Fart with settings
- `?QueefID=…` → Queef with settings
- `?instrument=queef` → Queef with defaults

## Share a sound

Open **Controls**, adjust the sliders (and waveform on Queef), then press **Share**. Settings are encoded into `FartID` or `QueefID` using URL-safe base64. Existing `?FartID=` links on the site root continue to work.

## Record a sound

Press **Record**, then press and hold the active instrument button. The recorder captures synthesizer output, not the microphone. Recording stops when you press **Record** again, after 1 second of silence following a detected signal, or at the 60-second maximum.

Non-empty recordings download as mono PCM WAV files named `{Instrument}_Fart-O-Izer_{YYYYMMDDHHMMSS}.wav` (for example `Fart_Fart-O-Izer_20260901153045.wav`). The latest recording stays available in the recording panel for re-download until the page is reloaded. Browsers must support Web Audio and `AudioWorklet`.

## Credits / Thank you

- **Smokeswift** — audio design
- **DrGM** — audio design, testing
