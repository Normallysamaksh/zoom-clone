export type Meeting = {
  id: string;
  title: string;
  description: string;
  scheduled_at: string | null;
  duration: number;
  status: "scheduled" | "active" | "ended";
  created_at: string;
  host_name: string;
  host_id: string;
  ended_at?: string | null;
};
export type MeetingInput = {
  title: string;
  description: string;
  scheduled_at: string | null;
  duration: number;
};
export type Participant = {
  id: string;
  name: string;
  is_host: boolean;
  muted: boolean;
  video_off: boolean;
  hand_raised: boolean;
  removed?: boolean;
};
export type JoinResult = {
  participant: Participant;
  token: string;
  meeting: Meeting;
};
export type Signal = {
  id: number;
  sender_id: string;
  kind: string;
  payload: Record<string, unknown>;
};
export type ChatMessage = {
  id: number;
  name: string;
  content: string;
  created_at: string;
};
