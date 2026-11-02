# Paste everything below this line into Claude Code

You are in the project folder of "Trilliant Digital Marketing OS V2": a **static, client-side-only** web app (no server, no database). The site is the `public/` folder. Deploy it to Render as a **free Static Site**. Work autonomously and only stop to ask me where this prompt says so.

## Rules
- Do not change any app behaviour or copy unless a step below requires it.
- The Render API key is in the environment variable `RENDER_API_KEY`. Never write it to a file, a commit, a log or the screen. If it is not set, stop and tell me how to set it (`export RENDER_API_KEY=...`).
- Do not claim something works unless you ran the check. If a step fails, show the real error and what you tried.

## Steps
1. **Verify locally.** Run `python3 -m http.server -d public 3000` in the background. Check that `curl -s localhost:3000/ | grep "Trilliant Digital Marketing OS"` matches and that `/app.js`, `/engine.js`, `/styles.css` return 200. If Playwright is available (`pip install playwright && playwright install chromium`), run `python3 tests/smoke.py` and require ALL PASSED. Stop the server afterwards.
2. **Git.** If this is not a git repo: `git init -b main`, commit everything. Make sure `.gitignore` is respected.
3. **GitHub.** Check `gh auth status`. If not logged in, stop and ask me to run `gh auth login`. Then create a **public** repo named `trilliant-marketing-os-v2` under my account (`gh repo create trilliant-marketing-os-v2 --public --source=. --push`). Public is fine: it holds no secrets, only fictional demo data. If that name exists, ask me for another.
4. **Render service.** Using `curl` with `Authorization: Bearer $RENDER_API_KEY`:
   - `GET https://api.render.com/v1/owners` to get my `ownerId` (if there are several, ask me which).
   - `GET https://api.render.com/v1/services?name=trilliant-marketing-os` first. If a service with that name already exists, reuse it and do NOT create a duplicate.
   - Otherwise `POST https://api.render.com/v1/services` with a static site: `type: static_site`, `name: trilliant-marketing-os`, `ownerId`, `repo` (the GitHub https URL), `branch: main`, `autoDeploy: "yes"`, and `serviceDetails: { publishPath: "public", buildCommand: "" }`. Static sites are free, so choose no paid plan.
   - If the API rejects the body, read the error, check Render's API docs (https://api-docs.render.com) and fix the payload. If Render says it cannot access the repo, tell me to install/authorise the Render GitHub app for this repo and wait.
5. **Wait for the deploy.** Poll `GET /v1/services/{id}/deploys?limit=1` every 10 s (up to 5 min) until status is `live`. If it fails, fetch the deploy logs, show the error and fix it.
6. **Smoke-test the live site.** Take the service URL (`serviceDetails.url`) and check with curl: `/` returns 200 and contains "Trilliant Digital Marketing OS"; `/app.js`, `/engine.js`, `/styles.css` return 200. If Playwright is available, open the live URL, click "Start with demo data", and confirm the client dropdown lists exactly 3 clients and there are no console errors. Then reload and confirm the start screen does not come back.
7. **Report.** Give me: the live URL, the GitHub repo URL, the Render service id, and which of the checks above you actually ran and passed. Remind me that the site has no login and keeps data only in each visitor's browser.

## Later changes
Every `git push` to `main` redeploys automatically (autoDeploy). To change the app, edit files in `public/`, run `python3 tests/smoke.py`, commit and push.
