import { useState } from "react";
import type { Project, Query, User } from "../shared/types";

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

const request = async (url: string, body: object) => {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Request failed");
};

export function PrivateQueryInbox({
  queries,
  user,
  recipients,
  onRefresh,
}: {
  queries: Query[];
  user: User;
  recipients: BootstrapRecipient[];
  onRefresh: () => Promise<unknown>;
}) {
  if (queries.length === 0) return null;
  return (
    <section className="private-query-section">
      <div className="section-head">
        <div>
          <h2>Private query inbox</h2>
          <p className="subtle">Only the sender, recipient, and people explicitly added by forwarding can view a thread.</p>
        </div>
        <span className="pill">{queries.length} thread{queries.length === 1 ? "" : "s"}</span>
      </div>
      <div className="private-query-list">
        {queries.map((query) => (
          <QueryThread
            key={query.id}
            query={query}
            user={user}
            recipients={recipients}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    </section>
  );
}

export type BootstrapRecipient = Pick<User, "id" | "name" | "role">;

export function QueriesChat({
  projects,
  queries,
  recipients,
  user,
  onRefresh,
}: {
  projects: Project[];
  queries: Query[];
  recipients: BootstrapRecipient[];
  user: User;
  onRefresh: () => Promise<unknown>;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const project = projects.find((item) => item.id === projectId);
  return (
    <section className="queries-chat-workspace">
      <PrivateQueryInbox queries={queries} user={user} recipients={recipients} onRefresh={onRefresh} />
      <section className="queries-start">
        <div>
          <h2>Start a private query</h2>
          <p className="subtle">Choose one of your active tasks, then address the message to a specific person or section.</p>
        </div>
        {projects.length === 0 ? (
          <p className="subtle">A private query can be started when a procurement task is assigned to you.</p>
        ) : (
          <>
            <label>
              Procurement task
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                {projects.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.stageLabel}</option>)}
              </select>
            </label>
            {project && <ProjectPrivateQueries projectId={project.id} queries={[]} user={user} recipients={recipients} onRefresh={onRefresh} showThreads={false} />}
          </>
        )}
      </section>
    </section>
  );
}

export function ProjectPrivateQueries({
  projectId,
  queries,
  user,
  recipients,
  onRefresh,
  showThreads = true,
}: {
  projectId: string;
  queries: Query[];
  user: User;
  recipients: BootstrapRecipient[];
  onRefresh: () => Promise<unknown>;
  showThreads?: boolean;
}) {
  const [text, setText] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError("");
    setSubmitting(true);
    try {
      await request(`/api/projects/${projectId}/queries`, { text, recipientId });
      setText("");
      setRecipientId("");
      await onRefresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="drawer-section private-query-section">
      <h3>Private queries</h3>
      {!showThreads ? null : queries.length === 0 ? (
        <p className="subtle">No private threads are visible to your account for this project.</p>
      ) : (
        <div className="private-query-list">
          {queries.map((query) => (
            <QueryThread
              key={query.id}
              query={query}
              user={user}
              recipients={recipients}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
      <div className="query-compose">
        <label>
          Send privately to
          <select value={recipientId} onChange={(event) => setRecipientId(event.target.value)}>
            <option value="">Select a person or section</option>
            {recipients.filter((recipient) => recipient.id !== user.id).map((recipient) => (
              <option key={recipient.id} value={recipient.id}>
                {recipient.name} · {roleNames[recipient.role] ?? recipient.role}
              </option>
            ))}
          </select>
        </label>
        <label>
          Query or clarification
          <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Write a message visible only to you and the selected recipient." maxLength={4000} />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="button secondary" disabled={submitting || !recipientId || text.trim().length < 2} onClick={() => void submit()}>
          Send private query
        </button>
      </div>
    </section>
  );
}

function QueryThread({
  query,
  user,
  recipients,
  onRefresh,
}: {
  query: Query;
  user: User;
  recipients: BootstrapRecipient[];
  onRefresh: () => Promise<unknown>;
}) {
  const [reply, setReply] = useState("");
  const [forwardTo, setForwardTo] = useState("");
  const [forwardRemarks, setForwardRemarks] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const eligibleRecipients = recipients.filter(
    (recipient) => recipient.id !== user.id && !query.participants.some((participant) => participant.id === recipient.id),
  );
  const endpoint = `/api/projects/${query.projectId}/queries/${query.id}`;

  const replyToThread = async () => {
    setError("");
    setBusy(true);
    try {
      await request(`${endpoint}/replies`, { text: reply });
      setReply("");
      await onRefresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const forwardThread = async () => {
    setError("");
    setBusy(true);
    try {
      await request(`${endpoint}/forward`, { recipientId: forwardTo, remarks: forwardRemarks });
      setForwardTo("");
      setForwardRemarks("");
      await onRefresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="private-query-card">
      <div className="private-query-heading">
        <div>
          <b>{query.projectTitle}</b>
          <small>{query.stage.replaceAll("_", " ")} · From {query.actor.name}</small>
        </div>
        <span className="pill">{query.status}</span>
      </div>
      {query.recipient && <small className="query-recipient">Current recipient: {query.recipient.name} · {roleNames[query.recipient.role] ?? query.recipient.role}</small>}
      <p className={`private-query-message chat-bubble ${query.actor.id === user.id ? "chat-own" : "chat-other"}`}>{query.text}</p>
      <div className="private-query-replies">
        {query.replies.map((message) => (
          <div className={`chat-message ${message.actor.id === user.id ? "chat-own" : "chat-other"}`} key={message.id}>
            <b>{message.actor.name}</b>
            <small>{new Date(message.at).toLocaleString()}</small>
            <p className="chat-bubble">{message.text}</p>
          </div>
        ))}
      </div>
      <div className="query-compose">
        <label>
          Reply privately
          <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Reply to this thread" maxLength={4000} />
        </label>
        <button className="button secondary" disabled={busy || reply.trim().length < 2} onClick={() => void replyToThread()}>
          Send reply
        </button>
        {eligibleRecipients.length > 0 && (
          <div className="query-forward">
            <label>
              Forward privately to
              <select value={forwardTo} onChange={(event) => setForwardTo(event.target.value)}>
                <option value="">Select a new recipient</option>
                {eligibleRecipients.map((recipient) => (
                  <option key={recipient.id} value={recipient.id}>
                    {recipient.name} · {roleNames[recipient.role] ?? recipient.role}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Forwarding note
              <input value={forwardRemarks} onChange={(event) => setForwardRemarks(event.target.value)} placeholder="Context for the new recipient" maxLength={2000} />
            </label>
            <button className="button secondary" disabled={busy || !forwardTo || forwardRemarks.trim().length < 2} onClick={() => void forwardThread()}>
              Forward Query
            </button>
          </div>
        )}
      </div>
      {error && <div className="error">{error}</div>}
    </article>
  );
}
