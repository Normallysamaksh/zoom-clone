"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, DEMO } from "./api";
import type { JoinResult, Participant, ChatMessage, Signal } from "./types";

type Remote = {
  participant: Participant;
  stream: MediaStream | null;
  connection: string;
};

export function useMeeting(
  id: string,
  joined: JoinResult | null,
  stream: MediaStream | null,
) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [remotes, setRemotes] = useState<Record<string, Remote>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");
  const [ended, setEnded] = useState(false);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const currentStream = useRef(stream);
  const latestPeople = useRef<Participant[]>([]);
  useEffect(() => {
    currentStream.current = stream;
    for (const pc of peers.current.values()) {
      for (const sender of pc.getSenders()) {
        const kind = pc.getTransceivers().find((t) => t.sender === sender)
          ?.receiver.track.kind;
        sender
          .replaceTrack(
            stream?.getTracks().find((t) => t.kind === kind) || null,
          )
          .catch(() => {});
      }
    }
  }, [stream]);

  useEffect(() => {
    if (!joined) return;
    if (DEMO) {
      setParticipants([joined.participant]);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let cursor = 0;
    let failures = 0;
    const pendingIce = new Map<string, RTCIceCandidateInit[]>();
    async function send(
      target: string,
      kind: string,
      payload: Record<string, unknown>,
    ) {
      await api.action(id, joined!.token, "signal", {
        target_id: target,
        kind,
        payload,
      });
    }
    function peer(person: Participant) {
      const existing = peers.current.get(person.id);
      if (existing) return existing;
      let iceServers: RTCIceServer[] = [
        { urls: "stun:stun.l.google.com:19302" },
      ];
      try {
        if (process.env.NEXT_PUBLIC_ICE_SERVERS)
          iceServers = JSON.parse(process.env.NEXT_PUBLIC_ICE_SERVERS);
      } catch {
        setError("The connection server configuration is invalid.");
      }
      const pc = new RTCPeerConnection({ iceServers });
      // Only the caller creates transceivers. The answering peer binds its tracks
      // to the transceivers created by the remote offer, avoiding recv-only answers.
      if (joined!.participant.id < person.id) {
        for (const kind of ["audio", "video"] as const) {
          const track = currentStream.current
            ?.getTracks()
            .find((t) => t.kind === kind);
          pc.addTransceiver(track || kind, {
            direction: "sendrecv",
            streams: currentStream.current ? [currentStream.current] : [],
          });
        }
      }
      pc.onicecandidate = (e) => {
        if (e.candidate)
          send(
            person.id,
            "ice",
            e.candidate.toJSON() as Record<string, unknown>,
          ).catch(() =>
            setError("Could not negotiate the connection. Check your network."),
          );
      };
      pc.ontrack = (e) => {
        setRemotes((old) => {
          const remoteStream = old[person.id]?.stream || new MediaStream();
          if (!remoteStream.getTracks().some((t) => t.id === e.track.id))
            remoteStream.addTrack(e.track);
          return {
            ...old,
            [person.id]: {
              participant: person,
              stream: remoteStream,
              connection: pc.connectionState,
            },
          };
        });
      };
      pc.onconnectionstatechange = () => {
        setRemotes((old) => ({
          ...old,
          [person.id]: {
            participant:
              latestPeople.current.find((p) => p.id === person.id) || person,
            stream: old[person.id]?.stream || null,
            connection: pc.connectionState,
          },
        }));
      };
      peers.current.set(person.id, pc);
      return pc;
    }
    async function receive(signal: Signal, people: Participant[]) {
      const person = people.find((p) => p.id === signal.sender_id);
      if (!person) return;
      const pc = peer(person);
      if (signal.kind === "offer") {
        await pc.setRemoteDescription(
          signal.payload as unknown as RTCSessionDescriptionInit,
        );
        for (const transceiver of pc.getTransceivers()) {
          const track = currentStream.current
            ?.getTracks()
            .find((t) => t.kind === transceiver.receiver.track.kind);
          await transceiver.sender.replaceTrack(track || null);
          if (currentStream.current)
            transceiver.sender.setStreams(currentStream.current);
          transceiver.direction = "sendrecv";
        }
        for (const candidate of pendingIce.get(person.id) || [])
          await pc.addIceCandidate(candidate);
        pendingIce.delete(person.id);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await send(person.id, "answer", { type: answer.type, sdp: answer.sdp });
      } else if (signal.kind === "answer") {
        if (pc.signalingState !== "have-local-offer") return;
        await pc.setRemoteDescription(
          signal.payload as unknown as RTCSessionDescriptionInit,
        );
        for (const candidate of pendingIce.get(person.id) || [])
          await pc.addIceCandidate(candidate);
        pendingIce.delete(person.id);
      } else if (signal.kind === "ice") {
        if (pc.remoteDescription)
          await pc.addIceCandidate(signal.payload as RTCIceCandidateInit);
        else
          pendingIce.set(person.id, [
            ...(pendingIce.get(person.id) || []),
            signal.payload as RTCIceCandidateInit,
          ]);
      }
    }
    async function poll() {
      try {
        const state = await api.state(id, joined!.token, cursor);
        if (stopped) return;
        failures = 0;
        setError("");
        setParticipants(state.participants);
        setMessages(state.messages);
        latestPeople.current = state.participants;
        if (state.status === "ended") {
          for (const pc of peers.current.values()) pc.close();
          peers.current.clear();
          setEnded(true);
          return;
        }
        for (const [personId, pc] of peers.current) {
          if (!state.participants.some((p) => p.id === personId)) {
            pc.close();
            peers.current.delete(personId);
            setRemotes((old) => {
              const next = { ...old };
              delete next[personId];
              return next;
            });
          }
        }
        for (const person of state.participants) {
          if (person.id === joined!.participant.id) continue;
          const isNew = !peers.current.has(person.id);
          const pc = peer(person);
          setRemotes((old) => ({
            ...old,
            [person.id]: {
              participant: person,
              stream: old[person.id]?.stream || null,
              connection: pc.connectionState,
            },
          }));
          // A deterministic caller prevents simultaneous offers (WebRTC glare).
          if (isNew && joined!.participant.id < person.id) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await send(person.id, "offer", {
              type: offer.type,
              sdp: offer.sdp,
            });
          }
        }
        for (const signal of state.signals) {
          await receive(signal, state.participants);
          cursor = signal.id;
        }
      } catch (e) {
        failures++;
        setError((e as Error).message);
        if (/removed|ended|expired/i.test((e as Error).message)) {
          for (const pc of peers.current.values()) pc.close();
          peers.current.clear();
          setEnded(true);
          return;
        }
      }
      if (!stopped)
        timer = setTimeout(poll, Math.min(1000 * Math.max(1, failures), 5000));
    }
    poll();
    const openPeers = peers.current;
    return () => {
      stopped = true;
      clearTimeout(timer);
      for (const pc of openPeers.values()) pc.close();
      openPeers.clear();
    };
  }, [id, joined]);

  const action = useCallback(
    async (name: string, payload: Record<string, unknown> = {}) => {
      if (!joined) return;
      try {
        await api.action(id, joined.token, name, payload);
        if (DEMO && name === "chat")
          setMessages((old) => [
            ...old,
            {
              id: Date.now(),
              name: joined.participant.name,
              content: String(payload.content),
              created_at: new Date().toISOString(),
            },
          ]);
        if (DEMO && name === "update")
          setParticipants((old) =>
            old.map((p) =>
              p.id === joined.participant.id ? { ...p, ...payload } : p,
            ),
          );
      } catch (e) {
        setError((e as Error).message);
        throw e;
      }
    },
    [id, joined],
  );
  return { participants, remotes, messages, error, ended, action };
}
