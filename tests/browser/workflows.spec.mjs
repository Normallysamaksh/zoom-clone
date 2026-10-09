import { test, expect } from "@playwright/test";

test("schedule persists, validates joins, and works on mobile", async ({
  page,
  request,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /Good (morning|afternoon|evening), Alex/,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Schedule Make time to connect", exact: true })
    .click();
  const topic = `Planning ${Date.now()}`;
  await page.getByRole("textbox", { name: "Topic", exact: true }).fill(topic);
  await page
    .getByRole("textbox", { name: /Description/ })
    .fill("Confirm priorities for the coming sprint.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("You’re all set!", { exact: true }),
  ).toBeVisible();
  const stored = (await (await request.get("/api/v1/meetings")).json()).find(
    (m) => m.title === topic,
  );
  expect(stored.status).toBe("scheduled");
  expect(stored.description).toBe("Confirm priorities for the coming sprint.");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Meetings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: topic, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Join Connect with a meeting ID",
      exact: true,
    })
    .click();
  await page
    .getByRole("textbox", { name: "Meeting ID or invitation link" })
    .fill("99999999999");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Join", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Meeting not found",
  );
  await page
    .getByRole("textbox", { name: "Meeting ID or invitation link" })
    .fill(`http://127.0.0.1:3000/j/${stored.id}`);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Join", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ready to join?" }),
  ).toBeVisible();
  await page.goto("/");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Meetings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: topic, exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const mute = page.getByRole("switch", { name: /Mute my microphone/ });
  await mute.check();
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(mute).toBeChecked();
  expect(errors).toEqual([]);
});

test("instant meeting creation redirects and creates a shareable ID", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /New meeting Start an instant meeting/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ready to join?" }),
  ).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").pop();
  expect(id).toMatch(/^\d{11}$/);
  expect(
    (await (await request.get(`/api/v1/meetings/${id}`)).json()).status,
  ).toBe("active");
  expect(
    await page.evaluate((id) => !!localStorage.getItem(`zoom-host-${id}`), id),
  ).toBe(true);
});

test("two peers exchange real audio/video; chat and host controls work", async ({
  playwright,
  request,
}) => {
  test.setTimeout(120000);
  const created = await (
    await request.post("/api/v1/meetings", {
      data: {
        title: `Live test ${Date.now()}`,
        description: "",
        duration: 30,
        scheduled_at: null,
      },
    })
  ).json();
  const id = created.meeting.id;
  const options = {
    channel: "chrome",
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  };
  const hostBrowser = await playwright.chromium.launch(options);
  const guestBrowser = await playwright.chromium.launch(options);
  const hostContext = await hostBrowser.newContext({
    permissions: ["camera", "microphone"],
  });
  const guestContext = await guestBrowser.newContext({
    permissions: ["camera", "microphone"],
  });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const errors = [];
  host.on("pageerror", (e) => errors.push(e.message));
  guest.on("pageerror", (e) => errors.push(e.message));
  await host.addInitScript(
    ({ id, token }) => localStorage.setItem(`zoom-host-${id}`, token),
    { id, token: created.host_token },
  );
  for (const context of [hostContext, guestContext]) {
    await context.addInitScript(() => {
      // Synthetic inputs avoid Windows Chrome's fake-camera service ending tracks.
      // The real RTCPeerConnection, signaling, encoding and network stay untouched.
      navigator.mediaDevices.getUserMedia = async function (options) {
        const tracks = [];
        if (options.video) {
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 360;
          const paint = () => {
            const context = canvas.getContext("2d");
            context.fillStyle = "#214d87";
            context.fillRect(0, 0, 640, 360);
            context.fillStyle = "#ffffff";
            context.font = "30px sans-serif";
            context.fillText(
              "Test camera - " + new Date().toLocaleTimeString(),
              45,
              180,
            );
          };
          paint();
          setInterval(paint, 66);
          tracks.push(...canvas.captureStream(15).getVideoTracks());
        }
        if (options.audio) {
          const context = new AudioContext();
          await context.resume();
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const destination = context.createMediaStreamDestination();
          gain.gain.value = 0.01;
          oscillator.connect(gain).connect(destination);
          oscillator.start();
          tracks.push(...destination.stream.getAudioTracks());
          window.__testAudioContext = context;
        }
        return new MediaStream(tracks);
      };
      navigator.mediaDevices.getDisplayMedia = async function () {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const draw = () => {
          const context = canvas.getContext("2d");
          context.fillStyle = "#12834c";
          context.fillRect(0, 0, 640, 360);
          context.fillStyle = "white";
          context.font = "30px sans-serif";
          context.fillText("Shared screen " + Date.now(), 35, 180);
        };
        draw();
        setInterval(draw, 66);
        return canvas.captureStream(15);
      };
      const Original = window.RTCPeerConnection;
      window.__testPeers = [];
      window.RTCPeerConnection = class extends Original {
        constructor(config) {
          super(config);
          window.__testPeers.push(this);
        }
      };
    });
  }
  for (const [page, name] of [
    [host, "Test Host"],
    [guest, "Test Guest"],
  ]) {
    await page.goto(
      `http://127.0.0.1:3000/j/${id}?name=${encodeURIComponent(name)}`,
    );
    await expect(
      page.getByRole("heading", { name: "Ready to join?" }),
    ).toBeVisible();
    await expect
      .poll(
        () =>
          page
            .locator(".camera-preview video")
            .evaluateAll((videos) => videos.some((v) => v.videoWidth > 0)),
        { timeout: 20000 },
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "Join meeting", exact: true })
      .click();
    await expect(page.locator(".stage-title")).toContainText(
      "You’re connected",
    );
  }
  for (const page of [host, guest]) {
    await expect(page.locator(".video-tile")).toHaveCount(2);
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const stats = await Promise.all(
              window.__testPeers.map((p) => p.getStats()),
            );
            const inbound = stats
              .flatMap((report) => [...report.values()])
              .filter((s) => s.type === "inbound-rtp" && s.bytesReceived > 0);
            return {
              video: inbound.some((s) => s.kind === "video"),
              audio: inbound.some((s) => s.kind === "audio"),
              connections: window.__testPeers.map((p) => p.connectionState),
              stats: stats
                .flatMap((report) => [...report.values()])
                .filter(
                  (s) => s.type === "inbound-rtp" || s.type === "outbound-rtp",
                )
                .map((s) => ({
                  type: s.type,
                  kind: s.kind,
                  sent: s.bytesSent,
                  received: s.bytesReceived,
                  frames: s.framesDecoded,
                })),
              localTracks: [
                ...(document
                  .querySelector(".self video")
                  ?.srcObject?.getTracks() || []),
              ].map((t) => ({
                kind: t.kind,
                readyState: t.readyState,
                enabled: t.enabled,
              })),
            };
          }),
        {
          timeout: 30000,
          message: "Both audio and video arrive from the other browser",
        },
      )
      .toMatchObject({ audio: true, video: true });
  }
  await host.screenshot({
    path: "output/screenshots/live-call-tested.png",
    fullPage: true,
  });
  await host.getByRole("button", { name: "Share screen", exact: true }).click();
  await expect(host.locator(".stage-title")).toContainText(
    "You are sharing your screen",
  );
  await expect
    .poll(() =>
      host.evaluate(() => {
        const track = document
          .querySelector(".self video")
          .srcObject.getVideoTracks()[0];
        return window.__testPeers.some((p) =>
          p.getSenders().some((s) => s.track?.id === track.id),
        );
      }),
    )
    .toBe(true);
  await host.getByRole("button", { name: "Stop share", exact: true }).click();
  await expect(host.locator(".stage-title")).toContainText("You’re connected");
  await guest.getByRole("button", { name: "Chat", exact: true }).click();
  await host.getByRole("button", { name: "Chat", exact: true }).click();
  await guest
    .getByRole("textbox", { name: "Message everyone" })
    .fill("Hello from the other browser");
  await guest.getByRole("button", { name: "Send message" }).click();
  await expect(
    host.getByText("Hello from the other browser", { exact: true }),
  ).toBeVisible();
  await guest.getByRole("button", { name: "Raise hand", exact: true }).click();
  await expect(
    guest.getByRole("button", { name: "Lower hand", exact: true }),
  ).toBeVisible();
  await host.getByRole("button", { name: /Participants/ }).click();
  await host.getByRole("button", { name: "Mute all", exact: true }).click();
  await expect(
    guest.getByRole("button", { name: "Unmute", exact: true }),
  ).toBeVisible();
  expect(
    await guest
      .locator(".video-tile.self video")
      .evaluate((v) => v.srcObject.getAudioTracks().every((t) => !t.enabled)),
  ).toBe(true);
  host.once("dialog", (dialog) => dialog.accept());
  await host
    .getByRole("button", { name: "Remove Test Guest", exact: true })
    .click();
  await expect(
    guest.getByRole("heading", { name: "This meeting has ended" }),
  ).toBeVisible();
  await expect(
    guest.getByText("You were removed from this meeting.", { exact: true }),
  ).toBeVisible();
  await host.getByRole("button", { name: "End", exact: true }).click();
  await host
    .getByRole("button", { name: "End for everyone", exact: true })
    .click();
  await expect(
    host.getByRole("heading", {
      name: /Good (morning|afternoon|evening), Alex/,
    }),
  ).toBeVisible();
  expect(
    (await (await request.get(`/api/v1/meetings/${id}`)).json()).status,
  ).toBe("ended");
  expect(errors).toEqual([]);
  await hostContext.close();
  await guestContext.close();
  await hostBrowser.close();
  await guestBrowser.close();
});

test("denied media permissions still allow joining and leaving", async ({
  page,
  request,
}) => {
  const created = await (
    await request.post("/api/v1/meetings", {
      data: { title: "Permission test", duration: 30 },
    })
  ).json();
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    };
  });
  await page.goto(`/j/${created.meeting.id}?name=Quiet%20Guest`);
  await expect(
    page.getByText(/Camera and microphone access is unavailable/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Join meeting", exact: true }).click();
  await expect(page.locator(".stage-title")).toContainText("You’re connected");
  await expect(
    page.getByRole("button", { name: "Unmute", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start video", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await page
    .getByRole("button", { name: "Leave meeting", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: /Good (morning|afternoon|evening), Alex/,
    }),
  ).toBeVisible();
});

test("saved preview preference can skip the pre-join screen", async ({
  page,
  request,
}) => {
  const created = await (
    await request.post("/api/v1/meetings", {
      data: { title: "Direct join test", duration: 30 },
    })
  ).json();
  await page.addInitScript(() => {
    localStorage.setItem(
      "zoom-preferences",
      JSON.stringify({ muted: true, videoOff: true, preview: false }),
    );
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    };
  });
  await page.goto(`/j/${created.meeting.id}`);
  await expect(page.locator(".stage-title")).toContainText("You’re connected");
  await expect(
    page.getByRole("button", { name: "Unmute", exact: true }),
  ).toBeVisible();
});
