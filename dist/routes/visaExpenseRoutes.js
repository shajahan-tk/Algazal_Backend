"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const visaExpenseController_1 = require("../controllers/visaExpenseController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
router.use(authMiddleware_1.authenticate);
// Visa Expense CRUD routes
router.post("/", (0, authMiddleware_1.authorize)(["admin", "super_admin", "accountant"]), visaExpenseController_1.createVisaExpense);
router.get("/", visaExpenseController_1.getVisaExpenses);
router.get("/export/excel", visaExpenseController_1.exportVisaExpensesToExcel);
router.get("/:id", visaExpenseController_1.getVisaExpense);
router.put("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "accountant"]), visaExpenseController_1.updateVisaExpense);
router.delete("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "accountant"]), visaExpenseController_1.deleteVisaExpense);
exports.default = router;
//# sourceMappingURL=visaExpenseRoutes.js.map