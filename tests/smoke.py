"""Browser smoke test. Usage: TDMOS_PASS=<login password> python3 tests/smoke.py   (needs: pip install playwright; playwright install chromium)"""
import http.server, threading, functools, os, sys, json, tempfile, re
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(ROOT, "public"))
handler.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{port}/"
SD = os.path.join(ROOT, "sample-data")
fails = []
def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f"  {extra}" if extra and not cond else ""))
    if not cond: fails.append(name)

def new_page(b, login=True):
    ctx = b.new_context(viewport={"width": 1300, "height": 900}); p = ctx.new_page(); errs = []
    if login: ctx.add_init_script("sessionStorage.setItem('tdmos-auth','1')")
    p.on("console", lambda m: errs.append(m.text) if m.type == "error" and "fonts.g" not in m.text and "Failed to load resource" not in m.text else None)
    p.on("pageerror", lambda e: errs.append(str(e))); return ctx, p, errs

def tabs(p, errs):
    for h in ["overview", "budget", "keywords", "audiences", "creative"]:
        p.evaluate(f"location.hash='{h}'"); p.wait_for_timeout(250)
def options(p): return p.eval_on_selector_all("#client-select option", "els=>els.map(e=>e.textContent)")
def state(p): return p.evaluate("JSON.parse(localStorage.getItem('pmo-state-v3')||'null')")

with sync_playwright() as pw:
    b = pw.chromium.launch()
    # 0. login gate
    ctx, p, errs = new_page(b, login=False); p.goto(URL); p.wait_for_timeout(600)
    check("login shown first", p.is_visible("#login.open"))
    p.fill("#login-user", "trilliant"); p.fill("#login-pass", "wrong"); p.click("#login-form button"); p.wait_for_timeout(400)
    check("wrong password rejected", p.is_visible("#login.open") and "Incorrect" in p.inner_text("#login-err"))
    p.fill("#login-pass", os.environ.get("TDMOS_PASS", "")); p.click("#login-form button"); p.wait_for_timeout(400)
    check("correct login opens app", not p.is_visible("#login.open"))
    p.reload(); p.wait_for_timeout(600)
    check("login persists on reload (same tab)", not p.is_visible("#login.open"))
    p.click('[data-action="start-demo"]'); p.wait_for_timeout(500)
    p.click('[data-action="logout"]'); p.wait_for_timeout(300)
    check("logout shows login again", p.is_visible("#login.open"))
    check("login: no console errors", not errs, str(errs[:3])); ctx.close()
    # 1. demo path
    ctx, p, errs = new_page(b); p.goto(URL); p.wait_for_timeout(600)
    check("start screen shown on first visit", p.is_visible("#start.open"))
    p.click('[data-action="start-demo"]'); p.wait_for_timeout(500)
    check("demo: start screen closed", not p.is_visible("#start.open"))
    check("demo: exactly 3 clients, no duplicates", len(options(p)) == 3 and len(set(options(p))) == 3, str(options(p)))
    tabs(p, errs); p.wait_for_timeout(500)
    p.reload(); p.wait_for_timeout(600)
    check("demo: persists after reload (no start screen)", not p.is_visible("#start.open"))
    check("demo: still 3 clients after reload", len(options(p)) == 3)
    p.select_option("#client-select", index=1); p.wait_for_timeout(300); tabs(p, errs)
    check("demo: no console errors", not errs, str(errs[:3]))
    p.click('[data-action="reset-all"]'); p.click('[data-modal="0"]'); p.wait_for_timeout(400)
    check("reset returns to start screen", p.is_visible("#start.open"))
    ctx.close()

    # 2. upload path with all four files
    ctx, p, errs = new_page(b); p.goto(URL); p.wait_for_timeout(500)
    p.click('[data-action="start-upload"]'); p.wait_for_timeout(300)
    p.fill("#nc-name", "Acme Test")
    p.click('[data-modal="0"]'); p.wait_for_timeout(300)
    check("upload: channels file required", "Choose the channel" in p.inner_text("#nc-err"))
    for k in ["channels", "keywords", "creatives", "audience"]: p.set_input_files(f"#nc-{k}", os.path.join(SD, f"{k}.csv"))
    p.click('[data-modal="0"]'); p.wait_for_timeout(1500)
    check("upload: client created, start closed", options(p) == ["Acme Test"] and not p.is_visible("#start.open"), str(options(p)))
    check("upload: demo clients not present", not any("Northwind" in o for o in options(p)))
    tabs(p, errs)
    check("upload: no console errors", not errs, str(errs[:3]))
    # duplicate client name
    p.click('[data-modal="close"]'); p.click('[data-action="new-client"]'); p.fill("#nc-name", "acme  test!"); p.set_input_files("#nc-channels", os.path.join(SD, "channels.csv")); p.click('[data-modal="0"]'); p.wait_for_timeout(500)
    check("duplicate client name rejected", "already exists" in p.inner_text("#nc-err"), p.inner_text("#nc-err"))
    check("still one client", len(options(p)) == 1)
    p.click('[data-modal="close"]')
    # 3. duplicate rows in re-upload
    rows = open(os.path.join(SD, "channels.csv")).read().strip().split("\n"); hdr, body = rows[0], rows[1:]
    dup = "\n".join([hdr] + body + body[:50] + [body[0].rsplit(",", 3)[0] + ",100,250,5"])  # 50 exact dupes + 1 same date/channel row
    f = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False); f.write(dup); f.close()
    p.evaluate("location.hash='budget'"); p.wait_for_timeout(400)
    p.set_input_files('input[data-upload="channels"]', f.name); p.wait_for_timeout(800)
    txt = p.inner_text("#modal-body")
    check("dedupe: reports exact duplicates removed", "50 exact duplicate rows removed" in txt, txt[:200])
    check("dedupe: reports combined rows", "1 rows combined" in txt, txt[:200])
    p.click('[data-modal="close"]'); p.wait_for_timeout(700)
    s = state(p); ws = s["workspaces"][s["clientId"]]
    uniq = all(len(c["dates"]) == len(set(c["dates"])) for c in ws["channels"])
    check("dedupe: every channel has unique dates", uniq)
    check("dedupe: row count equals original", sum(len(c["dates"]) for c in ws["channels"]) == len(body), f'{sum(len(c["dates"]) for c in ws["channels"])} vs {len(body)}')
    # keywords doubled
    kw = open(os.path.join(SD, "keywords.csv")).read().strip().split("\n"); kd = "\n".join(kw + kw[1:6] + [kw[1].upper()])
    f2 = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False); f2.write(kd); f2.close()
    p.evaluate("location.hash='keywords'"); p.wait_for_timeout(300)
    p.set_input_files('input[data-upload="keywords"]', f2.name); p.wait_for_timeout(600)
    check("dedupe: keywords", "5 exact duplicate rows removed" in p.inner_text("#modal-body") or "duplicate" in p.inner_text("#modal-body"), p.inner_text("#modal-body")[:200])
    p.click('[data-modal="close"]')
    s = state(p); ws = s["workspaces"][s["clientId"]]; texts = [k["text"].lower() for k in ws["keywords"]]
    check("dedupe: keywords unique", len(texts) == len(set(texts)) and len(texts) == len(kw) - 1)
    # semicolon CSV
    semi = "\n".join(l.replace(",", ";") for l in open(os.path.join(SD, "keywords.csv")).read().strip().split("\n"))
    f3 = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False); f3.write(semi); f3.close()
    p.set_input_files('input[data-upload="keywords"]', f3.name); p.wait_for_timeout(500)
    check("semicolon-delimited CSV accepted", "loaded" in (p.inner_text("#toast") + p.inner_text("#modal-body")).lower())
    # bad file message
    bad = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False); bad.write("foo,bar\n1,2\n"); bad.close()
    p.evaluate("location.hash='budget'"); p.wait_for_timeout(300)
    p.set_input_files('input[data-upload="channels"]', bad.name); p.wait_for_timeout(500)
    check("bad file gives a clear error", "Couldn't load" in p.inner_text("#modal-title") or "load" in p.inner_text("#modal-title").lower(), p.inner_text("#modal-title"))
    p.keyboard.press("Escape")
    # re-allocate works on uploaded data
    p.click('[data-action="reallocate"]'); p.wait_for_timeout(600)
    check("re-allocate runs on uploaded data", "Up to date" in p.inner_text("#results") or "up to date" in p.inner_text("#results").lower())
    check("upload flow: no console errors", not errs, str(errs[:3]))
    ctx.close()

    # 4. channels-only upload shows empty states, not sample data
    ctx, p, errs = new_page(b); p.goto(URL); p.wait_for_timeout(400)
    p.click('[data-action="start-upload"]'); p.fill("#nc-name", "Only Channels"); p.set_input_files("#nc-channels", os.path.join(SD, "channels.csv")); p.click('[data-modal="0"]'); p.wait_for_timeout(1200)
    tabs(p, errs)
    p.evaluate("location.hash='audiences'"); p.wait_for_timeout(400)
    check("audiences empty state", "No customer file" in p.inner_text("#results"))
    p.evaluate("location.hash='keywords'"); p.wait_for_timeout(400)
    ds = p.inner_text("#data-source"); check("data-source line has no 'sample'", "sample" not in ds.lower(), ds)
    check("channels-only: no console errors", not errs, str(errs[:3]))
    # zero-spend day tolerated
    z = open(os.path.join(SD, "channels.csv")).read().strip().split("\n"); z[5] = z[5].rsplit(",", 3)[0] + ",0,0,0"
    fz = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False); fz.write("\n".join(z)); fz.close()
    p.evaluate("location.hash='budget'"); p.wait_for_timeout(300); p.set_input_files('input[data-upload="channels"]', fz.name); p.wait_for_timeout(700)
    check("zero-spend day accepted, no errors", not errs, str(errs[:3]))
    ctx.close()
    b.close()

srv.shutdown()
print("\nALL PASSED" if not fails else f"\nFAILED: {fails}"); sys.exit(1 if fails else 0)
