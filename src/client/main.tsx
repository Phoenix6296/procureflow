import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  Bootstrap,
  Committee,
  Person,
  Project,
  User,
} from "../shared/types";
import { WorkflowDrawer as ProjectDrawer } from "./WorkflowDrawer";
import { QueriesChat } from "./PrivateQueries";
import "./styles.css";

const stageOrder = [
  "demand",
  "tsc_formation",
  "tsc_report",
  "as_review",
  "dgs_approval",
  "draft_tender",
  "final_tender",
  "vendor_activity",
  "bid_receipt",
  "bid_board",
  "technical_opening",
  "tec_formation",
  "technical_evaluation",
  "boc_formation",
  "financial_evaluation",
  "tac_formation",
  "tac_recommendation",
  "cfa_ifd",
];
const api = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
};
const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [form, setForm] = useState({
    username: "department",
    password: "department123",
  });
  const [error, setError] = useState("");
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand">
          <span className="logo">PF</span>
          <span>ProcureFlow</span>
        </div>
        <div className="eyebrow">LOCAL PROCUREMENT OPERATIONS</div>
        <h1>Tender command centre</h1>
        <p className="subtle">
          A secure, self-hosted workspace for every approval, query and bid.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const data = await api<{ user: User }>("/api/login", {
                method: "POST",
                body: JSON.stringify(form),
              });
              onLogin(data.user);
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          <label>
            Username
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          {error && <div className="error">{error}</div>}
          <button className="button primary wide">Sign in</button>
        </form>
      </section>
    </main>
  );
}

function App() {
  const [initialAuthReady, setInitialAuthReady] = useState(false);
  return (
    <FirstLoadIntro ready={initialAuthReady}>
      <AppContent onInitialAuthReady={setInitialAuthReady} />
    </FirstLoadIntro>
  );
}

function FirstLoadIntro({
  ready,
  children,
}: {
  ready: boolean;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(() => {
    try {
      const alreadyPlayed = window.sessionStorage.getItem("pf_intro_played") === "1";
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const openedAsNewDocument = navigation?.type === "navigate";
      return !alreadyPlayed || openedAsNewDocument;
    } catch {
      return false;
    }
  });
  const [revealed, setRevealed] = useState(false);
  const [flying, setFlying] = useState(false);
  const [emblemStyle, setEmblemStyle] = useState<React.CSSProperties>({
    left: "50%",
    top: "50%",
    width: "116px",
    height: "116px",
    transform: "translate(-50%, -50%)",
  });

  useEffect(() => {
    if (!ready || !visible) return;
    try {
      window.sessionStorage.setItem("pf_intro_played", "1");
    } catch {
      // The intro still plays for this mount when storage is unavailable.
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(false);
      return;
    }
    const revealTimer = window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(".brand .logo");
      if (target) {
        const bounds = target.getBoundingClientRect();
        setEmblemStyle({
          left: `${bounds.left}px`,
          top: `${bounds.top}px`,
          width: `${bounds.width}px`,
          height: `${bounds.height}px`,
          transform: "none",
        });
      }
      setRevealed(true);
      setFlying(true);
    }, 900);
    const finishTimer = window.setTimeout(() => setVisible(false), 1800);
    return () => {
      window.clearTimeout(revealTimer);
      window.clearTimeout(finishTimer);
    };
  }, [ready, visible]);

  return (
    <>
      <div className={`intro-underlay ${visible ? (revealed ? "intro-underlay-visible" : "intro-underlay-hidden") : ""}`} aria-hidden={visible && !revealed}>
        {children}
      </div>
      {visible && (
        <div className={`brand-intro-backdrop ${flying ? "brand-intro-flying" : ""}`} aria-hidden="true">
          <span className="logo brand-intro-emblem" style={emblemStyle}>PF</span>
        </div>
      )}
    </>
  );
}

function AppContent({
  onInitialAuthReady,
}: {
  onInitialAuthReady: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<"workflow" | "queries">("workflow");
  const [selected, setSelected] = useState<Project | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [handoffNotice, setHandoffNotice] = useState("");
  const refresh = async () => {
    const next = await api<Bootstrap>("/api/bootstrap");
    setData(next);
    return next;
  };
  useEffect(() => {
    api<{ user: User }>("/api/me")
      .then((x) => {
        setUser(x.user);
        return refresh();
      })
      .catch(() => undefined)
      .finally(() => onInitialAuthReady(true));
  }, []);
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setUser(u);
          void refresh();
        }}
      />
    );
  if (!data) return <div className="loading">Loading workspace…</div>;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">PF</span>
          <span>ProcureFlow</span>
        </div>
        <div className="workspace">
          <span className="status-dot" /> LAN workspace
        </div>
        <div className="sidebar-bottom">
          <div className="profile">
            <div className="avatar">
              {user.name
                .split(" ")
                .map((x) => x[0])
                .join("")}
            </div>
            <div>
              <b>{user.name}</b>
              <small>Signed-in account</small>
            </div>
          </div>
          <button
            className="signout"
            onClick={async () => {
              await api("/api/logout", { method: "POST" });
              setUser(null);
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        <header className="topbar">
          <div>
            <div className="eyebrow">PROCUREMENT WORKSPACE</div>
            <h1>My tasks</h1>
            <p className="subtle">
              Work assigned to your account, in workflow order.
            </p>
          </div>
          <div className="top-actions">
            <span className="network">
              <span className="status-dot" /> System online
            </span>
            {user.role === "department" && (
              <button
                className="button primary"
                onClick={() => {
                  setHandoffNotice("");
                  setShowCreate(true);
                }}
              >
                ＋ Raise demand
              </button>
            )}
          </div>
        </header>
        {handoffNotice && (
          <div className="handoff-notice" role="status">
            {handoffNotice}
          </div>
        )}
        <div className="workspace-tabs" role="tablist" aria-label="Procurement workspace">
          <button id="workflow-tab" role="tab" aria-controls="workflow-panel" aria-selected={workspaceTab === "workflow"} className={workspaceTab === "workflow" ? "tab-active" : ""} onClick={() => setWorkspaceTab("workflow")}>Workflow Task</button>
          <button id="queries-tab" role="tab" aria-controls="queries-panel" aria-selected={workspaceTab === "queries"} className={workspaceTab === "queries" ? "tab-active" : ""} onClick={() => setWorkspaceTab("queries")}>
            Queries &amp; Chat
            {data.queryInbox.filter((query) => query.status !== "resolved").length > 0 && <span className="tab-badge">{data.queryInbox.filter((query) => query.status !== "resolved").length}</span>}
          </button>
        </div>
        {workspaceTab === "workflow" ? (
          <div id="workflow-panel" role="tabpanel" aria-labelledby="workflow-tab" tabIndex={0}>
            <TaskDashboard projects={data.projects} role={user.role} onOpen={setSelected} />
          </div>
        ) : (
          <div id="queries-panel" role="tabpanel" aria-labelledby="queries-tab" tabIndex={0}>
            <QueriesChat projects={data.projects} queries={data.queryInbox} recipients={data.queryRecipients} user={user} onRefresh={refresh} />
          </div>
        )}
      </main>
      {selected && (
        <ProjectDrawer
          project={selected}
          data={data}
          user={user}
          onClose={() => setSelected(null)}
          onRefresh={async () => {
            const latest = await refresh();
            const next = latest.projects.find((p) => p.id === selected.id);
            if (next) setSelected(next);
            else {
              setSelected(null);
              setHandoffNotice(
                "Action completed. This task has left your queue.",
              );
            }
          }}
        />
      )}
      {showCreate && (
        <CreateDialog
          departments={data.departments}
          onClose={() => setShowCreate(false)}
          onCreated={async (p) => {
            await refresh();
            setShowCreate(false);
            setHandoffNotice(`Demand ${p.id} submitted for review.`);
          }}
        />
      )}
    </div>
  );
}

function TaskDashboard({
  projects,
  role,
  onOpen,
}: {
  projects: Project[];
  role: User["role"];
  onOpen: (p: Project) => void;
}) {
  return (
    <section className="task-dashboard">
      <div className="section-head">
        <div>
          <h2>Active action items</h2>
          <p className="subtle">
            {projects.length} task{projects.length === 1 ? "" : "s"} currently
            assigned to you.
          </p>
        </div>
      </div>
      {projects.length > 0 ? (
        <div className="project-grid">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <div className="empty-tasks">
          <span className="empty-mark">—</span>
          <h3>
            {role === "department"
              ? "Ready to start a procurement?"
              : "No pending tasks"}
          </h3>
          <p className="subtle">
            {role === "department"
              ? "Raise a department demand to begin the procurement process."
              : "There are no actions awaiting your account right now."}
          </p>
        </div>
      )}
    </section>
  );
}
function Metric({
  label,
  value,
  detail,
  tone = "",
}: {
  label: string;
  value: number;
  detail: string;
  tone?: string;
}) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone}`}>◈</div>
      <span className="subtle">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function Projects({
  data,
  onOpen,
}: {
  data: Bootstrap;
  onOpen: (p: Project) => void;
}) {
  return (
    <div className="project-grid">
      {data.projects.map((p) => (
        <ProjectCard key={p.id} project={p} onOpen={onOpen} />
      ))}
    </div>
  );
}
function ProjectCard({
  project,
  onOpen,
}: {
  project: Project;
  onOpen: (p: Project) => void;
}) {
  const percent = project.workflow?.completed
    ? 100
    : Math.round((Math.max(0, stageOrder.indexOf(project.stage)) / 17) * 100);
  return (
    <article className="project-card">
      <div className="card-top">
        <span className="project-id">{project.id}</span>
        <span className="pill">{percent}% complete</span>
      </div>
      <h3>{project.title}</h3>
      <p className="subtle clamp">{project.description}</p>
      <div className="progress">
        <i style={{ width: `${percent}%` }} />
      </div>
      <div className="card-meta">
        <span>
          <b>{project.stageLabel}</b>
          <small>Current stage</small>
        </span>
        <span>
          <b>{money(project.estimatedValue)}</b>
          <small>Estimated value</small>
        </span>
      </div>
      <button className="button secondary wide" onClick={() => onOpen(project)}>
        Open workspace <span>→</span>
      </button>
    </article>
  );
}
function Workflow({ data }: { data: Bootstrap }) {
  return (
    <section className="workflow-card">
      <h2>Procurement workflow</h2>
      <p className="subtle">Every project follows this controlled sequence.</p>
      <div className="workflow-list">
        {data.stages.map((s, i) => (
          <div className="workflow-step" key={s.id}>
            <div className="step-number">{String(i + 1).padStart(2, "0")}</div>
            <div>
              <b>{s.label}</b>
              <small>
                <b className="role-hint">{s.role}</b>
                <span>
                  {data.projects.filter((p) => p.stage === s.id).length}{" "}
                  project(s) at this stage
                </span>
              </small>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PeopleView({
  people,
  departments,
  vendors,
}: {
  people: Person[];
  departments: Bootstrap["departments"];
  vendors: Bootstrap["vendors"];
}) {
  return (
    <div className="management-grid">
      <section className="workflow-card management-card">
        <div className="section-head">
          <div>
            <h2>People master</h2>
            <p className="subtle">
              Active personnel available for committee constitution.
            </p>
          </div>
          <span className="pill">
            {people.filter((p) => p.active).length} active
          </span>
        </div>
        <div className="data-table">
          {people.map((person) => (
            <div className="data-row" key={person.id}>
              <div>
                <b>{person.name}</b>
                <small>
                  {person.designation} ·{" "}
                  {person.employee_id ?? "No employee ID"}
                </small>
              </div>
              <span>{person.department_code}</span>
              <small>{person.expertise || person.contact || "—"}</small>
            </div>
          ))}
        </div>
      </section>
      <section className="workflow-card management-card">
        <div className="section-head">
          <div>
            <h2>Departments</h2>
            <p className="subtle">Organisational directory</p>
          </div>
        </div>
        <div className="data-table">
          {departments.map((d) => (
            <div className="data-row" key={d.id}>
              <div>
                <b>{d.name}</b>
                <small>{d.code}</small>
              </div>
              <span>{d.active ? "Active" : "Inactive"}</span>
            </div>
          ))}
        </div>
        <h3 className="subsection-title">Vendors ({vendors.length})</h3>
        {vendors.map((v) => (
          <div className="compact-item" key={v.id}>
            <b>{v.name}</b>
            <small>
              {v.registration_no} · {v.email}
            </small>
          </div>
        ))}
      </section>
    </div>
  );
}

function CommitteeView({
  committees,
  projects,
}: {
  committees: Committee[];
  projects: Project[];
}) {
  const projectName = (id: string) =>
    projects.find((p) => p.id === id)?.title ?? id;
  return (
    <section className="workflow-card management-card wide-card">
      <div className="section-head">
        <div>
          <h2>Committee register</h2>
          <p className="subtle">
            Constitution, membership and approval status by project.
          </p>
        </div>
        <span className="pill">
          {committees.filter((c) => c.status === "pending").length} pending
        </span>
      </div>
      {committees.length === 0 ? (
        <p className="subtle empty-state">
          No committees have been constituted yet.
        </p>
      ) : (
        <div className="committee-grid">
          {committees.map((c) => (
            <article className="committee-card" key={c.id}>
              <div className="card-top">
                <span className="project-id">
                  {c.type} · v{c.version}
                </span>
                <span className="pill">{c.status}</span>
              </div>
              <h3>{projectName(c.project_id)}</h3>
              <div className="committee-meta">
                <b>Chairman</b>
                <span>{c.chairman?.name ?? "—"}</span>
                <b>Members</b>
                <span>
                  {c.members.length
                    ? c.members.map((m) => m.name).join(", ")
                    : "—"}
                </span>
                <b>Constituted</b>
                <span>{c.constitution_date}</span>
              </div>
              {c.terms && <p className="subtle clamp">{c.terms}</p>}
              <small className="subtle">
                {c.approvals.length} approval event(s)
              </small>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ReportsView({ data }: { data: Bootstrap }) {
  const report = data.reports;
  return (
    <div className="reports-view">
      <section className="metric-grid">
        <Metric
          label="Pending committees"
          value={report.pendingCommittees}
          detail="Awaiting action"
          tone="orange"
        />
        <Metric
          label="Open queries"
          value={report.pendingQueries}
          detail="Need a response"
          tone="orange"
        />
        <Metric
          label="Delayed milestones"
          value={report.delayedMilestones}
          detail="Past planned end"
          tone="orange"
        />
        <Metric
          label="Tracked projects"
          value={data.projects.length}
          detail="All workstreams"
        />
      </section>
      <section className="workflow-card management-card wide-card">
        <div className="section-head">
          <div>
            <h2>Stage monitoring</h2>
            <p className="subtle">
              Current project distribution across the procurement workflow.
            </p>
          </div>
        </div>
        <div className="report-bars">
          {data.stages.map((stage) => {
            const count =
              report.projectCounts.find((x) => x.stage === stage.id)?.count ??
              0;
            const max = Math.max(
              1,
              ...report.projectCounts.map((x) => x.count),
            );
            return (
              <div className="report-bar" key={stage.id}>
                <div>
                  <span>{stage.label}</span>
                  <b>{count}</b>
                </div>
                <i style={{ width: `${Math.round((count / max) * 100)}%` }} />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function LegacyProjectDrawer({
  project,
  data,
  user,
  onClose,
  onRefresh,
}: {
  project: Project;
  data: Bootstrap;
  user: User;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [reply, setReply] = useState<Record<string, string>>({});
  const [reportTitle, setReportTitle] = useState("");
  const [reportContent, setReportContent] = useState("");
  const [decisionRemarks, setDecisionRemarks] = useState("");
  const [committeeForm, setCommitteeForm] = useState({
    chairmanId: data.people[0]?.id ?? "",
    secretaryId: data.people[1]?.id ?? "",
    userRepId: data.people[3]?.id ?? data.people[0]?.id ?? "",
    memberIds: data.people.slice(0, 3).map((person) => person.id),
    constitutionDate: new Date().toISOString().slice(0, 10),
    validUntil: "",
    terms: "Examine project requirements and submit the TSC report.",
  });
  const index = data.stages.findIndex((s) => s.id === project.stage);
  const next = data.stages[index + 1];
  const committee = data.committees.find(
    (item) => item.project_id === project.id,
  );
  const canAdvance =
    (user.role === "committee" ||
      (user.role === "ia" &&
        (project.stage === "ia_review" || project.stage === "ifd_review"))) &&
    next &&
    !(
      (project.stage === "committee_pending" ||
        project.stage === "board_pending") &&
      committee?.status !== "approved"
    ) &&
    ![
      "tsc_report",
      "as_review",
      "hq_review",
      "arc_review",
      "cfa_approval",
      "completed",
    ].includes(project.stage);
  const submit = async (url: string, body: object) => {
    try {
      await api(url, { method: "POST", body: JSON.stringify(body) });
      setNote("");
      setQuery("");
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const submitCommittee = async () => {
    try {
      await api(`/api/projects/${project.id}/committees`, {
        method: "POST",
        body: JSON.stringify({
          type: "Technical Scrutiny Committee",
          ...committeeForm,
        }),
      });
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => e.currentTarget === e.target && onClose()}
    >
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <span className="project-id">{project.id}</span>
            <h2>{project.title}</h2>
            <p className="subtle">
              {project.stageLabel} · Due {project.deadline}
            </p>
          </div>
          <button className="close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="drawer-progress">
          <div className="progress">
            <i
              style={{
                width: `${Math.round((index / Math.max(1, data.stages.length - 1)) * 100)}%`,
              }}
            />
          </div>
          <small>
            Stage {index + 1} of {data.stages.length}
          </small>
        </div>
        {error && <div className="error">{error}</div>}
        {user.role === "adminia" &&
          project.stage === "committee_pending" &&
          (!committee || committee.status === "rejected") && (
            <section className="action-box">
              <span className="eyebrow">COMMITTEE CONSTITUTION</span>
              <h3>Select exactly three TSC members</h3>
              <p className="subtle">
                One selected member must be the chairperson. Super Admin
                approval is required before the board is formed.
              </p>
              <label>
                Three members
                <select
                  multiple
                  value={committeeForm.memberIds}
                  onChange={(e) =>
                    setCommitteeForm({
                      ...committeeForm,
                      memberIds: Array.from(e.target.selectedOptions).map(
                        (option) => option.value,
                      ),
                    })
                  }
                >
                  {data.people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name} · {person.designation}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Chairperson
                <select
                  value={committeeForm.chairmanId}
                  onChange={(e) =>
                    setCommitteeForm({
                      ...committeeForm,
                      chairmanId: e.target.value,
                    })
                  }
                >
                  {data.people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-row">
                <label>
                  Member secretary
                  <select
                    value={committeeForm.secretaryId}
                    onChange={(e) =>
                      setCommitteeForm({
                        ...committeeForm,
                        secretaryId: e.target.value,
                      })
                    }
                  >
                    {data.people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  User representative
                  <select
                    value={committeeForm.userRepId}
                    onChange={(e) =>
                      setCommitteeForm({
                        ...committeeForm,
                        userRepId: e.target.value,
                      })
                    }
                  >
                    {data.people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Terms of reference
                <textarea
                  value={committeeForm.terms}
                  onChange={(e) =>
                    setCommitteeForm({
                      ...committeeForm,
                      terms: e.target.value,
                    })
                  }
                />
              </label>
              <button className="button primary" onClick={submitCommittee}>
                Submit committee for Super Admin approval
              </button>
            </section>
          )}
        {user.role === "super_admin" && committee?.status === "pending" && (
          <section className="action-box approval-box">
            <span className="eyebrow">SUPER ADMIN DECISION</span>
            <h3>Approve the proposed TSC board</h3>
            <p className="subtle">
              A query keeps the committee pending. Approval forms the board and
              releases the project to TSC.
            </p>
            <textarea
              value={decisionRemarks}
              onChange={(e) => setDecisionRemarks(e.target.value)}
              placeholder="Record approval remarks or a query for Admin…"
            />
            <div className="action-row">
              <button
                className="button secondary"
                onClick={() =>
                  submit(`/api/committees/${committee.id}/decision`, {
                    action: "query",
                    remarks: decisionRemarks,
                  })
                }
              >
                Raise query
              </button>
              <button
                className="button primary"
                onClick={() =>
                  submit(`/api/committees/${committee.id}/decision`, {
                    action: "approve",
                    remarks: decisionRemarks,
                  })
                }
              >
                Approve & form board
              </button>
            </div>
          </section>
        )}
        {canAdvance && (
          <section className="action-box">
            <span className="eyebrow">NEXT ACTION</span>
            <h3>Move to {next.label}</h3>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add an approval or handover note…"
            />
            <button
              className="button primary"
              onClick={() =>
                submit(`/api/projects/${project.id}/advance`, { note })
              }
            >
              Advance workflow →
            </button>
          </section>
        )}
        {user.role === "committee" && project.stage === "tsc_report" && (
          <section className="action-box">
            <span className="eyebrow">TSC REPORT</span>
            <h3>Submit report for AS (IA) approval</h3>
            <input
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
              placeholder="Report title"
            />
            <textarea
              value={reportContent}
              onChange={(e) => setReportContent(e.target.value)}
              placeholder="Record technical scrutiny, observations and recommendation…"
            />
            <button
              className="button primary"
              onClick={() =>
                submit(`/api/projects/${project.id}/tsc-report`, {
                  title: reportTitle,
                  content: reportContent,
                })
              }
            >
              Submit report to AS (IA)
            </button>
          </section>
        )}
        {user.role === "ia" && project.stage === "as_review" && (
          <section className="action-box approval-box">
            <span className="eyebrow">AS (IA) REVIEW</span>
            <h3>Review the TSC report</h3>
            {project.reports[0] && (
              <div className="report-preview">
                <b>{project.reports[0].title}</b>
                <p>{project.reports[0].content}</p>
              </div>
            )}
            <textarea
              value={decisionRemarks}
              onChange={(e) => setDecisionRemarks(e.target.value)}
              placeholder="Add approval remarks or query…"
            />
            <div className="action-row">
              <button
                className="button secondary"
                onClick={() =>
                  submit(`/api/projects/${project.id}/as-decision`, {
                    action: "query",
                    remarks: decisionRemarks,
                  })
                }
              >
                May query
              </button>
              <button
                className="button primary"
                onClick={() =>
                  submit(`/api/projects/${project.id}/as-decision`, {
                    action: "approve",
                    remarks: decisionRemarks,
                  })
                }
              >
                Approve & forward to HQ
              </button>
            </div>
          </section>
        )}
        {user.role === "hq" && project.stage === "hq_review" && (
          <section className="action-box approval-box">
            <span className="eyebrow">HQ HANDOFF</span>
            <h3>Forward the file to DG / SS</h3>
            <p className="subtle">
              HQ is an intermediate authority and cannot skip or directly
              complete this approval.
            </p>
            <textarea
              value={decisionRemarks}
              onChange={(e) => setDecisionRemarks(e.target.value)}
              placeholder="Record HQ forwarding remarks…"
            />
            <button
              className="button primary"
              onClick={() =>
                submit(`/api/projects/${project.id}/hq-forward`, {
                  remarks: decisionRemarks,
                })
              }
            >
              Forward to DG / SS
            </button>
          </section>
        )}
        {user.role === "dgs" && project.stage === "arc_review" && (
          <section className="action-box approval-box">
            <span className="eyebrow">DGS (DG / SS) DECISION</span>
            <h3>Decide the tender</h3>
            <p className="subtle">
              DGS (Supreme) is the sole authority who can approve or reject this
              tender.
            </p>
            <textarea
              value={decisionRemarks}
              onChange={(e) => setDecisionRemarks(e.target.value)}
              placeholder="Record DGS (DG / SS) decision remarks…"
            />
            <div className="action-row">
              <button
                className="button secondary"
                onClick={() =>
                  submit(`/api/projects/${project.id}/dg-ss-decision`, {
                    action: "reject",
                    remarks: decisionRemarks,
                  })
                }
              >
                Reject tender
              </button>
              <button
                className="button primary"
                onClick={() =>
                  submit(`/api/projects/${project.id}/dg-ss-decision`, {
                    action: "approve",
                    remarks: decisionRemarks,
                  })
                }
              >
                Approve & release tender draft
              </button>
            </div>
          </section>
        )}
        {user.role === "committee" && project.stage === "cfa_approval" && (
          <section className="action-box approval-box">
            <span className="eyebrow">PROJECT CLOSURE</span>
            <h3>Close the project</h3>
            <p className="subtle">
              TSC closes the project after CFA approval. Admin only creates the
              project and constitutes the TSC group.
            </p>
            <textarea
              value={decisionRemarks}
              onChange={(e) => setDecisionRemarks(e.target.value)}
              placeholder="Record final closure remarks…"
            />
            <button
              className="button primary"
              onClick={() =>
                submit(`/api/projects/${project.id}/close`, {
                  remarks: decisionRemarks,
                })
              }
            >
              Close project
            </button>
          </section>
        )}
        {user.role === "vendor" && project.stage === "bid_submission" && (
          <BidForm
            onSubmit={(body) =>
              submit(`/api/projects/${project.id}/bids`, body)
            }
          />
        )}
        {user.role !== "vendor" || project.stage === "bid_submission" ? (
          <section className="drawer-section">
            <h3>Queries & replies</h3>
            {project.queries.map((q) => (
              <div className="query" key={q.id}>
                <b>{q.actor.name}</b>
                <small>{q.status}</small>
                <p>{q.text}</p>
                {q.replies.map((r) => (
                  <div className="reply" key={r.id}>
                    <b>{r.actor.name}</b>
                    <p>{r.text}</p>
                  </div>
                ))}
                <div className="reply-row">
                  <input
                    value={reply[q.id] ?? ""}
                    onChange={(e) =>
                      setReply({ ...reply, [q.id]: e.target.value })
                    }
                    placeholder="Reply to query…"
                  />
                  <button
                    className="button secondary"
                    onClick={() =>
                      submit(
                        `/api/projects/${project.id}/queries/${q.id}/replies`,
                        { text: reply[q.id] },
                      )
                    }
                  >
                    Reply
                  </button>
                </div>
              </div>
            ))}
            <div className="reply-row">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Raise a new query…"
              />
              <button
                className="button secondary"
                onClick={() =>
                  submit(`/api/projects/${project.id}/queries`, { text: query })
                }
              >
                Ask
              </button>
            </div>
          </section>
        ) : null}
        <section className="drawer-section">
          <h3>Activity</h3>
          {project.events.map((e) => (
            <div className="event" key={e.id}>
              <span className="event-dot" />
              <div>
                <b>{e.text}</b>
                <small>
                  {e.actor.name} · {new Date(e.at).toLocaleString()}
                </small>
              </div>
            </div>
          ))}
        </section>
      </aside>
    </div>
  );
}
function BidForm({ onSubmit }: { onSubmit: (body: object) => void }) {
  const [form, setForm] = useState({ reference: "", amount: "", note: "" });
  return (
    <section className="action-box">
      <span className="eyebrow">VENDOR SUBMISSION</span>
      <h3>Submit tender bid</h3>
      <input
        placeholder="Bid reference"
        value={form.reference}
        onChange={(e) => setForm({ ...form, reference: e.target.value })}
      />
      <input
        type="number"
        placeholder="Bid amount"
        value={form.amount}
        onChange={(e) => setForm({ ...form, amount: e.target.value })}
      />
      <textarea
        placeholder="Note (optional)"
        value={form.note}
        onChange={(e) => setForm({ ...form, note: e.target.value })}
      />
      <button className="button primary" onClick={() => onSubmit(form)}>
        Submit bid
      </button>
    </section>
  );
}
function CreateDialog({
  departments,
  onClose,
  onCreated,
}: {
  departments: Bootstrap["departments"];
  onClose: () => void;
  onCreated: (p: Project) => void;
}) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    estimatedValue: "",
    deadline: "",
    departmentId: departments[0]?.id ?? "",
    remarks: "",
  });
  const [attachment, setAttachment] = useState<File | null>(null);
  const [error, setError] = useState("");
  return (
    <div className="drawer-backdrop">
      <section className="dialog">
        <div className="drawer-head">
          <div>
            <span className="eyebrow">NEW WORKSTREAM</span>
            <h2>Create a Project</h2>
          </div>
          <button className="close" onClick={onClose}>
            ×
          </button>
        </div>
        <label>
          Project title
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </label>
        <label>
          Description
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        <label>
          Demanding department
          <select
            value={form.departmentId}
            onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
          >
            {departments
              .filter((department) => department.active)
              .map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            Estimated value
            <input
              type="number"
              value={form.estimatedValue}
              onChange={(e) =>
                setForm({ ...form, estimatedValue: e.target.value })
              }
            />
          </label>
          <label>
            Deadline
            <input
              type="date"
              value={form.deadline}
              onChange={(e) => setForm({ ...form, deadline: e.target.value })}
            />
          </label>
        </div>
        <label>
          Requirement attachment (PDF, optional)
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Demand remarks
          <textarea
            value={form.remarks}
            onChange={(e) => setForm({ ...form, remarks: e.target.value })}
            required
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button
          className="button primary wide"
          onClick={async () => {
            try {
              const document = attachment
                ? await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () =>
                      resolve({
                        name: attachment.name,
                        mimeType: attachment.type,
                        content: String(reader.result),
                      });
                    reader.onerror = () =>
                      reject(new Error("Unable to read the selected PDF"));
                    reader.readAsDataURL(attachment);
                  })
                : undefined;
              const x = await api<{ project: Project }>("/api/projects", {
                method: "POST",
                body: JSON.stringify({ ...form, attachment: document }),
              });
              onCreated(x.project);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Create project
        </button>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
