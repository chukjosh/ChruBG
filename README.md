# ChruBG

Remove the background from images and download them as PNG or JPG.
A static page plus one Python function. CPU only, no database, nothing saved.

## Quick start: run it on your computer

**You need:** Python 3.10 to 3.12, about 1 GB of free disk space, and an internet connection for the first run
(it downloads the packages and the models). The default model uses about 1.6 GB of memory.
Node.js is only needed if you want to run the JavaScript tests.

Open a terminal in the project folder, then follow the steps for your system.

**Windows (PowerShell)**

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python scripts/download_model.py
python server.py
```

If PowerShell refuses to run the activate script, run `Set-ExecutionPolicy -Scope Process RemoteSigned` first and try again.
In Command Prompt, use `.venv\Scripts\activate.bat` instead.

**macOS and Linux**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 scripts/download_model.py
python3 server.py
```

Then open **http://localhost:8000** in your browser. Press Ctrl+C in the terminal to stop it.

With no settings, the download step fetches the default server model (`isnet-general-use`, about 179 MB) and the in-browser model
(`silueta`, about 44 MB). It only downloads files that are missing, so later runs start straight away.
Your images are processed on your own computer and are not saved anywhere.

### Choosing other models locally

Set the variables before the download step and again before starting the server. Use the same values both times.

| System | Commands |
| --- | --- |
| PowerShell | `$env:ENABLED_MODELS = "isnet-general-use,silueta"` then `$env:BROWSER_MODELS = "silueta"` |
| Command Prompt | `set ENABLED_MODELS=isnet-general-use,silueta` then `set BROWSER_MODELS=silueta` |
| macOS and Linux | `export ENABLED_MODELS=isnet-general-use,silueta` then `export BROWSER_MODELS=silueta` |

For a lighter setup, use `ENABLED_MODELS=silueta` or `u2netp`. To turn in-browser mode off, set `BROWSER_MODELS` to an empty value.
Your own model files are covered under "Using your own model" below.

### Run the tests

```bash
pip install -r requirements-dev.txt
python3 -m pytest tests
node --test tests/*.test.js
```

The Python tests need at least one server model downloaded. `ENABLED_MODELS=u2netp` is the smallest (about 5 MB).

### Troubleshooting

| Problem | Fix |
| --- | --- |
| "No model is installed on this server" | Run the download step again, with the same `ENABLED_MODELS` as the server |
| `pip install` fails on `onnxruntime` | Use Python 3.10 to 3.12. Very new Python versions may not have packages yet |
| The page loads but shows no model picker | Normal when only one model is enabled and in-browser mode is off |
| Port 8000 is already in use | Set `PORT=8001` (PowerShell: `$env:PORT = "8001"`) and open that port instead |
| The server is slow or runs out of memory | Switch to `silueta` or `u2netp`. `isnet-general-use` needs about 1.6 GB |
| In-browser mode or ZIP download does nothing | They load a library from a CDN the first time, so they need an internet connection |
| The first image is slow | The model loads on the first request. Later images are quicker |

You can also use the Vercel CLI to mimic the hosted setup (`vercel dev`, after the download step). The steps above do not need it.

## Features

- Add one image or many. Results stay in the tab until you remove them or close it.
- Before and after slider on every image.
- Full resolution downloads: the server returns a mask and the browser applies it to your original photo (up to 4096 px).
- Background colours, PNG or JPG, trim to subject, or a square canvas.
- Download everything as a ZIP.
- Light and dark themes, automatic by default with a manual switch. Works on phones and tablets.
- Optional Crop and resize editor: drag and zoom inside a frame, pick an output size such as a passport photo, or set your own. Nothing is cropped unless you use it.
- A short, skippable tour on the first visit, which you can reopen from the header.
- Touch up brush: erase leftovers or restore parts the model removed by mistake.
- Choose a model when more than one is enabled.
- Optional in-browser mode: people can choose to process images on their own device. It is never used unless they pick it.

## Privacy

Images are held in memory only: in the browser tab, and in the server function for the length of one request.
Images are never written to disk, a database or browser storage. Only two small preferences are kept: your theme choice (sessionStorage, this tab only) and whether you have seen the tour (localStorage). Closing or refreshing the tab clears all results.
With the default server mode, images are sent to the server to be processed. With "In your browser", they never leave the device.
The page also loads some resources from third parties, listed under "What is not in the repo" below.

## Choosing models

Set `ENABLED_MODELS` to a comma separated list. The first one is the default.
When more than one is enabled, the page shows a model picker.

| Model | Notes |
| --- | --- |
| `isnet-general-use` | Best edges, about 1.6 GB memory |
| `silueta` | Fast and light, rougher edges |
| `u2netp` | Smallest and fastest, lowest detail |

A hosted instance should enable one or two light models. Self-hosters can enable whatever their hardware handles.
To add a model, add an entry to `api/_model_registry.py`. Check each model's license before offering it publicly.

## Using your own model

You can run any compatible ONNX model, not only the built in ones. Putting the file in `models/` is not enough on its own,
because ChruBG also needs to know how to prepare the image for it.

1. Put your file at `models/my-model.onnx`.
2. Add an entry to `api/_model_registry.py`. Leave out `download_url` for a file you supply yourself:

```python
"my-model": {
    "label": "My model",
    "description": "Short text shown in the model picker.",
    "input_size": 512,
    "mean": (0.485, 0.456, 0.406),
    "standard_deviation": (0.229, 0.224, 0.225),
},
```

3. Enable it with `ENABLED_MODELS=my-model` (or add it to the list). To also offer it in the browser, put a copy at `public/models/my-model.onnx` and add it to `BROWSER_MODELS`.

The values for `input_size`, `mean` and `standard_deviation` come from the model's own documentation.

**What a model must look like:** one image input shaped `[1, 3, size, size]`, and a first output shaped `[1, 1, size, size]`
where higher values mean "subject". Preprocessing is the U2-Net style: resize, divide by the largest pixel value, subtract the mean,
divide by the standard deviation. A model that expects different preprocessing needs a change in `predict_mask`
(`api/remove_background.py`) and `public/browser-engine.js`. Check the model's license before sharing it publicly.

**Where your file must be:**
- **Locally or with `server.py`:** just keep it in `models/`.
- **Vercel:** `models/` is git-ignored, so either commit the file (GitHub rejects files over 100 MB, so large models need Git LFS) or host it elsewhere and give the registry entry a `download_url` so the build fetches it.
- **Docker:** the image build only downloads built in models, and `models/` is excluded from the image. Mount your folder instead:
  `docker run -p 8000:8000 -v "$(pwd)/models:/app/models" -e ENABLED_MODELS=my-model chrubg`

## In-browser mode

Set `BROWSER_MODELS` (default `silueta`, empty turns it off) to offer models that run on the visitor's device.
The build downloads them into `public/models/` and serves them as static files. The page shows a
"Process: On the server / In your browser" switch, and the server stays the default.
The model downloads to the browser the first time it is used, and older phones will be slower.

## What is not in the repo

Some things are fetched at build time or by the browser instead of being committed:

| Item | Where it comes from | Used for | If unavailable |
| --- | --- | --- | --- |
| Model files (`.onnx`) | Downloaded by `scripts/download_model.py` from the rembg GitHub releases into `models/` and `public/models/` (both git-ignored) | Background removal | The build fails, or the model is missing at run time |
| onnxruntime-web 1.20.1 | jsDelivr CDN, loaded the first time someone picks "In your browser" | In-browser mode | In-browser mode shows an error. Server mode still works |
| JSZip 3.10.1 | jsDelivr CDN, loaded the first time someone clicks "Download all (ZIP)" | ZIP download | ZIP download shows an error. Single downloads still work |
| Google Fonts (Bricolage Grotesque, Instrument Sans) | Google Fonts, loaded with the page | Page typography | The page falls back to system fonts |

Server mode and single image downloads work without any CDN. People on an offline or private network,
or anyone who does not want requests to third parties, can self-host these files by copying them into
`public/` and changing the URLs in `public/export.js`, `public/browser-engine.js` and `public/index.html`.

## Deploy on Vercel

1. Push this folder to GitHub (models are downloaded at build time and git-ignored).
2. Import the repo in Vercel with no framework preset.
3. Optional environment variables: `ENABLED_MODELS`, `BROWSER_MODELS`, `RATE_LIMIT_PER_MINUTE` (default 30, 0 turns it off).
4. Deploy. The build runs `scripts/download_model.py`.

The built in rate limit is best effort, because each serverless instance counts separately.
For a hard limit, add a rate limiting rule in the Vercel Firewall settings.

## Run with Docker

```bash
docker build -t chrubg --build-arg ENABLED_MODELS=isnet-general-use,silueta .
docker run -p 8000:8000 chrubg
```

Docker has no Vercel size or memory limits, so heavier models are possible here.

## Limits

- Vercel caps request and response bodies at 4.5 MB, so the browser sends a copy resized to 1024 px.
- The first request after idle is slower while the model loads.
- Images are processed one at a time per browser tab.

## Contributing and license

See CONTRIBUTING.md. ChruBG is licensed under AGPL-3.0, see LICENSE. Models have their own licenses.
