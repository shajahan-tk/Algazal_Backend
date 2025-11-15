"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const payrollController_1 = require("../controllers/payrollController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
// Apply authentication middleware to all routes
router.use(authMiddleware_1.authenticate);
// Create payroll record
router.post("/", (0, authMiddleware_1.authorize)(["admin", "super_admin", "accountant"]), payrollController_1.createPayroll);
// Get all payroll records with filters
router.get("/", payrollController_1.getPayrolls);
// Export payrolls to Excel
router.get("/export/excel", payrollController_1.exportPayrollsToExcel);
// Generate payslip PDF (must come before /:id routes)
router.get("/:id/pdf", (0, authMiddleware_1.authorize)(["super_admin", "admin", "accountant", "finance"]), payrollController_1.generatePayslipPDF);
// Get payslip data (preview) (must come before /:id routes)
router.get("/:id/data", (0, authMiddleware_1.authorize)(["super_admin", "admin", "accountant", "finance"]), payrollController_1.getPayslipData);
// Get single payroll record
router.get("/:id", payrollController_1.getPayroll);
// Update payroll record
router.put("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "accountant"]), payrollController_1.updatePayroll);
// Delete payroll record
router.delete("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "accountant"]), payrollController_1.deletePayroll);
exports.default = router;
//# sourceMappingURL=payrollRoutes.js.map