"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const vehicleController_1 = require("../controllers/vehicleController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const multer_1 = require("../config/multer");
const router = express_1.default.Router();
router.use(authMiddleware_1.authenticate);
// Vehicle CRUD routes
router.post("/", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), multer_1.upload.array("attachments", 10), vehicleController_1.createVehicle);
router.get("/", vehicleController_1.getVehicles);
router.get("/:id", vehicleController_1.getVehicle);
router.put("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), multer_1.upload.array("attachments", 10), vehicleController_1.updateVehicle);
router.delete("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), vehicleController_1.deleteVehicle);
// Special vehicle routes
router.get("/number/:vehicleNumber", vehicleController_1.getVehicleByNumber);
exports.default = router;
//# sourceMappingURL=vehicleRoutes.js.map