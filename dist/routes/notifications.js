"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const db_1 = require("../db");
const router = express_1.default.Router();
// List notifications (newest first)
router.get("/", async (_req, res) => {
    try {
        const items = await db_1.prisma.notification.findMany({ orderBy: { createdAt: "desc" } });
        res.json(items);
    }
    catch (e) {
        res.status(500).json({ error: e?.message || "Failed to fetch notifications" });
    }
});
// Mark a notification as read
router.patch("/:id/read", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: "Invalid id" });
    try {
        const updated = await db_1.prisma.notification.update({ where: { id }, data: { read: true } });
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ error: e?.message || "Failed to mark as read" });
    }
});
// Mark all notifications as read
router.post("/mark-all-read", async (_req, res) => {
    try {
        await db_1.prisma.notification.updateMany({ data: { read: true } });
        res.status(204).end();
    }
    catch (e) {
        res.status(500).json({ error: e?.message || "Failed to mark all as read" });
    }
});
// Delete a notification
router.delete("/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id))
        return res.status(400).json({ error: "Invalid id" });
    try {
        await db_1.prisma.notification.delete({ where: { id } });
        res.status(204).end();
    }
    catch (e) {
        res.status(500).json({ error: e?.message || "Failed to delete notification" });
    }
});
exports.default = router;
