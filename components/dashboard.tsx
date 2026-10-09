"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Home,
  CalendarDays,
  Settings,
  Search,
  Bell,
  ChevronDown,
  Video,
  Plus,
  CalendarPlus,
  ArrowUpRight,
  Clock3,
  MoreHorizontal,
  ExternalLink,
  Check,
  ShieldCheck,
  Headphones,
  HelpCircle,
  SlidersHorizontal,
  Link as LinkIcon,
} from "lucide-react";
import {
  api,
  formatId,
  inviteLink,
  saveHostToken,
  hostToken,
  DEMO,
} from "@/lib/api";
import type { Meeting } from "@/lib/types";
import { Avatar, Modal, CopyButton, Toast, Busy } from "./ui";

type Dialog =
  "join" | "schedule" | "details" | "profile" | "notifications" | "help" | null;
function dateLabel(
  date: string | null,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
) {
  return date
    ? new Date(date).toLocaleDateString("en-US", options)
    : "Instant meeting";
}
function timeLabel(date: string | null) {
  return date
    ? new Date(date).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : "Now";
}
function dateInput() {
  const d = new Date(Date.now() + 3600000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export default function Dashboard() {
  const router = useRouter();
  const [tab, setTab] = useState("Home");
  const [filter, setFilter] = useState("Upcoming");
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = useCallback(() => setDialog(null), []);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [now, setNow] = useState<Date | null>(null);
  const [joinId, setJoinId] = useState("");
  const [name, setName] = useState("Alex Morgan");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [duration, setDuration] = useState(30);
  const [saved, setSaved] = useState<Meeting | null>(null);
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [prefs, setPrefs] = useState({
    muted: false,
    videoOff: false,
    preview: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMeetings(await api.meetings());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    const value = localStorage.getItem("zoom-preferences");
    if (value) setPrefs(JSON.parse(value));
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document
          .querySelector<HTMLInputElement>('[aria-label="Search meetings"]')
          ?.focus();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  function open(value: Dialog) {
    setError("");
    setSaved(null);
    setDialog(value);
    if (value === "schedule") {
      setTitle("");
      setDescription("");
      setDate(dateInput());
    }
  }
  async function start() {
    setBusy(true);
    setError("");
    try {
      const result = await api.create({
        title: "Alex Morgan's meeting",
        description: "",
        duration: 60,
        scheduled_at: null,
      });
      saveHostToken(result.meeting.id, result.host_token);
      router.push(`/j/${result.meeting.id}?name=${encodeURIComponent(name)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      let id = joinId.trim();
      if (id.includes("/")) {
        const url = new URL(id);
        const match = url.pathname.match(/^\/j\/(\d{11})\/?$/);
        if (!match)
          throw new Error("Enter a valid meeting ID or invitation link.");
        id = match[1];
      } else id = id.replace(/[\s-]/g, "");
      if (!/^\d{11}$/.test(id))
        throw new Error(
          "Enter an 11-digit meeting ID or a valid invitation link.",
        );
      const meeting = await api.meeting(id);
      if (meeting.status === "ended")
        throw new Error("This meeting has ended.");
      router.push(
        `/j/${id}?name=${encodeURIComponent(name.trim())}&muted=${audioMuted}&videoOff=${videoOff}`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function schedule(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (new Date(date).getTime() <= Date.now())
        throw new Error("Choose a date and time in the future.");
      const result = await api.create({
        title: title.trim(),
        description: description.trim(),
        scheduled_at: new Date(date).toISOString(),
        duration,
      });
      saveHostToken(result.meeting.id, result.host_token);
      setSaved(result.meeting);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function updatePref(key: keyof typeof prefs, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    localStorage.setItem("zoom-preferences", JSON.stringify(next));
    setToast("Your preferences have been saved");
  }
  const upcoming = meetings
    .filter((m) => m.status !== "ended")
    .sort((a, b) => (a.scheduled_at || "").localeCompare(b.scheduled_at || ""));
  const recent = meetings
    .filter((m) => m.status === "ended")
    .sort((a, b) =>
      (b.ended_at || b.scheduled_at || b.created_at).localeCompare(
        a.ended_at || a.scheduled_at || a.created_at,
      ),
    );
  const visible = (filter === "Upcoming" ? upcoming : recent).filter((m) =>
    `${m.title} ${m.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  const greeting =
    now && now.getHours() >= 17
      ? "Good evening"
      : now && now.getHours() >= 12
        ? "Good afternoon"
        : "Good morning";

  function meetingRow(m: Meeting, compact = false) {
    return (
      <div className={`meeting-row ${compact ? "compact" : ""}`} key={m.id}>
        <div className={`meeting-date ${m.status === "ended" ? "past" : ""}`}>
          <span>
            {dateLabel(m.scheduled_at || m.created_at, {
              month: "short",
            }).toUpperCase()}
          </span>
          <strong>{new Date(m.scheduled_at || m.created_at).getDate()}</strong>
        </div>
        <div className="meeting-info">
          <button
            className="text-link meeting-title"
            onClick={() => {
              setSelected(m);
              open("details");
            }}
          >
            {m.title}
          </button>
          <div className="meeting-meta">
            <span>
              {timeLabel(m.scheduled_at)} <span className="separator">·</span>{" "}
              {m.duration} min
            </span>
            <span className="meeting-id">Meeting ID: {formatId(m.id)}</span>
          </div>
        </div>
        <div className="meeting-row-actions">
          {m.status === "active" && (
            <span className="live-badge">In progress</span>
          )}
          {m.status !== "ended" && (
            <button
              className="btn secondary small"
              onClick={() => router.push(`/j/${m.id}`)}
            >
              {hostToken(m.id) ? "Start" : "Join"}
            </button>
          )}
          <button
            aria-label={`Details for ${m.title}`}
            className="icon-button"
            onClick={() => {
              setSelected(m);
              open("details");
            }}
          >
            <MoreHorizontal size={21} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace">
      <header className="topbar">
        <button
          className="brand"
          aria-label="Zoom home"
          onClick={() => setTab("Home")}
        >
          zoom<span>Workplace</span>
        </button>
        <div className="global-search">
          <Search size={17} />
          <input
            aria-label="Search meetings"
            placeholder="Search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (e.target.value) setTab("Meetings");
            }}
          />
          <span>Ctrl K</span>
        </div>
        <div className="header-actions">
          <span className="plan-pill">Basic</span>
          <button
            className="icon-button"
            aria-label="Help"
            onClick={() => open("help")}
          >
            <HelpCircle size={19} />
          </button>
          <button
            className="icon-button notification-button"
            aria-label="Notifications"
            onClick={() => open("notifications")}
          >
            <Bell size={19} />
            <i />
          </button>
          <button
            className="profile-button"
            aria-label="Profile menu"
            onClick={() => open("profile")}
          >
            <Avatar size="small" />
            <ChevronDown size={14} />
          </button>
        </div>
      </header>
      <aside className="sidebar">
        <div className="nav-main">
          {[
            { label: "Home", icon: Home },
            { label: "Meetings", icon: CalendarDays },
          ].map(({ label, icon: Icon }) => (
            <button
              key={label}
              className={`nav-item ${tab === label ? "active" : ""}`}
              onClick={() => {
                setTab(label);
                setSearch("");
              }}
            >
              <Icon size={23} strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="nav-bottom">
          <button
            className={`nav-item ${tab === "Settings" ? "active" : ""}`}
            onClick={() => setTab("Settings")}
          >
            <Settings size={23} strokeWidth={1.8} />
            <span>Settings</span>
          </button>
          <button className="nav-item" onClick={() => open("help")}>
            <Headphones size={22} strokeWidth={1.8} />
            <span>Support</span>
          </button>
        </div>
      </aside>
      <main className="dashboard-main">
        <div className="content-wrap">
          {tab === "Home" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR WORKDAY, CONNECTED</div>
                  <h1>
                    {greeting}, Alex <span className="wave">☀</span>
                  </h1>
                  <p>Ready for your next great conversation?</p>
                </div>
                <span className="today-label">
                  <CalendarDays size={16} />
                  {now?.toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  }) || "Today"}
                </span>
              </div>
              <div className="home-hero">
                <section className="quick-actions" aria-label="Meeting actions">
                  <h2>Let’s meet</h2>
                  <p>Bring your people together, wherever they are.</p>
                  <div className="action-grid">
                    <button
                      className="action-tile"
                      onClick={start}
                      disabled={busy}
                    >
                      <span className="action-icon orange">
                        <Video
                          size={30}
                          fill="currentColor"
                          strokeWidth={1.5}
                        />
                      </span>
                      <strong>{busy ? "Starting…" : "New meeting"}</strong>
                      <span>Start an instant meeting</span>
                    </button>
                    <button
                      className="action-tile"
                      onClick={() => open("join")}
                    >
                      <span className="action-icon blue">
                        <Plus size={34} strokeWidth={2} />
                      </span>
                      <strong>Join</strong>
                      <span>Connect with a meeting ID</span>
                    </button>
                    <button
                      className="action-tile"
                      onClick={() => open("schedule")}
                    >
                      <span className="action-icon blue">
                        <CalendarPlus size={29} strokeWidth={1.7} />
                      </span>
                      <strong>Schedule</strong>
                      <span>Make time to connect</span>
                    </button>
                  </div>
                  <div className="personal-meeting">
                    <span className="tiny-video">
                      <Video size={17} />
                    </span>
                    <div>
                      <strong>Your personal meeting space</strong>
                      <span>
                        Create a meeting and share the invitation with anyone.
                      </span>
                    </div>
                    <ArrowUpRight size={18} />
                  </div>
                </section>
                <section className="clock-card">
                  <div className="landscape">
                    <div className="sun" />
                    <div className="hill hill-back" />
                    <div className="hill hill-mid" />
                    <div className="hill hill-front" />
                    <div className="clock-content">
                      <strong>
                        {now?.toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        }) || "09:41"}
                      </strong>
                      <span>
                        {now?.toLocaleDateString("en-US", {
                          weekday: "long",
                          month: "long",
                          day: "numeric",
                        }) || "Welcome to your workspace"}
                      </span>
                    </div>
                  </div>
                  <div className="clock-bottom">
                    <span className="status-dot" />
                    <div>
                      <strong>A little connection goes a long way.</strong>
                      <p>Your next conversation starts here.</p>
                    </div>
                  </div>
                </section>
              </div>
              <section className="panel upcoming-panel">
                <div className="section-heading">
                  <div>
                    <h2>
                      Upcoming meetings{" "}
                      <span className="count">{upcoming.length}</span>
                    </h2>
                    <p>A look at what’s next on your calendar.</p>
                  </div>
                  <button
                    className="text-link view-all"
                    onClick={() => {
                      setTab("Meetings");
                      setFilter("Upcoming");
                    }}
                  >
                    View all <ArrowUpRight size={15} />
                  </button>
                </div>
                {loading ? (
                  <div className="empty-state">
                    <Busy />
                  </div>
                ) : upcoming.length ? (
                  upcoming.slice(0, 3).map((m) => meetingRow(m))
                ) : (
                  <div className="empty-state">
                    <CalendarDays size={30} />
                    <strong>Your calendar is clear</strong>
                    <span>
                      Schedule a meeting to get something on the books.
                    </span>
                    <button
                      className="btn primary"
                      onClick={() => open("schedule")}
                    >
                      Schedule a meeting
                    </button>
                  </div>
                )}
              </section>
              <section className="recent-section">
                <div className="section-heading">
                  <h2>Recent meetings</h2>
                  <button
                    className="text-link view-all"
                    onClick={() => {
                      setTab("Meetings");
                      setFilter("Previous");
                    }}
                  >
                    View history <ArrowUpRight size={15} />
                  </button>
                </div>
                <div className="recent-grid">
                  {recent.slice(0, 2).map((m) => (
                    <button
                      key={m.id}
                      className="recent-card"
                      onClick={() => {
                        setSelected(m);
                        open("details");
                      }}
                    >
                      <span className="recent-icon">
                        <Video size={20} />
                      </span>
                      <div>
                        <strong>{m.title}</strong>
                        <span>
                          {dateLabel(m.scheduled_at || m.created_at)}{" "}
                          <span className="separator">·</span> {m.duration} min
                        </span>
                      </div>
                      <ChevronDown className="rotate-arrow" size={18} />
                    </button>
                  ))}
                  {!recent.length && (
                    <p className="muted">
                      Your completed meetings will appear here.
                    </p>
                  )}
                </div>
              </section>
              <footer className="dashboard-footer">
                <ShieldCheck size={14} />
                <span>Made for meaningful connections.</span>
                <span className="footer-right">
                  Zoom Workplace · Meeting Platform
                </span>
              </footer>
            </>
          )}
          {tab === "Meetings" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">CONNECT ON YOUR SCHEDULE</div>
                  <h1>Meetings</h1>
                  <p>All your conversations, in one place.</p>
                </div>
                <button
                  className="btn primary"
                  onClick={() => open("schedule")}
                >
                  <Plus size={17} />
                  Schedule a meeting
                </button>
              </div>
              <section className="panel">
                <div className="meeting-list-toolbar">
                  <div className="tabs">
                    {["Upcoming", "Previous"].map((t) => (
                      <button
                        key={t}
                        className={filter === t ? "selected" : ""}
                        onClick={() => setFilter(t)}
                      >
                        {t}
                        <span>
                          {t === "Upcoming" ? upcoming.length : recent.length}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="list-search">
                    <Search size={16} />
                    <input
                      aria-label="Filter meetings"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search meetings"
                    />
                  </div>
                </div>
                <div className="list-caption">
                  {filter === "Upcoming"
                    ? "Your scheduled and in-progress meetings"
                    : "Your meeting history"}
                </div>
                {loading ? (
                  <div className="empty-state">
                    <Busy />
                  </div>
                ) : visible.length ? (
                  visible.map((m) => meetingRow(m))
                ) : (
                  <div className="empty-state">
                    <CalendarDays size={32} />
                    <strong>
                      {search ? "No matching meetings" : "No meetings yet"}
                    </strong>
                    <span>
                      {search
                        ? "Try searching for a different title or meeting ID."
                        : "Your meetings will appear here."}
                    </span>
                  </div>
                )}
              </section>
            </>
          )}
          {tab === "Settings" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">MAKE YOURSELF AT HOME</div>
                  <h1>Settings</h1>
                  <p>A meeting experience that works for you.</p>
                </div>
              </div>
              <div className="settings-layout">
                <div className="settings-tabs">
                  <span className="selected">
                    <SlidersHorizontal size={17} />
                    General
                  </span>
                  <span>
                    <Video size={17} />
                    Meeting preferences
                  </span>
                </div>
                <section className="panel settings-panel">
                  <h2>Profile</h2>
                  <div className="settings-profile">
                    <Avatar size="large" />
                    <div>
                      <strong>Alex Morgan</strong>
                      <span>Default workspace user</span>
                      <span className="plan-pill">Basic plan</span>
                    </div>
                  </div>
                  <hr />
                  <h2>Meeting preferences</h2>
                  <p className="muted">
                    Choose how you enter your next meeting.
                  </p>
                  {[
                    {
                      key: "muted" as const,
                      title: "Mute my microphone when joining",
                      description: "Join quietly and unmute when you’re ready.",
                    },
                    {
                      key: "videoOff" as const,
                      title: "Turn off my video when joining",
                      description:
                        "You can turn your camera on during the meeting.",
                    },
                    {
                      key: "preview" as const,
                      title: "Show the pre-join preview",
                      description:
                        "Check your audio and video before you connect.",
                    },
                  ].map((item) => (
                    <label className="preference-row" key={item.key}>
                      <div>
                        <strong>{item.title}</strong>
                        <span>{item.description}</span>
                      </div>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={prefs[item.key]}
                        onChange={(e) => updatePref(item.key, e.target.checked)}
                      />
                    </label>
                  ))}
                  <div className="settings-note">
                    <ShieldCheck size={19} />
                    <p>
                      Your preferences are saved on this device. You can change
                      them at any time.
                    </p>
                  </div>
                </section>
              </div>
            </>
          )}
          {error && !dialog && (
            <div className="error-banner" role="alert">
              {error}
              <button className="text-link" onClick={load}>
                Try again
              </button>
            </div>
          )}
        </div>
      </main>
      {dialog === "join" && (
        <Modal title="Join a meeting" onClose={close}>
          <form onSubmit={join}>
            <div className="modal-body">
              <p className="modal-intro">
                A great conversation is one click away.
              </p>
              <label className="field">
                Meeting ID or invitation link
                <input
                  required
                  autoComplete="off"
                  placeholder="Enter meeting ID or paste a link"
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                />
              </label>
              <label className="field">
                Your name
                <input
                  required
                  maxLength={60}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your display name"
                />
              </label>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={audioMuted}
                  onChange={(e) => setAudioMuted(e.target.checked)}
                />
                Don’t connect to audio
              </label>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={videoOff}
                  onChange={(e) => setVideoOff(e.target.checked)}
                />
                Turn off my video
              </label>
              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}
              <div className="subtle-note">
                <ShieldCheck size={16} />
                <span>
                  You’ll be able to check your audio and video before joining.
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn secondary" onClick={close}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={busy || !joinId.trim() || !name.trim()}
              >
                {busy ? <Busy label="Joining…" /> : "Join"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === "schedule" && (
        <Modal
          title={saved ? "Your meeting is scheduled" : "Schedule a meeting"}
          onClose={close}
          wide
        >
          {saved ? (
            <>
              <div className="modal-body">
                <div className="success-symbol">
                  <Check size={28} />
                </div>
                <h3 className="center">You’re all set!</h3>
                <p className="center muted">
                  Share the invitation and bring everyone together.
                </p>
                <div className="invitation-card">
                  <h3>{saved.title}</h3>
                  <p>
                    {dateLabel(saved.scheduled_at, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}{" "}
                    at {timeLabel(saved.scheduled_at)}
                  </p>
                  <p>{saved.duration} minutes</p>
                  <hr />
                  <span>Meeting ID</span>
                  <strong>{formatId(saved.id)}</strong>
                  <span>Invitation link</span>
                  <a href={inviteLink(saved.id)}>{inviteLink(saved.id)}</a>
                </div>
              </div>
              <div className="modal-footer">
                <CopyButton
                  value={`${saved.title}\n${dateLabel(saved.scheduled_at)} at ${timeLabel(saved.scheduled_at)}\n${inviteLink(saved.id)}`}
                />
                <button className="btn primary" onClick={close}>
                  Done
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={schedule}>
              <div className="modal-body">
                <label className="field">
                  Topic
                  <input
                    required
                    maxLength={120}
                    placeholder="e.g. Weekly team sync"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label className="field">
                  Description <span className="optional">(optional)</span>
                  <textarea
                    maxLength={2000}
                    placeholder="What will you be talking about?"
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <div className="form-grid">
                  <label className="field">
                    When
                    <input
                      type="datetime-local"
                      required
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    Duration
                    <select
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                    >
                      {[15, 30, 45, 60, 90, 120].map((n) => (
                        <option key={n} value={n}>
                          {n < 60
                            ? `${n} minutes`
                            : `${n / 60} hour${n > 60 ? "s" : ""}`}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="timezone-note">
                  <Clock3 size={14} />
                  Your timezone:{" "}
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}
                </p>
                <hr />
                <div className="schedule-detail">
                  <LinkIcon size={19} />
                  <div>
                    <strong>Meeting ID</strong>
                    <span>Generate automatically</span>
                  </div>
                  <span className="auto-badge">Automatic</span>
                </div>
                <div className="schedule-detail">
                  <ShieldCheck size={19} />
                  <div>
                    <strong>Ready to share</strong>
                    <span>
                      A unique invitation link will be created for your meeting.
                    </span>
                  </div>
                </div>
                {error && (
                  <p className="field-error" role="alert">
                    {error}
                  </p>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn secondary" onClick={close}>
                  Cancel
                </button>
                <button
                  className="btn primary"
                  disabled={busy || !title.trim()}
                >
                  {busy ? <Busy label="Scheduling…" /> : "Save"}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
      {dialog === "details" && selected && (
        <Modal title="Meeting details" onClose={close}>
          <div className="modal-body">
            <span
              className={`detail-status ${selected.status === "ended" ? "ended" : ""}`}
            >
              {selected.status === "ended"
                ? "Completed"
                : selected.status === "active"
                  ? "In progress"
                  : "Upcoming"}
            </span>
            <h3 className="detail-title">{selected.title}</h3>
            {selected.description && (
              <p className="muted">{selected.description}</p>
            )}
            <div className="detail-line">
              <CalendarDays size={18} />
              <div>
                {dateLabel(selected.scheduled_at, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
                <span>
                  {timeLabel(selected.scheduled_at)} · {selected.duration}{" "}
                  minutes
                </span>
              </div>
            </div>
            <div className="detail-line">
              <Avatar size="small" />
              <div>
                {selected.host_name}
                <span>Host</span>
              </div>
            </div>
            <div className="invitation-card">
              <span>Meeting ID</span>
              <strong>{formatId(selected.id)}</strong>
              <span>Invitation link</span>
              <a href={inviteLink(selected.id)}>{inviteLink(selected.id)}</a>
            </div>
            {error && <p className="field-error">{error}</p>}
          </div>
          <div className="modal-footer detail-footer">
            {selected.status !== "ended" && hostToken(selected.id) && (
              <button
                className="text-link danger"
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Cancel this meeting? Participants will no longer be able to join.",
                    )
                  )
                    return;
                  try {
                    await api.cancel(selected.id);
                    close();
                    await load();
                    setToast("Meeting cancelled");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Cancel meeting
              </button>
            )}
            <CopyButton value={inviteLink(selected.id)} />
            {selected.status !== "ended" && (
              <button
                className="btn primary"
                onClick={() => router.push(`/j/${selected.id}`)}
              >
                {hostToken(selected.id) ? "Start" : "Join"}
              </button>
            )}
          </div>
        </Modal>
      )}
      {dialog === "profile" && (
        <Modal title="Your profile" onClose={close}>
          <div className="modal-body profile-modal">
            <Avatar size="large" />
            <h3>Alex Morgan</h3>
            <p className="muted">Default workspace user</p>
            <span className="availability">
              <span className="status-dot" />
              Available
            </span>
            <div className="profile-plan">
              <strong>Zoom Workplace Basic</strong>
              <span>Your space for everyday connections.</span>
            </div>
          </div>
          <div className="modal-footer">
            <button
              className="btn secondary"
              onClick={() => {
                close();
                setTab("Settings");
              }}
            >
              Open settings <ExternalLink size={15} />
            </button>
            <button className="btn primary" onClick={close}>
              Done
            </button>
          </div>
        </Modal>
      )}
      {dialog === "notifications" && (
        <Modal title="Notifications" onClose={close}>
          <div className="modal-body">
            <div className="empty-state">
              <Bell size={32} />
              <strong>You’re all caught up</strong>
              <span>Your upcoming meetings are ready on your dashboard.</span>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn primary" onClick={close}>
              Done
            </button>
          </div>
        </Modal>
      )}
      {dialog === "help" && (
        <Modal title="Welcome to your meeting space" onClose={close}>
          <div className="modal-body help-content">
            <p>
              <strong>New meeting</strong> starts an instant conversation and
              creates an invitation link.
            </p>
            <p>
              <strong>Join</strong> accepts an 11-digit meeting ID or this app’s
              invitation link.
            </p>
            <p>
              <strong>Schedule</strong> saves a meeting to your calendar. All
              dates are shown in your local timezone.
            </p>
            <p>
              Camera and microphone access work on localhost and secure HTTPS
              connections. You can also join with both turned off.
            </p>
            {DEMO && (
              <p className="subtle-note">Design preview mode is enabled.</p>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn primary" onClick={close}>
              Got it
            </button>
          </div>
        </Modal>
      )}
      {toast && <Toast text={toast} />}
    </div>
  );
}
