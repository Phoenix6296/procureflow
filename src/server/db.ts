import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";

export const stages = [
  ["demand", "Department Demand", "Department → Admin (IA)"],
  ["tsc_formation", "TSC Formation", "Admin (IA)"],
  ["tsc_report", "TSC Specifications Report", "TSC"],
  ["as_review", "AS (IA) Review", "Admin (IA) → AS (IA)"],
  ["dgs_approval", "DGS Approval", "Admin (IA) → Admin (HQ) → DGS → Admin (HQ)"],
  ["draft_tender", "Draft Tender", "Admin (HQ)"],
  ["final_tender", "Final Tender", "Admin (IA)"],
  ["vendor_activity", "Vendor Activity (Offline)", "Admin (IA)"],
  ["bid_receipt", "Bid Receipt", "Admin (IA)"],
  ["bid_board", "Bid Opening Board Formation", "Admin (IA)"],
  ["technical_opening", "Technical Bid Opening (Offline)", "TSC"],
  ["tec_formation", "TEC Formation", "Admin (IA) → Superadmin"],
  ["technical_evaluation", "Technical Evaluation (Offline)", "TEC"],
  ["boc_formation", "BOC Formation", "Admin (IA)"],
  ["financial_evaluation", "Financial Evaluation", "BOC"],
  ["tac_formation", "TAC Formation", "Admin (IA)"],
  ["tac_recommendation", "TAC Recommendation", "TAC"],
  ["cfa_ifd", "CFA and IFD", "CFA → Admin (IA)"],
] as const;

export const users = [
  {
    id: "u-admin",
    name: "Admin (IA)",
    role: "adminia",
    username: "adminia",
    password: "adminia123",
  },
  {
    id: "u-super",
    name: "Superadmin (SS)",
    role: "super_admin",
    username: "superadmin",
    password: "admin123",
  },
  {
    id: "u-dgs",
    name: "DGS",
    role: "dgs",
    username: "dgs",
    password: "dgs123",
  },
  {
    id: "u-hq",
    name: "Admin (HQ)",
    role: "adminhq",
    username: "adminhq",
    password: "adminhq123",
  },
  {
    id: "u-tsc",
    name: "TSC / Committee Member",
    role: "committee",
    username: "tsc",
    password: "tsc123",
  },
  {
    id: "u-ia",
    name: "AS (IA) / IA Wing",
    role: "ia",
    username: "ia",
    password: "ia123",
  },
  {
    id: "u-department",
    name: "Department Officer",
    role: "department",
    username: "department",
    password: "department123",
  },
  {
    id: "u-cfa",
    name: "CFA Officer",
    role: "cfa",
    username: "cfa",
    password: "cfa123",
  },
  {
    id: "u-hq-liaison",
    name: "HQ Officer",
    role: "hq",
    username: "hq",
    password: "hq123",
  },
  {
    id: "u-vendor",
    name: "Demo Vendor",
    role: "vendor",
    username: "vendor",
    password: "vendor123",
  },
] as const;

const db = new Database(path.join(process.cwd(), "procureflow.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
    estimated_value REAL NOT NULL DEFAULT 0, deadline TEXT NOT NULL,
    stage TEXT NOT NULL, owner_id TEXT NOT NULL, created_at TEXT NOT NULL,
    department_id TEXT NOT NULL DEFAULT 'dept-user', workflow_data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL,
    actor_id TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS queries (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, actor_id TEXT NOT NULL,
    text TEXT NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL,
    recipient_id TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS tsc_reports (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version INTEGER NOT NULL,
    submitted_by TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
    status TEXT NOT NULL, submitted_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS replies (
    id TEXT PRIMARY KEY, query_id TEXT NOT NULL, actor_id TEXT NOT NULL,
    text TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS query_participants (
    query_id TEXT NOT NULL, user_id TEXT NOT NULL, access_type TEXT NOT NULL,
    added_by TEXT NOT NULL, at TEXT NOT NULL,
    PRIMARY KEY (query_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS bids (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, vendor_id TEXT NOT NULL,
    reference TEXT NOT NULL, amount REAL NOT NULL, note TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, designation TEXT NOT NULL, department_id TEXT NOT NULL,
    employee_id TEXT, contact TEXT, expertise TEXT, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS committees (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, version INTEGER NOT NULL,
    chairman_id TEXT, secretary_id TEXT, user_rep_id TEXT, constitution_date TEXT NOT NULL,
    valid_until TEXT, terms TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft'
  );
  CREATE TABLE IF NOT EXISTS committee_members (
    committee_id TEXT NOT NULL, person_id TEXT NOT NULL, role TEXT NOT NULL,
    PRIMARY KEY (committee_id, person_id)
  );
  CREATE TABLE IF NOT EXISTS committee_approvals (
    id TEXT PRIMARY KEY, committee_id TEXT NOT NULL, actor_id TEXT NOT NULL,
    action TEXT NOT NULL, remarks TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, category TEXT NOT NULL,
    name TEXT NOT NULL, storage_path TEXT NOT NULL, uploaded_by TEXT NOT NULL, at TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    content TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, registration_no TEXT NOT NULL UNIQUE,
    contact TEXT NOT NULL, email TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS bid_evaluations (
    id TEXT PRIMARY KEY, bid_id TEXT NOT NULL, evaluator_id TEXT NOT NULL,
    technical_status TEXT NOT NULL, observations TEXT NOT NULL, recommendation TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS contracts (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, vendor_id TEXT NOT NULL,
    award_reference TEXT NOT NULL, approved_value REAL NOT NULL, validity_until TEXT,
    performance_security REAL NOT NULL DEFAULT 0, status TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS milestones (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
    planned_start TEXT NOT NULL, planned_end TEXT NOT NULL, actual_start TEXT,
    actual_end TEXT, status TEXT NOT NULL, delay_reason TEXT NOT NULL DEFAULT '', remarks TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT,
    type TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL,
    read_at TEXT, at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY, project_id TEXT, actor_id TEXT NOT NULL,
    entity_type TEXT NOT NULL, entity_id TEXT, action TEXT NOT NULL,
    details TEXT NOT NULL, at TEXT NOT NULL
  );
`);
const projectColumns = db.prepare("PRAGMA table_info(projects)").all() as Array<{
  name: string;
}>;
if (!projectColumns.some((column) => column.name === "department_id"))
  db.exec(
    "ALTER TABLE projects ADD COLUMN department_id TEXT NOT NULL DEFAULT 'dept-user'",
  );
if (!projectColumns.some((column) => column.name === "workflow_data"))
  db.exec(
    "ALTER TABLE projects ADD COLUMN workflow_data TEXT NOT NULL DEFAULT '{}'",
  );
const queryColumns = db.prepare("PRAGMA table_info(queries)").all() as Array<{
  name: string;
}>;
if (!queryColumns.some((column) => column.name === "stage"))
  db.exec(
    "ALTER TABLE queries ADD COLUMN stage TEXT NOT NULL DEFAULT 'general'",
  );
if (!queryColumns.some((column) => column.name === "recipient_id"))
  db.exec(
    "ALTER TABLE queries ADD COLUMN recipient_id TEXT NOT NULL DEFAULT ''",
  );
db.prepare(
  "INSERT OR IGNORE INTO query_participants (query_id, user_id, access_type, added_by, at) SELECT id, actor_id, 'sender', actor_id, at FROM queries",
).run();
db.prepare(
  "INSERT OR IGNORE INTO query_participants (query_id, user_id, access_type, added_by, at) SELECT id, recipient_id, 'recipient', actor_id, at FROM queries WHERE recipient_id != ''",
).run();
db.prepare(
  "UPDATE events SET text = 'Private query activity is available to thread participants only' WHERE type IN ('query', 'as_query')",
).run();

const now = () => new Date().toISOString();
const uid = (prefix: string) =>
  `${prefix}-${crypto.randomBytes(5).toString("hex")}`;
export const safeUser = (user: (typeof users)[number] | undefined) =>
  user && {
    id: user.id,
    name: user.name,
    role: user.role,
    username: user.username,
  };
export const stageInfo = stages.map(([id, label, role]) => ({ id, label, role }));
export function assignedRole(stage: string, workflow: Record<string, any>) {
  if (workflow.completed) return null;
  if (stage === "demand") return "adminia";
  if (["tsc_formation", "bid_receipt", "bid_board", "boc_formation", "tac_formation"].includes(stage)) return "adminia";
  if (["tsc_report", "technical_opening", "technical_evaluation", "financial_evaluation", "tac_recommendation"].includes(stage)) return "committee";
  if (stage === "as_review") return workflow.phase === "as_decision" ? "ia" : "adminia";
  if (stage === "dgs_approval") {
    return ({ adminia_route: "adminia", adminhq_route: "adminhq", dgs_review: "dgs", adminhq_return: "adminhq" } as Record<string, string>)[workflow.phase] ?? "adminia";
  }
  if (stage === "tec_formation") return workflow.phase === "ss_approval" ? "super_admin" : "adminia";
  if (stage === "cfa_ifd") return workflow.phase === "ifd_confirmation" ? "adminia" : "cfa";
  if (["draft_tender"].includes(stage)) return "adminhq";
  if (["final_tender", "vendor_activity"].includes(stage)) return "adminia";
  return null;
}
export function seed() {
  const departmentCount = (
    db.prepare("SELECT COUNT(*) count FROM departments").get() as {
      count: number;
    }
  ).count;
  if (departmentCount === 0) {
    db.prepare("INSERT INTO departments VALUES (?, ?, ?, 1)").run(
      "dept-user",
      "User Department",
      "USER",
    );
    db.prepare("INSERT INTO departments VALUES (?, ?, ?, 1)").run(
      "dept-ia",
      "Inspection & Audit",
      "IA",
    );
    db.prepare("INSERT INTO departments VALUES (?, ?, ?, 1)").run(
      "dept-hq",
      "Headquarters",
      "HQ",
    );
    const insertPerson = db.prepare(
      "INSERT INTO people VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
    );
    insertPerson.run(
      "person-chair",
      "Dr. Anil Sharma",
      "Chief Engineer",
      "dept-user",
      "EMP-001",
      "Ext. 201",
      "Network infrastructure",
    );
    insertPerson.run(
      "person-secretary",
      "Meera Nair",
      "Deputy Director",
      "dept-hq",
      "EMP-002",
      "Ext. 202",
      "Procurement",
    );
    insertPerson.run(
      "person-member",
      "Rajiv Menon",
      "Technical Officer",
      "dept-ia",
      "EMP-003",
      "Ext. 203",
      "Cybersecurity",
    );
    insertPerson.run(
      "person-rep",
      "Nisha Kapoor",
      "User Department Representative",
      "dept-user",
      "EMP-004",
      "Ext. 204",
      "Operations",
    );
  }
  const vendorCount = (
    db.prepare("SELECT COUNT(*) count FROM vendors").get() as { count: number }
  ).count;
  if (vendorCount === 0) {
    db.prepare("INSERT INTO vendors VALUES (?, ?, ?, ?, ?, 1)").run(
      "vendor-demo",
      "Demo Infrastructure Pvt. Ltd.",
      "VEND-001",
      "Arjun Rao",
      "vendor@example.local",
    );
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, at);
    CREATE INDEX IF NOT EXISTS idx_queries_project ON queries(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_queries_participants ON queries(actor_id, recipient_id, at);
    CREATE INDEX IF NOT EXISTS idx_query_participants_user ON query_participants(user_id, query_id);
    CREATE INDEX IF NOT EXISTS idx_bids_project ON bids(project_id, at);
    CREATE INDEX IF NOT EXISTS idx_committees_project ON committees(project_id, version);
    CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id, category);
    CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id, planned_end);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
    CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_logs(project_id, at);
  `);
}
export function addEvent(
  projectId: string,
  type: string,
  actorId: string,
  text: string,
) {
  db.prepare("INSERT INTO events VALUES (?, ?, ?, ?, ?, ?)").run(
    uid("evt"),
    projectId,
    type,
    actorId,
    text,
    now(),
  );
}
export function projectView(row: any, viewerId?: string) {
  const project = {
    id: row.id,
    title: row.title,
    description: row.description,
    estimatedValue: row.estimated_value,
    deadline: row.deadline,
    stage: row.stage,
    stageLabel:
      JSON.parse(row.workflow_data || "{}").completed === true
        ? "Completed"
        : (stageInfo.find((s) => s.id === row.stage)?.label ?? row.stage),
    owner: safeUser(users.find((u) => u.id === row.owner_id))!,
    departmentId: row.department_id,
    departmentName:
      (db.prepare("SELECT name FROM departments WHERE id = ?").get(row.department_id) as { name: string } | undefined)?.name ?? "Unknown department",
    workflow: JSON.parse(row.workflow_data || "{}"),
    assignedRole: assignedRole(row.stage, JSON.parse(row.workflow_data || "{}")),
    createdAt: row.created_at,
  };
  const documents = db
    .prepare(
      "SELECT id, category, name, mime_type, uploaded_by, at FROM documents WHERE project_id = ? ORDER BY at DESC",
    )
    .all(row.id);
  const events = db
    .prepare("SELECT * FROM events WHERE project_id = ? ORDER BY at DESC")
    .all(row.id)
    .map((e: any) => ({
      id: e.id,
      type: e.type,
      actor: safeUser(users.find((u) => u.id === e.actor_id))!,
      text: e.text,
      at: e.at,
    }));
  const queries = db
    .prepare("SELECT * FROM queries WHERE project_id = ? ORDER BY at DESC")
    .all(row.id)
    .filter(
      (q: any) =>
        !!viewerId && !!db
          .prepare("SELECT 1 FROM query_participants WHERE query_id = ? AND user_id = ?")
          .get(q.id, viewerId),
    )
    .map((q: any) => queryView(q));
  const bids = db
    .prepare("SELECT * FROM bids WHERE project_id = ? ORDER BY at DESC")
    .all(row.id)
    .map((b: any) => ({
      id: b.id,
      vendor: safeUser(users.find((u) => u.id === b.vendor_id))!,
      reference: b.reference,
      amount: b.amount,
      note: b.note,
      at: b.at,
    }));
  const reports = db
    .prepare(
      "SELECT * FROM tsc_reports WHERE project_id = ? ORDER BY version DESC",
    )
    .all(row.id)
    .map((report: any) => ({
      id: report.id,
      version: report.version,
      title: report.title,
      content: report.content,
      status: report.status,
      submittedAt: report.submitted_at,
      submittedBy: safeUser(users.find((u) => u.id === report.submitted_by)),
    }));
  return { ...project, events, queries, bids, reports, documents };
}
function queryView(query: any) {
  const project = db.prepare("SELECT title FROM projects WHERE id = ?").get(query.project_id) as { title: string } | undefined;
  return {
    id: query.id,
    projectId: query.project_id,
    projectTitle: project?.title ?? "Procurement query",
    stage: query.stage,
    actor: safeUser(users.find((user) => user.id === query.actor_id))!,
    recipient: safeUser(users.find((user) => user.id === query.recipient_id)) ?? null,
    participants: db
      .prepare("SELECT user_id FROM query_participants WHERE query_id = ? ORDER BY at")
      .all(query.id)
      .map((participant: any) => safeUser(users.find((user) => user.id === participant.user_id))!),
    text: query.text,
    status: query.status,
    at: query.at,
    replies: db
      .prepare("SELECT * FROM replies WHERE query_id = ? ORDER BY at")
      .all(query.id)
      .map((reply: any) => ({
        id: reply.id,
        actor: safeUser(users.find((user) => user.id === reply.actor_id))!,
        text: reply.text,
        at: reply.at,
      })),
  };
}
export function queryInbox(userId: string) {
  return db
    .prepare("SELECT q.* FROM queries q JOIN query_participants p ON p.query_id = q.id WHERE p.user_id = ? ORDER BY q.at DESC")
    .all(userId)
    .map(queryView);
}
export { db, now, uid };

export function listPeople() {
  return db
    .prepare(
      `
    SELECT p.*, d.name department_name, d.code department_code
    FROM people p JOIN departments d ON d.id = p.department_id
    ORDER BY p.active DESC, p.name
  `,
    )
    .all();
}

export function listDepartments() {
  return db.prepare("SELECT * FROM departments ORDER BY name").all();
}

export function listVendors() {
  return db.prepare("SELECT * FROM vendors ORDER BY active DESC, name").all();
}

export function listCommittees(projectId?: string) {
  const rows = projectId
    ? db
        .prepare(
          "SELECT * FROM committees WHERE project_id = ? ORDER BY version DESC",
        )
        .all(projectId)
    : db
        .prepare("SELECT * FROM committees ORDER BY constitution_date DESC")
        .all();
  return rows.map((committee: any) => ({
    ...committee,
    chairman: safePerson(committee.chairman_id),
    secretary: safePerson(committee.secretary_id),
    userRepresentative: safePerson(committee.user_rep_id),
    members: db
      .prepare(
        `
      SELECT cm.role, p.id, p.name, p.designation, p.department_id
      FROM committee_members cm JOIN people p ON p.id = cm.person_id
      WHERE cm.committee_id = ? ORDER BY p.name
    `,
      )
      .all(committee.id),
    approvals: db
      .prepare(
        "SELECT * FROM committee_approvals WHERE committee_id = ? ORDER BY at DESC",
      )
      .all(committee.id),
  }));
}

function safePerson(id: string | null) {
  if (!id) return null;
  return (
    db
      .prepare(
        "SELECT p.id, p.name, p.designation, d.name department FROM people p JOIN departments d ON d.id = p.department_id WHERE p.id = ?",
      )
      .get(id) ?? null
  );
}

export function reportSummary() {
  const projectCounts = db
    .prepare("SELECT stage, COUNT(*) count FROM projects GROUP BY stage")
    .all();
  const pendingQueries = db
    .prepare("SELECT COUNT(*) count FROM queries WHERE status != 'resolved'")
    .get() as { count: number };
  const delayedMilestones = db
    .prepare(
      "SELECT COUNT(*) count FROM milestones WHERE planned_end < date('now') AND actual_end IS NULL",
    )
    .get() as { count: number };
  const pendingCommittees = db
    .prepare(
      "SELECT COUNT(*) count FROM committees WHERE status NOT IN ('approved', 'rejected')",
    )
    .get() as { count: number };
  return {
    projectCounts,
    pendingQueries: pendingQueries.count,
    delayedMilestones: delayedMilestones.count,
    pendingCommittees: pendingCommittees.count,
  };
}
