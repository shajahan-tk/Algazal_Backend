"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const monthlyReportController_1 = require("../controllers/monthlyReportController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
router.use(authMiddleware_1.authenticate);
// Report routes
router.get("/monthly", (0, authMiddleware_1.authorize)(["admin", "super_admin", "accountant"]), monthlyReportController_1.generateMonthlyReport);
router.get("/yearly", (0, authMiddleware_1.authorize)(["admin", "super_admin", "accountant"]), monthlyReportController_1.generateYearlyReport);
exports.default = router;
//# sourceMappingURL=reportRoutes.js.map