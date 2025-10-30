import React, { useEffect, useRef, useState } from "react";
import { db, storage } from "./firebaseConfig";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

// Unified recorder supporting audio-only and video+audio
export default function AudioRecorder({ roomId, onDone, onBack }) {
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const liveVideoRef = useRef(null);

  const [mode, setMode] = useState("audio"); // 'audio' | 'video'
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blobUrl, setBlobUrl] = useState(null);
  const [blob, setBlob] = useState(null);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef(null);

  const pickMimeType = (kind) => {
    const candidates =
      kind === "video"
        ? [
            "video/webm;codecs=vp9,opus",
            "video/webm;codecs=vp8,opus",
            "video/webm",
          ]
        : ["audio/webm;codecs=opus", "audio/webm"];
    for (const t of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported?.(t)) return t;
    }
    return undefined;
  };

  const resetRecording = () => {
    setBlob(null);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    setSeconds(0);
    setIsPaused(false);
  };

  const start = async () => {
    try {
      resetRecording();
      const constraints =
        mode === "video"
          ? {
              video: { width: { ideal: 1280 }, height: { ideal: 720 } },
              audio: true,
            }
          : { audio: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (mode === "video" && liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        await liveVideoRef.current.play().catch(() => {});
      }
      const mimeType = pickMimeType(mode);
      const mr = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const type = mode === "video" ? "video/webm" : "audio/webm";
        const b = new Blob(chunksRef.current, { type });
        setBlob(b);
        setBlobUrl(URL.createObjectURL(b));
      };
      mr.start(250);
      mediaRecorderRef.current = mr;
      setIsRecording(true);
      setIsPaused(false);
      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds((s) => (isPaused ? s : s + 1));
      }, 1000);
    } catch (e) {
      alert("Unable to start recording: " + e.message);
    }
  };

  const pause = () => {
    if (!mediaRecorderRef.current) return;
    if (mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
    }
  };

  const resume = () => {
    if (!mediaRecorderRef.current) return;
    if (mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
    }
  };

  const stop = () => {
    try {
      if (mediaRecorderRef.current && isRecording) {
        mediaRecorderRef.current.stop();
      }
    } finally {
      setIsRecording(false);
      setIsPaused(false);
      clearInterval(timerRef.current);
      timerRef.current = null;
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((t) => t.stop());
        } catch {}
        streamRef.current = null;
      }
      if (liveVideoRef.current) {
        try {
          liveVideoRef.current.pause();
          liveVideoRef.current.srcObject = null;
        } catch {}
      }
    }
  };

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        try {
          mediaRecorderRef.current.stop();
        } catch {}
      }
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((t) => t.stop());
        } catch {}
      }
      if (liveVideoRef.current) {
        try {
          liveVideoRef.current.srcObject = null;
        } catch {}
      }
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!blob) return;
    setSaving(true);
    try {
      const isVideo = mode === "video" && blob.type.startsWith("video");
      const basePath = isVideo ? "videos" : "audio";
      const ext = "webm";
      const path = `rooms/${roomId}/${basePath}/${Date.now()}-recording.${ext}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, blob);
      const url = await getDownloadURL(storageRef);
      await addDoc(collection(db, "clips"), {
        roomId,
        type: isVideo ? "video" : "audio",
        url,
        createdAt: serverTimestamp(),
      });
      onDone?.({ type: isVideo ? "video" : "audio", url });
    } catch (e) {
      alert("Failed to save: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const download = () => {
    if (!blob || !blobUrl) return;
    const isVideo = mode === "video" && blob.type.startsWith("video");
    const ext = "webm";
    const name = isVideo
      ? `video-${Date.now()}.${ext}`
      : `audio-${Date.now()}.${ext}`;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const canToggleMode = !isRecording;

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      <div
        className="row"
        style={{ alignItems: "center", justifyContent: "space-between" }}
      >
        <h3 style={{ margin: 0 }}>Record</h3>
        <span className="badge">
          Room: <span className="kbd">{roomId || "—"}</span>
        </span>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button
          className={mode === "audio" ? "ok" : "ghost"}
          onClick={() => canToggleMode && setMode("audio")}
          disabled={!canToggleMode}
        >
          🎙️ Audio
        </button>
        <button
          className={mode === "video" ? "ok" : "ghost"}
          onClick={() => canToggleMode && setMode("video")}
          disabled={!canToggleMode}
        >
          🎥 Video
        </button>
      </div>
      {/* Preview area */}
      {isRecording && mode === "video" && (
        <video
          ref={liveVideoRef}
          className="preview"
          muted
          playsInline
          autoPlay
        />
      )}
      {!isRecording && blobUrl && mode === "video" && (
        <video className="preview" src={blobUrl} controls />
      )}
      {!isRecording && blobUrl && mode === "audio" && (
        <audio controls src={blobUrl} style={{ width: "100%" }} />
      )}
      {/* Controls */}
      {!isRecording && !blobUrl && (
        <button onClick={start} className="ok">
          {mode === "video" ? "Start Video Recording" : "Start Audio Recording"}
        </button>
      )}{" "}
      {isRecording && (
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <span className="badge">
            ⏱ {seconds}s {isPaused ? "paused" : "recording"}…
          </span>
          {!isPaused ? (
            <button onClick={pause} className="ghost">
              ⏸ Pause
            </button>
          ) : (
            <button onClick={resume} className="ghost">
              ▶️ Resume
            </button>
          )}
          <button onClick={stop} className="warn">
            ⏹ Stop
          </button>
        </div>
      )}
      {!isRecording && blobUrl && (
        <div className="row" style={{ gap: 8 }}>
          <button
            onClick={() => {
              stop();
              resetRecording();
            }}
            className="ghost"
          >
            ↺ Re-record
          </button>
          <button onClick={download} className="ghost">
            ⬇️ Download
          </button>
          <button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save to Room"}
          </button>
        </div>
      )}
      <hr className="sep" />
      <button onClick={onBack} className="ghost">
        ← Back
      </button>
    </div>
  );
}
