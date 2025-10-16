"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const expenseController_1 = require("../controllers/expenseController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const multer_1 = require("../config/multer");
const router = express_1.default.Router();
router.use(authMiddleware_1.authenticate);
// Labor data endpoint
router.get("/project/:projectId/labor-data", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer", "finance"]), expenseController_1.getProjectLaborData);
router.post("/project/:projectId", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer", "finance"]), multer_1.upload.fields([
    { name: "files", maxCount: 100 }, // Changed from "materials" to "files"
]), expenseController_1.createExpense);
router.get("/project/:projectId", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer", "finance"]), expenseController_1.getProjectExpenses);
router.get("/project/:projectId/summary", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer", "finance"]), expenseController_1.getExpenseSummary);
router.get("/:expenseId", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer", "finance"]), expenseController_1.getExpenseById);
router.put("/:expenseId", (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer", "finance"]), multer_1.upload.fields([
    { name: "files", maxCount: 100 }, // Changed from "materialFiles" to "files"
]), expenseController_1.updateExpense);
router.delete("/:expenseId", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance"]), expenseController_1.deleteExpense);
router.get("/:id/pdf", authMiddleware_1.authenticate, (0, authMiddleware_1.authorize)(["admin", "super_admin", "engineer", "finance"]), expenseController_1.generateExpensePdf);
exports.default = router;
//# sourceMappingURL=expenseRoutes.js.map