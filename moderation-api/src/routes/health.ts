import { Router } from "express";
import { HashStore } from "../store";

export function buildHealthRoutes(hashStore: HashStore): Router {
  const router = Router();

  router.get("/health", async (_req, res) => {
    res.status(200).json({
      status: "ok",
      hashCount: await hashStore.count(),
      time: new Date().toISOString(),
    });
  });

  return router;
}
