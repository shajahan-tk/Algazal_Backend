"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const morgan_1 = __importDefault(require("morgan"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const apiHandlerHelpers_1 = require("./utils/apiHandlerHelpers");
const errorHandler_1 = require("./utils/errorHandler");
const userRoutes_1 = __importDefault(require("./routes/userRoutes"));
const estimationRoutes_1 = __importDefault(require("./routes/estimationRoutes"));
const clientRoutes_1 = __importDefault(require("./routes/clientRoutes"));
const projectRoutes_1 = __importDefault(require("./routes/projectRoutes"));
const commentRoutes_1 = __importDefault(require("./routes/commentRoutes"));
const quotationRoutes_1 = __importDefault(require("./routes/quotationRoutes"));
const lpoRoutes_1 = __importDefault(require("./routes/lpoRoutes"));
const workCompletionRoutes_1 = __importDefault(require("./routes/workCompletionRoutes"));
const attandanceRoutes_1 = __importDefault(require("./routes/attandanceRoutes"));
const expenseRoutes_1 = __importDefault(require("./routes/expenseRoutes"));
const analyticalRoute_1 = __importDefault(require("./routes/analyticalRoute"));
const shopRoutes_1 = __importDefault(require("./routes/shopRoutes"));
const vehicleRoutes_1 = __importDefault(require("./routes/vehicleRoutes"));
const billRoutes_1 = __importDefault(require("./routes/billRoutes"));
const categoryRoutes_1 = __importDefault(require("./routes/categoryRoutes"));
const bankRoutes_1 = __importDefault(require("./routes/bankRoutes"));
const projectProfitRoutes_1 = __importDefault(require("./routes/projectProfitRoutes"));
const employeeExpenseRoutes_1 = __importDefault(require("./routes/employeeExpenseRoutes"));
const payrollRoutes_1 = __importDefault(require("./routes/payrollRoutes"));
const visaExpenseRoutes_1 = __importDefault(require("./routes/visaExpenseRoutes"));
const reportRoutes_1 = __importDefault(require("./routes/reportRoutes"));
const employeeSummaryRoutes_1 = __importDefault(require("./routes/employeeSummaryRoutes"));
const db_1 = require("./config/db");
const seeder_1 = require("./utils/seeder");
dotenv_1.default.config();
const app = (0, express_1.default)();
// app.use(
//   // cors({
//   //   origin: "*", // Allow all origins
//   //   methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], // Allow all common methods
//   //   allowedHeaders: [
//   //     "Content-Type",
//   //     "Authorization",
//   //     "Origin",
//   //     "X-Requested-With",
//   //     "Accept",
//   //   ], // Allow all common headers
//   // })
// );
app.use((0, cors_1.default)({
    origin: "*", // 👈 must be specific, not '*'
    credentials: true, // 👈 required for cookies/auth headers
}));
// app.use(limiter);
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, morgan_1.default)("dev")); // Logging
app.get("/", (req, res) => {
    console.log("Test log route hit"); // This should appear in console
    res.send("Test log");
});
// app.use(helmet()); // Security
app.get("/seed", (_req, res) => {
    (0, seeder_1.seedSuperAdmin)();
    res.send("ok");
});
app.use("/api/user", userRoutes_1.default);
app.use("/api/estimation", estimationRoutes_1.default);
app.use("/api/client", clientRoutes_1.default);
app.use("/api/project", projectRoutes_1.default);
app.use("/api/comment", commentRoutes_1.default);
app.use("/api/quotation", quotationRoutes_1.default);
app.use("/api/lpo", lpoRoutes_1.default);
app.use("/api/work-completion", workCompletionRoutes_1.default);
app.use("/api/attendance", attandanceRoutes_1.default);
app.use("/api/expense", expenseRoutes_1.default);
app.use("/api/analytics", analyticalRoute_1.default);
app.use("/api/shops", shopRoutes_1.default);
app.use("/api/vehicles", vehicleRoutes_1.default);
app.use("/api/bills", billRoutes_1.default);
app.use("/api/categories", categoryRoutes_1.default);
app.use("/api/bank", bankRoutes_1.default);
app.use("/api/project-profit", projectProfitRoutes_1.default);
app.use("/api/employee-expenses", employeeExpenseRoutes_1.default);
app.use("/api/payroll", payrollRoutes_1.default);
app.use("/api/visa-expenses", visaExpenseRoutes_1.default);
app.use("/api/reports", reportRoutes_1.default);
app.use("/api/employee-summary", employeeSummaryRoutes_1.default);
app.use(errorHandler_1.errorHandler);
app.use((req, res, next) => {
    throw new apiHandlerHelpers_1.ApiError(404, "Route not found");
});
// Error-handling middleware
// app.get("*", (req, res) => {
//   res.sendFile("/var/www/kmcc-frontend/dist/index.html");
// });
(0, db_1.connectDb)().then(() => {
    app.listen(4001, () => {
        console.log(`Server is running on port ${process.env.PORT}`);
    });
});
//# sourceMappingURL=index.js.map