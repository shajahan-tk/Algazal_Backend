"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const clientController_1 = require("../controllers/clientController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
// Apply authentication to all routes
router.use(authMiddleware_1.authenticate);
// Client CRUD routes
router.post("/", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), clientController_1.createClient);
router.get("/", clientController_1.getClients);
router.get("/:id", clientController_1.getClient);
router.put("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), clientController_1.updateClient);
router.delete("/:id", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), clientController_1.deleteClient);
// Special client routes
router.get("/trn/:trnNumber", clientController_1.getClientByTrn);
router.get("/pincode/:pincode", clientController_1.getClientsByPincode);
// Location management routes
router.post("/:id/locations", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), clientController_1.addLocationToClient);
// Building management routes
router.post("/:clientId/locations/:locationId/buildings", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), clientController_1.addBuildingToLocation);
// Apartment management routes
router.post("/:clientId/locations/:locationId/buildings/:buildingId/apartments", (0, authMiddleware_1.authorize)(["admin", "super_admin"]), clientController_1.addApartmentToBuilding);
exports.default = router;
//# sourceMappingURL=clientRoutes.js.map