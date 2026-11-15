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
python local_server.py
```

If PowerShell refuses to run the activate script, run `Set-ExecutionPolicy -Scope Process RemoteSigned` first and try again.
In Command Prompt, use `.venv\Scripts\activate.bat` instead.

**macOS and Linux**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 scripts/download_model.py
python3 local_server.py
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

For a lighter setup, use `ENABLED_MODELS=silueta` or `u2netp`. To turn in-browser mode off, set `BROWSER_MODELS` to `none`.
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

## Project structure

```text
ChruBG/
├── .github/
│   └── workflows/
│       └── ci.yml             # Runs the tests on every push
├── api/
│   ├── _model_registry.py     # Model settings, download links and the ENABLED_MODELS lists
│   └── remove_background.py   # The background removal function, the only server code
├── public/
│   ├── app.js                 # Main page logic: images, cards, model picker
│   ├── browser-engine.js      # Optional in-browser processing
│   ├── crop-editor.js         # Crop and resize editor
│   ├── crop-math.js           # Crop geometry, also covered by tests
│   ├── editor.js              # Touch up brush
│   ├── export.js              # Downloads, backgrounds, trim and ZIP
│   ├── index.html             # The page
│   ├── styles.css             # Styles, including dark mode and mobile
│   ├── theme.js               # Light and dark theme switch
│   └── tour.js                # First visit walkthrough
├── scripts/
│   └── download_model.py      # Downloads the models, also runs at build time on Vercel
├── tests/
│   ├── crop-math.test.js      # Tests for the crop geometry
│   └── test_api.py            # Tests for the API
├── .dockerignore              # Files Docker leaves out of the image
├── .gitignore                 # Keeps downloaded models out of Git
├── CONTRIBUTING.md            # How to contribute
├── Dockerfile                 # Builds a self-contained image
├── LICENSE                    # AGPL-3.0 license text
├── README.md                  # This file
├── local_server.py            # Runs the page and API together on your computer or in Docker
├── requirements-dev.txt       # Test tools
├── requirements.txt           # Python packages the server needs
└── vercel.json                # Build command, output folder and function settings for Vercel
```

`models/` and `public/models/` are created by `scripts/download_model.py` and are not part of the repo.

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
On Vercel's standard function size limit only `u2netp` fits. See "Function size limit on Vercel" below.
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
- **Locally or with `local_server.py`:** just keep it in `models/`.
- **Vercel:** `models/` is git-ignored, so either commit the file (GitHub rejects files over 100 MB, so large models need Git LFS) or host it elsewhere and give the registry entry a `download_url` so the build fetches it. The file also counts toward the function size limit, see "Function size limit on Vercel".
- **Docker:** the image build only downloads built in models, and `models/` is excluded from the image. Mount your folder instead:
  `docker run -p 8000:8000 -v "$(pwd)/models:/app/models" -e ENABLED_MODELS=my-model chrubg`

## In-browser mode

Set `BROWSER_MODELS` (default `silueta`, `none` turns it off) to offer models that run on the visitor's device.
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
2. In Vercel, choose **Add New, Project**, then import the repo.
3. On the configure screen, use these settings:

| Setting | Value |
| --- | --- |
| Root Directory | `./` (leave as is) |
| Application Preset | **Other**. Do not pick Python, which expects a Python web framework app |
| Build Command | Leave blank. `vercel.json` sets it to `python3 scripts/download_model.py` |
| Output Directory | Leave blank. `vercel.json` sets it to `public` |
| Install Command | Leave blank |
| Run or Start command | None. Vercel has no run command for this kind of project |

Settings in `vercel.json` take priority over the dashboard fields.

4. Environment variables are optional. If you set any, tick **Production** and **Preview**, because the build reads them to decide which models to download:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ENABLED_MODELS` | `isnet-general-use` | Models the server offers. The first is the default. `none` means no server model |
| `BROWSER_MODELS` | `silueta` | Models people can choose to run in their own browser. `none` turns it off |
| `RATE_LIMIT_PER_MINUTE` | `30` | Requests per client per minute. `0` turns it off |

5. Click **Deploy** and watch the build log. The build downloads the models, so the first build takes a little longer.

Changing an environment variable later needs a redeploy.
The built in rate limit is best effort, because each serverless instance counts separately.
For a hard limit, add a rate limiting rule in the Vercel Firewall settings.

### Function size limit on Vercel

The server function has a size limit, and the Python packages alone use about 185 MB of it.
Vercel's docs list 500 MB for Python functions, but a build of this project in November 2026 enforced **225 MB**
and failed with `LAMBDA_SIZE_EXCEEDED` when `isnet-general-use` (179 MB) was bundled. Pick one of these:

| Option | Settings | Trade-off |
| --- | --- | --- |
| 1. Large functions (beta) | Add the environment variable `VERCEL_SUPPORT_LARGE_FUNCTIONS` = `1`, then redeploy | Keeps the best model. It is a beta feature and needs Fluid compute with Active CPU, which Vercel enables by default for new projects |
| 2. A small server model | `ENABLED_MODELS` = `u2netp` | Fits, at roughly 190 MB in total, but has the lowest detail. `silueta` (44 MB) is too big for the standard limit by a few MB |
| 3. In-browser only | `ENABLED_MODELS` = `none`, and keep `BROWSER_MODELS` = `silueta` | No server model at all. The page uses "In your browser" automatically, so images are processed on visitors' devices |

To see what takes up the space, add `VERCEL_ANALYZE_BUILD_OUTPUT` = `1` and redeploy. The build log then lists the largest files.
The memory limit is separate: Hobby functions get 2 GB, and `isnet-general-use` needs about 1.6 GB.

**Other build problems:** an error about a Python "entrypoint" means the preset is set to Python, so switch it to Other.

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

See [CONTRIBUTING.md](CONTRIBUTING.md). ChruBG is licensed under AGPL-3.0, see [LICENSE](LICENSE). Models have their own licenses.

---

<div align="center">
  <p>⭐ Star this repo if you found it helpful!</p>
</div>
