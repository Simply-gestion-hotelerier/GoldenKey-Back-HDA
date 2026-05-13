"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jwt_1 = require("../auth/jwt");
const rbac_1 = require("../auth/rbac");
const r = (0, express_1.Router)();
r.post("/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ error: "email and password are required" });
    const user = await db_1.prisma.user.findUnique({ where: { email } });
    if (!user)
        return res.status(401).json({ error: "Invalid credentials" });
    let ok = false;
    if (user.password.startsWith("$2")) {
        ok = await bcrypt_1.default.compare(password, user.password).catch(() => false);
    }
    else {
        ok = password === user.password;
    }
    if (!ok)
        return res.status(401).json({ error: "Invalid credentials" });
    const scopes = (0, rbac_1.scopesForRole)(user.role);
    const token = (0, jwt_1.signToken)({ sub: user.id, email: user.email, role: user.role, scopes });
    return res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, scopes },
    });
});
const auth_1 = require("../middleware/auth");
r.get("/me", auth_1.authenticate, async (req, res) => {
    const user = req.user;
    if (!user)
        return res.status(401).json({ error: "Unauthorized" });
    const db = await db_1.prisma.user.findUnique({ where: { id: user.id } });
    if (!db)
        return res.status(401).json({ error: "Unauthorized" });
    return res.json({ id: db.id, email: db.email, name: db.name, role: db.role, scopes: user.scopes });
});
exports.default = r;
