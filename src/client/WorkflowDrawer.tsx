import { useState } from "react";
import type { Bootstrap, Project, User } from "../shared/types";

const roleNames: Record<string, string> = {
  department: "Department",
  adminia: "Admin (IA)",
  adminhq: "Admin (HQ)",
  super_admin: "Superadmin (SS)",
  dgs: "DGS",
  hq: "HQ",
  committee: "TSC / Committee",
  ia: "AS (IA) / IA Wing",
  cfa: "CFA",
};
const stageOrder = [
  "demand", "tsc_formation", "tsc_report", "as_review", "dgs_approval",
  "draft_tender", "final_tender", "vendor_activity", "bid_receipt",
  "bid_board", "technical_opening", "tec_formation", "technical_evaluation",
  "boc_formation", "financial_evaluation", "tac_formation",
  "tac_recommendation", "cfa_ifd",
];
const api = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Request failed");
  return result;
};

export function WorkflowDrawer({
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
  const [remarks, setRemarks] = useState("");
  const [members, setMembers] = useState(data.people.slice(0, 3).map((person) => person.id));
  const [chairperson, setChairperson] = useState(data.people[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState({
    content: "", deadline: "", bidCount: "", vendors: "", vendor: "",
    price: "", specifications: "", reference: "",
  });
  const workflow = project.workflow ?? {};
  const stageIndex = stageOrder.indexOf(project.stage);

  const filePayload = async () => {
    if (!file) return undefined;
    return new Promise<{ name: string; mimeType: string; content: string }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Unable to read the selected PDF"));
      reader.readAsDataURL(file);
    });
  };
  const run = async (action: string, extra: Record<string, unknown> = {}) => {
    setError("");
    try {
      const attachment = ["upload_draft", "issue_final_tender", "save_final_revision"].includes(action)
        ? await filePayload()
        : undefined;
      await api(`/api/projects/${project.id}/action`, {
        method: "POST",
        body: JSON.stringify({ action, remarks, ...extra, ...(attachment ? { document: attachment } : {}) }),
      });
      setRemarks("");
      setFile(null);
      await onRefresh();
    } catch (failure) {
      setError((failure as Error).message);
    }
  };
  const setField = (name: keyof typeof fields, value: string) =>
    setFields((current) => ({ ...current, [name]: value }));
  const committeeForm = (action: string, title: string) => (
    <>
      <label>{title} members (select exactly three)
        <select multiple value={members} onChange={(event) => setMembers(Array.from(event.target.selectedOptions).map((option) => option.value))}>
          {data.people.filter((person) => person.active).map((person) => <option key={person.id} value={person.id}>{person.name} · {person.department_code}</option>)}
        </select>
      </label>
      <label>Chairperson
        <select value={chairperson} onChange={(event) => setChairperson(event.target.value)}>
          {data.people.filter((person) => members.includes(person.id)).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select>
      </label>
      {project.stage === "tac_formation" && <p className="form-hint">At least one member must belong to {project.departmentName}.</p>}
      <button className="button primary" onClick={() => run(action, { memberIds: members, chairpersonId: chairperson })}>Constitute committee</button>
    </>
  );
  const renderAction = () => {
    if (workflow.completed) return <div className="completion-banner"><b>Procurement completed</b><span>IFD reference {workflow.ifdReference}</span></div>;
    return <section className="action-box workflow-action">
      <span className="eyebrow">STAGE {stageIndex + 1} · {roleNames[user.role]}</span>
      <h3>{project.stageLabel}</h3>
      {project.stage === "demand" && <><p className="subtle">Review the department requirement and accept it into the procurement sequence.</p><button className="button primary" onClick={() => run("accept_demand")}>Accept demand</button></>}
      {project.stage === "tsc_formation" && committeeForm("form_tsc", "TSC")}
      {project.stage === "tsc_report" && <><textarea placeholder="Specifications, evaluation criteria and technical rationale" value={fields.content} onChange={(event) => setField("content", event.target.value)} /><button className="button primary" onClick={() => run("submit_tsc_report", { content: fields.content })}>Submit report to Admin (IA)</button></>}
      {project.stage === "as_review" && workflow.phase === "adminia_route" && <><div className="report-preview"><b>TSC specifications report</b><p>{workflow.tscReport ?? "No report submitted yet."}</p></div><button className="button primary" onClick={() => run("route_to_as")}>Route report to AS (IA)</button></>}
      {project.stage === "as_review" && workflow.phase === "as_decision" && <><div className="report-preview"><b>TSC specifications report</b><p>{workflow.tscReport ?? "No report submitted yet."}</p></div><div className="action-row"><button className="button secondary" onClick={() => run("as_decision", { decision: "return" })}>Return to TSC</button><button className="button primary" onClick={() => run("as_decision", { decision: "approve" })}>Approve & route</button></div></>}
      {project.stage === "dgs_approval" && workflow.phase === "adminia_route" && <button className="button primary" onClick={() => run("route_to_hq")}>Route approved file to Admin (HQ)</button>}
      {project.stage === "dgs_approval" && workflow.phase === "adminhq_route" && <button className="button primary" onClick={() => run("route_to_dgs")}>Route file to DGS</button>}
      {project.stage === "dgs_approval" && workflow.phase === "dgs_review" && <div className="action-row"><button className="button secondary" onClick={() => run("dgs_decision", { decision: "return" })}>Return to Admin (HQ)</button><button className="button primary" onClick={() => run("dgs_decision", { decision: "approve" })}>Approve</button></div>}
      {project.stage === "dgs_approval" && workflow.phase === "adminhq_return" && <button className="button primary" onClick={() => run("acknowledge_dgs")}>Acknowledge approval & continue</button>}
      {project.stage === "draft_tender" && <><label>Draft tender PDF<input type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><small>Revision {Number(workflow.draftVersion ?? 0) + 1}</small><button className="button primary" onClick={() => run("upload_draft")}>Send draft to Admin (IA)</button></>}
      {project.stage === "final_tender" && <><label>Final tender PDF<input type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><label>Submission deadline<input type="date" value={fields.deadline} onChange={(event) => setField("deadline", event.target.value)} /></label><small>Next final version {Number(workflow.finalVersion ?? 0) + 1}</small><div className="action-row"><button className="button secondary" onClick={() => run("save_final_revision")}>Save revision</button><button className="button primary" onClick={() => run("issue_final_tender", { deadline: fields.deadline })}>Issue tender to vendors</button></div></>}
      {project.stage === "vendor_activity" && <><p className="subtle">Offline vendor queries, replies and bid submissions. Published deadline: <b>{workflow.submissionDeadline}</b></p><button className="button primary" onClick={() => run("finish_vendor_activity")}>Close vendor activity</button></>}
      {project.stage === "bid_receipt" && <><label>Total bids received<input type="number" min="0" value={fields.bidCount} onChange={(event) => setField("bidCount", event.target.value)} /></label><button className="button primary" onClick={() => run("record_bid_receipt", { bidCount: Number(fields.bidCount) })}>Record receipt & notify vendors</button></>}
      {project.stage === "bid_board" && committeeForm("form_board", "Bid Opening Board")}
      {project.stage === "technical_opening" && <button className="button primary" onClick={() => run("record_technical_opening")}>Record technical bid opening</button>}
      {project.stage === "tec_formation" && workflow.phase === "ss_approval" && <div className="action-row"><button className="button primary" onClick={() => run("tec_decision", { decision: "approve" })}>Approve TEC</button></div>}
      {project.stage === "tec_formation" && workflow.phase !== "ss_approval" && committeeForm("form_tec", "Technical Evaluation Committee")}
      {project.stage === "technical_evaluation" && <><label>Qualified vendors (one per line)<textarea value={fields.vendors} onChange={(event) => setField("vendors", event.target.value)} /></label><button className="button primary" onClick={() => run("submit_technical_evaluation", { vendors: fields.vendors })}>Submit technical evaluation</button></>}
      {project.stage === "boc_formation" && committeeForm("form_boc", "Bid Opening Committee")}
      {project.stage === "financial_evaluation" && <><label>Top three vendors (one per line)<textarea value={fields.vendors} onChange={(event) => setField("vendors", event.target.value)} /></label><button className="button primary" onClick={() => run("submit_financial_evaluation", { vendors: fields.vendors })}>Submit financial evaluation</button></>}
      {project.stage === "tac_formation" && committeeForm("form_tac", "TAC")}
      {project.stage === "tac_recommendation" && <><label>Winning vendor<input value={fields.vendor} onChange={(event) => setField("vendor", event.target.value)} /></label><label>Price bid<input type="number" min="1" value={fields.price} onChange={(event) => setField("price", event.target.value)} /></label><label>Recommended specifications<textarea value={fields.specifications} onChange={(event) => setField("specifications", event.target.value)} /></label><button className="button primary" onClick={() => run("submit_tac_recommendation", { vendor: fields.vendor, price: fields.price, specifications: fields.specifications })}>Submit recommendation to Admin (IA)</button></>}
      {project.stage === "cfa_ifd" && workflow.phase !== "ifd_confirmation" && <button className="button primary" onClick={() => run("cfa_release")}>Release funds via IFD</button>}
      {project.stage === "cfa_ifd" && workflow.phase === "ifd_confirmation" && <><label>IFD confirmation reference<input value={fields.reference} onChange={(event) => setField("reference", event.target.value)} /></label><button className="button primary" onClick={() => run("record_ifd", { reference: fields.reference })}>Confirm IFD & complete project</button></>}
      <label>Action remarks<textarea required value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Required audit-trail remarks" /></label>
    </section>;
  };

  return <div className="drawer-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
    <aside className="drawer">
      <div className="drawer-head"><div><span className="project-id">{project.id}</span><h2>{project.title}</h2><p className="subtle">{project.departmentName} · {project.stageLabel}</p></div><button className="close" onClick={onClose} aria-label="Close project">×</button></div>
      <div className="drawer-progress"><div className="progress"><i style={{ width: `${workflow.completed ? 100 : Math.round((Math.max(0, stageIndex) / 17) * 100)}%` }} /></div><small>Stage {stageIndex + 1} of 18</small></div>
      {error && <div className="error">{error}</div>}
      {renderAction()}
      <section className="drawer-section"><h3>Project documents</h3>{project.documents.length === 0 ? <p className="subtle">No documents attached.</p> : project.documents.map((document) => <a className="document-link" key={document.id} href={`/api/documents/${document.id}`} target="_blank" rel="noreferrer"><span>{document.name}</span><small>{document.category.replaceAll("_", " ")} · {new Date(document.at).toLocaleDateString()}</small></a>)}</section>
      {Array.isArray(workflow.committees) && workflow.committees.length > 0 && <section className="drawer-section"><h3>Committee assignments</h3>{workflow.committees.map((committee: { id?: string; type: string; memberIds: string[]; chairpersonId: string }, index: number) => {
        const record = data.committees.find((item) => item.id === committee.id);
        return <div className="committee-assignment" key={committee.id ?? `${committee.type}-${index}`}><div><b>{committee.type}</b><span className="pill">{record?.status ?? "formed"}</span></div><p>Chairperson: {data.people.find((person) => person.id === committee.chairpersonId)?.name ?? "—"}</p><small>{committee.memberIds.map((id) => data.people.find((person) => person.id === id)?.name ?? id).join(" · ")}</small></div>;
      })}</section>}
      <section className="drawer-section"><h3>Audit trail</h3>{project.events.map((event) => <div className="event" key={event.id}><span className="event-dot" /><div><b>{event.text}</b><small>{event.actor.name} · {roleNames[event.actor.role] ?? event.actor.role} · {new Date(event.at).toLocaleString()}</small></div></div>)}</section>
    </aside>
  </div>;
}
