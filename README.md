# Fart-O-Izer 6000

A fully client-side fart synthesizer built with HTML, CSS, and the Web Audio API. No samples, build step, external libraries, or network requests are required.

## Run locally

Serve the project directory with any static file server, then open the displayed URL. For example, with Python installed:

```text
python -m http.server 8080
```

Open `http://localhost:8080/` and press **FART**. Browsers require the first audio context to start from a user gesture.

## Share a sound

Adjust the Advanced controls. The settings are encoded into the `FartID` query parameter using URL-safe base64. Copy the page URL and open it elsewhere to restore the same settings.
