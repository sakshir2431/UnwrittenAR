import React, { useEffect, useRef, useState } from "react";
import { db, storage } from "./firebaseConfig";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export default function AudioRecorder({ roomId, onDone, onBack }) {
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [blobUrl, setBlobUrl] = useState(null);
  const [blob, setBlob] = useState(null);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef(null);

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
    chunksRef.current = [];
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onstop = () => {
      const b = new Blob(chunksRef.current, { type: "audio/webm" });
      setBlob(b);
      setBlobUrl(URL.createObjectURL(b));
    };
    mr.start(100);
    mediaRecorderRef.current = mr;
    setRecording(true);
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  };

  const stop = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      mediaRecorderRef.current = null;
    }
    setRecording(false);
    clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const save = async () => {
    if (!blob) return;
    setSaving(true);
    try {
      const audioRef = ref(
        storage,
        `rooms/${roomId}/audio/${Date.now()}-note.webm`
      );
      await uploadBytes(audioRef, blob);
      const audioUrl = await getDownloadURL(audioRef);
      await addDoc(collection(db, "clips"), {
        roomId,
        type: "audio",
        url: audioUrl,
        createdAt: serverTimestamp(),
      });
      onDone?.({ type: "audio", url: audioUrl });
    } catch (e) {
      alert("Failed to save audio: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      <div
        className="row"
        style={{ alignItems: "center", justifyContent: "space-between" }}
      >
        <h3 style={{ margin: 0 }}>Voice Note</h3>
        <span className="badge">
          Room: <span className="kbd">{roomId || "—"}</span>
        </span>
      </div>

      {!recording && !blobUrl && (
        <button onClick={start} className="ok">
          🎙️ Start Recording
        </button>
      )}

      {recording && (
        <>
          <div className="badge">⏱ {seconds}s recording…</div>
          <button onClick={stop} className="warn">
            ⏹ Stop
          </button>
        </>
      )}

      {blobUrl && !recording && (
        <>
          <audio controls src={blobUrl} style={{ width: "100%" }} />
          <div className="row" style={{ gap: 8 }}>
            <button
              onClick={() => {
                setBlob(null);
                setBlobUrl(null);
              }}
              className="ghost"
            >
              ↺ Re-record
            </button>
            <button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save to Room"}
            </button>
          </div>
        </>
      )}

      <hr className="sep" />
      <button onClick={onBack} className="ghost">
        ← Back
      </button>
    </div>
  );
}
