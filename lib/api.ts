import type {
  Meeting,
  MeetingInput,
  Participant,
  JoinResult,
  Signal,
  ChatMessage,
} from "./types";

export const DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const prefix = "/api/v1";

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(prefix + path, {
      ...options,
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch {
    throw new Error(
      "Unable to connect. Please check your connection and try again.",
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "Something went wrong. Please try again.",
    );
  return data;
}

function seeds(): Meeting[] {
  const now = new Date();
  return [
    {
      id: "83245678901",
      title: "Product design sync",
      description: "Review the latest designs and align on next steps.",
      scheduled_at: new Date(now.getTime() + 3600000).toISOString(),
      duration: 30,
      status: "scheduled",
      created_at: now.toISOString(),
      host_name: "Alex Morgan",
      host_id: "default-user",
    },
    {
      id: "84512345678",
      title: "Weekly team standup",
      description:
        "A little time to connect, share updates, and plan the week.",
      scheduled_at: new Date(now.getTime() + 86400000).toISOString(),
      duration: 45,
      status: "scheduled",
      created_at: now.toISOString(),
      host_name: "Alex Morgan",
      host_id: "default-user",
    },
    {
      id: "86790123456",
      title: "Project kickoff",
      description: "Let's make great things together.",
      scheduled_at: new Date(now.getTime() + 172800000).toISOString(),
      duration: 60,
      status: "scheduled",
      created_at: now.toISOString(),
      host_name: "Alex Morgan",
      host_id: "default-user",
    },
    {
      id: "81234567890",
      title: "Engineering catch-up",
      description: "",
      scheduled_at: new Date(now.getTime() - 86400000).toISOString(),
      duration: 30,
      status: "ended",
      created_at: now.toISOString(),
      host_name: "Alex Morgan",
      host_id: "default-user",
    },
    {
      id: "82345678901",
      title: "Design review",
      description: "",
      scheduled_at: new Date(now.getTime() - 172800000).toISOString(),
      duration: 45,
      status: "ended",
      created_at: now.toISOString(),
      host_name: "Alex Morgan",
      host_id: "default-user",
    },
  ];
}
function demoMeetings(): Meeting[] {
  const value = localStorage.getItem("zoom-demo-meetings");
  return value ? JSON.parse(value) : seeds();
}
function save(meetings: Meeting[]) {
  localStorage.setItem("zoom-demo-meetings", JSON.stringify(meetings));
}
export const formatId = (id: string) =>
  id.replace(/(\d{3})(\d{4})(\d{4})/, "$1 $2 $3");
export const inviteLink = (id: string) =>
  `${typeof window !== "undefined" ? window.location.origin : ""}/j/${id}`;
export function saveHostToken(id: string, token: string) {
  localStorage.setItem(`zoom-host-${id}`, token);
}
export function hostToken(id: string) {
  return localStorage.getItem(`zoom-host-${id}`) || "";
}

export const api = {
  meetings: async (): Promise<Meeting[]> =>
    DEMO ? demoMeetings() : request("/meetings"),
  meeting: async (id: string): Promise<Meeting> => {
    if (!DEMO) return request(`/meetings/${id}`);
    const result = demoMeetings().find((m) => m.id === id);
    if (!result)
      throw new Error("Meeting not found. Check the meeting ID and try again.");
    return result;
  },
  create: async (
    input: MeetingInput,
  ): Promise<{ meeting: Meeting; host_token: string }> => {
    if (!DEMO)
      return request("/meetings", {
        method: "POST",
        body: JSON.stringify(input),
      });
    const meeting: Meeting = {
      ...input,
      id: String(Math.floor(10000000000 + Math.random() * 89999999999)),
      status: input.scheduled_at ? "scheduled" : "active",
      host_id: "default-user",
      host_name: "Alex Morgan",
      created_at: new Date().toISOString(),
    };
    save([meeting, ...demoMeetings()]);
    return { meeting, host_token: "demo-host" };
  },
  cancel: async (id: string) => {
    if (DEMO) {
      save(
        demoMeetings().map((m) =>
          m.id === id ? { ...m, status: "ended" } : m,
        ),
      );
      return;
    }
    return request(`/meetings/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ host_token: hostToken(id) }),
    });
  },
  join: async (
    id: string,
    name: string,
    muted: boolean,
    video_off: boolean,
  ): Promise<JoinResult> => {
    if (!DEMO)
      return request(`/meetings/${id}/join`, {
        method: "POST",
        body: JSON.stringify({
          name,
          muted,
          video_off,
          host_token: hostToken(id),
        }),
      });
    return {
      meeting: await api.meeting(id),
      participant: {
        id: "demo-self",
        name,
        is_host: !!hostToken(id),
        muted,
        video_off,
        hand_raised: false,
      },
      token: "demo",
    };
  },
  state: async (
    id: string,
    token: string,
    cursor: number,
  ): Promise<{
    participants: Participant[];
    signals: Signal[];
    messages: ChatMessage[];
    status: string;
  }> =>
    request(`/meetings/${id}/state?cursor=${cursor}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  action: async (
    id: string,
    token: string,
    action: string,
    payload: Record<string, unknown> = {},
  ) => {
    if (DEMO) return {};
    return request(`/meetings/${id}/${action}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  },
};
