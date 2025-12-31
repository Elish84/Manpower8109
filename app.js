// app.js (ES Module)
// Firestore + Anon Auth + סינון + ייבוא CSV/JSON

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, signInAnonymously, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, collection, addDoc, doc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp, getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const firebaseConfig = window.BATT_FIREBASE_CONFIG;
const CFG = window.BATT_CONFIG;

if (!firebaseConfig || !CFG) {
  alert("חסר firebase-config.js או config.js");
}

// ---- Firebase init
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---- UI refs
const loginView = $("loginView");
const appView = $("appView");
const loginPassword = $("loginPassword");
const loginRole = $("loginRole");
const loginForce = $("loginForce");
const loginMsg = $("loginMsg");
const btnLogin = $("btnLogin");
const btnLogout = $("btnLogout");

const ctxTitle = $("ctxTitle");
const ctxSubtitle = $("ctxSubtitle");

const fFirst = $("fFirst");
const fLast = $("fLast");
const fCompany = $("fCompany");
const fPlatoon = $("fPlatoon");
const fSquad = $("fSquad");
const fBattalion = $("fBattalion");
const r1 = $("r1");
const r2 = $("r2");
const r3 = $("r3");
const r4 = $("r4");
const btnAdd = $("btnAdd");
const addMsg = $("addMsg");

const importFile = $("importFile");
const importMode = $("importMode");
const btnImport = $("btnImport");
const btnExportJson = $("btnExportJson");
const importMsg = $("importMsg");

const qName = $("qName");
const qRole = $("qRole");
const qPlatoon = $("qPlatoon");
const btnClearFilters = $("btnClearFilters");
const countHint = $("countHint");

const tbody = $("tbody");
const liveHint = $("liveHint");

// ---- State
let session = null; // { role, force }
let unsub = null;

let allRows = [];      // כל הרשומות מה-DB
let visibleRows = [];  // אחרי סינון

// ---- Helpers
function fillSelect(selectEl, items) {
  selectEl.innerHTML = "";
  for (const it of items) {
    const opt = document.createElement("option");
    opt.value = it;
    opt.textContent = it;
    selectEl.appendChild(opt);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function getForceCollection(forceName) {
  // תואם ל-DB הקיים: "פלוגה א" -> "א_פלוגה"
  const parts = String(forceName || "").trim().split(/\s+/);
  let slug = forceName.replace(/\s+/g, "_");

  if (parts.length === 2 && parts[0] === "פלוגה") {
    slug = `${parts[1]}_${parts[0]}`; // א_פלוגה
  }

  return `units_${slug}_soldiers`;
}


function setMsg(el, text, isError=false) {
  el.textContent = text || "";
  el.style.color = isError ? "#ff8a8a" : "";
}

function normalize(s) {
  return String(s || "").trim().toLowerCase();
}

// ---- Init dropdowns
fillSelect(loginRole, CFG.roles);
fillSelect(loginForce, CFG.forces);
fillSelect(r1, CFG.jobs);
fillSelect(r2, CFG.jobs);
fillSelect(r3, CFG.jobs);
fillSelect(r4, CFG.jobs);

// סינון תפקיד: כולל "הכל"
fillSelect(qRole, ["הכל", ...CFG.jobs.filter(x => x !== "ללא")]);

// default battalion
fBattalion.value = CFG.app.battalion_name_default || "8109";

// ---- Session restore
try {
  const raw = sessionStorage.getItem("BATT_SESSION");
  if (raw) session = JSON.parse(raw);
} catch { /* ignore */ }

if (session?.role && session?.force) {
  // נפתח את האפליקציה אחרי auth
  openLogin();
  setMsg(loginMsg, "משחזר סשן... מתחבר", false);
  // נתחבר באנונימי כדי שיעבור Rules
  signInAnonymously(auth).catch((e) => {
    console.error(e);
    setMsg(loginMsg, "שגיאת התחברות (Anon Auth). בדוק שהפעלת Anonymous Sign-in ב-Firebase Auth.", true);
  });
} else {
  openLogin();
}

// ---- Auth state
onAuthStateChanged(auth, (user) => {
  // אם יש סשן ו-user קיים → נפתח אפליקציה
  if (session?.role && session?.force && user) {
    openApp(session);
  }
});

// ---- Login flow
btnLogin.addEventListener("click", async () => {
  const pass = loginPassword.value.trim();
  const role = loginRole.value;
  const force = loginForce.value;

  if (pass !== CFG.auth.simple_password) {
    setMsg(loginMsg, "סיסמה שגויה", true);
    return;
  }
  if (!role || !force) {
    setMsg(loginMsg, "בחר תפקיד וכוח", true);
    return;
  }

  session = { role, force };
  sessionStorage.setItem("BATT_SESSION", JSON.stringify(session));

  try {
    setMsg(loginMsg, "מתחבר...", false);
    await signInAnonymously(auth);
    // openApp ייקרא מתוך onAuthStateChanged
  } catch (e) {
    console.error(e);
    setMsg(loginMsg, "שגיאת התחברות (Anon Auth). בדוק שהפעלת Anonymous Sign-in ב-Firebase Auth.", true);
  }
});

btnLogout.addEventListener("click", async () => {
  sessionStorage.removeItem("BATT_SESSION");
  session = null;
  if (unsub) { unsub(); unsub = null; }
  allRows = [];
  visibleRows = [];
  renderRows([]);

  try { await signOut(auth); } catch {}
  openLogin();
});

// ---- Add soldier
btnAdd.addEventListener("click", async () => {
  if (!session) return;

  const firstName = fFirst.value.trim();
  const lastName  = fLast.value.trim();

  if (!firstName || !lastName) {
    setMsg(addMsg, "חסר שם פרטי/משפחה", true);
    return;
  }

  const payload = {
    firstName,
    lastName,
    battalion: (fBattalion.value.trim() || CFG.app.battalion_name_default || "8109"),
    company: (fCompany.value.trim() || session.force),
    platoon: fPlatoon.value.trim(),
    squad: fSquad.value.trim(),
    roles: [r1.value, r2.value, r3.value, r4.value].filter(x => x && x !== "ללא"),
    forceScope: session.force,
    updatedAt: serverTimestamp(),
    updatedByRole: session.role
  };

  try {
    setMsg(addMsg, "שומר...");
    const colName = getForceCollection(session.force);
    await addDoc(collection(db, colName), payload);

    // ניקוי שדות חלקי
    fFirst.value = "";
    fLast.value = "";
    fPlatoon.value = "";
    fSquad.value = "";
    r1.value = "ללא"; r2.value="ללא"; r3.value="ללא"; r4.value="ללא";

    setMsg(addMsg, "נשמר ✅");
    setTimeout(() => setMsg(addMsg, ""), 1200);
  } catch (e) {
    console.error(e);
    setMsg(addMsg, "שגיאה בשמירה (בדוק Firestore Rules / Auth)", true);
  }
});

// ---- Filters (client-side)
function applyFilters() {
  const nameQ = normalize(qName.value);
  const roleQ = qRole.value; // "הכל" או תפקיד
  const platoonQ = normalize(qPlatoon.value);

  visibleRows = allRows.filter((r) => {
    const full = normalize(`${r.firstName||""} ${r.lastName||""}`);
    const okName = !nameQ || full.includes(nameQ);

    const okRole = (roleQ === "הכל") ? true : (Array.isArray(r.roles) && r.roles.includes(roleQ));

    const okPlatoon = !platoonQ || normalize(r.platoon).includes(platoonQ);

    return okName && okRole && okPlatoon;
  });

  renderRows(visibleRows);
  countHint.textContent = `מוצגים ${visibleRows.length} מתוך ${allRows.length}`;
}

[qName, qRole, qPlatoon].forEach(el => el.addEventListener("input", applyFilters));
qRole.addEventListener("change", applyFilters);

btnClearFilters.addEventListener("click", () => {
  qName.value = "";
  qRole.value = "הכל";
  qPlatoon.value = "";
  applyFilters();
});

// ---- Render table
function renderRows(rows) {
  tbody.innerHTML = "";

  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" class="muted">אין נתונים תואמים</td>`;
    tbody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const name = `${escapeHtml(row.firstName)} ${escapeHtml(row.lastName)}`.trim();
    const org = [
      row.battalion ? `גדוד: ${escapeHtml(row.battalion)}` : "",
      row.company ? `פלוגה: ${escapeHtml(row.company)}` : "",
      row.platoon ? `מחלקה: ${escapeHtml(row.platoon)}` : "",
      row.squad ? `כיתה: ${escapeHtml(row.squad)}` : ""
    ].filter(Boolean).join(" · ");

    const rolesHtml = (row.roles || []).length
      ? (row.roles || []).map(r => `<span class="pill">${escapeHtml(r)}</span>`).join("")
      : `<span class="muted">—</span>`;

    const tr = document.createElement("tr");
    tr.dataset.id = row.__id;

    tr.innerHTML = `
      <td>${name}</td>
      <td class="muted">${org || "—"}</td>
      <td>${rolesHtml}</td>
      <td class="actions">
        <button class="btnEdit">ערוך</button>
        <button class="btnDel danger">מחק</button>
      </td>
    `;

    // Edit
    tr.querySelector(".btnEdit").addEventListener("click", () => openEditRow(tr, row));

    // Delete
    tr.querySelector(".btnDel").addEventListener("click", async () => {
      if (!confirm(`למחוק את "${row.firstName} ${row.lastName}"?`)) return;
      try {
        const colName = getForceCollection(session.force);
        await deleteDoc(doc(db, colName, row.__id));
      } catch (e) {
        console.error(e);
        alert("שגיאה במחיקה (בדוק Rules/Auth)");
      }
    });

    tbody.appendChild(tr);
  }
}

function openEditRow(tr, row) {
  const roles = row.roles || [];
  const html = `
    <td>
      <input class="eFirst" value="${escapeHtml(row.firstName)}" style="width:48%" />
      <input class="eLast"  value="${escapeHtml(row.lastName)}"  style="width:48%" />
    </td>
    <td>
      <div class="row" style="margin:0">
        <input class="eBatt" placeholder="גדוד" value="${escapeHtml(row.battalion)}" style="width:24%" />
        <input class="eComp" placeholder="פלוגה" value="${escapeHtml(row.company)}" style="width:24%" />
        <input class="ePlat" placeholder="מחלקה" value="${escapeHtml(row.platoon)}" style="width:24%" />
        <input class="eSquad" placeholder="כיתה" value="${escapeHtml(row.squad)}" style="width:24%" />
      </div>
    </td>
    <td>
      <div class="row" style="margin:0">
        ${renderJobSelect("eR1", roles[0] || "ללא")}
        ${renderJobSelect("eR2", roles[1] || "ללא")}
        ${renderJobSelect("eR3", roles[2] || "ללא")}
        ${renderJobSelect("eR4", roles[3] || "ללא")}
      </div>
    </td>
    <td class="actions">
      <button class="btnSave primary">שמור</button>
      <button class="btnCancel">בטל</button>
    </td>
  `;
  tr.innerHTML = html;

  tr.querySelector(".btnCancel").addEventListener("click", () => {
    // רענון יבוא מה-onSnapshot
  });

  tr.querySelector(".btnSave").addEventListener("click", async () => {
    try {
      const firstName = tr.querySelector(".eFirst").value.trim();
      const lastName  = tr.querySelector(".eLast").value.trim();

      const battalion = tr.querySelector(".eBatt").value.trim();
      const company   = tr.querySelector(".eComp").value.trim();
      const platoon   = tr.querySelector(".ePlat").value.trim();
      const squad     = tr.querySelector(".eSquad").value.trim();

      const rr = [
        tr.querySelector(".eR1").value,
        tr.querySelector(".eR2").value,
        tr.querySelector(".eR3").value,
        tr.querySelector(".eR4").value
      ].filter(x => x && x !== "ללא");

      const colName = getForceCollection(session.force);
      await updateDoc(doc(db, colName, row.__id), {
        firstName, lastName, battalion, company, platoon, squad,
        roles: rr,
        updatedAt: serverTimestamp(),
        updatedByRole: session.role
      });
    } catch (e) {
      console.error(e);
      alert("שגיאה בשמירה (בדוק Rules/Auth)");
    }
  });
}

function renderJobSelect(className, selected) {
  const opts = CFG.jobs.map(j => {
    const sel = (j === selected) ? "selected" : "";
    return `<option value="${escapeHtml(j)}" ${sel}>${escapeHtml(j)}</option>`;
  }).join("");
  return `<select class="${className}" style="min-width:140px">${opts}</select>`;
}

// ---- Import / Export
btnExportJson.addEventListener("click", () => {
  const data = visibleRows.map(({__id, ...rest}) => rest);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `8109_${session?.force || "force"}_soldiers_export.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

btnImport.addEventListener("click", async () => {
  if (!session) return;
  const file = importFile.files?.[0];
  if (!file) { setMsg(importMsg, "בחר קובץ לייבוא", true); return; }

  const mode = importMode.value; // merge/replace
  const name = (file.name || "").toLowerCase();
  const text = await file.text();

  let rows = [];
  try {
    if (name.endsWith(".json")) {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("JSON חייב להיות מערך");
      rows = parsed;
    } else if (name.endsWith(".csv")) {
      rows = parseCsv(text);
    } else {
      // נסיון לפי MIME
      if (file.type.includes("json")) {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error("JSON חייב להיות מערך");
        rows = parsed;
      } else {
        rows = parseCsv(text);
      }
    }
  } catch (e) {
    console.error(e);
    setMsg(importMsg, "שגיאה בפענוח קובץ (CSV/JSON)", true);
    return;
  }

  // Normalize to our schema
  rows = rows
    .map(normalizeImportRow)
    .filter(r => r.firstName && r.lastName);

  if (!rows.length) {
    setMsg(importMsg, "לא נמצאו רשומות תקינות לייבוא", true);
    return;
  }

  const colName = getForceCollection(session.force);

  try {
    setMsg(importMsg, "מייבא...", false);

    if (mode === "replace") {
      // מחיקת כל המסמכים בכוח (batch)
      const snap = await getDocs(collection(db, colName));
      if (!snap.empty) {
        let batch = writeBatch(db);
        let n = 0;
        for (const d of snap.docs) {
          batch.delete(d.ref);
          n++;
          if (n % 450 === 0) { // מרווח בטוח
            await batch.commit();
            batch = writeBatch(db);
          }
        }
        await batch.commit();
      }
    }

    // הוספה ב-batches
    let batch = writeBatch(db);
    let count = 0;
    for (const r of rows) {
      const ref = doc(collection(db, colName));
      batch.set(ref, r);
      count++;
      if (count % 450 === 0) {
        await batch.commit();
        batch = writeBatch(db);
      }
    }
    await batch.commit();

    setMsg(importMsg, `ייבוא הסתיים ✅ (${rows.length})`);
    setTimeout(() => setMsg(importMsg, ""), 1500);
    importFile.value = "";
  } catch (e) {
    console.error(e);
    setMsg(importMsg, "שגיאה בייבוא (בדוק Rules/Auth)", true);
  }
});

function parseCsv(csvText) {
  // CSV פשוט: מפריד לפי פסיקים, תומך בגרשיים בסיסי
  const lines = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim().length);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map(h => h.trim());
  const rows = [];

  for (let i=1; i<lines.length; i++) {
    const parts = splitCsvLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => obj[h] = (parts[idx] ?? "").trim());
    rows.push(obj);
  }
  return rows;
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i=0; i<line.length; i++) {
    const ch = line[i];
    if (ch === '"' ) {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function normalizeImportRow(r) {
  // תומך בכמה שמות שדות אפשריים
  const firstName = (r.firstName ?? r.firstname ?? r.first ?? r["שם פרטי"] ?? "").toString().trim();
  const lastName  = (r.lastName  ?? r.lastname  ?? r.last  ?? r["שם משפחה"] ?? "").toString().trim();

  const battalion = (r.battalion ?? r["גדוד"] ?? CFG.app.battalion_name_default ?? "8109").toString().trim();
  const company   = (r.company   ?? r["פלוגה"] ?? session.force).toString().trim();
  const platoon   = (r.platoon   ?? r["מחלקה"] ?? "").toString().trim();
  const squad     = (r.squad     ?? r["כיתה"]  ?? "").toString().trim();

  const role1 = (r.role1 ?? r.r1 ?? r["תפקיד 1"] ?? "").toString().trim();
  const role2 = (r.role2 ?? r.r2 ?? r["תפקיד 2"] ?? "").toString().trim();
  const role3 = (r.role3 ?? r.r3 ?? r["תפקיד 3"] ?? "").toString().trim();
  const role4 = (r.role4 ?? r.r4 ?? r["תפקיד 4"] ?? "").toString().trim();

  const roles = [role1, role2, role3, role4]
    .map(x => x || "ללא")
    .filter(x => x && x !== "ללא");

  return {
    firstName,
    lastName,
    battalion,
    company,
    platoon,
    squad,
    roles,
    forceScope: session.force,
    updatedAt: serverTimestamp(),
    updatedByRole: session.role,
    importedAt: serverTimestamp()
  };
}

// ---- Views
function openLogin() {
  loginView.classList.remove("hidden");
  appView.classList.add("hidden");
  setMsg(loginMsg, "");
}

function openApp(sess) {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");

  ctxTitle.textContent = `כוח אדם – ${sess.force}`;
  ctxSubtitle.textContent = `מחובר כ: ${sess.role} · גדוד: ${CFG.app.battalion_name_default || "8109"} · Auth: Anonymous`;

  // ברירת מחדל לשדות
  fCompany.value = sess.force;
  fBattalion.value = CFG.app.battalion_name_default || "8109";

  // Live listener
  if (unsub) { unsub(); unsub = null; }

  const colName = getForceCollection(sess.force);
  const q = query(collection(db, colName), orderBy("lastName"), orderBy("firstName"));

  liveHint.textContent = "טוען נתונים בזמן אמת...";
  unsub = onSnapshot(q, (snap) => {
    allRows = [];
    snap.forEach(docu => allRows.push({ __id: docu.id, ...docu.data() }));

    applyFilters();
    liveHint.textContent = `עודכן: ${new Date().toLocaleString("he-IL")}`;
  }, (err) => {
    console.error(err);
    liveHint.textContent = "שגיאת הרשאות/חיבור. בדוק Firestore Rules ו-Anonymous Auth מופעל.";
  });
}
