"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedSuperAdmin = void 0;
const db_1 = require("../config/db");
const userModel_1 = require("../models/userModel");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const SALT_ROUNDS = 10;
const seedSuperAdmin = async () => {
    try {
        // Connect to database
        await (0, db_1.connectDb)();
        const superAdminData = {
            email: "superadmin@example.com", // Change this to your desired email
            password: "SuperAdmin@123", // Change this to a strong password
            phoneNumbers: ["+1234567890"], // Change to actual phone number
            firstName: "Super",
            lastName: "Admin",
            role: "super_admin",
            isActive: true,
        };
        // Check if super admin already exists
        const existingSuperAdmin = await userModel_1.User.findOne({ role: "super_admin" });
        if (existingSuperAdmin) {
            console.log("Super admin already exists");
            return;
        }
        // Hash password
        const hashedPassword = await bcryptjs_1.default.hash(superAdminData.password, SALT_ROUNDS);
        // Create super admin
        const superAdmin = await userModel_1.User.create({
            ...superAdminData,
            password: hashedPassword,
            // No createdBy since this is the first user
        });
        console.log("Super admin created successfully:");
        console.log({
            _id: superAdmin._id,
            email: superAdmin.email,
            role: superAdmin.role,
            createdAt: superAdmin.createdAt,
        });
    }
    catch (error) {
        console.error("Error seeding super admin:", error);
        process.exit(1);
    }
};
exports.seedSuperAdmin = seedSuperAdmin;
//# sourceMappingURL=seeder.js.map