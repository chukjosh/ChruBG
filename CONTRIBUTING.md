# Contributing to ChruBG

Thanks for helping. Bug reports, fixes and new model entries are all welcome.

## Set up

```bash
pip install -r requirements.txt -r requirements-dev.txt
ENABLED_MODELS=u2netp python3 scripts/download_model.py
ENABLED_MODELS=u2netp python3 -m pytest tests
node --test tests/*.test.js
python3 local_server.py   # http://localhost:8000
```

## Guidelines

- Write readable code: descriptive names, no cryptic abbreviations.
- Keep images in memory only. Do not add code that writes uploads to disk or a database.
- Adding a model: add an entry to `api/_model_registry.py`, test it, and note its license in your pull request.
- Run the tests and `node --check public/*.js` before opening a pull request.

By contributing you agree that your contribution is licensed under AGPL-3.0, the project license.
