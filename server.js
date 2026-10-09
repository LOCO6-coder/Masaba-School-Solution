
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
let JWT_SECRET = null; // resolved at startup (env var, or a random secret stored in the database)

const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads");
if(!process.env.DATABASE_URL){try{fs.mkdirSync(DATA_DIR,{recursive:true});fs.mkdirSync(UPLOAD_DIR,{recursive:true})}catch{}}

app.set("trust proxy",1);
app.use((req,res,next)=>{res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("X-Frame-Options","SAMEORIGIN");res.setHeader("Referrer-Policy","same-origin");next()});
app.use(express.json({limit:"4mb"}));
app.use(express.urlencoded({extended:true}));
app.use(express.static(PUBLIC_DIR));
app.use("/uploads", express.static(UPLOAD_DIR));

const files = {};
for (const name of ["users","students","teachers","parents","classes","subjects","announcements","events","admissions","attendance","results","assignments","materials","exams","attempts","fees","audit","settings"]) files[name]=path.join(DATA_DIR,`${name}.json`);

const classSeed=[
 {id:"kindergarten",name:"Kindergarten",section:"Early Years",defaultSubjectIds:[]},
 {id:"nursery-1",name:"Nursery 1",section:"Early Years",defaultSubjectIds:[]},
 {id:"nursery-2",name:"Nursery 2",section:"Early Years",defaultSubjectIds:[]},
 {id:"nursery-3",name:"Nursery 3",section:"Early Years",defaultSubjectIds:[]},
 ...["1","2","3","4","5","6"].map(n=>({id:"primary-"+n,name:"Primary "+n,section:"Primary"})),
 ...["1","2","3"].map(n=>({id:"jss-"+n,name:"JSS "+n,section:"Junior Secondary",defaultSubjectIds:[]})),
 ...["1","2","3"].map(n=>({id:"sss-"+n,name:"SSS "+n,section:"Senior Secondary",defaultSubjectIds:[]}))
];
const subjectSeed=["English Language","Mathematics","Basic Science","Basic Technology","Computer Studies","Social Studies","Civic Education","Biology","Chemistry","Physics","Economics","Government","Literature","Agricultural Science","Geography","French"].map((name,i)=>({id:"sub-"+(i+1),name,active:true}));

const defaults={
 classes:classSeed, subjects:subjectSeed, students:[],teachers:[],parents:[],announcements:[],events:[],admissions:[],attendance:[],results:[],assignments:[],materials:[],exams:[],attempts:[],fees:[],audit:[],
 settings:{schoolName:"Masaba School Solution",motto:"Illuminating minds & hearts to a better future.",address:"No. 1 Masaba Estate, Ita Oshin, Abeokuta, Ogun State, Nigeria.",emails:["masabaintl@gmail.com","masabasolutions@gmail.com"],phones:["0703 835 8625","0708 178 9499","0904 504 0370"],session:"2026/2027",term:"First Term"}
};

const NAMES=Object.keys(files);
const DATABASE_URL=process.env.DATABASE_URL||"";
const {AsyncLocalStorage}=require("async_hooks");
const als=new AsyncLocalStorage();
let pool=null;
if(DATABASE_URL){const {Pool}=require("pg");pool=new Pool({connectionString:DATABASE_URL,ssl:/localhost|127\.0\.0\.1/.test(DATABASE_URL)?false:{rejectUnauthorized:false},max:3,idleTimeoutMillis:10000})}
const clone=x=>JSON.parse(JSON.stringify(x));
const fileCache={};
// Every request gets its own freshly loaded copy of the data (als store). Local mode (no DATABASE_URL) uses plain files.
function read(name){const c=als.getStore();return c?c.data[name]:fileCache[name]}
function write(name,data){
 const c=als.getStore();
 if(c){c.data[name]=data;c.dirty.add(name);return}
 fileCache[name]=data;try{fs.writeFileSync(files[name],JSON.stringify(data,null,2))}catch(e){console.error("File save failed",e.message)}
}
async function loadData(client){
 const data={},dirty=new Set(),r=await client.query("select name,data from store");
 for(const row of r.rows)data[row.name]=row.data;
 for(const n of NAMES)if(data[n]===undefined){data[n]=clone(defaults[n]??[]);dirty.add(n)}
 return {data,dirty,client};
}
async function saveDirty(client,c){
 for(const n of [...c.dirty])await client.query("insert into store(name,data,updated_at) values($1,$2,now()) on conflict(name) do update set data=excluded.data, updated_at=now()",[n,JSON.stringify(c.data[n])]);
 c.dirty.clear();
}
function secretFrom(c){
 if(process.env.JWT_SECRET)return process.env.JWT_SECRET;
 if(!c.data._secret){c.data._secret={v:crypto.randomBytes(48).toString("hex")};c.dirty.add("_secret")}
 return c.data._secret.v;
}
async function initStore(){
 if(!pool){
  for(const n of NAMES){try{if(fs.existsSync(files[n]))fileCache[n]=JSON.parse(fs.readFileSync(files[n],"utf8"))}catch{}}
  for(const n of NAMES)if(fileCache[n]===undefined)write(n,clone(defaults[n]??[]));
  JWT_SECRET=process.env.JWT_SECRET||crypto.randomBytes(48).toString("hex");migrate();seed();
  console.warn("WARNING: no DATABASE_URL set - saving to local files (fine for testing only).");return;
 }
 const client=await pool.connect();
 try{
  await client.query("create table if not exists store(name text primary key,data jsonb not null,updated_at timestamptz default now())");
  await client.query("create table if not exists files(id text primary key,name text,mime text,data bytea not null,created_at timestamptz default now())");
  await client.query("begin");await client.query("select pg_advisory_xact_lock(7731)");
  const c=await loadData(client);JWT_SECRET=secretFrom(c);
  als.run(c,()=>{migrate();seed()});
  await saveDirty(client,c);await client.query("commit");
 }catch(e){try{await client.query("rollback")}catch{}throw e}
 finally{client.release()}
}
const ready=initStore();ready.catch(e=>console.error("STARTUP FAILED:",e.message));
// Database middleware: loads fresh data, serialises writers with a lock, and saves BEFORE the response is sent.
app.use(async(req,res,next)=>{
 if(!req.path.startsWith("/api/"))return next();
 try{await ready}catch{return res.status(503).json({error:"The system could not reach its database. Please try again in a moment."})}
 if(!pool||req.path.startsWith("/api/files/")||req.path==="/api/health")return next();
 const isWrite=!["GET","HEAD","OPTIONS"].includes(req.method);let client,c;
 try{
  client=await pool.connect();await client.query("begin");
  if(isWrite){await client.query("set local lock_timeout='8s'");await client.query("select pg_advisory_xact_lock(7731)")}
  c=await loadData(client);
 }catch(e){console.error("DB error:",e.message);if(client){try{await client.query("rollback")}catch{}client.release()}return res.status(503).json({error:"Database is busy or unreachable. Please try again."})}
 let done=false;
 const finish=async ok=>{if(done)return;done=true;try{if(ok){await saveDirty(client,c);await client.query("commit")}else await client.query("rollback")}catch(e){try{await client.query("rollback")}catch{}throw e}finally{client.release()}};
 const origJson=res.json.bind(res);
 res.json=function(body){finish(res.statusCode<400).then(()=>origJson(body)).catch(e=>{console.error("SAVE FAILED:",e.message);res.statusCode=500;origJson({error:"Your changes could not be saved. Please try again."})});return res};
 res.on("close",()=>{if(!done)finish(false).catch(()=>{})});
 req.dbctx=c;als.run(c,()=>next());
});
const inCtx=fn=>(req,res,next)=>als.run(req.dbctx,()=>fn(req,res,next));
function pick(o,keys){const r={};for(const k of keys)if(o&&o[k]!==undefined)r[k]=o[k];return r}
function clean(b){const {id,_id,passwordHash,createdBy,teacherId,studentId,subjectId,...rest}=b||{};return rest}
function uid(p="id"){return `${p}_${crypto.randomBytes(6).toString("hex")}`}
function audit(user,action,details=""){const rows=read("audit");rows.unshift({id:uid("audit"),at:new Date().toISOString(),user:user?.username||"system",role:user?.role||"system",action,details});write("audit",rows.slice(0,1000))}
function sign(u){return jwt.sign({id:u.id,username:u.username,role:u.role,owner:!!u.owner,personId:u.personId,name:u.name},JWT_SECRET,{expiresIn:"12h"})}
function auth(req,res,next){
 const h=req.headers.authorization||"";if(!h.startsWith("Bearer "))return res.status(401).json({error:"Authentication required"});
 let p;try{p=jwt.verify(h.slice(7),JWT_SECRET)}catch{return res.status(401).json({error:"Session expired"})}
 const u=read("users").find(x=>x.id===p.id);if(!u||u.active===false)return res.status(401).json({error:"Account disabled or removed"});
 if(u.mustChange&&!req.path.endsWith("/change-password")&&!req.path.endsWith("/auth/me"))return res.status(403).json({error:"You must change your password first",mustChange:true});
 req.user={id:u.id,username:u.username,role:u.role,owner:!!u.owner,personId:u.personId,name:u.name};next();
}
function roles(...r){return (req,res,next)=>r.includes(req.user.role)?next():res.status(403).json({error:"You do not have permission for this action"})}
function safe(u){const {passwordHash,...x}=u;return x}
function grade(score){score=Number(score)||0;return score>=75?"A":score>=65?"B":score>=55?"C":score>=45?"D":score>=40?"E":"F"}

function seed(){
 if(!read("users").length){
  const un=String(process.env.OWNER_USERNAME||"").trim(),pw=String(process.env.OWNER_PASSWORD||"");
  if(!un||pw.length<8){console.warn("SETUP NEEDED: set OWNER_USERNAME and OWNER_PASSWORD (at least 8 characters) in the hosting Environment settings, then redeploy.");return}
  write("users",[{id:uid("usr"),username:un,passwordHash:bcrypt.hashSync(pw,10),role:"admin",owner:true,name:"Proprietor",personId:null,active:true,mustChange:true}]);
  console.log("Owner account created:",un);
 }
}
function migrate(){
 const cl=read("classes"),c=cl.find(x=>x.id==="creche");
 if(c){c.id="kindergarten";c.name="Kindergarten";write("classes",cl);const st=read("students");st.forEach(x=>{if(x.classId==="creche")x.classId="kindergarten"});write("students",st)}
}

const loginTries=new Map();
const tooMany=k=>{const a=loginTries.get(k);return a&&a.n>=8&&Date.now()-a.t<15*60000};
const failTry=k=>{const a=loginTries.get(k);if(!a||Date.now()-a.t>=15*60000)loginTries.set(k,{n:1,t:Date.now()});else a.n++};
app.post("/api/auth/login",(req,res)=>{
 const {username,password}=req.body||{},key=req.ip+"|"+String(username||"").toLowerCase();
 if(tooMany(key))return res.status(429).json({error:"Too many failed attempts. Please wait 15 minutes and try again."});
 const u=read("users").find(x=>x.username.toLowerCase()===String(username||"").toLowerCase()&&x.active!==false);
 if(!u||!bcrypt.compareSync(String(password||""),u.passwordHash)){failTry(key);return res.status(401).json({error:"Invalid username or password"})}
 loginTries.delete(key);audit(u,"LOGIN","Successful login");res.json({token:sign(u),user:safe(u)});
});
app.post("/api/auth/change-password",auth,(req,res)=>{
 const {currentPassword,newPassword}=req.body||{},rows=read("users"),i=rows.findIndex(x=>x.id===req.user.id);
 if(i<0)return res.status(404).json({error:"Account not found"});
 if(!bcrypt.compareSync(String(currentPassword||""),rows[i].passwordHash))return res.status(400).json({error:"Current password is incorrect"});
 const np=String(newPassword||"");if(np.length<8)return res.status(400).json({error:"New password must be at least 8 characters"});
 if(np===String(currentPassword))return res.status(400).json({error:"Choose a password different from the current one"});
 rows[i].passwordHash=bcrypt.hashSync(np,10);rows[i].mustChange=false;write("users",rows);audit(req.user,"CHANGE_PASSWORD","Password changed");
 res.json({user:safe(rows[i]),token:sign(rows[i])});
});
app.get("/api/users",auth,roles("admin","principal"),(req,res)=>res.json(read("users").map(safe)));
app.post("/api/users",auth,roles("admin","principal"),(req,res)=>{
 const b=req.body||{},allowed=req.user.owner?["admin","principal","teacher","student","parent"]:["teacher","student","parent"];
 if(!allowed.includes(b.role))return res.status(403).json({error:req.user.owner?"Invalid account type":"Only the proprietor can create admin or principal accounts"});
 const username=String(b.username||"").trim(),pw=String(b.password||"");
 if(username.length<3)return res.status(400).json({error:"Username must be at least 3 characters"});
 if(pw.length<8)return res.status(400).json({error:"Temporary password must be at least 8 characters"});
 const users=read("users");if(users.some(x=>x.username.toLowerCase()===username.toLowerCase()))return res.status(409).json({error:"That username is already taken"});
 let personId=null,name=String(b.name||"").trim();
 if(["teacher","student","parent"].includes(b.role)){
  const person=read(b.role+"s").find(x=>x.id===b.personId);if(!person)return res.status(400).json({error:"Choose the "+b.role+" this login belongs to"});
  if(users.some(x=>x.role===b.role&&x.personId===person.id))return res.status(409).json({error:"This person already has a login"});
  personId=person.id;name=name||person.name;
 }
 if(!name)return res.status(400).json({error:"Name is required"});
 const item={id:uid("usr"),username,passwordHash:bcrypt.hashSync(pw,10),role:b.role,owner:false,name,personId,active:true,mustChange:true,createdBy:req.user.username};
 users.push(item);write("users",users);audit(req.user,"CREATE_USER",`${item.role}: ${item.username}`);res.status(201).json(safe(item));
});
app.patch("/api/users/:id",auth,roles("admin","principal"),(req,res)=>{
 const users=read("users"),i=users.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"User not found"});
 const t=users[i],b=req.body||{};
 if(t.owner&&t.id!==req.user.id)return res.status(403).json({error:"The proprietor account can only be changed by the proprietor"});
 if(!req.user.owner&&["admin","principal"].includes(t.role))return res.status(403).json({error:"Only the proprietor can manage admin and principal accounts"});
 if(b.active!==undefined){if(t.id===req.user.id)return res.status(400).json({error:"You cannot disable your own account"});t.active=Boolean(b.active)}
 if(b.newPassword!==undefined){const pw=String(b.newPassword);if(pw.length<8)return res.status(400).json({error:"Password must be at least 8 characters"});t.passwordHash=bcrypt.hashSync(pw,10);t.mustChange=true}
 write("users",users);audit(req.user,"UPDATE_USER",`${t.username}${b.active!==undefined?(t.active?" enabled":" disabled"):""}${b.newPassword!==undefined?" password reset":""}`);res.json(safe(t));
});
app.get("/api/backup",auth,roles("admin","principal"),(req,res)=>{
 const out={exportedAt:new Date().toISOString()};for(const n of NAMES)out[n]=n==="users"?read(n).map(safe):read(n);
 res.setHeader("Content-Disposition",`attachment; filename="masaba-backup-${new Date().toISOString().slice(0,10)}.json"`);res.json(out);
});
app.get("/api/health",(req,res)=>res.json({ok:true,storage:pool?"database":"files"}));
app.get("/api/auth/me",auth,(req,res)=>res.json({user:req.user}));

app.get("/api/public",(req,res)=>res.json({school:read("settings"),classes:read("classes"),subjects:read("subjects").filter(s=>s.active!==false),announcements:read("announcements").slice(0,10),events:read("events").slice(0,10)}));

app.post("/api/admissions",(req,res)=>{const b=req.body||{};if(!b.parentName||!b.phone||!b.studentName)return res.status(400).json({error:"Parent name, phone and student name are required"});const rows=read("admissions");const item={id:uid("adm"),parentName:b.parentName,phone:b.phone,email:b.email||"",studentName:b.studentName,classApplying:b.classApplying||"",message:b.message||"",status:"New",createdAt:new Date().toISOString()};rows.unshift(item);write("admissions",rows);res.status(201).json(item)});

app.get("/api/dashboard",auth,(req,res)=>{
 const students=read("students"),teachers=read("teachers"),parents=read("parents"),exams=read("exams");
 if(req.user.role==="student"){const s=students.find(x=>x.id===req.user.personId);return res.json({role:"student",student:s,subjects:read("subjects").filter(x=>(s?.subjectIds||[]).includes(x.id)),results:read("results").filter(x=>x.studentId===s?.id),attendance:read("attendance").filter(x=>x.studentId===s?.id),fees:read("fees").filter(x=>x.studentId===s?.id),assignments:read("assignments").filter(x=>x.classId===s?.classId),materials:read("materials").filter(x=>x.classId===s?.classId),exams:exams.filter(x=>x.status==="published")})}
 if(req.user.role==="parent"){const p=read("parents").find(x=>x.id===req.user.personId),ids=p?.studentIds||[];return res.json({role:"parent",parent:p,children:students.filter(s=>ids.includes(s.id)),results:read("results").filter(x=>ids.includes(x.studentId)),attendance:read("attendance").filter(x=>ids.includes(x.studentId)),fees:read("fees").filter(x=>ids.includes(x.studentId)),assignments:read("assignments").filter(x=>ids.includes(x.studentId))})}
 if(req.user.role==="teacher"){const t=read("teachers").find(x=>x.id===req.user.personId);return res.json({role:"teacher",teacher:t,students:students.filter(s=>(t?.classIds||[]).includes(s.classId)),classes:read("classes"),subjects:read("subjects"),assignments:read("assignments").filter(x=>x.teacherId===req.user.personId),materials:read("materials").filter(x=>x.teacherId===req.user.personId),exams:exams.filter(x=>x.createdBy===req.user.personId||req.user.role==="admin")})}
 res.json({role:req.user.role,stats:{students:students.length,teachers:teachers.length,parents:parents.length,classes:read("classes").length,subjects:read("subjects").length,exams:exams.length,admissions:read("admissions").filter(x=>x.status==="New").length,feesOutstanding:read("fees").filter(x=>x.status!=="Paid").length},announcements:read("announcements").slice(0,8),events:read("events").slice(0,8)});
});

app.get("/api/students",auth,roles("admin","principal","teacher"),(req,res)=>{
 const rows=read("students");
 if(req.user.role==="teacher"){const tea=read("teachers").find(x=>x.id===req.user.personId);return res.json(rows.filter(s=>(tea?.classIds||[]).includes(s.classId)))}
 res.json(rows);
});
app.get("/api/students/:id",auth,(req,res)=>{const s=read("students").find(x=>x.id===req.params.id);if(!s)return res.status(404).json({error:"Student not found"});if(req.user.role==="student"&&req.user.personId!==s.id)return res.status(403).json({error:"Access denied"});if(req.user.role==="parent"&&!read("parents").find(p=>p.id===req.user.personId&&p.studentIds.includes(s.id)))return res.status(403).json({error:"Access denied"});if(req.user.role==="teacher"){const tea=read("teachers").find(x=>x.id===req.user.personId);if(!(tea?.classIds||[]).includes(s.classId))return res.status(403).json({error:"Student is outside your assigned classes"});}res.json({...s,subjects:read("subjects").filter(x=>(s.subjectIds||[]).includes(x.id)),class:read("classes").find(x=>x.id===s.classId),parent:read("parents").find(x=>x.id===s.parentId)})});
app.post("/api/students",auth,roles("admin","principal"),(req,res)=>{const rows=read("students"),b=req.body||{};const item={id:uid("stu"),admissionNo:b.admissionNo||`MSS-${String(rows.length+1).padStart(4,"0")}`,name:b.name||"Unnamed Student",classId:b.classId||"kindergarten",gender:b.gender||"",dob:b.dob||"",parentId:b.parentId||null,status:b.status||"Active",subjectIds:Array.isArray(b.subjectIds)?b.subjectIds:[]};rows.push(item);write("students",rows);audit(req.user,"CREATE_STUDENT",item.name);res.status(201).json(item)});
app.patch("/api/students/:id",auth,roles("admin","principal"),(req,res)=>{const rows=read("students"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Student not found"});rows[i]={...rows[i],...clean(req.body),id:rows[i].id,subjectIds:Array.isArray(req.body.subjectIds)?req.body.subjectIds:(rows[i].subjectIds||[])};write("students",rows);audit(req.user,"UPDATE_STUDENT",rows[i].name);res.json(rows[i])});
app.put("/api/students/:id/subjects",auth,roles("admin","principal","teacher"),(req,res)=>{const rows=read("students"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Student not found"});if(req.user.role==="teacher"){const tea=read("teachers").find(x=>x.id===req.user.personId);if(!(tea?.classIds||[]).includes(rows[i].classId))return res.status(403).json({error:"Student is outside your assigned classes"});}const ids=(req.body.subjectIds||[]).map(String);if(req.user.role==="teacher"){const tea=read("teachers").find(x=>x.id===req.user.personId);const allowed=new Set(tea?.subjectIds||[]);if(ids.some(id=>!allowed.has(id)))return res.status(403).json({error:"You can only assign subjects you are authorized to teach"});}rows[i].subjectIds=[...new Set(ids)];write("students",rows);audit(req.user,"UPDATE_STUDENT_SUBJECTS",`${rows[i].name}: ${rows[i].subjectIds.join(",")}`);res.json({student:rows[i],subjects:read("subjects").filter(s=>ids.includes(s.id))})});

app.get("/api/teachers",auth,roles("admin","principal","teacher"),(req,res)=>res.json(read("teachers")));
app.post("/api/teachers",auth,roles("admin","principal"),(req,res)=>{const rows=read("teachers"),b=req.body||{};const item={id:uid("tea"),name:b.name||"Unnamed Teacher",staffId:b.staffId||`MSS-T${String(rows.length+1).padStart(3,"0")}`,email:b.email||"",phone:b.phone||"",classIds:b.classIds||[],subjectIds:b.subjectIds||[],status:"Active"};rows.push(item);write("teachers",rows);res.status(201).json(item)});
app.patch("/api/teachers/:id",auth,roles("admin","principal"),(req,res)=>{const rows=read("teachers"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Teacher not found"});rows[i]={...rows[i],...clean(req.body),id:rows[i].id};write("teachers",rows);res.json(rows[i])});

app.get("/api/parents",auth,roles("admin","principal"),(req,res)=>res.json(read("parents")));
app.post("/api/parents",auth,roles("admin","principal"),(req,res)=>{const rows=read("parents"),b=req.body||{};const item={id:uid("par"),name:b.name||"Parent",phone:b.phone||"",email:b.email||"",studentIds:b.studentIds||[],status:"Active"};rows.push(item);write("parents",rows);res.status(201).json(item)});
app.patch("/api/parents/:id",auth,roles("admin","principal"),(req,res)=>{const rows=read("parents"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Parent not found"});rows[i]={...rows[i],...clean(req.body),id:rows[i].id};write("parents",rows);res.json(rows[i])});

app.get("/api/classes",auth,(req,res)=>res.json(read("classes")));
app.post("/api/classes",auth,roles("admin","principal"),(req,res)=>{const rows=read("classes"),b=req.body||{};const item={id:uid("class"),name:b.name||"New Class",section:b.section||"Other",defaultSubjectIds:Array.isArray(b.defaultSubjectIds)?b.defaultSubjectIds:[]};rows.push(item);write("classes",rows);res.status(201).json(item)});
app.patch("/api/classes/:id",auth,roles("admin","principal"),(req,res)=>{const rows=read("classes"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Class not found"});rows[i]={...rows[i],...clean(req.body),id:rows[i].id};write("classes",rows);res.json(rows[i])});

app.get("/api/subjects",auth,(req,res)=>res.json(read("subjects")));
app.post("/api/subjects",auth,roles("admin","principal"),(req,res)=>{const rows=read("subjects"),b=req.body||{};const item={id:uid("sub"),name:b.name||"New Subject",active:true};rows.push(item);write("subjects",rows);res.status(201).json(item)});
app.patch("/api/subjects/:id",auth,roles("admin","principal"),(req,res)=>{const rows=read("subjects"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Subject not found"});rows[i]={...rows[i],...clean(req.body),id:rows[i].id};write("subjects",rows);res.json(rows[i])});

app.get("/api/results",auth,(req,res)=>{let rows=read("results");if(req.user.role==="student")rows=rows.filter(x=>x.studentId===req.user.personId&&x.published!==false);if(req.user.role==="teacher"){const tea=read("teachers").find(x=>x.id===req.user.personId);const ids=read("students").filter(s=>(tea?.classIds||[]).includes(s.classId)).map(s=>s.id);rows=rows.filter(x=>ids.includes(x.studentId));}if(req.user.role==="parent"){const p=read("parents").find(x=>x.id===req.user.personId);rows=rows.filter(x=>(p?.studentIds||[]).includes(x.studentId)&&x.published!==false)}res.json(rows.map(x=>({...x,subject:read("subjects").find(s=>s.id===x.subjectId)?.name||x.subject||"Subject",student:read("students").find(s=>s.id===x.studentId)?.name||""})))});
app.post("/api/results",auth,roles("admin","principal","teacher"),(req,res)=>{const rows=read("results"),b=req.body||{};if(req.user.role==="teacher"){const tea=read("teachers").find(t=>t.id===req.user.personId),stu=read("students").find(s=>s.id===b.studentId);if(!stu||!(tea?.classIds||[]).includes(stu.classId))return res.status(403).json({error:"Student is outside your assigned classes"});if(!(tea?.subjectIds||[]).includes(b.subjectId))return res.status(403).json({error:"You are not authorized for this subject"});}const ca=Number(b.ca)||0,exam=Number(b.exam)||0,score=Math.min(100,ca+exam),item={id:uid("res"),studentId:b.studentId,subjectId:b.subjectId,session:b.session||read("settings").session,term:b.term||read("settings").term,ca,exam,score,grade:grade(score),remark:b.remark||"",published:Boolean(b.published)};rows.push(item);write("results",rows);res.status(201).json(item)});
app.patch("/api/results/:id",auth,roles("admin","principal","teacher"),(req,res)=>{const rows=read("results"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Result not found"});if(req.user.role==="teacher"){const tea=read("teachers").find(t=>t.id===req.user.personId),stu=read("students").find(st=>st.id===rows[i].studentId);if(!stu||!(tea?.classIds||[]).includes(stu.classId)||!(tea?.subjectIds||[]).includes(rows[i].subjectId))return res.status(403).json({error:"You can only edit results for your own classes and subjects"})}const ca=Number(req.body.ca??rows[i].ca)||0,exam=Number(req.body.exam??rows[i].exam)||0;rows[i]={...rows[i],...clean(req.body),ca,exam,score:Math.min(100,ca+exam),grade:grade(Math.min(100,ca+exam)),id:rows[i].id};write("results",rows);res.json(rows[i])});

app.get("/api/attendance",auth,(req,res)=>{let rows=read("attendance");if(req.user.role==="student")rows=rows.filter(x=>x.studentId===req.user.personId);if(req.user.role==="teacher"){const tea=read("teachers").find(x=>x.id===req.user.personId);const ids=read("students").filter(s=>(tea?.classIds||[]).includes(s.classId)).map(s=>s.id);rows=rows.filter(x=>ids.includes(x.studentId));}if(req.user.role==="parent"){const p=read("parents").find(x=>x.id===req.user.personId);rows=rows.filter(x=>(p?.studentIds||[]).includes(x.studentId)&&x.published!==false)}res.json(rows)});
app.post("/api/attendance",auth,roles("admin","principal","teacher"),(req,res)=>{const rows=read("attendance"),b=req.body||{};const stu=read("students").find(x=>x.id===b.studentId);if(!stu)return res.status(400).json({error:"Student not found"});if(req.user.role==="teacher"){const tea=read("teachers").find(x=>x.id===req.user.personId);if(!(tea?.classIds||[]).includes(stu.classId))return res.status(403).json({error:"Student is outside your assigned classes"})}const item={id:uid("att"),studentId:b.studentId,date:b.date||new Date().toISOString().slice(0,10),status:b.status||"Present",markedBy:req.user.personId||req.user.id};rows.push(item);write("attendance",rows);res.status(201).json(item)});

app.get("/api/assignments",auth,(req,res)=>{let rows=read("assignments");if(req.user.role==="teacher")rows=rows.filter(x=>x.teacherId===req.user.personId);if(req.user.role==="student"){const s=read("students").find(x=>x.id===req.user.personId);rows=rows.filter(x=>!x.classId||x.classId===s?.classId)}if(req.user.role==="parent"){const p=read("parents").find(x=>x.id===req.user.personId);const classes=read("students").filter(s=>(p?.studentIds||[]).includes(s.id)).map(s=>s.classId);rows=rows.filter(x=>!x.classId||classes.includes(x.classId))}res.json(rows)});
app.post("/api/assignments",auth,roles("admin","principal","teacher"),(req,res)=>{const rows=read("assignments"),b=req.body||{};const item={id:uid("asg"),title:b.title||"Assignment",description:b.description||"",classId:b.classId||"",subjectId:b.subjectId||"",dueDate:b.dueDate||"",teacherId:req.user.personId||req.user.id,createdAt:new Date().toISOString()};rows.unshift(item);write("assignments",rows);res.status(201).json(item)});

app.get("/api/materials",auth,(req,res)=>{let rows=read("materials");if(req.user.role==="student"){const s=read("students").find(x=>x.id===req.user.personId);rows=rows.filter(x=>!x.classId||x.classId===s?.classId)}if(req.user.role==="parent"){const p=read("parents").find(x=>x.id===req.user.personId);const classes=read("students").filter(s=>(p?.studentIds||[]).includes(s.id)).map(s=>s.classId);rows=rows.filter(x=>!x.classId||classes.includes(x.classId))}res.json(rows)});
app.post("/api/materials",auth,roles("admin","principal","teacher"),(req,res)=>{const rows=read("materials"),b=req.body||{};const item={id:uid("mat"),title:b.title||"Learning material",url:b.url||"",subjectId:b.subjectId||"",classId:b.classId||"",teacherId:req.user.personId||req.user.id,createdAt:new Date().toISOString()};rows.unshift(item);write("materials",rows);res.status(201).json(item)});

app.get("/api/fees",auth,(req,res)=>{let rows=read("fees");if(req.user.role==="student")rows=rows.filter(x=>x.studentId===req.user.personId);if(req.user.role==="parent"){const p=read("parents").find(x=>x.id===req.user.personId);rows=rows.filter(x=>(p?.studentIds||[]).includes(x.studentId)&&x.published!==false)}res.json(rows)});
app.post("/api/fees",auth,roles("admin","principal"),(req,res)=>{const rows=read("fees"),b=req.body||{},amount=Number(b.amount)||0,paid=Number(b.paid)||0;const item={id:uid("fee"),studentId:b.studentId,session:b.session||read("settings").session,term:b.term||read("settings").term,item:b.item||"School fees",amount,paid,status:paid>=amount?"Paid":paid>0?"Part Paid":"Outstanding",dueDate:b.dueDate||""};rows.push(item);write("fees",rows);res.status(201).json(item)});
app.patch("/api/fees/:id",auth,roles("admin","principal"),(req,res)=>{const rows=read("fees"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Fee record not found"});rows[i]={...rows[i],...clean(req.body),id:rows[i].id};rows[i].status=Number(rows[i].paid)>=Number(rows[i].amount)?"Paid":Number(rows[i].paid)>0?"Part Paid":"Outstanding";write("fees",rows);res.json(rows[i])});

app.get("/api/announcements",auth,(req,res)=>res.json(read("announcements")));
app.post("/api/announcements",auth,roles("admin","principal","teacher"),(req,res)=>{const rows=read("announcements"),b=req.body||{},item={id:uid("ann"),title:b.title||"Announcement",body:b.body||"",date:new Date().toISOString().slice(0,10),author:req.user.username};rows.unshift(item);write("announcements",rows);res.status(201).json(item)});
app.delete("/api/announcements/:id",auth,roles("admin","principal"),(req,res)=>{write("announcements",read("announcements").filter(x=>x.id!==req.params.id));res.json({ok:true})});

app.get("/api/events",auth,(req,res)=>res.json(read("events")));
app.post("/api/events",auth,roles("admin","principal"),(req,res)=>{const rows=read("events"),b=req.body||{},item={id:uid("evt"),title:b.title||"Event",date:b.date||new Date().toISOString().slice(0,10),description:b.description||""};rows.push(item);write("events",rows);res.status(201).json(item)});

app.get("/api/admissions",auth,roles("admin","principal"),(req,res)=>res.json(read("admissions")));
app.patch("/api/admissions/:id",auth,roles("admin","principal"),(req,res)=>{const rows=read("admissions"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Admission not found"});rows[i].status=req.body.status||rows[i].status;write("admissions",rows);res.json(rows[i])});

app.get("/api/exams",auth,(req,res)=>{let rows=read("exams");if(req.user.role==="student"){const s=read("students").find(x=>x.id===req.user.personId);rows=rows.filter(e=>e.status==="published"&&(!e.classId||e.classId===s?.classId)&&(!e.subjectId||(s?.subjectIds||[]).includes(e.subjectId)))}res.json(rows.map(e=>({...e,questions:e.questions.map(({answer,...q})=>q)})))});
app.post("/api/exams",auth,roles("admin","principal","teacher"),(req,res)=>{const rows=read("exams"),b=req.body||{};if(req.user.role==="teacher"){const tea=read("teachers").find(t=>t.id===req.user.personId);if(!(tea?.classIds||[]).includes(b.classId))return res.status(403).json({error:"Class is outside your assignment"});if(!(tea?.subjectIds||[]).includes(b.subjectId))return res.status(403).json({error:"You are not authorized for this subject"});}const item={id:uid("exam"),title:b.title||"New CBT",subjectId:b.subjectId||"",classId:b.classId||"",description:b.description||"",durationMinutes:Number(b.durationMinutes)||30,status:b.status||"draft",startAt:b.startAt||null,endAt:b.endAt||null,maxAttempts:Number(b.maxAttempts)||1,questions:Array.isArray(b.questions)?b.questions:[],createdBy:req.user.personId||req.user.id};rows.push(item);write("exams",rows);res.status(201).json(item)});
app.patch("/api/exams/:id",auth,roles("admin","principal","teacher"),(req,res)=>{const rows=read("exams"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Exam not found"});if(req.user.role==="teacher"&&rows[i].createdBy!==req.user.personId)return res.status(403).json({error:"You can only edit exams you created"});const {id:_x,createdBy:_y,...examBody}=req.body||{};rows[i]={...rows[i],...examBody,id:rows[i].id,createdBy:rows[i].createdBy};write("exams",rows);res.json(rows[i])});
function openExam(e){const now=Date.now();return e.status==="published"&&(!e.startAt||now>=new Date(e.startAt).getTime())&&(!e.endAt||now<=new Date(e.endAt).getTime())}
app.post("/api/exams/:id/start",auth,roles("student"),(req,res)=>{const e=read("exams").find(x=>x.id===req.params.id),s=read("students").find(x=>x.id===req.user.personId);if(!e)return res.status(404).json({error:"Exam not found"});if(!openExam(e))return res.status(400).json({error:"This exam is not currently available"});if(e.classId&&e.classId!==s?.classId)return res.status(403).json({error:"This exam is not assigned to your class"});if(e.subjectId&&!(s?.subjectIds||[]).includes(e.subjectId))return res.status(403).json({error:"You are not enrolled in this exam subject"});const rows=read("attempts"),used=rows.filter(a=>a.examId===e.id&&a.studentId===s.id);if(used.filter(a=>a.status==="submitted").length>=e.maxAttempts)return res.status(400).json({error:"Maximum attempts reached"});let a=used.find(x=>x.status==="in_progress");if(!a){const start=Date.now();a={id:uid("attempt"),examId:e.id,studentId:s.id,startedAt:new Date(start).toISOString(),deadline:new Date(start+e.durationMinutes*60000).toISOString(),status:"in_progress",answers:{},score:null,total:null,submittedAt:null};rows.push(a);write("attempts",rows);audit(req.user,"START_EXAM",e.title)}res.json({attemptId:a.id,deadline:a.deadline,exam:{...e,questions:e.questions.map(({answer,...q})=>q)}})});
app.post("/api/exams/attempts/:id/answer",auth,roles("student"),(req,res)=>{const rows=read("attempts"),i=rows.findIndex(a=>a.id===req.params.id&&a.studentId===req.user.personId);if(i<0)return res.status(404).json({error:"Attempt not found"});const a=rows[i];if(a.status!=="in_progress")return res.status(400).json({error:"Attempt closed"});if(Date.now()>new Date(a.deadline).getTime())return res.status(400).json({error:"Time expired"});a.answers[String(req.body.questionId)]=Number(req.body.answer);write("attempts",rows);res.json({ok:true,deadline:a.deadline})});
function finalize(a){const e=read("exams").find(x=>x.id===a.examId);let score=0,total=0;for(const q of (e?.questions||[])){total+=Number(q.marks)||1;if(Number(a.answers[q.id])===Number(q.answer))score+=Number(q.marks)||1}a.score=score;a.total=total;a.status="submitted";a.submittedAt=new Date().toISOString();return {score,total}}
app.post("/api/exams/attempts/:id/submit",auth,roles("student"),(req,res)=>{const rows=read("attempts"),i=rows.findIndex(a=>a.id===req.params.id&&a.studentId===req.user.personId);if(i<0)return res.status(404).json({error:"Attempt not found"});const a=rows[i];if(a.status==="submitted")return res.json({score:a.score,total:a.total,submittedAt:a.submittedAt,auto:false});const r=finalize(a);write("attempts",rows);audit(req.user,"SUBMIT_EXAM",a.examId);res.json({...r,submittedAt:a.submittedAt})});
app.get("/api/exam-attempts",auth,roles("admin","principal","teacher"),(req,res)=>res.json(read("attempts").map(a=>({...a,student:read("students").find(s=>s.id===a.studentId)?.name||"",exam:read("exams").find(e=>e.id===a.examId)?.title||""}))));

const OKEXT=new Set([".jpg",".jpeg",".png",".webp",".gif",".pdf",".doc",".docx",".ppt",".pptx",".xls",".xlsx",".txt"]);
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:4*1024*1024},fileFilter:(req,file,cb)=>OKEXT.has(path.extname(file.originalname).toLowerCase())?cb(null,true):cb(new Error("This file type is not allowed"))});
app.post("/api/upload",auth,roles("admin","principal","teacher"),upload.single("file"),inCtx(async(req,res)=>{
 if(!req.file)return res.status(400).json({error:"No file uploaded"});
 const id=uid("f"),ext=path.extname(req.file.originalname).toLowerCase();
 if(pool){await als.getStore().client.query("insert into files(id,name,mime,data) values($1,$2,$3,$4)",[id,req.file.originalname,req.file.mimetype,req.file.buffer]);return res.json({url:"/api/files/"+id,originalName:req.file.originalname})}
 fs.writeFileSync(path.join(UPLOAD_DIR,id+ext),req.file.buffer);res.json({url:"/uploads/"+id+ext,originalName:req.file.originalname});
}));
app.get("/api/files/:id",async(req,res)=>{
 try{await ready;if(!pool)return res.status(404).json({error:"File not found"});
  const r=await pool.query("select name,mime,data from files where id=$1",[req.params.id]);if(!r.rows[0])return res.status(404).json({error:"File not found"});
  const f=r.rows[0];res.setHeader("Content-Type",f.mime||"application/octet-stream");res.setHeader("Content-Disposition",'inline; filename="'+encodeURIComponent(f.name||"file")+'"');res.setHeader("Cache-Control","public, max-age=86400");res.end(f.data);
 }catch(e){res.status(500).json({error:"Could not load the file"})}
});

app.get("/api/audit",auth,roles("admin","principal"),(req,res)=>res.json(read("audit").slice(0,200)));
app.get("/api/settings",auth,roles("admin","principal"),(req,res)=>res.json(read("settings")));
app.patch("/api/settings",auth,roles("admin","principal"),(req,res)=>{const s={...read("settings"),...req.body};write("settings",s);audit(req.user,"UPDATE_SETTINGS","School settings updated");res.json(s)});

app.get("/api/report/:studentId",auth,(req,res)=>{
 const s=read("students").find(x=>x.id===req.params.studentId);if(!s)return res.status(404).json({error:"Student not found"});
 const tea=req.user.role==="teacher"?read("teachers").find(t=>t.id===req.user.personId):null; const teacherAllowed=req.user.role==="teacher"&&(tea?.classIds||[]).includes(s.classId); const allowed=req.user.role==="admin"||req.user.role==="principal"||teacherAllowed||req.user.personId===s.id|| (req.user.role==="parent"&&read("parents").find(p=>p.id===req.user.personId)?.studentIds.includes(s.id));
 if(!allowed)return res.status(403).json({error:"Access denied"});
 res.json({school:read("settings"),student:s,class:read("classes").find(c=>c.id===s.classId),subjects:read("subjects").filter(x=>(s.subjectIds||[]).includes(x.id)),results:read("results").filter(x=>x.studentId===s.id&&((req.user.role==="admin"||req.user.role==="principal"||teacherAllowed)||x.published!==false)),attendance:read("attendance").filter(x=>x.studentId===s.id),parent:read("parents").find(p=>p.id===s.parentId)});
});

app.use((req,res,next)=>{if(req.method==="GET"&&!req.path.startsWith("/api/"))return res.sendFile(path.join(PUBLIC_DIR,"index.html"));next()});
app.use((err,req,res,next)=>{console.error(err.message);res.status(err.status||400).json({error:err.message||"Request failed"})});
module.exports=app;
if(require.main===module){ready.then(()=>app.listen(PORT,()=>console.log(`Masaba School Solution running on port ${PORT}`))).catch(()=>process.exit(1))}
