import type { Express, Request, Response, RequestHandler } from "express";
import { v4 as uuidv4 } from "uuid";
import { log } from "../logger.js";

export function createImageRoutes(
  app: Express,
  deps: {
    database: any;
    upload: { single: (fieldName: string) => RequestHandler };
  }
): void {
  const { database, upload } = deps;

  app.post("/api/images/upload", upload.single("file"), (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    const sessionId = req.body?.session_id;
    if (!sessionId) {
      res.status(400).json({ error: "session_id required" });
      return;
    }

    const allowedTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);
    if (!allowedTypes.has(req.file.mimetype)) {
      res.status(400).json({ error: `Unsupported image type: ${req.file.mimetype}` });
      return;
    }

    if (req.file.size > 10 * 1024 * 1024) {
      res.status(400).json({ error: "File too large (max 10MB)" });
      return;
    }

    const imageId = uuidv4();
    try {
      const meta = database.storeImage(
        imageId,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        req.file.buffer,
        sessionId,
      );
      res.json(meta);
    } catch (err) {
      log.error("Failed to store image", { sessionId, filename: req.file?.originalname, error: String(err) });
      res.status(500).json({ error: "Failed to store image" });
    }
  });

  app.get("/api/images/:imageId", (req: Request, res: Response) => {
    try {
      const image = database.getImage(req.params.imageId);
      if (!image) {
        res.status(404).json({ error: "Image not found" });
        return;
      }
      res.set("Content-Type", image.mime_type as string);
      res.set("Content-Disposition", `inline; filename="${image.filename}"`);
      res.send(image.data as Buffer);
    } catch (err) {
      log.error("Failed to retrieve image", { imageId: req.params.imageId, error: String(err) });
      res.status(500).json({ error: "Failed to retrieve image" });
    }
  });
}
