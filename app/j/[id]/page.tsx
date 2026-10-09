"use client";
import { use } from "react";
import MeetingRoom from "@/components/meeting-room";
export default function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <MeetingRoom id={id} />;
}
