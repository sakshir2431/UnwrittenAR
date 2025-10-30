import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import { fetch } from "undici";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export const ingestMyWebAR = onRequest({ cors: true, timeoutSeconds: 30 }, async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    const { roomId, url, title, thumbUrl } = req.body || {};
    if (!roomId || !url) {
      return res.status(400).json({ error: "roomId and url are required" });
    }
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "Invalid URL" });
    }

    const head = await fetch(url, { method: "HEAD" }).catch(() => null);
    if (!head || !head.ok) {
      logger.warn("HEAD check failed", { status: head?.status });
      // proceed but warn; some hosts may block HEAD
    }

    const doc = {
      roomId,
      title: title || "External AR",
      externalUrl: url,
      thumbUrl: thumbUrl || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const ref = await db.collection("experiences").add(doc);
    return res.status(200).json({ id: ref.id, ...doc });
  } catch (e) {
    logger.error("ingestMyWebAR failed", e);
    return res.status(500).json({ error: "Internal error" });
  }
});
