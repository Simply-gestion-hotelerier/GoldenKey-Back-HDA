"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireScope = requireScope;
const rbac_1 = require("../auth/rbac");
function requireScope(...required) {
    return (req, res, next) => {
        const user = req.user;
        if (!user)
            return res.status(401).json({ error: "Unauthorized" });
        if (!(0, rbac_1.hasScopes)(user.scopes, required)) {
            return res.status(403).json({ error: "Forbidden", required });
        }
        next();
    };
}
