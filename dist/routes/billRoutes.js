"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const billController_1 = require("../controllers/billController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const multer_1 = require("../config/multer");
const router = express_1.default.Router();
router.use(authMiddleware_1.authenticate);
// Bill CRUD routes
router.post("/", (0, authMiddleware_1.authorize)(["admin", "super_admin", "accountant"]), multer_1.upload.array("attachments", 10), billController_1.createBill);
router.get("/", billController_1.getBills); // Supports year, month, type, shop, vehicle, amount range, search filters
router.get("/summary", billController_1.getFinancialSummary); // Financial aggregation data
router.get("/statistics", billController_1.getBillStatistics); // Detailed statistics
router.get("/export/excel", billController_1.exportBillsToExcel);
router.get("/:id", billController_1.getBill); // Get single bill by ID
router.put("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "accountant"]), multer_1.upload.array("attachments", 10), billController_1.updateBill);
router.delete("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "accountant"]), billController_1.deleteBill);
exports.default = router;
//# sourceMappingURL=billRoutes.js.map