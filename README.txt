MASABA SCHOOL SOLUTION — V2 DEVELOPMENT BUILD

RUN LOCALLY
1. Install Node.js LTS.
2. Open Command Prompt in this folder.
3. Run: npm install
4. Run: npm start
5. Open: http://localhost:3000

IMPORTANT: Do NOT double-click public/index.html. The application must be served by server.js.

DEMO ACCOUNTS
Administrator: admin / admin123
Principal: principal / principal123
Teacher: teacher / teacher123
Student: student / student123
Parent: parent / parent123

V2 FEATURES
- Public website: Home, About, Academics, Admissions, News, Events, Gallery, Contact.
- Role-based portals: Administrator, Principal, Teacher, Student, Parent.
- JWT authentication and role-based authorization.
- Audit trail.
- Student records, admission numbers, classes, parent links and status.
- Individual student subject management: authorized teachers can add/remove subjects for students in assigned classes; admin/principal can manage all.
- Creche, Nursery, Primary 1–6, JSS 1–3, SSS 1–3.
- Subject catalogue and teacher class/subject assignments.
- Results with CA + exam + total + grade and published/unpublished control.
- Printable report-card view.
- Attendance: Present / Absent / Late.
- Assignments and learning materials.
- CBT exam creation, multiple-choice question builder, class/subject assignment, duration, start/end window, max attempts, draft/published state, eligibility checks, server-side deadline, answer saving, automatic submission and attempt review.
- Fees: amount, paid, balance and status.
- Admissions enquiry workflow.
- Announcements and events.
- Editable school settings.

DEVELOPMENT/PRODUCTION NOTES
This is a development build. Before real student data is entered:
- Replace JWT_SECRET with a strong secret in .env.
- Move from JSON storage to PostgreSQL/MySQL.
- Use HTTPS.
- Configure backups.
- Add password reset/change workflows.
- Add stricter upload validation and rate limiting.
- Review privacy/data-protection requirements.
- Remove demo credentials.

OWNER REVIEW
Deploy the Node application itself, not public/index.html. The server must run with npm start.
