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

## GitHub Pages

This repository is designed for project-site hosting from the `gh-pages` branch:

1. Push the branch to a GitHub repository.
2. In the repository settings, open **Pages**.
3. Select **Deploy from a branch**, choose `gh-pages`, and select the root folder.
4. Open the generated Pages URL.

All application resources use relative paths, so the app works when hosted beneath a repository path. A custom domain is not configured by default; add a `CNAME` file only when one is selected.
