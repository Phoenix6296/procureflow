import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import {
  addEvent,
  assignedRole,
  db,
  listCommittees,
  listDepartments,
  listPeople,
  listVendors,
  now,
  projectView,
  queryInbox,
  safeUser,
  seed,
  stageInfo,
  stages,
  uid,
  users,
} from "./db.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const sessions = new Map<string, string>();
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
seed();

const userFor = (req: express.Request) =>
  users.find((u) => u.id === sessions.get(req.cookies.session));
const auth = (req: express.Request, res: express.Response) => {
  const user = userFor(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return user;
};
const project = (id: string) =>
  db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as any;
const allowedRoles = (_stage: string): string[] => [];
const nextStage = (stage: string) =>
  stages[stages.findIndex(([id]) => id === stage) + 1]?.[0];
const handoffStages = new Set([
  "tsc_report",
  "as_review",
  "hq_review",
  "arc_review",
  "cfa_approval",
  "completed",
]);
const queryParticipant = (user: (typeof users)[number], query: any) =>
  !!db.prepare("SELECT 1 FROM query_participants WHERE query_id = ? AND user_id = ?")
    .get(query.id, user.id);

const readWorkflow = (row: any) => JSON.parse(row.workflow_data || "{}");
const saveWorkflow = (row: any, stage: string, workflow: Record<string, any>) =>
  db.prepare("UPDATE projects SET stage = ?, workflow_data = ? WHERE id = ?").run(
    stage,
    JSON.stringify(workflow),
    row.id,
  );
const addDocument = (
  projectId: string,
  userId: string,
  category: string,
  input: any,
) => {
  if (
    !input ||
    typeof input.name !== "string" ||
    input.mimeType !== "application/pdf" ||
    typeof input.content !== "string"
  )
    throw new Error("Attach a PDF document");
  const content = input.content.replace(/^data:application\/pdf;base64,/, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content) || content.length > 8_000_000)
    throw new Error("PDF must be valid and no larger than 6 MB");
  db.prepare(
    "INSERT INTO documents (id, project_id, category, name, storage_path, uploaded_by, at, mime_type, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(uid("doc"), projectId, category, input.name.slice(0, 180), "database", userId, now(), "application/pdf", content);
};

app.get("/api/documents/:id", (req, res) => {
  const user = auth(req, res);
  if (!user) return;
  const document = db
    .prepare("SELECT name, mime_type, content, project_id FROM documents WHERE id = ?")
    .get(req.params.id) as any;
  if (!document) return res.status(404).json({ error: "Document not found" });
  const projectRow = project(document.project_id);
  if (assignedRole(projectRow.stage, readWorkflow(projectRow)) !== user.role)
    return res.status(404).json({ error: "Document not found" });
  res.type(document.mime_type).setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(document.name)}`,
  );
  return res.send(Buffer.from(document.content, "base64"));
});

app.post("/api/login", (req, res) => {
  const input = z
    .object({ username: z.string(), password: z.string() })
    .safeParse(req.body);
  const user =
    input.success &&
    users.find(
      (u) =>
        u.username === input.data.username &&
        u.password === input.data.password,
    );
  if (!user)
    return res.status(401).json({ error: "Invalid username or password" });
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, user.id);
  res.cookie("session", token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 86400000,
  });
  return res.json({ user: safeUser(user) });
});
app.post("/api/logout", (req, res) => {
  sessions.delete(req.cookies.session);
  res.clearCookie("session");
  res.json({ ok: true });
});
app.get("/api/me", (req, res) => {
  const user = userFor(req);
  return user
    ? res.json({ user: safeUser(user) })
    : res.status(401).json({ error: "Not authenticated" });
});
app.get("/api/bootstrap", (req, res) => {
  const user = auth(req, res);
  if (!user) return;
  const rows = db
    .prepare("SELECT * FROM projects ORDER BY created_at DESC")
    .all()
    .filter((row: any) => assignedRole(row.stage, readWorkflow(row)) === user.role);
  const projectIds = rows.map((row: any) => row.id);
  res.json({
    projects: rows.map((row) => projectView(row, user.id)),
    stages: [],
    users: [],
    people: user.role === "adminia" ? listPeople() : [],
    departments: user.role === "department" ? listDepartments() : [],
    vendors: [],
    committees: projectIds.length
      ? projectIds.flatMap((id: string) => listCommittees(id))
      : [],
    reports: { projectCounts: [], pendingQueries: 0, delayedMilestones: 0, pendingCommittees: 0 },
    queryInbox: queryInbox(user.id),
    queryRecipients: users
      .filter((candidate) => candidate.id !== user.id && candidate.role !== "vendor")
      .map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
        role: candidate.role,
      })),
  });
});
app.get("/api/people", (req, res) => {
  const user = auth(req, res);
  if (!user) return;
  if (user.role !== "adminia") return res.status(403).json({ error: "Personnel directory is not available for this account" });
  res.json({ people: listPeople(), departments: listDepartments() });
});
app.get("/api/vendors", (req, res) => {
  const user = auth(req, res);
  if (!user) return;
  if (user.role !== "adminia") return res.status(403).json({ error: "Vendor directory is not available for this account" });
  res.json({ vendors: listVendors() });
});
app.get("/api/committees", (req, res) => {
  const user = auth(req, res);
  if (!user) return;
  if (user.role !== "adminia") return res.status(403).json({ error: "Committee register is not available for this account" });
  const visibleProjectIds = db
    .prepare("SELECT * FROM projects")
    .all()
    .filter((row: any) => assignedRole(row.stage, readWorkflow(row)) === user.role)
    .map((row: any) => row.id);
  const requestedProjectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  if (requestedProjectId && !visibleProjectIds.includes(requestedProjectId))
    return res.status(404).json({ error: "Project not found" });
  res.json({
    committees: requestedProjectId
      ? listCommittees(requestedProjectId)
      : visibleProjectIds.flatMap((id: string) => listCommittees(id)),
  });
});
app.get("/api/reports/summary", (req, res) => {
  if (!auth(req, res)) return;
  res.status(404).json({ error: "Role-wide reports are not part of the task workspace" });
});
app.get("/api/projects/:id/logs", (req, res) => {
  const user = auth(req, res);
  if (!user) return;
  const row = project(req.params.id);
  if (!row) return res.status(404).json({ error: "Project not found" });
  if (assignedRole(row.stage, readWorkflow(row)) !== user.role)
    return res.status(404).json({ error: "Project not found" });
  const view = projectView(row, user.id);
  return res.json({ project: view, logs: view.events });
});
app.post("/api/projects/:id/action", (req, res) => {
  const user = auth(req, res);
  const row = project(req.params.id);
  if (!user || !row)
    return res.status(404).json({ error: "Project not found" });
  if (assignedRole(row.stage, readWorkflow(row)) !== user.role)
    return res.status(404).json({ error: "Project not found" });
  const body = req.body as Record<string, any>;
  const workflow = readWorkflow(row);
  const remarks = typeof body.remarks === "string" ? body.remarks.trim() : "";
  if (remarks.length < 2)
    return res.status(400).json({ error: "Action remarks are required" });
  const fail = (message: string, status = 403) => res.status(status).json({ error: message });
  const requireState = (stage: string, role: string, phase?: string) =>
    row.stage === stage &&
    user.role === role &&
    (phase === undefined || workflow.phase === phase);
  const audit = (action: string) =>
    addEvent(row.id, action, user.id, `${action.replaceAll("_", " ")}: ${remarks}`);
  const move = (stage: string, nextWorkflow = workflow) => {
    saveWorkflow(row, stage, nextWorkflow);
    audit(String(body.action));
    return res.json({ project: projectView(project(row.id), user.id) });
  };
  try {
    switch (body.action) {
      case "accept_demand":
        if (!requireState("demand", "adminia")) return fail("Only Admin (IA) can accept a demand");
        workflow.phase = "accepted";
        return move("tsc_formation");
      case "form_tsc":
        if (!requireState("tsc_formation", "adminia")) return fail("Only Admin (IA) can form the TSC");
        return formCommittee("Technical Scrutiny Committee", "tsc_report");
      case "submit_tsc_report":
        if (!requireState("tsc_report", "committee")) return fail("Only TSC members can submit the specifications report");
        if (typeof body.content !== "string" || body.content.trim().length < 20)
          return fail("Provide a detailed specifications report", 400);
        workflow.tscReport = body.content.trim();
        workflow.phase = "adminia_route";
        return move("as_review");
      case "route_to_as":
        if (!requireState("as_review", "adminia", "adminia_route")) return fail("Only Admin (IA) can route the report to AS (IA)");
        workflow.phase = "as_decision";
        return move(row.stage);
      case "as_decision":
        if (!requireState("as_review", "ia", "as_decision")) return fail("Only AS (IA) can review this report");
        if (body.decision === "return") return move("tsc_report");
        if (body.decision !== "approve") return fail("Choose approve or return; use Private queries for clarification", 400);
        workflow.phase = "adminia_route";
        return move("dgs_approval");
      case "route_to_hq":
        if (!requireState("dgs_approval", "adminia", "adminia_route")) return fail("Only Admin (IA) can route the approved file to Admin (HQ)");
        workflow.phase = "adminhq_route";
        return move(row.stage);
      case "route_to_dgs":
        if (!requireState("dgs_approval", "adminhq", "adminhq_route") && !requireState("dgs_approval", "hq", "adminhq_route"))
          return fail("Only Admin (HQ) can route this file to DGS");
        workflow.phase = "dgs_review";
        return move(row.stage);
      case "dgs_decision":
        if (!requireState("dgs_approval", "dgs", "dgs_review")) return fail("Only DGS can decide this approval");
        if (body.decision === "return") {
          workflow.phase = "adminhq_route";
          return move(row.stage);
        }
        if (body.decision !== "approve") return fail("Choose approve or return; use Private queries for clarification", 400);
        workflow.phase = "adminhq_return";
        return move(row.stage);
      case "acknowledge_dgs":
        if (!requireState("dgs_approval", "adminhq", "adminhq_return")) return fail("Only Admin (HQ) can complete the DGS handoff");
        workflow.phase = "draft_upload";
        return move("draft_tender");
      case "upload_draft":
        if (!requireState("draft_tender", "adminhq")) return fail("Only Admin (HQ) can upload the draft tender");
        addDocument(row.id, user.id, "draft_tender", body.document);
        workflow.draftVersion = (workflow.draftVersion ?? 0) + 1;
        return move("final_tender");
      case "issue_final_tender":
        if (!requireState("final_tender", "adminia")) return fail("Only Admin (IA) can issue the final tender");
        if (typeof body.deadline !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.deadline))
          return fail("Set a valid submission deadline", 400);
        if (body.document) {
          addDocument(row.id, user.id, "final_tender", body.document);
          workflow.finalVersion = (workflow.finalVersion ?? 0) + 1;
        } else if (!workflow.finalVersion) {
          return fail("Upload a final tender PDF before publishing", 400);
        }
        workflow.submissionDeadline = body.deadline;
        db.prepare("UPDATE projects SET deadline = ? WHERE id = ?").run(body.deadline, row.id);
        return move("vendor_activity");
      case "save_final_revision":
        if (!requireState("final_tender", "adminia")) return fail("Only Admin (IA) can revise the final tender");
        addDocument(row.id, user.id, "final_tender", body.document);
        workflow.finalVersion = (workflow.finalVersion ?? 0) + 1;
        return move(row.stage);
      case "finish_vendor_activity":
        if (!requireState("vendor_activity", "adminia")) return fail("Only Admin (IA) can close offline vendor activity");
        if (workflow.submissionDeadline && workflow.submissionDeadline > new Date().toISOString().slice(0, 10))
          return fail("Vendor activity cannot close before the published deadline", 400);
        return move("bid_receipt");
      case "record_bid_receipt":
        if (!requireState("bid_receipt", "adminia")) return fail("Only Admin (IA) can record bid receipt");
        if (!Number.isInteger(body.bidCount) || body.bidCount < 0)
          return fail("Enter a valid total bid count", 400);
        workflow.bidCount = body.bidCount;
        const notifyVendor = db.prepare(
          "INSERT INTO notifications VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        );
        users.filter((candidate) => candidate.role === "vendor").forEach((vendor) =>
          notifyVendor.run(
            uid("notification"),
            vendor.id,
            row.id,
            "bid_receipt",
            "Bid receipt recorded",
            `${body.bidCount} bid(s) were recorded for ${row.title}.`,
            null,
            now(),
          ),
        );
        return move("bid_board");
      case "form_board":
        if (!requireState("bid_board", "adminia")) return fail("Only Admin (IA) can form the Bid Opening Board");
        return formCommittee("Bid Opening Board", "technical_opening");
      case "record_technical_opening":
        if (!requireState("technical_opening", "committee")) return fail("Only the Bid Opening Board can record the opening");
        return move("tec_formation");
      case "form_tec":
        if (!requireState("tec_formation", "adminia")) return fail("Only Admin (IA) can form the TEC");
        workflow.committees = workflow.committees ?? [];
        workflow.committees.push(getCommittee("Technical Evaluation Committee"));
        workflow.phase = "ss_approval";
        return move(row.stage);
      case "tec_decision":
        if (!requireState("tec_formation", "super_admin", "ss_approval")) return fail("Only Superadmin (SS) can approve or query the TEC");
        if (body.decision !== "approve") return fail("Use Private queries for clarification", 400);
        recordCommitteeDecision("approve");
        workflow.phase = "approved";
        return move("technical_evaluation");
      case "submit_technical_evaluation":
        if (!requireState("technical_evaluation", "committee")) return fail("Only the TEC can submit its evaluation");
        workflow.qualifiedVendors = parseNames(body.vendors, 1, 100, "qualified vendors");
        return move("boc_formation");
      case "form_boc":
        if (!requireState("boc_formation", "adminia")) return fail("Only Admin (IA) can form the BOC");
        return formCommittee("Bid Opening Committee", "financial_evaluation");
      case "submit_financial_evaluation":
        if (!requireState("financial_evaluation", "committee")) return fail("Only the BOC can submit the financial evaluation");
        workflow.topVendors = parseNames(body.vendors, 3, 3, "top three vendors");
        if (!workflow.qualifiedVendors?.length || workflow.topVendors.some((vendor: string) => !workflow.qualifiedVendors.includes(vendor)))
          return fail("The BOC may select only vendors qualified by the TEC", 400);
        return move("tac_formation");
      case "form_tac":
        if (!requireState("tac_formation", "adminia")) return fail("Only Admin (IA) can form the TAC");
        return formCommittee("Technical Advisory Committee", "tac_recommendation", true);
      case "submit_tac_recommendation":
        if (!requireState("tac_recommendation", "committee")) return fail("Only the TAC can submit its recommendation");
        if (typeof body.vendor !== "string" || !body.vendor.trim() || !Number.isFinite(Number(body.price)) || Number(body.price) <= 0 || typeof body.specifications !== "string" || body.specifications.trim().length < 5)
          return fail("Winning vendor, positive price, and specifications are required", 400);
        workflow.recommendation = { vendor: body.vendor.trim(), price: Number(body.price), specifications: body.specifications.trim() };
        workflow.phase = "cfa_release";
        return move("cfa_ifd");
      case "cfa_release":
        if (!requireState("cfa_ifd", "cfa", "cfa_release")) return fail("Only CFA can release funds");
        workflow.phase = "ifd_confirmation";
        return move(row.stage);
      case "record_ifd":
        if (!requireState("cfa_ifd", "adminia", "ifd_confirmation")) return fail("Only Admin (IA) can confirm IFD");
        if (typeof body.reference !== "string" || body.reference.trim().length < 2)
          return fail("Enter the IFD confirmation reference", 400);
        workflow.ifdReference = body.reference.trim();
        workflow.completed = true;
        return move(row.stage);
      default:
        return fail("Unknown workflow action", 400);
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Unable to complete action", 400);
  }

  function getCommittee(type: string, requireDepartment = false) {
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds : [];
    if (memberIds.length !== 3 || new Set(memberIds).size !== 3 || !memberIds.includes(body.chairpersonId))
      throw new Error("Select exactly three unique members and designate one as chairperson");
    const people = db.prepare("SELECT id, department_id FROM people WHERE active = 1 AND id IN (?, ?, ?)").all(...memberIds) as Array<{ id: string; department_id: string }>;
    if (people.length !== 3) throw new Error("Choose three active committee members");
    if (requireDepartment && !people.some((person) => person.department_id === row.department_id))
      throw new Error("At least one TAC member must belong to the demanding department");
    const committeeId = uid("committee");
    const existing = db.prepare(
      "SELECT MAX(version) version FROM committees WHERE project_id = ? AND type = ?",
    ).get(row.id, type) as { version: number | null };
    const submittedAt = now();
    const requiresApproval = type === "Technical Evaluation Committee";
    db.prepare(
      "INSERT INTO committees VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      committeeId,
      row.id,
      type,
      (existing.version ?? 0) + 1,
      body.chairpersonId,
      null,
      null,
      submittedAt.slice(0, 10),
      null,
      remarks,
      requiresApproval ? "pending" : "approved",
    );
    const addMember = db.prepare("INSERT INTO committee_members VALUES (?, ?, ?)");
    memberIds.forEach((memberId: string) =>
      addMember.run(committeeId, memberId, memberId === body.chairpersonId ? "Chairperson" : "Member"),
    );
    db.prepare("INSERT INTO committee_approvals VALUES (?, ?, ?, ?, ?, ?)").run(
      uid("approval"), committeeId, user!.id, "submitted", remarks, submittedAt,
    );
    return { id: committeeId, type, memberIds, chairpersonId: body.chairpersonId, formedBy: user!.id, at: submittedAt };
  }
  function recordCommitteeDecision(action: "approve") {
    const committee = db.prepare(
      "SELECT id FROM committees WHERE project_id = ? AND type = ? ORDER BY version DESC LIMIT 1",
    ).get(row.id, "Technical Evaluation Committee") as { id: string } | undefined;
    if (!committee) throw new Error("The TEC constitution was not found");
    if (action === "approve")
      db.prepare("UPDATE committees SET status = 'approved' WHERE id = ?").run(committee.id);
    db.prepare("INSERT INTO committee_approvals VALUES (?, ?, ?, ?, ?, ?)").run(
      uid("approval"), committee.id, user!.id, action, remarks, now(),
    );
  }
  function formCommittee(type: string, next: string, requireDepartment = false) {
    workflow.committees = workflow.committees ?? [];
    workflow.committees.push(getCommittee(type, requireDepartment));
    return move(next);
  }
  function parseNames(value: unknown, min: number, max: number, label: string) {
    const names = typeof value === "string" ? value.split("\n").map((name) => name.trim()).filter(Boolean) : [];
    if (names.length < min || names.length > max || new Set(names).size !== names.length)
      throw new Error(`Enter ${min === max ? `exactly ${min}` : `at least ${min}`} unique ${label}, one per line`);
    return names;
  }
});
app.use(/^\/api\/projects\/[^/]+\/(advance|tsc-report|as-decision|hq-forward|dg-ss-decision|close|bids|committees)(\/|$)/, (_req, res) =>
  res.status(410).json({ error: "This legacy route is disabled; use the current workflow action" }),
);
app.post("/api/projects/:id/committees", (req, res) => {
  const user = auth(req, res);
  const row = project(req.params.id);
  if (!user || !row || user.role !== "adminia")
    return res
      .status(403)
      .json({ error: "Only Admin can constitute committees" });
  const parsed = z
    .object({
      type: z.string().min(2),
      chairmanId: z.string().min(1),
      secretaryId: z.string().min(1),
      userRepId: z.string().min(1),
      memberIds: z.array(z.string()).length(3),
      constitutionDate: z.string().min(1),
      validUntil: z.string().optional(),
      terms: z.string().min(3),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: "Complete committee details are required" });
  if (
    new Set(parsed.data.memberIds).size !== 3 ||
    !parsed.data.memberIds.includes(parsed.data.chairmanId)
  ) {
    return res
      .status(400)
      .json({
        error:
          "A committee must contain exactly three unique people, including the chairperson",
      });
  }
  const existing = db
    .prepare(
      "SELECT MAX(version) version FROM committees WHERE project_id = ? AND type = ?",
    )
    .get(row.id, parsed.data.type) as { version: number | null };
  const committeeId = uid("committee");
  const createCommittee = db.transaction(() => {
    db.prepare(
      "INSERT INTO committees VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      committeeId,
      row.id,
      parsed.data.type,
      (existing.version ?? 0) + 1,
      parsed.data.chairmanId,
      parsed.data.secretaryId,
      parsed.data.userRepId,
      parsed.data.constitutionDate,
      parsed.data.validUntil ?? null,
      parsed.data.terms,
      "pending",
    );
    const addMember = db.prepare(
      "INSERT INTO committee_members VALUES (?, ?, ?)",
    );
    parsed.data.memberIds.forEach((memberId) =>
      addMember.run(committeeId, memberId, "Member"),
    );
    db.prepare("INSERT INTO committee_approvals VALUES (?, ?, ?, ?, ?, ?)").run(
      uid("approval"),
      committeeId,
      user.id,
      "submitted",
      "Committee composition submitted for approval",
      now(),
    );
    addEvent(
      row.id,
      "committee",
      user.id,
      `${parsed.data.type} constituted (version ${(existing.version ?? 0) + 1})`,
    );
  });
  createCommittee();
  res.status(201).json({ committee: listCommittees(row.id)[0] });
});
app.post("/api/committees/:id/decision", (req, res) => {
  return res.status(410).json({ error: "Use a targeted private query thread for clarification requests" });
});
app.post("/api/projects", (req, res) => {
  const user = auth(req, res);
  if (!user || user.role !== "department")
    return res.status(403).json({ error: "Only the Department role can raise a demand" });
  const parsed = z
    .object({
      title: z.string().min(2),
      description: z.string().min(5),
      estimatedValue: z.coerce.number().min(0),
      deadline: z.string().min(1),
      departmentId: z.string().min(1),
      remarks: z.string().min(2),
      attachment: z.any().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: "Title, description, value, deadline, department and remarks are required" });
  if (!db.prepare("SELECT 1 FROM departments WHERE id = ? AND active = 1").get(parsed.data.departmentId))
    return res.status(400).json({ error: "Choose an active demanding department" });
  const id = uid("PRJ");
  db.prepare("INSERT INTO projects (id, title, description, estimated_value, deadline, stage, owner_id, created_at, department_id, workflow_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    id,
    parsed.data.title,
    parsed.data.description,
    parsed.data.estimatedValue,
    parsed.data.deadline,
    "demand",
    user.id,
    now(),
    parsed.data.departmentId,
    JSON.stringify({ phase: "admin_review" }),
  );
  if (parsed.data.attachment) {
    try {
      addDocument(id, user.id, "requirement", parsed.data.attachment);
    } catch (error) {
      db.prepare("DELETE FROM projects WHERE id = ?").run(id);
      return res.status(400).json({ error: error instanceof Error ? error.message : "Invalid PDF" });
    }
  }
  addEvent(id, "demand", user.id, `Demand raised: ${parsed.data.remarks}`);
  return res.status(201).json({ project: projectView(project(id), user.id) });
});
app.post("/api/projects/:id/advance", (req, res) => {
  const user = auth(req, res);
  const row = project(req.params.id);
  if (!user || !row)
    return res.status(404).json({ error: "Project not found" });
  if (handoffStages.has(row.stage))
    return res
      .status(403)
      .json({
        error: "This stage requires its designated handoff or approval action",
      });
  if (!allowedRoles(row.stage).includes(user.role))
    return res.status(403).json({ error: "You cannot advance this stage" });
  const target = nextStage(row.stage);
  if (!target || (req.body.targetStage && req.body.targetStage !== target))
    return res
      .status(400)
      .json({
        error: "Projects must advance to the declared next workflow stage",
      });
  const transition = db.transaction(() => {
    db.prepare("UPDATE projects SET stage = ? WHERE id = ?").run(
      target,
      row.id,
    );
    addEvent(
      row.id,
      "transition",
      user.id,
      req.body.note ||
        `Stage advanced to ${stageInfo.find((s) => s.id === target)?.label}`,
    );
  });
  transition();
  return res.json({ project: projectView(project(row.id), user.id) });
});
app.post("/api/projects/:id/tsc-report", (req, res) => {
  const user = auth(req, res);
  const row = project(req.params.id);
  if (!user || !row)
    return res.status(404).json({ error: "Project not found" });
  if (user.role !== "committee" || row.stage !== "tsc_report") {
    return res
      .status(403)
      .json({ error: "Only TSC can submit a report at the TSC report stage" });
  }
  const parsed = z
    .object({ title: z.string().min(3), content: z.string().min(20) })
    .safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: "Report title and detailed content are required" });
  const latest = db
    .prepare(
      "SELECT MAX(version) version FROM tsc_reports WHERE project_id = ?",
    )
    .get(row.id) as { version: number | null };
  const reportId = uid("report");
  const submit = db.transaction(() => {
    db.prepare("INSERT INTO tsc_reports VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      reportId,
      row.id,
      (latest.version ?? 0) + 1,
      user.id,
      parsed.data.title,
      parsed.data.content,
      "submitted",
      now(),
    );
    db.prepare("UPDATE projects SET stage = 'as_review' WHERE id = ?").run(
      row.id,
    );
    addEvent(
      row.id,
      "tsc_report",
      user.id,
      `TSC submitted report version ${(latest.version ?? 0) + 1} for AS (IA) approval`,
    );
  });
  submit();
  res.status(201).json({ project: projectView(project(row.id), user.id) });
});
app.post("/api/projects/:id/as-decision", (req, res) => {
  return res.status(410).json({ error: "Use the current workflow action and private query composer" });
});
app.post("/api/projects/:id/hq-forward", (req, res) => {
  const user = auth(req, res);
  if (!user) return;
  const row = project(req.params.id);
  if (!row) return res.status(404).json({ error: "Project not found" });
  if (user.role !== "hq" || row.stage !== "hq_review")
    return res
      .status(403)
      .json({ error: "Only HQ can forward this file to DG / SS approval" });
  const parsed = z.object({ remarks: z.string().min(2) }).safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: "HQ forwarding remarks are required" });
  db.prepare("UPDATE projects SET stage = 'arc_review' WHERE id = ?").run(
    row.id,
  );
  addEvent(
    row.id,
    "hq_forward",
    user.id,
    `HQ forwarded the file to DG / SS approval: ${parsed.data.remarks}`,
  );
  return res.json({ project: projectView(project(row.id), user.id) });
});
app.post("/api/projects/:id/dg-ss-decision", (req, res) => {
  const user = auth(req, res);
  if (!user) return;
  const row = project(req.params.id);
  if (!row) return res.status(404).json({ error: "Project not found" });
  if (user.role !== "dgs" || row.stage !== "arc_review")
    return res
      .status(403)
      .json({ error: "Only DGS (Supreme) can approve or reject the tender" });
  const parsed = z
    .object({
      action: z.enum(["approve", "reject"]),
      remarks: z.string().min(2),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: "DG / SS approval remarks are required" });
  const target =
    parsed.data.action === "approve" ? "tender_draft" : "tender_draft";
  db.prepare("UPDATE projects SET stage = ? WHERE id = ?").run(target, row.id);
  addEvent(
    row.id,
    "dg_ss_decision",
    user.id,
    `DGS (Supreme) ${parsed.data.action}ed the tender: ${parsed.data.remarks}`,
  );
  return res.json({ project: projectView(project(row.id), user.id) });
});
app.post("/api/projects/:id/close", (req, res) => {
  const user = auth(req, res);
  if (!user) return;
  const row = project(req.params.id);
  if (!row) return res.status(404).json({ error: "Project not found" });
  if (user.role !== "committee")
    return res
      .status(403)
      .json({ error: "Only TSC can close a project after CFA approval" });
  if (row.stage !== "cfa_approval")
    return res
      .status(400)
      .json({ error: "A project can only be closed after CFA approval" });
  const remarks = z.object({ remarks: z.string().min(2) }).safeParse(req.body);
  if (!remarks.success)
    return res.status(400).json({ error: "Closure remarks are required" });
  db.prepare("UPDATE projects SET stage = 'completed' WHERE id = ?").run(
    row.id,
  );
  addEvent(
    row.id,
    "closed",
    user.id,
    `TSC closed the project after CFA approval: ${remarks.data.remarks}`,
  );
  return res.json({ project: projectView(project(row.id), user.id) });
});
app.post("/api/projects/:id/bids", (req, res) => {
  const user = auth(req, res);
  const row = project(req.params.id);
  if (!user || !row)
    return res.status(404).json({ error: "Project not found" });
  if (user.role !== "vendor" || row.stage !== "bid_submission")
    return res
      .status(403)
      .json({
        error: "Bids are only accepted from vendors during bid submission",
      });
  const parsed = z
    .object({
      reference: z.string().min(2),
      amount: z.coerce.number().positive(),
      note: z.string().default(""),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: "Bid reference and positive amount are required" });
  db.prepare("INSERT INTO bids VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    uid("bid"),
    row.id,
    user.id,
    parsed.data.reference,
    parsed.data.amount,
    parsed.data.note,
    now(),
  );
  addEvent(
    row.id,
    "bid",
    user.id,
    `Vendor bid ${parsed.data.reference} submitted`,
  );
  return res.json({ project: projectView(project(row.id), user.id) });
});
app.post("/api/projects/:id/queries", (req, res) => {
  const user = auth(req, res);
  const row = project(req.params.id);
  if (!user || !row)
    return res.status(404).json({ error: "Project not found" });
  if (assignedRole(row.stage, readWorkflow(row)) !== user.role || user.role === "vendor")
    return res.status(404).json({ error: "Project not found" });
  const parsed = z.object({
    text: z.string().trim().min(2).max(4000),
    recipientId: z.string().min(1),
  }).safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Query text and a specific recipient are required" });
  const recipient = users.find((candidate) => candidate.id === parsed.data.recipientId);
  if (!recipient || recipient.role === "vendor" || recipient.id === user.id)
    return res.status(400).json({ error: "Choose a valid recipient other than yourself" });
  const queryId = uid("qry");
  const createdAt = now();
  const createThread = db.transaction(() => {
    db.prepare(
      "INSERT INTO queries (id, project_id, actor_id, text, status, at, stage, recipient_id) VALUES (?, ?, ?, ?, 'open', ?, ?, ?)",
    ).run(queryId, row.id, user.id, parsed.data.text, createdAt, row.stage, recipient.id);
    const addParticipant = db.prepare(
      "INSERT INTO query_participants (query_id, user_id, access_type, added_by, at) VALUES (?, ?, ?, ?, ?)",
    );
    addParticipant.run(queryId, user.id, "sender", user.id, createdAt);
    addParticipant.run(queryId, recipient.id, "recipient", user.id, createdAt);
  });
  createThread();
  return res.status(201).json({ ok: true });
});
app.post("/api/projects/:id/queries/:queryId/replies", (req, res) => {
  const user = auth(req, res);
  const row = project(req.params.id);
  if (!user || !row)
    return res.status(404).json({ error: "Project not found" });
  const parsed = z.object({ text: z.string().trim().min(2).max(4000) }).safeParse(req.body);
  const queryRecord = db
    .prepare("SELECT * FROM queries WHERE id = ? AND project_id = ?")
    .get(req.params.queryId, row.id) as any;
  if (user.role === "vendor" || !parsed.success || !queryRecord || !queryParticipant(user, queryRecord))
    return res
      .status(403)
      .json({
        error: "This private thread is restricted to its sender and current recipient",
      });
  db.prepare("INSERT INTO replies VALUES (?, ?, ?, ?, ?)").run(
    uid("reply"),
    req.params.queryId,
    user.id,
    parsed.data.text,
    now(),
  );
  db.prepare("UPDATE queries SET status = 'replied' WHERE id = ?").run(
    req.params.queryId,
  );
  return res.json({ ok: true });
});
app.post("/api/projects/:id/queries/:queryId/forward", (req, res) => {
  const user = auth(req, res);
  const row = project(req.params.id);
  if (!user || !row || user.role === "vendor")
    return res.status(404).json({ error: "Private thread not found" });
  const parsed = z.object({
    recipientId: z.string().min(1),
    remarks: z.string().trim().min(2).max(2000),
  }).safeParse(req.body);
  const queryRecord = db
    .prepare("SELECT * FROM queries WHERE id = ? AND project_id = ?")
    .get(req.params.queryId, row.id) as any;
  if (!parsed.success || !queryRecord || !queryParticipant(user, queryRecord))
    return res.status(404).json({ error: "Private thread not found" });
  const recipient = users.find((candidate) => candidate.id === parsed.data.recipientId);
  if (!recipient || recipient.role === "vendor" || recipient.id === queryRecord.actor_id || recipient.id === user.id)
    return res.status(400).json({ error: "Choose a valid new recipient other than the sender" });
  const forward = db.transaction(() => {
    db.prepare("UPDATE queries SET recipient_id = ?, status = 'forwarded' WHERE id = ?")
      .run(recipient.id, queryRecord.id);
    db.prepare(
      "INSERT OR IGNORE INTO query_participants (query_id, user_id, access_type, added_by, at) VALUES (?, ?, 'forwarded', ?, ?)",
    ).run(queryRecord.id, recipient.id, user.id, now());
    db.prepare("INSERT INTO replies VALUES (?, ?, ?, ?, ?)")
      .run(uid("reply"), queryRecord.id, user.id, `Forwarded to ${recipient.name} (${recipient.role}): ${parsed.data.remarks}`, now());
  });
  forward();
  return res.json({ ok: true });
});
app.use(express.static(path.resolve(process.cwd(), "dist/client")));
app.use((_req, res) =>
  res.sendFile(path.resolve(process.cwd(), "dist/client/index.html")),
);
app.listen(port, "0.0.0.0", () =>
  console.log(`ProcureFlow running on http://0.0.0.0:${port}`),
);
