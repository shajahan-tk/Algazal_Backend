"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const employeeExpenseController_1 = require("../controllers/employeeExpenseController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
router.use(authMiddleware_1.authenticate);
router.post("/", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance"]), employeeExpenseController_1.createEmployeeExpense);
router.get("/", employeeExpenseController_1.getEmployeeExpenses);
router.get("/export/excel", employeeExpenseController_1.exportEmployeeExpensesToExcel);
router.get("/:id", employeeExpenseController_1.getEmployeeExpense);
router.put("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance"]), employeeExpenseController_1.updateEmployeeExpense);
router.delete("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "finance"]), employeeExpenseController_1.deleteEmployeeExpense);
exports.default = router;
//# sourceMappingURL=employeeExpenseRoutes.js.map