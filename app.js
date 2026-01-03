import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, query, orderBy, onSnapshot, serverTimestamp, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id)=>document.getElementById(id);
const CFG = window.BATT_CONFIG;
const app = initializeApp(window.BATT_FIREBASE_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);

// UI
const loginView=$("loginView"), appView=$("appView");
const loginPassword=$("loginPassword"), loginRole=$("loginRole"), loginForce=$("loginForce");
const btnLogin=$("btnLogin"), btnLogout=$("btnLogout"), loginMsg=$("loginMsg");
const ctxTitle=$("ctxTitle"), ctxSubtitle=$("ctxSubtitle");

const fFirst=$("fFirst"), fLast=$("fLast"), fCompany=$("fCompany"), fPlatoon=$("fPlatoon"), fSquad=$("fSquad"), fBattalion=$("fBattalion");
const r1=$("r1"), r2=$("r2"), r3=$("r3"), r4=$("r4");
const btnAdd=$("btnAdd"), addMsg=$("addMsg");

const importFile=$("importFile"), importMode=$("importMode"), btnImport=$("btnImport"), btnExportJson=$("btnExportJson"), importMsg=$("importMsg");
const btnMigrate=$("btnMigrate"), migrateMsg=$("migrateMsg");

const qName=$("qName"), qRole=$("qRole"), qPlatoon=$("qPlatoon"), btnClearFilters=$("btnClearFilters"), countHint=$("countHint");
const tbody=$("tbody"), liveHint=$("liveHint");

let session=null; // {role, forceId, forceLabel}
let unsub=null;
let allRows=[], visibleRows=[];

function setMsg(el,t,err=false){ el.textContent=t||""; el.style.color=err?"#ff8a8a":""; }
function escapeHtml(s){ return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
function normalize(s){ return String(s||"").trim().toLowerCase(); }
function fillSelect(sel, items){
  sel.innerHTML="";
  for(const it of items){
    const opt=document.createElement("option");
    opt.value = (it.value ?? it.id ?? it);
    opt.textContent = (it.label ?? it);
    sel.appendChild(opt);
  }
}

fillSelect(loginRole, CFG.roles.map(r=>({value:r,label:r})));
fillSelect(loginForce, CFG.forces.map(f=>({value:f.id,label:f.label})));
fillSelect(r1, CFG.jobs); fillSelect(r2, CFG.jobs); fillSelect(r3, CFG.jobs); fillSelect(r4, CFG.jobs);
fillSelect(qRole, ["הכל", ...CFG.jobs.filter(x=>x!=="ללא")]);

fBattalion.value = CFG.app.battalion_name_default || "8109";

function soldiersCol(forceId){ return collection(db, "forces", forceId, "soldiers"); }

function openLogin(){ loginView.classList.remove("hidden"); appView.classList.add("hidden"); setMsg(loginMsg,""); }
function openApp(sess){
  loginView.classList.add("hidden"); appView.classList.remove("hidden");
  ctxTitle.textContent = `כוח אדם – ${sess.forceLabel}`;
  ctxSubtitle.textContent = `מחובר כ: ${sess.role} · DB: forces/${sess.forceId}/soldiers · Auth: Anonymous`;
  fCompany.value = sess.forceLabel;
  fBattalion.value = CFG.app.battalion_name_default || "8109";

  if(unsub){ unsub(); unsub=null; }
  const q = query(soldiersCol(sess.forceId), orderBy("lastName"));
  liveHint.textContent="טוען נתונים בזמן אמת...";
  unsub = onSnapshot(q,(snap)=>{
    allRows=[]; snap.forEach(d=>allRows.push({__id:d.id, ...d.data()}));
    applyFilters();
    liveHint.textContent=`עודכן: ${new Date().toLocaleString("he-IL")}`;
  },(err)=>{
    console.error(err);
    liveHint.textContent="שגיאת הרשאות/חיבור. בדוק Firestore Rules ו-Anonymous Auth מופעל.";
  });
}

try{ const raw=sessionStorage.getItem("BATT_SESSION_V2"); if(raw) session=JSON.parse(raw);}catch{}
onAuthStateChanged(auth,(user)=>{ if(session?.role && session?.forceId && user) openApp(session); });

if(session?.role && session?.forceId){
  openLogin(); setMsg(loginMsg,"משחזר סשן... מתחבר");
  signInAnonymously(auth).catch(e=>{ console.error(e); setMsg(loginMsg,"שגיאת התחברות (Anon Auth). הפעל Anonymous ב-Firebase.",true); });
}else openLogin();

btnLogin.addEventListener("click", async ()=>{
  const pass=loginPassword.value.trim();
  if(pass!==CFG.auth.simple_password){ setMsg(loginMsg,"סיסמה שגויה",true); return; }
  const role=loginRole.value;
  const forceId=loginForce.value;
  const forceLabel=(CFG.forces.find(f=>f.id===forceId)?.label)||forceId;
  session={role, forceId, forceLabel};
  sessionStorage.setItem("BATT_SESSION_V2", JSON.stringify(session));
  try{ setMsg(loginMsg,"מתחבר..."); await signInAnonymously(auth); }catch(e){ console.error(e); setMsg(loginMsg,"שגיאת התחברות (Anon Auth).",true); }
});

btnLogout.addEventListener("click", async ()=>{
  sessionStorage.removeItem("BATT_SESSION_V2"); session=null;
  if(unsub){ unsub(); unsub=null; }
  allRows=[]; visibleRows=[]; renderRows([]);
  try{ await signOut(auth); }catch{}
  openLogin();
});

btnAdd.addEventListener("click", async ()=>{
  if(!session) return;
  const firstName=fFirst.value.trim(), lastName=fLast.value.trim();
  if(!firstName || !lastName){ setMsg(addMsg,"חסר שם פרטי/משפחה",true); return; }
  const payload={
    firstName,lastName,
    battalion:(fBattalion.value.trim()||CFG.app.battalion_name_default||"8109"),
    company:(fCompany.value.trim()||session.forceLabel),
    platoon:fPlatoon.value.trim(),
    squad:fSquad.value.trim(),
    roles:[r1.value,r2.value,r3.value,r4.value].filter(x=>x && x!=="ללא"),
    forceId:session.forceId, forceLabel:session.forceLabel,
    updatedAt:serverTimestamp(), updatedByRole:session.role
  };
  try{
    setMsg(addMsg,"שומר...");
    await addDoc(soldiersCol(session.forceId), payload);
    fFirst.value=""; fLast.value=""; fPlatoon.value=""; fSquad.value="";
    r1.value="ללא"; r2.value="ללא"; r3.value="ללא"; r4.value="ללא";
    setMsg(addMsg,"נשמר ✅"); setTimeout(()=>setMsg(addMsg,""),1200);
  }catch(e){ console.error(e); setMsg(addMsg,"שגיאה בשמירה (Rules/Auth)",true); }
});

function applyFilters(){
  const nameQ=normalize(qName.value), roleQ=qRole.value, platoonQ=normalize(qPlatoon.value);
  visibleRows = allRows.filter(r=>{
    const full=normalize(`${r.firstName||""} ${r.lastName||""}`);
    const okName=!nameQ || full.includes(nameQ);
    const okRole=(roleQ==="הכל")?true:((r.roles||[]).includes(roleQ));
    const okPlatoon=!platoonQ || normalize(r.platoon).includes(platoonQ);
    return okName && okRole && okPlatoon;
  });
  renderRows(visibleRows);
  countHint.textContent=`מוצגים ${visibleRows.length} מתוך ${allRows.length}`;
}
[qName,qPlatoon].forEach(el=>el.addEventListener("input",applyFilters));
qRole.addEventListener("change",applyFilters);
btnClearFilters.addEventListener("click",()=>{ qName.value=""; qRole.value="הכל"; qPlatoon.value=""; applyFilters(); });

function renderRows(rows){
  tbody.innerHTML="";
  if(!rows.length){
    const tr=document.createElement("tr");
    tr.innerHTML=`<td colspan="4" class="muted">אין נתונים תואמים</td>`;
    tbody.appendChild(tr); return;
  }
  for(const row of rows){
    const name=`${escapeHtml(row.firstName)} ${escapeHtml(row.lastName)}`.trim();
    const org=[row.battalion?`גדוד: ${escapeHtml(row.battalion)}`:"",
               row.company?`פלוגה: ${escapeHtml(row.company)}`:"",
               row.platoon?`מחלקה: ${escapeHtml(row.platoon)}`:"",
               row.squad?`כיתה: ${escapeHtml(row.squad)}`:""].filter(Boolean).join(" · ");
    const rolesHtml=(row.roles||[]).length ? (row.roles||[]).map(r=>`<span class="pill">${escapeHtml(r)}</span>`).join("") : `<span class="muted">—</span>`;
    const tr=document.createElement("tr");
    tr.innerHTML = `<td>${name}</td><td class="muted">${org||"—"}</td><td>${rolesHtml}</td>
    <td class="actions"><button class="btnEdit">ערוך</button><button class="btnDel danger">מחק</button></td>`;
    tr.querySelector(".btnDel").addEventListener("click", async ()=>{
      if(!confirm(`למחוק את "${row.firstName} ${row.lastName}"?`)) return;
      try{ await deleteDoc(doc(db,"forces",session.forceId,"soldiers",row.__id)); }catch(e){ console.error(e); alert("שגיאה במחיקה"); }
    });
    tr.querySelector(".btnEdit").addEventListener("click", ()=>openEdit(tr,row));
    tbody.appendChild(tr);
  }
}

function jobSelect(cls, selected){
  const opts = CFG.jobs.map(j=>`<option value="${escapeHtml(j)}" ${(j===selected)?"selected":""}>${escapeHtml(j)}</option>`).join("");
  return `<select class="${cls}" style="min-width:140px">${opts}</select>`;
}
function openEdit(tr,row){
  const roles=row.roles||[];
  tr.innerHTML = `<td><input class="eFirst" value="${escapeHtml(row.firstName)}" style="width:48%"/><input class="eLast" value="${escapeHtml(row.lastName)}" style="width:48%"/></td>
  <td><div class="row" style="margin:0"><input class="eBatt" value="${escapeHtml(row.battalion)}" style="width:24%"/><input class="eComp" value="${escapeHtml(row.company)}" style="width:24%"/>
  <input class="ePlat" value="${escapeHtml(row.platoon)}" style="width:24%"/><input class="eSquad" value="${escapeHtml(row.squad)}" style="width:24%"/></div></td>
  <td><div class="row" style="margin:0">${jobSelect("eR1",roles[0]||"ללא")}${jobSelect("eR2",roles[1]||"ללא")}${jobSelect("eR3",roles[2]||"ללא")}${jobSelect("eR4",roles[3]||"ללא")}</div></td>
  <td class="actions"><button class="btnSave primary">שמור</button><button class="btnCancel">בטל</button></td>`;
  tr.querySelector(".btnCancel").addEventListener("click", ()=>{/* snapshot refresh */});
  tr.querySelector(".btnSave").addEventListener("click", async ()=>{
    try{
      const firstName=tr.querySelector(".eFirst").value.trim();
      const lastName=tr.querySelector(".eLast").value.trim();
      const battalion=tr.querySelector(".eBatt").value.trim();
      const company=tr.querySelector(".eComp").value.trim();
      const platoon=tr.querySelector(".ePlat").value.trim();
      const squad=tr.querySelector(".eSquad").value.trim();
      const rr=[tr.querySelector(".eR1").value,tr.querySelector(".eR2").value,tr.querySelector(".eR3").value,tr.querySelector(".eR4").value].filter(x=>x && x!=="ללא");
      await updateDoc(doc(db,"forces",session.forceId,"soldiers",row.__id),{firstName,lastName,battalion,company,platoon,squad,roles:rr,updatedAt:serverTimestamp(),updatedByRole:session.role});
    }catch(e){ console.error(e); alert("שגיאה בשמירה"); }
  });
}

btnExportJson.addEventListener("click", ()=>{
  const data = visibleRows.map(({__id,...rest})=>rest);
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json;charset=utf-8"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=`8109_${session?.forceId||"force"}_soldiers_export.json`; a.click(); URL.revokeObjectURL(a.href);
});

btnImport.addEventListener("click", async ()=>{
  if(!session) return;
  const file=importFile.files?.[0];
  if(!file){ setMsg(importMsg,"בחר קובץ לייבוא",true); return; }
  const text=await file.text();
  let rows=[];
  try{
    if(file.name.toLowerCase().endsWith(".json")) rows=JSON.parse(text);
    else rows=parseCsv(text);
    if(!Array.isArray(rows)) throw new Error("not array");
  }catch(e){ console.error(e); setMsg(importMsg,"שגיאה בפענוח קובץ",true); return; }

  rows = rows.map(r=>normalizeImportRow(r)).filter(r=>r.firstName && r.lastName);
  if(!rows.length){ setMsg(importMsg,"לא נמצאו רשומות תקינות",true); return; }

  try{
    setMsg(importMsg,"מייבא...");
    if(importMode.value==="replace"){
      const snap=await getDocs(soldiersCol(session.forceId));
      if(!snap.empty){
        let b=writeBatch(db); let n=0;
        for(const d of snap.docs){ b.delete(d.ref); n++; if(n%450===0){ await b.commit(); b=writeBatch(db);} }
        await b.commit();
      }
    }
    let b=writeBatch(db); let n=0;
    for(const r of rows){ b.set(doc(soldiersCol(session.forceId)), r); n++; if(n%450===0){ await b.commit(); b=writeBatch(db);} }
    await b.commit();
    setMsg(importMsg,`ייבוא הסתיים ✅ (${rows.length})`); setTimeout(()=>setMsg(importMsg,""),1500); importFile.value="";
  }catch(e){ console.error(e); setMsg(importMsg,"שגיאה בייבוא",true); }
});

function parseCsv(csvText){
  const lines=csvText.replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n").filter(l=>l.trim().length);
  if(lines.length<2) return [];
  const headers=splitCsvLine(lines[0]).map(h=>h.trim());
  const out=[];
  for(let i=1;i<lines.length;i++){
    const parts=splitCsvLine(lines[i]);
    const obj={}; headers.forEach((h,idx)=>obj[h]=(parts[idx]??"").trim());
    out.push(obj);
  }
  return out;
}
function splitCsvLine(line){
  const out=[]; let cur=""; let inQ=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){ if(inQ && line[i+1]==='"'){ cur+='"'; i++; } else inQ=!inQ; }
    else if(ch===',' && !inQ){ out.push(cur); cur=""; }
    else cur+=ch;
  }
  out.push(cur); return out;
}
function normalizeImportRow(r){
  const firstName=(r.firstName??r.firstname??r["שם פרטי"]??"").toString().trim();
  const lastName=(r.lastName??r.lastname??r["שם משפחה"]??"").toString().trim();
  const battalion=(r.battalion??r["גדוד"]??CFG.app.battalion_name_default??"8109").toString().trim();
  const company=(r.company??r["פלוגה"]??session.forceLabel).toString().trim();
  const platoon=(r.platoon??r["מחלקה"]??"").toString().trim();
  const squad=(r.squad??r["כיתה"]??"").toString().trim();
  const role1=(r.role1??r["תפקיד 1"]??"").toString().trim();
  const role2=(r.role2??r["תפקיד 2"]??"").toString().trim();
  const role3=(r.role3??r["תפקיד 3"]??"").toString().trim();
  const role4=(r.role4??r["תפקיד 4"]??"").toString().trim();
  const roles=[role1,role2,role3,role4].map(x=>x||"ללא").filter(x=>x && x!=="ללא");
  return {firstName,lastName,battalion,company,platoon,squad,roles,forceId:session.forceId,forceLabel:session.forceLabel,updatedAt:serverTimestamp(),updatedByRole:session.role,importedAt:serverTimestamp()};
}

btnMigrate.addEventListener("click", async ()=>{
  if(!session) return;
  if(!confirm(`להריץ מיגרציה לכוח "${session.forceLabel}"?`)) return;
  try{
    setMsg(migrateMsg,"מריץ מיגרציה...");
    const legacyCols=getLegacyCols(session.forceLabel);
    let total=0;
    for(const legacy of legacyCols){
      const snap=await getDocs(collection(db, legacy));
      if(snap.empty) continue;
      let b=writeBatch(db); let n=0;
      for(const d of snap.docs){
        b.set(doc(soldiersCol(session.forceId)), {...d.data(), forceId:session.forceId, forceLabel:session.forceLabel, legacyId:d.id, legacyCollection:legacy, migratedAt:serverTimestamp()}, {merge:true});
        n++; total++;
        if(n%450===0){ await b.commit(); b=writeBatch(db); }
      }
      await b.commit();
    }
    setMsg(migrateMsg,`מיגרציה הסתיימה ✅ (${total})`); setTimeout(()=>setMsg(migrateMsg,""),2500);
  }catch(e){ console.error(e); setMsg(migrateMsg,"שגיאה במיגרציה",true); }
});
function getLegacyCols(forceLabel){
  const slug1=forceLabel.replace(/\s+/g,"_"); // פלוגה_א
  const parts=forceLabel.trim().split(/\s+/).filter(Boolean);
  let slug2=slug1;
  if(parts.length===2 && parts[0]==="פלוגה") slug2=`${parts[1]}_${parts[0]}`; // א_פלוגה
  return Array.from(new Set([`units_${slug1}_soldiers`, `units_${slug2}_soldiers`]));
}
