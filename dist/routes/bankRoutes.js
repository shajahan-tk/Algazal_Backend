"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const bankController_1 = require("../controllers/bankController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const multer_1 = require("../config/multer");
const router = express_1.default.Router();
router.use(authMiddleware_1.authenticate);
// Bank Report CRUD routes
router.post("/", (0, authMiddleware_1.authorize)(["admin", "super_admin", "accountant"]), multer_1.upload.array("attachments", 10), bankController_1.createBankReport);
router.get("/", bankController_1.getBankReports); // Supports year, month, type, shop, category, amount range, search filters
router.get("/summary", bankController_1.getBankFinancialSummary); // Financial aggregation data
router.get("/statistics", bankController_1.getBankReportStatistics); // Detailed statistics
router.get("/export/excel", bankController_1.exportBankReportsToExcel);
router.get("/:id", bankController_1.getBankReport); // Get single report by ID
router.put("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "accountant"]), multer_1.upload.array("attachments", 10), bankController_1.updateBankReport);
router.delete("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "accountant"]), bankController_1.deleteBankReport);
exports.default = router;
//# sourceMappingURL=bankRoutes.js.map