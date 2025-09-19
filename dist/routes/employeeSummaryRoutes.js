"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const employeeSummaryController_1 = require("../controllers/employeeSummaryController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
// Apply authentication to all routes
router.use(authMiddleware_1.authenticate);
// Get employee summary
router.get("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance", "engineer", "supervisor"]), employeeSummaryController_1.getEmployeeSummary);
exports.default = router;
//# sourceMappingURL=employeeSummaryRoutes.js.map