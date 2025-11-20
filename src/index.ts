import express, { Request, Response, NextFunction, ErrorRequestHandler, } from "express";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors";
import dotenv from "dotenv";
import { ApiError } from "./utils/apiHandlerHelpers";
import { errorHandler } from "./utils/errorHandler";
import { checkBackendStatus } from "./middlewares/checkBackendStatus";
import userRouter from "./routes/userRoutes";
import estimationRouter from "./routes/estimationRoutes";
import clientRouter from "./routes/clientRoutes";
import projectRouter from "./routes/projectRoutes";
import commentRouter from "./routes/commentRoutes";
import quotationRouter from "./routes/quotationRoutes";
import lpoRouter from "./routes/lpoRoutes";
import workCompletionRouter from "./routes/workCompletionRoutes";
import attandanceRouter from "./routes/attandanceRoutes";
import expenseRouter from "./routes/expenseRoutes";
import analyticsRouter from "./routes/analyticalRoute";
import shopRouter from "./routes/shopRoutes";
import vehicleRouter from "./routes/vehicleRoutes";
import billsRouter from "./routes/billRoutes";
import categoryRouter from "./routes/categoryRoutes";
import bankRouter from "./routes/bankRoutes";
import projectProfitRouter from "./routes/projectProfitRoutes";
import employeeExpenseRouter from "./routes/employeeExpenseRoutes";
import payrollRouter from "./routes/payrollRoutes";
import visaRouter from "./routes/visaExpenseRoutes";
import reportTouter from "./routes/reportRoutes"
import employeeSummaryRouter from "./routes/employeeSummaryRoutes";
import attendanceManagementRouter from "./routes/attendanceManagementRoutes";
import bankDetailsRouter from "./routes/bankDetailsRoutes";
import dashboardRoutes from "./routes/dashboardAnalyticsRoutes";
import utilsRouter from "./routes/utilsRoutes";
import restrictionRouter from "./routes/restrictionRoutes";
import { connectDb } from "./config/db";
import { seedSuperAdmin } from "./utils/seeder";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: ["https://new.alghazalgroup.com", "https://new.alghazalgroup.com/", "http://localhost:5173", "http://localhost:5173/"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Origin",
      "X-Requested-With",
      "Accept",
    ],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("common"));

// Test route
app.get("/", (req, res) => {
  console.log("Test log route hit");
  res.send("Test log");
});

// Seed route
app.get("/seed", (_req: Request, res: Response) => {
  seedSuperAdmin();
  res.send("ok")
});

// IMPORTANT: Restriction route MUST be registered BEFORE the checkBackendStatus middleware
app.use("/api/restriction", restrictionRouter);

// Apply backend status check to ALL other routes
app.use(checkBackendStatus as any);

// All other routes
app.use("/api/dashboard-analytics", dashboardRoutes);
app.use("/api/user", userRouter);
app.use("/api/estimation", estimationRouter);
app.use("/api/client", clientRouter);
app.use("/api/project", projectRouter);
app.use("/api/comment", commentRouter);
app.use("/api/quotation", quotationRouter);
app.use("/api/lpo", lpoRouter);
app.use("/api/work-completion", workCompletionRouter);
app.use("/api/attendance", attandanceRouter);
app.use("/api/expense", expenseRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/shops", shopRouter);
app.use("/api/vehicles", vehicleRouter);
app.use("/api/bills", billsRouter);
app.use("/api/categories", categoryRouter);
app.use("/api/bank", bankRouter);
app.use("/api/bank-details", bankDetailsRouter);
app.use("/api/project-profit", projectProfitRouter);
app.use("/api/employee-expenses", employeeExpenseRouter);
app.use("/api/payroll", payrollRouter);
app.use("/api/visa-expenses", visaRouter);
app.use("/api/reports", reportTouter);
app.use("/api/employee-summary", employeeSummaryRouter);
app.use("/api/attendance-management", attendanceManagementRouter);
app.use("/api/utils", utilsRouter);

app.use(errorHandler as ErrorRequestHandler);

app.use((req: Request, res: Response, next: NextFunction) => {
  throw new ApiError(404, "Route not found");
});

connectDb().then(() => {
  app.listen(4001, () => {
    console.log(`Server is running on port ${process.env.PORT}`);
  });
});