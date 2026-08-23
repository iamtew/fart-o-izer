# Fart-O-Izer 6000

A fully client-side fart synthesizer built with HTML, CSS, and the Web Audio API. No samples, build step, external libraries, or network requests are required.

## Audio architecture

The Flatulence Factory in `flatulence_factory.js` is the audio engine for the FART-O-IZER 6000. It owns the Web Audio context, master gain, noise generation, oscillator, filter, envelopes, LFO, scheduling, and cleanup. The UI controller in `app.js` owns settings, URL sharing, controls, and status messages, and passes the current settings to the factory when FART is pressed.

The factory starts the audio context lazily after the first user gesture. Each press builds a short-lived graph from a sawtooth oscillator and filtered white noise, shapes it with gain envelopes, adds pitch wobble with an LFO, and disconnects the nodes after playback.

## Run locally

Serve the project directory with any static file server, then open the displayed URL. For example, with Python installed:

```text
python -m http.server 8080
```

Open `http://localhost:8080/` and press **FART**. Browsers require the first audio context to start from a user gesture.

## Share a sound

Adjust the Advanced controls. The settings are encoded into the `FartID` query parameter using URL-safe base64. Copy the page URL and open it elsewhere to restore the same settings.

## Record a sound

Press **Record**, then press **FART** as usual. The recorder captures the synthesizer's output, not the microphone, so no microphone permission is requested. Recording stops when you press **Record** again, after 1 second of silence following a detected fart signal, or at the 60-second maximum.

Non-empty recordings download as mono PCM WAV files. The latest recording remains available in the **Fart Recording** section for another download until the page is reloaded. Browsers must support Web Audio and `AudioWorklet`; unsupported browsers report the problem in the status message.
