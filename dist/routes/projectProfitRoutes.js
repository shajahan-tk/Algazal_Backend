"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const projectProfitController_1 = require("../controllers/projectProfitController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const multer_1 = require("../config/multer");
const router = express_1.default.Router();
router.use(authMiddleware_1.authenticate);
// IMPORTANT: More specific routes must come BEFORE parameterized routes
router.get("/export/excel", projectProfitController_1.exportProjectProfitsToExcel);
router.get("/summary", projectProfitController_1.getProfitSummary);
router.get("/projects/list", projectProfitController_1.getProjects); // Route for getting projects with LPO data
router.post("/", (0, authMiddleware_1.authorize)(["admin", "super_admin", "accountant"]), multer_1.upload.array("attachments", 10), projectProfitController_1.createProjectProfit);
router.get("/", projectProfitController_1.getProjectProfits);
router.get("/:id", projectProfitController_1.getProjectProfit);
router.put("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "accountant"]), multer_1.upload.array("attachments", 10), projectProfitController_1.updateProjectProfit);
router.delete("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin", "accountant"]), projectProfitController_1.deleteProjectProfit);
exports.default = router;
//# sourceMappingURL=projectProfitRoutes.js.map