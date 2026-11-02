/* Simple client-side login gate. Not real security: the hash below ships to every visitor. */
(function () {
  "use strict";
  var USER = "trilliant";
  var HASH = "c97609ce61e1b5d0f2596046e2ed7a5ed0fbaa9eed3fec6e330014d77999d08d";
  var FLAG = "tdmos-auth";
  var box = document.getElementById("login");
  if (!box) return;

  function authed() { try { return sessionStorage.getItem(FLAG) === "1"; } catch (e) { return false; } }
  function open() { box.classList.add("open"); var u = document.getElementById("login-user"); if (u) u.focus(); }
  function close() { box.classList.remove("open"); }
  async function sha256(s) {
    var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  box.innerHTML = '<form class="start-card login-card" id="login-form" autocomplete="on">' +
    '<div class="brand-mark" aria-hidden="true">TD</div>' +
    '<h1>Trilliant Digital Marketing OS</h1>' +
    '<p class="muted">Please log in to continue.</p>' +
    '<label class="small" for="login-user" style="font-weight:600">Username</label>' +
    '<input id="login-user" name="username" type="text" autocomplete="username" required>' +
    '<label class="small" for="login-pass" style="font-weight:600">Password</label>' +
    '<input id="login-pass" name="password" type="password" autocomplete="current-password" required>' +
    '<p class="small" id="login-err" role="alert" style="color:#b42318;min-height:1.2em"></p>' +
    '<button class="btn primary" type="submit">Log in</button></form>';

  document.getElementById("login-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var u = document.getElementById("login-user").value.trim().toLowerCase();
    var p = document.getElementById("login-pass").value;
    var err = document.getElementById("login-err");
    var ok = false;
    try { ok = u === USER && (await sha256("tdmos:" + u + ":" + p)) === HASH; }
    catch (x) { err.textContent = "Login needs a secure (https) connection."; return; }
    if (!ok) { err.textContent = "Incorrect username or password."; return; }
    try { sessionStorage.setItem(FLAG, "1"); } catch (x) { /* ignore */ }
    document.getElementById("login-pass").value = "";
    err.textContent = ""; close();
  });

  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest('[data-action="logout"]');
    if (!t) return;
    try { sessionStorage.removeItem(FLAG); } catch (x) { /* ignore */ }
    open();
  });

  if (!authed()) open();
})();
