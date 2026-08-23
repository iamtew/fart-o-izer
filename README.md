# Fart-O-Izer 6000

**Play it live:** [https://fart.seshsofa.nl](https://fart.seshsofa.nl)

A fully client-side atmospheric sound lab built with HTML, CSS, and the Web Audio API. No samples, build step, or npm dependencies. The app is structured as a shared lab shell that hosts self-contained instruments — today that is the **Fart** synthesizer; more instruments can plug in later without changing the page URL or recording flow.

Fonts are loaded from a CDN for branding; all audio synthesis and UI logic run in the browser with no backend.

## Project structure

```text
index.html                          Lab shell (masthead, console frame, actions, recording)
style.css                           Shared layout, tokens, panel chrome, recording UI
app.js                              Lab controller — recording, panels, instrument mounting
pcm_capture_worklet.js              Shared WAV capture worklet (repo root)
instruments/fart/
  fart.js                           Fart instrument — settings, FartID, hold/release, controls
  fart.css                            Fart play surface and control styling
  flatulence_factory.js             Flatulence Factory Web Audio engine
img/                                Mascot and background assets
docs/                               Design notes (PLAN.txt, PLAN_RECORDING.txt, FONTS.md)
```

The shell owns `#instrument-stage` (play surface) and `#instrument-controls` (advanced sliders). Each instrument mounts into those roots and exposes a small API: `mount`, `getAudio`, `share`, `reset`, `getGain`.

## Audio architecture

**Lab shell (`app.js`)** handles status messages, the advanced panel, and WAV recording. It talks to the active instrument through `getAudio()` — never directly to Web Audio nodes.

**Fart instrument (`instruments/fart/fart.js`)** owns settings, FartID URL sharing, the hold-to-play button, mascot animation, and control wiring. It passes settings to the Flatulence Factory when FART is pressed.

**Flatulence Factory (`instruments/fart/flatulence_factory.js`)** is the audio engine. It owns the Web Audio context, master gain, noise generation, oscillator, filter, envelopes, LFO, scheduling, and cleanup. Recording taps the factory's master output via `pcm_capture_worklet.js`.

The factory starts the audio context lazily after the first user gesture. Press and hold **FART** to sustain a sound; release to fade out. The **Release** control sets the fade-out tail length. Each press builds a short-lived graph from a sawtooth oscillator and filtered white noise, shapes it with gain envelopes, adds pitch wobble with an LFO, and disconnects the nodes after playback.

## Run locally

Serve the project directory with any static file server, then open the displayed URL. For example, with Python installed:

```text
python -m http.server 8000
```

Open `http://localhost:8000/` and press **FART**. Browsers require the first audio context to start from a user gesture.

## Share a sound

Open **Controls**, adjust the sliders, then press **Share**. Settings are encoded into the `FartID` query parameter using URL-safe base64 (for example `https://fart.seshsofa.nl/?FartID=…`). Copy the page URL and open it elsewhere to restore the same sound. Existing share links on the site root continue to work after the instrument refactor.

## Record a sound

Press **Record**, then press **FART** as usual. The recorder captures the synthesizer's output, not the microphone, so no microphone permission is requested. Recording stops when you press **Record** again, after 1 second of silence following a detected fart signal, or at the 60-second maximum.

Non-empty recordings download as mono PCM WAV files. The latest recording remains available in the **Fart Recording** section for another download until the page is reloaded. Browsers must support Web Audio and `AudioWorklet`; unsupported browsers report the problem in the status message.

## Credits / Thank you

- **Smokeswift** — audio design
- **DrGM** — audio design, testing
