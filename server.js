
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "MASABA_CHANGE_THIS_SECRET_BEFORE_PRODUCTION";

const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads");
fs.mkdirSync(DATA_DIR,{recursive:true}); fs.mkdirSync(UPLOAD_DIR,{recursive:true});

app.use(cors());
app.use(express.json({limit:"4mb"}));
app.use(express.urlencoded({extended:true}));
app.use(express.static(PUBLIC_DIR));
app.use("/uploads", express.static(UPLOAD_DIR));

const files = {};
for (const name of ["users","students","teachers","parents","classes","subjects","announcements","events","admissions","attendance","results","assignments","materials","exams","attempts","fees","audit","settings"]) files[name]=path.join(DATA_DIR,`${name}.json`);

const classSeed=[
 {id:"creche",name:"Creche",section:"Early Years",defaultSubjectIds:[]},
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

function read(name){
 if(!fs.existsSync(files[name])) write(name,defaults[name] ?? []);
 try{return JSON.parse(fs.readFileSync(files[name],"utf8"))}catch{return defaults[name] ?? []}
}
function write(name,data){fs.writeFileSync(files[name],JSON.stringify(data,null,2))}
for(const k of Object.keys(files)) if(!fs.existsSync(files[k])) write(k,defaults[k]);
function uid(p="id"){return `${p}_${crypto.randomBytes(6).toString("hex")}`}
function audit(user,action,details=""){const rows=read("audit");rows.unshift({id:uid("audit"),at:new Date().toISOString(),user:user?.username||"system",role:user?.role||"system",action,details});write("audit",rows.slice(0,1000))}
function sign(u){return jwt.sign({id:u.id,username:u.username,role:u.role,personId:u.personId,name:u.name},JWT_SECRET,{expiresIn:"12h"})}
function auth(req,res,next){const h=req.headers.authorization||"";if(!h.startsWith("Bearer "))return res.status(401).json({error:"Authentication required"});try{req.user=jwt.verify(h.slice(7),JWT_SECRET);next()}catch{return res.status(401).json({error:"Session expired"})}}
function roles(...r){return (req,res,next)=>r.includes(req.user.role)?next():res.status(403).json({error:"You do not have permission for this action"})}
function safe(u){const {passwordHash,...x}=u;return x}
function grade(score){score=Number(score)||0;return score>=75?"A":score>=65?"B":score>=55?"C":score>=45?"D":score>=40?"E":"F"}

function seed(){
 const users=read("users"); if(!users.length){
  const mk=(username,password,role,name,personId=null)=>({id:uid("usr"),username,passwordHash:bcrypt.hashSync(password,10),role,name,personId,active:true});
  write("users",[mk("admin","admin123","admin","School Administrator"),mk("principal","principal123","principal","Demo Principal"),mk("teacher","teacher123","teacher","Demo Teacher","t1"),mk("student","student123","student","Demo Student","s1"),mk("parent","parent123","parent","Demo Parent","p1")]);
 }
 if(!read("teachers").length)write("teachers",[{id:"t1",name:"Demo Teacher",staffId:"MSS-T001",email:"teacher@masaba.local",phone:"",classIds:["jss-2"],subjectIds:["sub-1","sub-5"],status:"Active"}]);
 if(!read("parents").length)write("parents",[{id:"p1",name:"Demo Parent",phone:"",email:"parent@masaba.local",studentIds:["s1"],status:"Active"}]);
 if(!read("students").length)write("students",[{id:"s1",admissionNo:"MSS-0001",name:"Demo Student",classId:"jss-2",gender:"",dob:"",parentId:"p1",status:"Active",subjectIds:["sub-1","sub-2","sub-3","sub-5"]}]);
 if(!read("results").length)write("results",[
  {id:uid("res"),studentId:"s1",session:"2026/2027",term:"First Term",subjectId:"sub-2",ca:25,exam:60,score:85,grade:"A",published:true,remark:"Excellent work."},
  {id:uid("res"),studentId:"s1",session:"2026/2027",term:"First Term",subjectId:"sub-1",ca:24,exam:57,score:81,grade:"A",published:true,remark:"Very good."},
  {id:uid("res"),studentId:"s1",session:"2026/2027",term:"First Term",subjectId:"sub-3",ca:22,exam:57,score:79,grade:"A",published:true,remark:"Good progress."}
 ]);
 if(!read("fees").length)write("fees",[{id:uid("fee"),studentId:"s1",session:"2026/2027",term:"First Term",item:"School fees",amount:120000,paid:120000,status:"Paid",dueDate:"2026-09-15"}]);
 if(!read("exams").length)write("exams",[{
  id:"exam_demo",title:"Masaba General Knowledge CBT",subjectId:"sub-1",classId:"jss-2",description:"Demo examination.",durationMinutes:10,status:"published",startAt:null,endAt:null,maxAttempts:1,
  questions:[
   {id:"q1",text:"What is 7 × 8?",options:["48","54","56","64"],answer:2,marks:1},
   {id:"q2",text:"Which gas do plants mainly take in during photosynthesis?",options:["Oxygen","Carbon dioxide","Nitrogen","Hydrogen"],answer:1,marks:1},
   {id:"q3",text:"Choose the correctly spelled word.",options:["Enviroment","Environment","Envirronment","Enviornment"],answer:1,marks:1},
   {id:"q4",text:"What is the capital of Ogun State?",options:["Ibadan","Abeokuta","Akure","Lagos"],answer:1,marks:1}
  ]
 }]);
}
seed();

app.post("/api/auth/login",(req,res)=>{const {username,password}=req.body||{};const u=read("users").find(x=>x.username.toLowerCase()===String(username||"").toLowerCase()&&x.active!==false);if(!u||!bcrypt.compareSync(String(password||""),u.passwordHash))return res.status(401).json({error:"Invalid username or password"});audit(u,"LOGIN","Successful login");res.json({token:sign(u),user:safe(u)})});
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
app.post("/api/students",auth,roles("admin","principal"),(req,res)=>{const rows=read("students"),b=req.body||{};const item={id:uid("stu"),admissionNo:b.admissionNo||`MSS-${String(rows.length+1).padStart(4,"0")}`,name:b.name||"Unnamed Student",classId:b.classId||"creche",gender:b.gender||"",dob:b.dob||"",parentId:b.parentId||null,status:b.status||"Active",subjectIds:Array.isArray(b.subjectIds)?b.subjectIds:[]};rows.push(item);write("students",rows);audit(req.user,"CREATE_STUDENT",item.name);res.status(201).json(item)});
app.patch("/api/students/:id",auth,roles("admin","principal"),(req,res)=>{const rows=read("students"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Student not found"});rows[i]={...rows[i],...req.body,id:rows[i].id,subjectIds:Array.isArray(req.body.subjectIds)?req.body.subjectIds:(rows[i].subjectIds||[])};write("students",rows);audit(req.user,"UPDATE_STUDENT",rows[i].name);res.json(rows[i])});
app.put("/api/students/:id/subjects",auth,roles("admin","principal","teacher"),(req,res)=>{const rows=read("students"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Student not found"});if(req.user.role==="teacher"){const tea=read("teachers").find(x=>x.id===req.user.personId);if(!(tea?.classIds||[]).includes(rows[i].classId))return res.status(403).json({error:"Student is outside your assigned classes"});}const ids=(req.body.subjectIds||[]).map(String);if(req.user.role==="teacher"){const allowed=new Set(tea?.subjectIds||[]);if(ids.some(id=>!allowed.has(id)))return res.status(403).json({error:"You can only assign subjects you are authorized to teach"});}rows[i].subjectIds=[...new Set(ids)];write("students",rows);audit(req.user,"UPDATE_STUDENT_SUBJECTS",`${rows[i].name}: ${rows[i].subjectIds.join(",")}`);res.json({student:rows[i],subjects:read("subjects").filter(s=>ids.includes(s.id))})});

app.get("/api/teachers",auth,roles("admin","principal","teacher"),(req,res)=>res.json(read("teachers")));
app.post("/api/teachers",auth,roles("admin","principal"),(req,res)=>{const rows=read("teachers"),b=req.body||{};const item={id:uid("tea"),name:b.name||"Unnamed Teacher",staffId:b.staffId||`MSS-T${String(rows.length+1).padStart(3,"0")}`,email:b.email||"",phone:b.phone||"",classIds:b.classIds||[],subjectIds:b.subjectIds||[],status:"Active"};rows.push(item);write("teachers",rows);res.status(201).json(item)});
app.patch("/api/teachers/:id",auth,roles("admin","principal"),(req,res)=>{const rows=read("teachers"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Teacher not found"});rows[i]={...rows[i],...req.body,id:rows[i].id};write("teachers",rows);res.json(rows[i])});

app.get("/api/parents",auth,roles("admin","principal"),(req,res)=>res.json(read("parents")));
app.post("/api/parents",auth,roles("admin","principal"),(req,res)=>{const rows=read("parents"),b=req.body||{};const item={id:uid("par"),name:b.name||"Parent",phone:b.phone||"",email:b.email||"",studentIds:b.studentIds||[],status:"Active"};rows.push(item);write("parents",rows);res.status(201).json(item)});
app.patch("/api/parents/:id",auth,roles("admin","principal"),(req,res)=>{const rows=read("parents"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Parent not found"});rows[i]={...rows[i],...req.body,id:rows[i].id};write("parents",rows);res.json(rows[i])});

app.get("/api/classes",auth,(req,res)=>res.json(read("classes")));
app.post("/api/classes",auth,roles("admin","principal"),(req,res)=>{const rows=read("classes"),b=req.body||{};const item={id:uid("class"),name:b.name||"New Class",section:b.section||"Other",defaultSubjectIds:Array.isArray(b.defaultSubjectIds)?b.defaultSubjectIds:[]};rows.push(item);write("classes",rows);res.status(201).json(item)});
app.patch("/api/classes/:id",auth,roles("admin","principal"),(req,res)=>{const rows=read("classes"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Class not found"});rows[i]={...rows[i],...req.body,id:rows[i].id};write("classes",rows);res.json(rows[i])});

app.get("/api/subjects",auth,(req,res)=>res.json(read("subjects")));
app.post("/api/subjects",auth,roles("admin","principal"),(req,res)=>{const rows=read("subjects"),b=req.body||{};const item={id:uid("sub"),name:b.name||"New Subject",active:true};rows.push(item);write("subjects",rows);res.status(201).json(item)});
app.patch("/api/subjects/:id",auth,roles("admin","principal"),(req,res)=>{const rows=read("subjects"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Subject not found"});rows[i]={...rows[i],...req.body,id:rows[i].id};write("subjects",rows);res.json(rows[i])});

app.get("/api/results",auth,(req,res)=>{let rows=read("results");if(req.user.role==="student")rows=rows.filter(x=>x.studentId===req.user.personId&&x.published!==false);if(req.user.role==="teacher"){const tea=read("teachers").find(x=>x.id===req.user.personId);const ids=read("students").filter(s=>(tea?.classIds||[]).includes(s.classId)).map(s=>s.id);rows=rows.filter(x=>ids.includes(x.studentId));}if(req.user.role==="parent"){const p=read("parents").find(x=>x.id===req.user.personId);rows=rows.filter(x=>(p?.studentIds||[]).includes(x.studentId)&&x.published!==false)}res.json(rows.map(x=>({...x,subject:read("subjects").find(s=>s.id===x.subjectId)?.name||x.subject||"Subject",student:read("students").find(s=>s.id===x.studentId)?.name||""})))});
app.post("/api/results",auth,roles("admin","principal","teacher"),(req,res)=>{const rows=read("results"),b=req.body||{};if(req.user.role==="teacher"){const tea=read("teachers").find(t=>t.id===req.user.personId),stu=read("students").find(s=>s.id===b.studentId);if(!stu||!(tea?.classIds||[]).includes(stu.classId))return res.status(403).json({error:"Student is outside your assigned classes"});if(!(tea?.subjectIds||[]).includes(b.subjectId))return res.status(403).json({error:"You are not authorized for this subject"});}const ca=Number(b.ca)||0,exam=Number(b.exam)||0,score=Math.min(100,ca+exam),item={id:uid("res"),studentId:b.studentId,subjectId:b.subjectId,session:b.session||read("settings").session,term:b.term||read("settings").term,ca,exam,score,grade:grade(score),remark:b.remark||"",published:Boolean(b.published)};rows.push(item);write("results",rows);res.status(201).json(item)});
app.patch("/api/results/:id",auth,roles("admin","principal","teacher"),(req,res)=>{const rows=read("results"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Result not found"});const ca=Number(req.body.ca??rows[i].ca)||0,exam=Number(req.body.exam??rows[i].exam)||0;rows[i]={...rows[i],...req.body,ca,exam,score:Math.min(100,ca+exam),grade:grade(Math.min(100,ca+exam)),id:rows[i].id};write("results",rows);res.json(rows[i])});

app.get("/api/attendance",auth,(req,res)=>{let rows=read("attendance");if(req.user.role==="student")rows=rows.filter(x=>x.studentId===req.user.personId);if(req.user.role==="teacher"){const tea=read("teachers").find(x=>x.id===req.user.personId);const ids=read("students").filter(s=>(tea?.classIds||[]).includes(s.classId)).map(s=>s.id);rows=rows.filter(x=>ids.includes(x.studentId));}if(req.user.role==="parent"){const p=read("parents").find(x=>x.id===req.user.personId);rows=rows.filter(x=>(p?.studentIds||[]).includes(x.studentId)&&x.published!==false)}res.json(rows)});
app.post("/api/attendance",auth,roles("admin","principal","teacher"),(req,res)=>{const rows=read("attendance"),b=req.body||{};const item={id:uid("att"),studentId:b.studentId,date:b.date||new Date().toISOString().slice(0,10),status:b.status||"Present",markedBy:req.user.personId||req.user.id};rows.push(item);write("attendance",rows);res.status(201).json(item)});

app.get("/api/assignments",auth,(req,res)=>{let rows=read("assignments");if(req.user.role==="teacher")rows=rows.filter(x=>x.teacherId===req.user.personId);if(req.user.role==="student"){const s=read("students").find(x=>x.id===req.user.personId);rows=rows.filter(x=>!x.classId||x.classId===s?.classId)}if(req.user.role==="parent"){const p=read("parents").find(x=>x.id===req.user.personId);const classes=read("students").filter(s=>(p?.studentIds||[]).includes(s.id)).map(s=>s.classId);rows=rows.filter(x=>!x.classId||classes.includes(x.classId))}res.json(rows)});
app.post("/api/assignments",auth,roles("admin","principal","teacher"),(req,res)=>{const rows=read("assignments"),b=req.body||{};const item={id:uid("asg"),title:b.title||"Assignment",description:b.description||"",classId:b.classId||"",subjectId:b.subjectId||"",dueDate:b.dueDate||"",teacherId:req.user.personId||req.user.id,createdAt:new Date().toISOString()};rows.unshift(item);write("assignments",rows);res.status(201).json(item)});

app.get("/api/materials",auth,(req,res)=>{let rows=read("materials");if(req.user.role==="student"){const s=read("students").find(x=>x.id===req.user.personId);rows=rows.filter(x=>!x.classId||x.classId===s?.classId)}if(req.user.role==="parent"){const p=read("parents").find(x=>x.id===req.user.personId);const classes=read("students").filter(s=>(p?.studentIds||[]).includes(s.id)).map(s=>s.classId);rows=rows.filter(x=>!x.classId||classes.includes(x.classId))}res.json(rows)});
app.post("/api/materials",auth,roles("admin","principal","teacher"),(req,res)=>{const rows=read("materials"),b=req.body||{};const item={id:uid("mat"),title:b.title||"Learning material",url:b.url||"",subjectId:b.subjectId||"",classId:b.classId||"",teacherId:req.user.personId||req.user.id,createdAt:new Date().toISOString()};rows.unshift(item);write("materials",rows);res.status(201).json(item)});

app.get("/api/fees",auth,(req,res)=>{let rows=read("fees");if(req.user.role==="student")rows=rows.filter(x=>x.studentId===req.user.personId);if(req.user.role==="parent"){const p=read("parents").find(x=>x.id===req.user.personId);rows=rows.filter(x=>(p?.studentIds||[]).includes(x.studentId)&&x.published!==false)}res.json(rows)});
app.post("/api/fees",auth,roles("admin","principal"),(req,res)=>{const rows=read("fees"),b=req.body||{},amount=Number(b.amount)||0,paid=Number(b.paid)||0;const item={id:uid("fee"),studentId:b.studentId,session:b.session||read("settings").session,term:b.term||read("settings").term,item:b.item||"School fees",amount,paid,status:paid>=amount?"Paid":paid>0?"Part Paid":"Outstanding",dueDate:b.dueDate||""};rows.push(item);write("fees",rows);res.status(201).json(item)});
app.patch("/api/fees/:id",auth,roles("admin","principal"),(req,res)=>{const rows=read("fees"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Fee record not found"});rows[i]={...rows[i],...req.body,id:rows[i].id};rows[i].status=Number(rows[i].paid)>=Number(rows[i].amount)?"Paid":Number(rows[i].paid)>0?"Part Paid":"Outstanding";write("fees",rows);res.json(rows[i])});

app.get("/api/announcements",auth,(req,res)=>res.json(read("announcements")));
app.post("/api/announcements",auth,roles("admin","principal","teacher"),(req,res)=>{const rows=read("announcements"),b=req.body||{},item={id:uid("ann"),title:b.title||"Announcement",body:b.body||"",date:new Date().toISOString().slice(0,10),author:req.user.username};rows.unshift(item);write("announcements",rows);res.status(201).json(item)});
app.delete("/api/announcements/:id",auth,roles("admin","principal"),(req,res)=>{write("announcements",read("announcements").filter(x=>x.id!==req.params.id));res.json({ok:true})});

app.get("/api/events",auth,(req,res)=>res.json(read("events")));
app.post("/api/events",auth,roles("admin","principal"),(req,res)=>{const rows=read("events"),b=req.body||{},item={id:uid("evt"),title:b.title||"Event",date:b.date||new Date().toISOString().slice(0,10),description:b.description||""};rows.push(item);write("events",rows);res.status(201).json(item)});

app.get("/api/admissions",auth,roles("admin","principal"),(req,res)=>res.json(read("admissions")));
app.patch("/api/admissions/:id",auth,roles("admin","principal"),(req,res)=>{const rows=read("admissions"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Admission not found"});rows[i].status=req.body.status||rows[i].status;write("admissions",rows);res.json(rows[i])});

app.get("/api/exams",auth,(req,res)=>{let rows=read("exams");if(req.user.role==="student"){const s=read("students").find(x=>x.id===req.user.personId);rows=rows.filter(e=>e.status==="published"&&(!e.classId||e.classId===s?.classId)&&(!e.subjectId||(s?.subjectIds||[]).includes(e.subjectId)))}res.json(rows.map(e=>({...e,questions:e.questions.map(({answer,...q})=>q)})))});
app.post("/api/exams",auth,roles("admin","principal","teacher"),(req,res)=>{const rows=read("exams"),b=req.body||{};if(req.user.role==="teacher"){const tea=read("teachers").find(t=>t.id===req.user.personId);if(!(tea?.classIds||[]).includes(b.classId))return res.status(403).json({error:"Class is outside your assignment"});if(!(tea?.subjectIds||[]).includes(b.subjectId))return res.status(403).json({error:"You are not authorized for this subject"});}const item={id:uid("exam"),title:b.title||"New CBT",subjectId:b.subjectId||"",classId:b.classId||"",description:b.description||"",durationMinutes:Number(b.durationMinutes)||30,status:b.status||"draft",startAt:b.startAt||null,endAt:b.endAt||null,maxAttempts:Number(b.maxAttempts)||1,questions:Array.isArray(b.questions)?b.questions:[],createdBy:req.user.personId||req.user.id};rows.push(item);write("exams",rows);res.status(201).json(item)});
app.patch("/api/exams/:id",auth,roles("admin","principal","teacher"),(req,res)=>{const rows=read("exams"),i=rows.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:"Exam not found"});rows[i]={...rows[i],...req.body,id:rows[i].id};write("exams",rows);res.json(rows[i])});
function openExam(e){const now=Date.now();return e.status==="published"&&(!e.startAt||now>=new Date(e.startAt).getTime())&&(!e.endAt||now<=new Date(e.endAt).getTime())}
app.post("/api/exams/:id/start",auth,roles("student"),(req,res)=>{const e=read("exams").find(x=>x.id===req.params.id),s=read("students").find(x=>x.id===req.user.personId);if(!e)return res.status(404).json({error:"Exam not found"});if(!openExam(e))return res.status(400).json({error:"This exam is not currently available"});if(e.classId&&e.classId!==s?.classId)return res.status(403).json({error:"This exam is not assigned to your class"});if(e.subjectId&&!(s?.subjectIds||[]).includes(e.subjectId))return res.status(403).json({error:"You are not enrolled in this exam subject"});const rows=read("attempts"),used=rows.filter(a=>a.examId===e.id&&a.studentId===s.id);if(used.filter(a=>a.status==="submitted").length>=e.maxAttempts)return res.status(400).json({error:"Maximum attempts reached"});let a=used.find(x=>x.status==="in_progress");if(!a){const start=Date.now();a={id:uid("attempt"),examId:e.id,studentId:s.id,startedAt:new Date(start).toISOString(),deadline:new Date(start+e.durationMinutes*60000).toISOString(),status:"in_progress",answers:{},score:null,total:null,submittedAt:null};rows.push(a);write("attempts",rows);audit(req.user,"START_EXAM",e.title)}res.json({attemptId:a.id,deadline:a.deadline,exam:{...e,questions:e.questions.map(({answer,...q})=>q)}})});
app.post("/api/exams/attempts/:id/answer",auth,roles("student"),(req,res)=>{const rows=read("attempts"),i=rows.findIndex(a=>a.id===req.params.id&&a.studentId===req.user.personId);if(i<0)return res.status(404).json({error:"Attempt not found"});const a=rows[i];if(a.status!=="in_progress")return res.status(400).json({error:"Attempt closed"});if(Date.now()>new Date(a.deadline).getTime())return res.status(400).json({error:"Time expired"});a.answers[String(req.body.questionId)]=Number(req.body.answer);write("attempts",rows);res.json({ok:true,deadline:a.deadline})});
function finalize(a){const e=read("exams").find(x=>x.id===a.examId);let score=0,total=0;for(const q of (e?.questions||[])){total+=Number(q.marks)||1;if(Number(a.answers[q.id])===Number(q.answer))score+=Number(q.marks)||1}a.score=score;a.total=total;a.status="submitted";a.submittedAt=new Date().toISOString();return {score,total}}
app.post("/api/exams/attempts/:id/submit",auth,roles("student"),(req,res)=>{const rows=read("attempts"),i=rows.findIndex(a=>a.id===req.params.id&&a.studentId===req.user.personId);if(i<0)return res.status(404).json({error:"Attempt not found"});const a=rows[i];if(a.status==="submitted")return res.json({score:a.score,total:a.total,submittedAt:a.submittedAt,auto:false});const r=finalize(a);write("attempts",rows);audit(req.user,"SUBMIT_EXAM",a.examId);res.json({...r,submittedAt:a.submittedAt})});
app.get("/api/exam-attempts",auth,roles("admin","principal","teacher"),(req,res)=>res.json(read("attempts").map(a=>({...a,student:read("students").find(s=>s.id===a.studentId)?.name||"",exam:read("exams").find(e=>e.id===a.examId)?.title||""}))));

const upload=multer({dest:UPLOAD_DIR});
app.post("/api/upload",auth,roles("admin","principal","teacher"),upload.single("file"),(req,res)=>{if(!req.file)return res.status(400).json({error:"No file uploaded"});res.json({url:"/uploads/"+req.file.filename,originalName:req.file.originalname})});

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
app.listen(PORT,()=>console.log(`Masaba School Solution running at http://localhost:${PORT}`));
