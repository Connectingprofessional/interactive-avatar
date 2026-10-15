# Deploy and run

## Run on your computer (Windows)
1. Unzip into an empty folder.
2. Double-click `run-local.bat` (needs Python or Node). It runs server.py and opens http://localhost:8000.
   Do not double-click index.html: browsers block the AI workers on file:// pages.

## Deploy free on GitHub Pages
1. Create a repository (or use connectingprofessional/interactive-avatar).
2. Upload everything in this folder to the repository root (index.html must be at the root). Keep the hidden `.nojekyll` file.
3. Settings > Pages > Build and deployment > Source: "Deploy from a branch" > Branch: main, folder: / (root) > Save.
   (This repo also has a GitHub Actions workflow that publishes the `docs/` folder. Keep `docs/index.html` identical to the root `index.html`.)
4. Wait about a minute, then open https://YOUR-USER.github.io/YOUR-REPO/

Git commands, if you prefer:
    git init && git add . && git commit -m "avatar"
    git branch -M main
    git remote add origin https://github.com/YOUR-USER/YOUR-REPO.git
    git push -u origin main --force

## Deploy free on a Hugging Face Space (static)
1. huggingface.co > New Space > SDK: Static.
2. Upload index.html and replace the Space README.md with:
       ---
       title: Interactive Avatar
       sdk: static
       ---
3. The Space URL serves the page over https, so the offline models work there too.

## First use of the offline AI
Open the Persona tab > "Connect an AI / offline models", tick natural voice and/or offline listening,
pick a brain, then "Save and download selected models now". Models download once and are cached.
