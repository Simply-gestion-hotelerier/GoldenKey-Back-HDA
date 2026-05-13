"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
const jwt_1 = require("../auth/jwt");
const db_1 = require("../db");
const rbac_1 = require("../auth/rbac");
async function authenticate(req, res, next) {
    try {
        const auth = req.headers.authorization || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
        if (!token)
            return res.status(401).json({ error: "Missing token" });
        const payload = (0, jwt_1.verifyToken)(token);
        const user = await db_1.prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user)
            return res.status(401).json({ error: "Invalid token" });
        req.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            scopes: payload.scopes?.length ? payload.scopes : (0, rbac_1.scopesForRole)(user.role),
        };
        next();
    }
    catch (e) {
        return res.status(401).json({ error: "Unauthorized" });
    }
}
