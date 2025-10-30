import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { db, storage } from "./firebaseConfig";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
  orderBy,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import AudioRecorder from "./AudioRecorder";
import jsQR from "jsqr";

const SCREENS = {
  HOME: "HOME",
  SCAN: "SCAN",
  VOICE: "VOICE",
  SUBMIT: "SUBMIT",
  IMMERSIVE: "IMMERSIVE",
};

export default function App() {
  const [screen, setScreen] = useState(SCREENS.HOME);
  const [roomId, setRoomId] = useState(
    () => new URLSearchParams(location.search).get("room") || ""
  );
  const [cameraAllowed, setCameraAllowed] = useState(false);

  // SCAN (QR)
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);

  // upload form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [uploading, setUploading] = useState(false);
  const [videoFile, setVideoFile] = useState(null);
  const [glbFile, setGlbFile] = useState(null);

  // clip list
  const [clips, setClips] = useState([]);
  // immersive experiences (GLB+audio or immersive video)
  const immersiveIframeRef = useRef(null);
  const [experiences, setExperiences] = useState([]);
  const [selectedExperience, setSelectedExperience] = useState(null);

  const ensureRoom = () => {
    if (!roomId.trim()) {
      const fallback = "demo-room";
      setRoomId(fallback);
      history.replaceState({}, "", `/?room=${encodeURIComponent(fallback)}`);
      return fallback;
    }
    return roomId.trim();
  };

  // Load clips whenever room changes
  useEffect(() => {
    const rid = roomId.trim();
    if (!rid) return;
    (async () => {
      const q = query(
        collection(db, "clips"),
        where("roomId", "==", rid),
        orderBy("createdAt", "desc")
      );
      const snap = await getDocs(q);
      setClips(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    })();
  }, [roomId]);

  // ====== SCAN: QR reader that redirects ======
  useEffect(() => {
    if (screen !== SCREENS.SCAN) return;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        streamRef.current = stream;
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraAllowed(true);

        const loop = () => {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (video && canvas) {
            const w = (canvas.width = video.videoWidth || 640);
            const h = (canvas.height = video.videoHeight || 480);
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const code = jsQR(img.data, w, h, {
              inversionAttempts: "dontInvert",
            });
            if (code?.data) {
              // stop camera and redirect
              try {
                stream.getTracks().forEach((t) => t.stop());
              } catch {}
              cancelAnimationFrame(rafRef.current);
              // Add a tiny UX pause (optional)
              setTimeout(() => {
                window.location.href = code.data;
              }, 150);
              return;
            }
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      } catch {
        setCameraAllowed(false);
      }
    };

    start();

    return () => {
      cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((t) => t.stop());
        } catch {}
      }
    };
  }, [screen]);

  const postToImmersive = (payload) => {
    const win = immersiveIframeRef.current?.contentWindow;
    if (win) win.postMessage({ type: "experience", payload }, "*");
  };

  // Load experiences for IMMERSIVE screen
  useEffect(() => {
    const rid = roomId.trim();
    if (!rid) return;
    if (screen !== SCREENS.IMMERSIVE) return;
    (async () => {
      const q = query(
        collection(db, "experiences"),
        where("roomId", "==", rid),
        orderBy("createdAt", "desc")
      );
      const snap = await getDocs(q);
      setExperiences(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    })();
  }, [screen, roomId]);

  // When an immersive iframe is present, send the selected experience
  useEffect(() => {
    if (screen !== SCREENS.IMMERSIVE) return;
    if (!selectedExperience) return;
    const iframe = immersiveIframeRef.current;
    if (!iframe) return;
    const onLoad = () => postToImmersive(selectedExperience);
    iframe.addEventListener("load", onLoad);
    // also try immediate post in case it's already loaded
    postToImmersive(selectedExperience);
    return () => iframe.removeEventListener("load", onLoad);
  }, [screen, selectedExperience]);

  const handleUpload = async () => {
    const rid = ensureRoom();
    if (!name || !email) return alert("Add your name and email.");
    if (!videoFile && !glbFile) return alert("Select a video or a GLB.");
    setUploading(true);
    try {
      let doc = {
        roomId: rid,
        authorName: name,
        authorEmail: email,
        createdAt: serverTimestamp(),
      };
      if (videoFile) {
        const vref = ref(
          storage,
          `rooms/${rid}/videos/${Date.now()}-${videoFile.name}`
        );
        await uploadBytes(vref, videoFile);
        doc.type = "video";
        doc.url = await getDownloadURL(vref);
      } else if (glbFile) {
        const gref = ref(
          storage,
          `rooms/${rid}/glb/${Date.now()}-${glbFile.name}`
        );
        await uploadBytes(gref, glbFile);
        doc.type = "glb";
        doc.url = await getDownloadURL(gref);
      }
      await addDoc(collection(db, "clips"), doc);
      alert("Uploaded!");
      setVideoFile(null);
      setGlbFile(null);

      const q = query(
        collection(db, "clips"),
        where("roomId", "==", rid),
        orderBy("createdAt", "desc")
      );
      const snap = await getDocs(q);
      const next = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setClips(next);
    } catch (e) {
      alert("Upload failed: " + e.message);
    } finally {
      setUploading(false);
    }
  };

  // Derived examples (kept if needed later)

  return (
    <div className="app">
      <h2 style={{ marginTop: 0 }}>Unwritten — AR</h2>
      <div className="badge" style={{ marginBottom: 12 }}>
        Status: {screen}
      </div>

      <AnimatePresence mode="wait">
        {screen === SCREENS.HOME && (
          <motion.div
            key="HOME"
            className="card"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            style={{ display: "grid", gap: 12 }}
          >
            <label>Room ID</label>
            <input
              placeholder="Room ID"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />

            <div className="row">
              <button
                onClick={() => {
                  ensureRoom();
                  setScreen(SCREENS.SCAN);
                }}
              >
                Scan Space
              </button>
              <button
                className="ghost"
                onClick={() => {
                  ensureRoom();
                  setScreen(SCREENS.IMMERSIVE);
                }}
              >
                watch videos
              </button>
              {/* Removed: Generate QR */}
            </div>

            <hr className="sep" />

            <div className="row">
              <button
                className="ok"
                onClick={() => {
                  ensureRoom();
                  setScreen(SCREENS.SUBMIT);
                }}
              >
                Submit Video/GLB
              </button>
              <button
                onClick={() => {
                  ensureRoom();
                  setScreen(SCREENS.VOICE);
                }}
              >
                Record Audio/Video
              </button>
            </div>

            {!!clips.length && (
              <>
                <hr className="sep" />
                <b>Recent in room “{roomId || "demo-room"}”</b>
                <div className="row" style={{ width: "100%" }}>
                  {clips.slice(0, 6).map((c) => (
                    <div
                      key={c.id}
                      className="card"
                      style={{
                        flex: "1 1 240px",
                        display: "grid",
                        gap: 6,
                        background: "#171a25",
                      }}
                    >
                      <div className="badge">
                        {c.type?.toUpperCase()} •{" "}
                        {new Date(
                          c.createdAt?.seconds
                            ? c.createdAt.seconds * 1000
                            : Date.now()
                        ).toLocaleString()}
                      </div>
                      <div style={{ wordBreak: "break-all", color: "#9aa0ae" }}>
                        {c.url}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </motion.div>
        )}

        {screen === SCREENS.SCAN && (
          <motion.div
            key="SCAN"
            className="card"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            style={{ display: "grid", gap: 12 }}
          >
            <b>Scan a QR code to enter a space</b>
            <div className="row" style={{ alignItems: "center" }}>
              <span className="badge">
                Camera: {cameraAllowed ? "✅ Allowed" : "⏳ Requesting…"}
              </span>
              <span className="badge">Tip: Hold ~15–25cm away</span>
            </div>

            {/* Live camera preview */}
            <video
              ref={videoRef}
              className="preview"
              muted
              playsInline
              autoPlay
            />

            {/* Hidden canvas for QR processing */}
            <canvas ref={canvasRef} style={{ display: "none" }} />

            <div className="row">
              <button className="ghost" onClick={() => setScreen(SCREENS.HOME)}>
                ← Back
              </button>
            </div>
          </motion.div>
        )}

        {screen === SCREENS.VOICE && (
          <motion.div
            key="VOICE"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <AudioRecorder
              roomId={roomId || "demo-room"}
              onBack={() => setScreen(SCREENS.HOME)}
              onDone={() => setScreen(SCREENS.HOME)}
            />
          </motion.div>
        )}

        {screen === SCREENS.SUBMIT && (
          <motion.div
            key="SUBMIT"
            className="card"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            style={{ display: "grid", gap: 12 }}
          >
            <b>Submit a Video or GLB</b>
            <div className="row">
              <div style={{ flex: 1 }}>
                <label>Your Name</label>
                <input
                  placeholder="Sakshi Rane"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label>Email</label>
                <input
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="row">
              <div className="card" style={{ flex: 1 }}>
                <label>Video (mp4, webm)</label>
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) => {
                    setVideoFile(e.target.files?.[0] || null);
                    setGlbFile(null);
                  }}
                />
              </div>
              <div className="card" style={{ flex: 1 }}>
                <label>3D Avatar (GLB)</label>
                <input
                  type="file"
                  accept=".glb"
                  onChange={(e) => {
                    setGlbFile(e.target.files?.[0] || null);
                    setVideoFile(null);
                  }}
                />
              </div>
            </div>

            {videoFile && (
              <video
                className="preview"
                src={URL.createObjectURL(videoFile)}
                controls
              />
            )}

            <div className="row">
              <button className="ghost" onClick={() => setScreen(SCREENS.HOME)}>
                ← Back
              </button>
              <button disabled={uploading} onClick={handleUpload}>
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>
          </motion.div>
        )}

        {/* REVEAL screen removed per request */}

        {screen === SCREENS.IMMERSIVE && (
          <motion.div
            key="IMMERSIVE"
            className="card"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            style={{ display: "grid", gap: 12 }}
          >
            <b>Immersive AR Experiences</b>
            <p style={{ color: "#9aa0ae", margin: 0 }}>
              Pick an experience to view in AR.
            </p>

            <div className="row" style={{ width: "100%" }}>
              {experiences.length === 0 ? (
                <div className="badge">No experiences yet.</div>
              ) : (
                experiences.map((ex) => (
                  <div
                    key={ex.id}
                    className="card"
                    style={{ flex: "1 1 280px", background: "#171a25" }}
                  >
                    <div className="badge" style={{ marginBottom: 8 }}>
                      {new Date(
                        ex.createdAt?.seconds
                          ? ex.createdAt.seconds * 1000
                          : Date.now()
                      ).toLocaleString()}
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <b style={{ color: "#e7e7ea" }}>{ex.title || "Untitled"}</b>
                      {ex.thumbUrl && (
                        <img
                          src={ex.thumbUrl}
                          alt={ex.title || "thumb"}
                          style={{ width: "100%", borderRadius: 10 }}
                        />
                      )}
                      <small style={{ color: "#9aa0ae" }}>
                        {ex.videoUrl ? "Immersive video" : "GLB + Audio"}
                      </small>
                      <button onClick={() => setSelectedExperience(ex)} className="ok">
                        View in AR
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {selectedExperience && (
              <div className="iframe-wrap" style={{ marginTop: 8 }}>
                <iframe
                  ref={immersiveIframeRef}
                  src={`/ar/experience.html#${encodeURIComponent(roomId || "demo-room")}`}
                  allow="camera *; microphone *; xr-spatial-tracking; fullscreen"
                  title="Immersive Experience"
                ></iframe>
                <div className="scan-frame"></div>
              </div>
            )}

            <div className="row">
              <button className="ghost" onClick={() => setScreen(SCREENS.HOME)}>
                ← Back
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
