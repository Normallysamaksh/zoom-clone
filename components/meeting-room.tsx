"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Users,
  MessageSquare,
  MonitorUp,
  ShieldCheck,
  ChevronUp,
  Info,
  X,
  Send,
  Hand,
  Grid2X2,
  ArrowLeft,
  Copy,
  MoreHorizontal,
  LogOut,
} from "lucide-react";
import { api, formatId, inviteLink, hostToken, DEMO } from "@/lib/api";
import { useMeeting } from "@/lib/use-meeting";
import type { Meeting, JoinResult } from "@/lib/types";
import { Avatar, Busy, Modal, CopyButton, Toast } from "./ui";

function VideoFeed({
  stream,
  muted = false,
  className = "",
}: {
  stream: MediaStream | null;
  muted?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);
  return (
    <video className={className} ref={ref} autoPlay playsInline muted={muted} />
  );
}

export default function MeetingRoom({ id }: { id: string }) {
  const router = useRouter();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [name, setName] = useState("Alex Morgan");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<JoinResult | null>(null);
  const [panel, setPanel] = useState<"participants" | "chat" | null>(null);
  const [info, setInfo] = useState(false);
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [chat, setChat] = useState("");
  const [toast, setToast] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [speakerView, setSpeakerView] = useState(false);
  const screenRef = useRef<MediaStream | null>(null);
  const closeInfo = useCallback(() => setInfo(false), []);
  const closeLeave = useCallback(() => setLeaveDialog(false), []);
  const live = useMeeting(id, joined, stream);

  const acquire = useCallback(async () => {
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (!mountedRef.current) {
        next.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = next;
      setStream(next);
      setMediaError("");
    } catch {
      try {
        const next = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        if (!mountedRef.current) {
          next.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = next;
        setStream(next);
        setVideoOff(true);
        setMediaError("Camera unavailable. You can still join with audio.");
      } catch {
        setMuted(true);
        setVideoOff(true);
        setMediaError(
          "Camera and microphone access is unavailable. Allow access in your browser, or join with both turned off.",
        );
      }
    }
  }, []);
  useEffect(() => {
    let disposed = false;
    mountedRef.current = true;
    const query = new URLSearchParams(window.location.search);
    const prefs = JSON.parse(localStorage.getItem("zoom-preferences") || "{}");
    const displayName = query.get("name") || "Alex Morgan";
    const initialMuted = query.has("muted")
      ? query.get("muted") === "true"
      : !!prefs.muted;
    const initialVideoOff = query.has("videoOff")
      ? query.get("videoOff") === "true"
      : !!prefs.videoOff;
    setName(displayName);
    setMuted(initialMuted);
    setVideoOff(initialVideoOff);
    api
      .meeting(id)
      .then(async (m) => {
        if (!disposed) {
          if (m.status === "ended") setError("This meeting has ended.");
          else {
            setMeeting(m);
            if (!DEMO) await acquire();
            if (!disposed && prefs.preview === false) {
              const result = await api.join(
                id,
                displayName,
                initialMuted ||
                  (!DEMO && !streamRef.current?.getAudioTracks().length),
                initialVideoOff ||
                  (!DEMO && !streamRef.current?.getVideoTracks().length),
              );
              setJoined(result);
              setMeeting(result.meeting);
            }
          }
        }
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      screenRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [id, acquire]);
  useEffect(() => {
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }, [muted, stream]);
  useEffect(() => {
    if (!sharing)
      streamRef.current
        ?.getVideoTracks()
        .forEach((t) => (t.enabled = !videoOff));
  }, [videoOff, sharing, stream]);
  useEffect(() => {
    if (!joined) return;
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [joined]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!joined || DEMO) return;
    const me = live.participants.find((p) => p.id === joined.participant.id);
    if (
      me?.muted &&
      streamRef.current?.getAudioTracks().some((t) => t.enabled)
    ) {
      setMuted(true);
      setToast("Your microphone was muted");
    }
  }, [live.participants, joined]);
  useEffect(() => {
    if (!joined || DEMO) return;
    function leaveOnClose() {
      fetch(`/api/v1/meetings/${id}/leave`, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${joined!.token}`,
        },
        body: "{}",
      }).catch(() => {});
    }
    window.addEventListener("pagehide", leaveOnClose);
    return () => window.removeEventListener("pagehide", leaveOnClose);
  }, [id, joined]);
  useEffect(() => {
    if (live.ended) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      screenRef.current?.getTracks().forEach((t) => t.stop());
    }
  }, [live.ended]);

  async function enter(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await api.join(id, name.trim(), muted, videoOff);
      setJoined(result);
      setMeeting(result.meeting);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function leave(end = false) {
    setBusy(true);
    try {
      await live.action(end ? "end" : "leave");
      streamRef.current?.getTracks().forEach((t) => t.stop());
      screenRef.current?.getTracks().forEach((t) => t.stop());
      router.push("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggleAudio() {
    if (!streamRef.current?.getAudioTracks().length && !DEMO) {
      await acquire();
      return;
    }
    const next = !muted;
    setMuted(next);
    await live.action("update", { muted: next }).catch(() => {});
  }
  async function toggleVideo() {
    if (!streamRef.current?.getVideoTracks().length && !DEMO) {
      await acquire();
      return;
    }
    const next = !videoOff;
    setVideoOff(next);
    await live.action("update", { video_off: next }).catch(() => {});
  }
  async function share() {
    if (sharing) {
      screenRef.current?.getTracks().forEach((t) => t.stop());
      screenRef.current = null;
      setStream(streamRef.current);
      setSharing(false);
      return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });
      screenRef.current = screen;
      const next = new MediaStream([
        ...screen.getVideoTracks(),
        ...(streamRef.current?.getAudioTracks() || []),
      ]);
      setStream(next);
      setSharing(true);
      screen.getVideoTracks()[0].onended = () => {
        setStream(streamRef.current);
        setSharing(false);
      };
    } catch {
      setToast("Screen sharing was cancelled or unavailable");
    }
  }
  const me =
    live.participants.find((p) => p.id === joined?.participant.id) ||
    joined?.participant;
  const people = live.participants.length
    ? live.participants
    : joined
      ? [joined.participant]
      : [];
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0"),
    seconds = String(elapsed % 60).padStart(2, "0");

  if (loading)
    return (
      <div className="prejoin-page">
        <div className="brand">
          zoom<span>Workplace</span>
        </div>
        <Busy label="Getting your meeting ready…" />
      </div>
    );
  if ((!meeting && error) || live.ended)
    return (
      <div className="prejoin-page">
        <div className="brand">
          zoom<span>Workplace</span>
        </div>
        <div className="meeting-unavailable">
          <span className="unavailable-icon">
            <VideoOff size={34} />
          </span>
          <h1>
            {live.ended ? "This meeting has ended" : "Unable to join meeting"}
          </h1>
          <p>
            {live.ended
              ? live.error || "Thanks for connecting. See you next time!"
              : error}
          </p>
          <button className="btn primary" onClick={() => router.push("/")}>
            Back to home
          </button>
        </div>
      </div>
    );
  if (!joined)
    return (
      <div className="prejoin-page">
        <header className="prejoin-header">
          <button className="brand" onClick={() => router.push("/")}>
            zoom<span>Workplace</span>
          </button>
          <span>
            <ShieldCheck size={15} />A secure space to connect
          </span>
        </header>
        <main className="prejoin-main">
          <div className="prejoin-heading">
            <span className="eyebrow">YOU’RE ALMOST THERE</span>
            <h1>Ready to join?</h1>
            <p>Check your audio and video before you connect.</p>
          </div>
          <div className="prejoin-card">
            <div className="preview-side">
              <div className="camera-preview">
                {stream && !videoOff ? (
                  <VideoFeed stream={stream} muted className="mirror" />
                ) : (
                  <>
                    <Avatar name={name} size="preview-avatar" />
                    <span className="camera-off-caption">
                      {DEMO ? "Video preview" : "Your camera is off"}
                    </span>
                  </>
                )}
                <span className="preview-name">{name || "Your name"}</span>
                <div className="preview-controls">
                  <button
                    aria-label={muted ? "Unmute microphone" : "Mute microphone"}
                    className={muted ? "off" : ""}
                    onClick={toggleAudio}
                  >
                    {muted ? <MicOff size={21} /> : <Mic size={21} />}
                  </button>
                  <button
                    aria-label={videoOff ? "Turn on camera" : "Turn off camera"}
                    className={videoOff ? "off" : ""}
                    onClick={toggleVideo}
                  >
                    {videoOff ? <VideoOff size={21} /> : <Video size={21} />}
                  </button>
                </div>
              </div>
              <div className="preview-note">
                <ShieldCheck size={15} />
                You’re in control of your audio and video.
              </div>
            </div>
            <form className="prejoin-form" onSubmit={enter}>
              <span className="detail-status">
                {hostToken(id) ? "You’re the host" : "You’re invited"}
              </span>
              <h2>{meeting?.title}</h2>
              <p className="muted">Hosted by {meeting?.host_name}</p>
              <div className="prejoin-id">Meeting ID: {formatId(id)}</div>
              <label className="field">
                Your name
                <input
                  required
                  maxLength={60}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button
                className="btn primary join-room"
                disabled={busy || !name.trim()}
              >
                {busy ? <Busy label="Connecting…" /> : "Join meeting"}
                <ArrowLeft size={17} className="reverse-arrow" />
              </button>
              {mediaError && (
                <p className="media-warning" role="status">
                  {mediaError}
                  <button type="button" className="text-link" onClick={acquire}>
                    Try again
                  </button>
                </p>
              )}
              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}
              <span className="joining-note">
                By joining, you agree to be a good meeting neighbor.
              </span>
            </form>
          </div>
          <button
            className="text-link back-home"
            onClick={() => router.push("/")}
          >
            <ArrowLeft size={15} />
            Back to home
          </button>
        </main>
        <footer className="prejoin-footer">
          Zoom Workplace · Connect from anywhere
        </footer>
      </div>
    );
  return (
    <div className="meeting-room">
      <header className="room-topbar">
        <div>
          <ShieldCheck size={17} className="green" />
          <button
            className="room-info-button"
            aria-label="Meeting information"
            onClick={() => setInfo(true)}
          >
            <Info size={17} />
          </button>
          <span>{meeting?.title}</span>
        </div>
        <div>
          <span className="meeting-timer">
            {minutes}:{seconds}
          </span>
          <button
            className="room-view"
            onClick={() => setSpeakerView((v) => !v)}
          >
            <Grid2X2 size={15} />
            {speakerView ? "Speaker view" : "Gallery view"}
          </button>
        </div>
      </header>
      <div className="room-body">
        <main className={`video-stage ${speakerView ? "speaker" : ""}`}>
          <div className="stage-title">
            <span className="connected-dot" />
            {sharing ? "You are sharing your screen" : "You’re connected"}
            <span>{formatId(id)}</span>
          </div>
          <div className={`video-grid count-${people.length}`}>
            <div className={`video-tile self ${!muted ? "speaking" : ""}`}>
              {stream && (!videoOff || sharing) ? (
                <VideoFeed
                  stream={stream}
                  muted
                  className={sharing ? "" : "mirror"}
                />
              ) : (
                <div className="tile-placeholder">
                  <Avatar name={name} size="room-avatar" />
                  <span>{name}</span>
                  <small>
                    {videoOff
                      ? "Camera is off"
                      : DEMO
                        ? "Design preview"
                        : "Camera unavailable"}
                  </small>
                </div>
              )}
              <span className="tile-label">
                {muted && <MicOff size={13} />}
                {name} (You)
                {me?.is_host && <span className="host-label">Host</span>}
              </span>
              {me?.hand_raised && <Hand className="raised-hand" size={25} />}
            </div>
            {Object.values(live.remotes).map((remote) => (
              <div className="video-tile" key={remote.participant.id}>
                {remote.stream && !remote.participant.video_off ? (
                  <VideoFeed stream={remote.stream} />
                ) : (
                  <div className="tile-placeholder">
                    <Avatar
                      name={remote.participant.name}
                      size="room-avatar"
                      color="purple"
                    />
                    <span>{remote.participant.name}</span>
                    <small>
                      {remote.connection === "failed"
                        ? "Connection failed"
                        : remote.connection === "connected"
                          ? "Camera is off"
                          : "Connecting…"}
                    </small>
                  </div>
                )}
                {remote.stream && remote.participant.video_off && (
                  <VideoFeed stream={remote.stream} className="audio-only" />
                )}
                <span className="tile-label">
                  {remote.participant.muted && <MicOff size={13} />}
                  {remote.participant.name}
                  {remote.participant.is_host && (
                    <span className="host-label">Host</span>
                  )}
                </span>
                {remote.participant.hand_raised && (
                  <Hand className="raised-hand" size={25} />
                )}
              </div>
            ))}
          </div>
          {people.length === 1 && (
            <div className="alone-note">
              <Users size={18} />
              <span>You’re the first one here. Invite someone to join.</span>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(inviteLink(id));
                    setToast("Invitation link copied");
                  } catch {
                    setInfo(true);
                  }
                }}
              >
                Copy invite link <Copy size={14} />
              </button>
            </div>
          )}
          {(live.error || error) && (
            <div className="room-error" role="alert">
              {live.error || error}
            </div>
          )}
        </main>
        {panel && (
          <aside className="room-panel">
            <div className="room-panel-header">
              <h2>
                {panel === "participants"
                  ? `Participants (${people.length})`
                  : "Meeting chat"}
              </h2>
              <button
                className="icon-button"
                aria-label="Close panel"
                onClick={() => setPanel(null)}
              >
                <X size={18} />
              </button>
            </div>
            {panel === "participants" ? (
              <>
                <div className="participant-list">
                  {people.map((person) => (
                    <div className="participant-row" key={person.id}>
                      <Avatar
                        name={person.name}
                        size="small"
                        color={
                          person.id === joined.participant.id ? "" : "purple"
                        }
                      />
                      <div>
                        <strong>
                          {person.name}
                          {person.id === joined.participant.id ? " (You)" : ""}
                        </strong>
                        <span>{person.is_host ? "Host" : "Participant"}</span>
                      </div>
                      {person.hand_raised && (
                        <Hand size={15} className="blue-text" />
                      )}
                      {person.id === joined.participant.id ? (
                        muted ? (
                          <MicOff size={16} className="red" />
                        ) : (
                          <Mic size={16} />
                        )
                      ) : person.muted ? (
                        <MicOff size={16} className="red" />
                      ) : (
                        <Mic size={16} />
                      )}
                      {person.video_off ? (
                        <VideoOff size={16} />
                      ) : (
                        <Video size={16} />
                      )}
                      {me?.is_host && person.id !== joined.participant.id && (
                        <button
                          title="Remove participant"
                          aria-label={`Remove ${person.name}`}
                          className="icon-button"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove ${person.name} from this meeting?`,
                              )
                            )
                              live
                                .action("remove", { participant_id: person.id })
                                .catch(() => {});
                          }}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="participant-footer">
                  <button
                    className="btn secondary small"
                    onClick={() => setInfo(true)}
                  >
                    Invite <PlusIcon />
                  </button>
                  {me?.is_host && (
                    <button
                      className="btn secondary small"
                      onClick={() => {
                        live
                          .action("mute-all")
                          .then(() => setToast("All participants muted"))
                          .catch(() => {});
                      }}
                    >
                      Mute all
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="chat-messages">
                  <div className="chat-welcome">
                    <MessageSquare size={26} />
                    <strong>A space for the conversation</strong>
                    <p>Messages are visible to everyone in this meeting.</p>
                  </div>
                  {live.messages.map((message) => (
                    <div className="chat-message" key={message.id}>
                      <div>
                        <strong>{message.name}</strong>
                        <span>
                          {new Date(message.created_at).toLocaleTimeString(
                            "en-US",
                            { hour: "numeric", minute: "2-digit" },
                          )}
                        </span>
                      </div>
                      <p>{message.content}</p>
                    </div>
                  ))}
                </div>
                <form
                  className="chat-compose"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!chat.trim()) return;
                    try {
                      await live.action("chat", { content: chat.trim() });
                      setChat("");
                    } catch {}
                  }}
                >
                  <span>
                    To: <strong>Everyone</strong>
                    <ChevronUp size={12} />
                  </span>
                  <textarea
                    aria-label="Message everyone"
                    placeholder="Type a message…"
                    value={chat}
                    onChange={(e) => setChat(e.target.value)}
                    maxLength={2000}
                  />
                  <button
                    className="icon-button"
                    aria-label="Send message"
                    disabled={!chat.trim()}
                  >
                    <Send size={18} />
                  </button>
                </form>
              </>
            )}
          </aside>
        )}
      </div>
      <footer className="room-toolbar">
        <div className="toolbar-group">
          <button
            className={`toolbar-button ${muted ? "red" : ""}`}
            onClick={toggleAudio}
          >
            {muted ? <MicOff size={23} /> : <Mic size={23} />}
            <span>{muted ? "Unmute" : "Mute"}</span>
          </button>
          <button
            className="toolbar-chevron"
            aria-label="Audio settings"
            onClick={() =>
              setToast("Audio uses your browser’s default microphone")
            }
          >
            <ChevronUp size={13} />
          </button>
          <button className="toolbar-button" onClick={toggleVideo}>
            {videoOff ? <VideoOff size={24} /> : <Video size={24} />}
            <span>{videoOff ? "Start video" : "Stop video"}</span>
          </button>
        </div>
        <div className="toolbar-group center-controls">
          <button
            className={`toolbar-button ${panel === "participants" ? "toolbar-active" : ""}`}
            onClick={() =>
              setPanel(panel === "participants" ? null : "participants")
            }
          >
            <span className="toolbar-icon">
              <Users size={24} />
              <small>{people.length}</small>
            </span>
            <span>Participants</span>
          </button>
          <button
            className={`toolbar-button ${panel === "chat" ? "toolbar-active" : ""}`}
            onClick={() => setPanel(panel === "chat" ? null : "chat")}
          >
            <MessageSquare size={23} />
            <span>Chat</span>
          </button>
          <button className="toolbar-button share-button" onClick={share}>
            <MonitorUp size={25} />
            <span>{sharing ? "Stop share" : "Share screen"}</span>
          </button>
          <button
            className={`toolbar-button ${me?.hand_raised ? "toolbar-active" : ""}`}
            onClick={() =>
              live
                .action("update", { hand_raised: !me?.hand_raised })
                .catch(() => {})
            }
          >
            <Hand size={23} />
            <span>{me?.hand_raised ? "Lower hand" : "Raise hand"}</span>
          </button>
          <button
            className="toolbar-button more-control"
            onClick={() => setInfo(true)}
          >
            <MoreHorizontal size={24} />
            <span>More</span>
          </button>
        </div>
        <button className="leave-button" onClick={() => setLeaveDialog(true)}>
          {me?.is_host ? "End" : "Leave"}
          <ChevronUp size={14} />
        </button>
      </footer>
      {info && (
        <Modal title="Meeting information" onClose={closeInfo}>
          <div className="modal-body">
            <h3>{meeting?.title}</h3>
            <div className="detail-line">
              <ShieldCheck size={17} />
              <div>
                {meeting?.host_name}
                <span>Meeting host</span>
              </div>
            </div>
            <div className="invitation-card">
              <span>Meeting ID</span>
              <strong>{formatId(id)}</strong>
              <span>Invitation link</span>
              <a href={inviteLink(id)}>{inviteLink(id)}</a>
            </div>
          </div>
          <div className="modal-footer">
            <CopyButton value={inviteLink(id)} />
            <button className="btn primary" onClick={closeInfo}>
              Done
            </button>
          </div>
        </Modal>
      )}
      {leaveDialog && (
        <Modal
          title={
            me?.is_host ? "End or leave this meeting?" : "Leave this meeting?"
          }
          onClose={closeLeave}
        >
          <div className="modal-body">
            <p className="muted">
              {me?.is_host
                ? "End the meeting for everyone, or leave while others continue their conversation."
                : "You can rejoin using the same invitation link while the meeting is active."}
            </p>
            {error && <p className="field-error">{error}</p>}
          </div>
          <div className="modal-footer">
            <button className="btn secondary" onClick={closeLeave}>
              Cancel
            </button>
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => leave(false)}
            >
              Leave meeting <LogOut size={15} />
            </button>
            {me?.is_host && (
              <button
                className="btn danger-fill"
                disabled={busy}
                onClick={() => leave(true)}
              >
                End for everyone
              </button>
            )}
          </div>
        </Modal>
      )}
      {toast && <Toast text={toast} />}
    </div>
  );
}
function PlusIcon() {
  return <span style={{ fontSize: 18 }}>+</span>;
}
