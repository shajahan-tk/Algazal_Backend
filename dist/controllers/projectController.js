"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWorkDuration = exports.setWorkEndDate = exports.setWorkStartDate = exports.addGrnNumber = exports.generateInvoicePdf = exports.getDriverProjects = exports.updateWorkersAndDriver = exports.getAssignedTeam = exports.assignTeamAndDriver = exports.generateInvoiceData = exports.deleteProject = exports.getProjectProgressUpdates = exports.updateProjectProgress = exports.assignProject = exports.updateProjectStatus = exports.updateProject = exports.getProject = exports.getEngineerProjects = exports.getProjects = exports.createProject = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const apiHandlerHelpers_2 = require("../utils/apiHandlerHelpers");
const projectModel_1 = require("../models/projectModel");
const clientModel_1 = require("../models/clientModel");
const estimationModel_1 = require("../models/estimationModel");
const userModel_1 = require("../models/userModel");
const quotationModel_1 = require("../models/quotationModel");
const mailer_1 = require("../utils/mailer");
const commentModel_1 = require("../models/commentModel");
const lpoModel_1 = require("../models/lpoModel");
const dayjs_1 = __importDefault(require("dayjs"));
const mongoose_1 = __importStar(require("mongoose"));
const documentNumbers_1 = require("../utils/documentNumbers");
const expenseModel_1 = require("../models/expenseModel");
const puppeteer_1 = __importDefault(require("puppeteer"));
const constant_1 = require("../config/constant");
// Status transition validation
const validStatusTransitions = {
    draft: ["estimation_prepared"],
    estimation_prepared: ["quotation_sent", "on_hold", "cancelled"],
    quotation_sent: [
        "quotation_approved",
        "quotation_rejected",
        "on_hold",
        "cancelled",
    ],
    quotation_approved: ["lpo_received", "on_hold", "cancelled"],
    lpo_received: ["work_started", "on_hold", "cancelled"],
    work_started: ["in_progress", "on_hold", "cancelled"],
    in_progress: ["work_completed", "on_hold", "cancelled"],
    work_completed: ["quality_check", "on_hold"],
    quality_check: ["client_handover", "work_completed"],
    client_handover: ["final_invoice_sent", "on_hold"],
    final_invoice_sent: ["payment_received", "on_hold"],
    payment_received: ["project_closed"],
    on_hold: ["in_progress", "work_started", "cancelled"],
    cancelled: [],
    project_closed: [],
    team_assigned: ["work_started", "on_hold"],
};
exports.createProject = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectName, projectDescription, client, location, building, apartmentNumber, attention } = req.body;
    console.log(req.body);
    if (!projectName || !client || !location || !building || !apartmentNumber) {
        throw new apiHandlerHelpers_2.ApiError(400, "Required fields are missing");
    }
    const clientExists = await clientModel_1.Client.findById(client);
    if (!clientExists) {
        throw new apiHandlerHelpers_2.ApiError(404, "Client not found");
    }
    const project = await projectModel_1.Project.create({
        projectName,
        projectDescription,
        client,
        location,
        building,
        apartmentNumber,
        projectNumber: await (0, documentNumbers_1.generateProjectNumber)(),
        status: "draft",
        progress: 0,
        createdBy: req.user?.userId,
        attention
    });
    res
        .status(201)
        .json(new apiHandlerHelpers_1.ApiResponse(201, project, "Project created successfully"));
});
exports.getProjects = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    // Build filter
    const filter = {};
    // Status filter
    if (req.query.status) {
        filter.status = req.query.status;
    }
    // Client filter
    if (req.query.client) {
        filter.client = req.query.client;
    }
    // Search functionality
    if (req.query.search) {
        const searchTerm = req.query.search;
        filter.$or = [
            { projectName: { $regex: searchTerm, $options: "i" } },
            { projectDescription: { $regex: searchTerm, $options: "i" } },
            { location: { $regex: searchTerm, $options: "i" } },
            { building: { $regex: searchTerm, $options: "i" } },
            { apartmentNumber: { $regex: searchTerm, $options: "i" } },
            { projectNumber: { $regex: searchTerm, $options: "i" } }, // Added projectNumber to search
        ];
    }
    const total = await projectModel_1.Project.countDocuments(filter);
    const projects = await projectModel_1.Project.find(filter)
        .populate("client", "clientName clientAddress mobileNumber")
        .populate("createdBy", "firstName lastName email")
        .populate("updatedBy", "firstName lastName email")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 });
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        projects,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
        },
    }, "Projects retrieved successfully"));
});
exports.getEngineerProjects = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const userId = req.user?.userId;
    // Validate engineer user
    if (!userId) {
        throw new apiHandlerHelpers_2.ApiError(401, "Unauthorized access");
    }
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    // Build filter - only projects assigned to this engineer
    const filter = { assignedTo: userId };
    // Status filter
    if (req.query.status) {
        filter.status = req.query.status;
    }
    // Client filter
    if (req.query.client) {
        filter.client = req.query.client;
    }
    // Search functionality
    if (req.query.search) {
        const searchTerm = req.query.search;
        filter.$or = [
            { projectName: { $regex: searchTerm, $options: "i" } },
            { projectDescription: { $regex: searchTerm, $options: "i" } },
            { location: { $regex: searchTerm, $options: "i" } },
            { building: { $regex: searchTerm, $options: "i" } },
            { apartmentNumber: { $regex: searchTerm, $options: "i" } },
        ];
    }
    const total = await projectModel_1.Project.countDocuments(filter);
    const projects = await projectModel_1.Project.find(filter)
        .populate("client", "clientName clientAddress mobileNumber")
        .populate("createdBy", "firstName lastName email")
        .populate("updatedBy", "firstName lastName email")
        .populate("assignedTo", "firstName lastName email")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 });
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        projects,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
        },
    }, "Projects retrieved successfully"));
});
exports.getProject = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const project = await projectModel_1.Project.findById(id)
        .populate("client")
        .populate("createdBy", "firstName lastName email")
        .populate("updatedBy", "firstName lastName email")
        .populate("assignedTo", "-password");
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    // Check if an estimation exists for this project
    const estimation = await estimationModel_1.Estimation.findOne({ project: id }).select("_id isChecked isApproved");
    const quotation = await quotationModel_1.Quotation.findOne({ project: id }).select("_id");
    const Lpo = await lpoModel_1.LPO.findOne({ project: id }).select("_id");
    const expense = await expenseModel_1.Expense.findOne({ project: id }).select("_id");
    const responseData = {
        ...project.toObject(),
        estimationId: estimation?._id || null,
        quotationId: quotation?._id || null,
        lpoId: Lpo?._id || null,
        isChecked: estimation?.isChecked || false,
        isApproved: estimation?.isApproved || false,
        expenseId: expense?._id || null,
    };
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, responseData, "Project retrieved successfully"));
});
exports.updateProject = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    console.log(updateData);
    // Add updatedBy automatically
    updateData.updatedBy = req.user?.userId;
    const project = await projectModel_1.Project.findById(id);
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    // Validate progress (0-100)
    if (updateData.progress !== undefined) {
        if (updateData.progress < 0 || updateData.progress > 100) {
            throw new apiHandlerHelpers_2.ApiError(400, "Progress must be between 0 and 100");
        }
    }
    // Update status with validation
    if (updateData.status) {
        if (!validStatusTransitions[project.status]?.includes(updateData.status)) {
            throw new apiHandlerHelpers_2.ApiError(400, `Invalid status transition from ${project.status} to ${updateData.status}`);
        }
    }
    const updatedProject = await projectModel_1.Project.findByIdAndUpdate(id, updateData, {
        new: true,
        runValidators: true,
    })
        .populate("client", "clientName clientAddress mobileNumber")
        .populate("updatedBy", "firstName lastName email");
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, updatedProject, "Project updated successfully"));
});
exports.updateProjectStatus = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) {
        throw new apiHandlerHelpers_2.ApiError(400, "Status is required");
    }
    const project = await projectModel_1.Project.findById(id);
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    // Validate status transition
    if (!validStatusTransitions[project.status]?.includes(status)) {
        throw new apiHandlerHelpers_2.ApiError(400, `Invalid status transition from ${project.status} to ${status}`);
    }
    const updateData = {
        status,
        updatedBy: req.user?.userId,
    };
    const updatedProject = await projectModel_1.Project.findByIdAndUpdate(id, updateData, {
        new: true,
    });
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, updatedProject, "Project status updated successfully"));
});
exports.assignProject = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { assignedTo } = req.body;
    // Validation
    if (!assignedTo || !id) {
        throw new apiHandlerHelpers_2.ApiError(400, "AssignedTo is required");
    }
    // Find project
    const project = await projectModel_1.Project.findById(id);
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(400, "Project not found");
    }
    // Find engineer
    const engineer = await userModel_1.User.findById(assignedTo);
    if (!engineer) {
        throw new apiHandlerHelpers_2.ApiError(400, "Engineer not found");
    }
    // Update project assignment
    project.assignedTo = assignedTo;
    await project.save();
    try {
        // Get all admin and super_admin users
        const adminUsers = await userModel_1.User.find({
            role: { $in: ["admin", "super_admin"] },
            email: { $exists: true, $ne: "" }, // Only users with emails
        }).select("email firstName");
        // Create list of all recipients (engineer + admins)
        const allRecipients = [
            engineer.email,
            ...adminUsers.map((admin) => admin.email),
        ];
        // Remove duplicates (in case engineer is also an admin)
        const uniqueRecipients = [...new Set(allRecipients)];
        // Send single email to all recipients
        await mailer_1.mailer.sendEmail({
            to: uniqueRecipients.join(","), // Comma-separated list
            subject: `Project Assignment: ${project.projectName}`,
            templateParams: {
                userName: "Team", // Generic since we're sending to multiple people
                actionUrl: `${constant_1.FRONTEND_URL}/app/project-view/${project._id}`,
                contactEmail: "info@alghazalgroup.com",
                logoUrl: "https://agats.s3.ap-south-1.amazonaws.com/logo/alghlogo.jpg",
                projectName: project.projectName || "the project",
            },
            text: `Dear Team,\n\nEngineer ${engineer.firstName || "Engineer"} has been assigned to project "${project.projectName || "the project"}".\n\nView project details: ${constant_1.FRONTEND_URL}/app/project-view/${project._id}\n\nBest regards,\nTECHNICAL SERVICE TEAM`,
            headers: {
                "X-Priority": "1",
                Importance: "high",
            },
        });
        res
            .status(200)
            .json(new apiHandlerHelpers_1.ApiResponse(200, {}, "Project assigned and notifications sent successfully"));
    }
    catch (emailError) {
        console.error("Email sending failed:", emailError);
        res
            .status(200)
            .json(new apiHandlerHelpers_1.ApiResponse(200, {}, "Project assigned successfully but notification emails failed to send"));
    }
});
exports.updateProjectProgress = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { progress, comment } = req.body;
    const userId = req.user?.userId;
    if (progress === undefined || progress < 0 || progress > 100) {
        throw new apiHandlerHelpers_2.ApiError(400, "Progress must be between 0 and 100");
    }
    const project = await projectModel_1.Project.findById(id)
        .populate("client")
        .populate("assignedTo");
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    // Store old progress for comparison
    const oldProgress = project.progress;
    // Update project status based on progress
    if (project.progress >= 0 && project.status === "team_assigned") {
        project.status = "work_started";
    }
    if (project.progress > 0 && project.status === "work_started") {
        project.status = "in_progress";
    }
    const updateData = {
        progress,
        updatedBy: userId,
    };
    // Auto-update status if progress reaches 100%
    if (progress === 100 && project.status !== "work_completed") {
        updateData.status = "work_completed";
    }
    await project.save(); // Save the project first to update its status
    const updatedProject = await projectModel_1.Project.findByIdAndUpdate(id, updateData, {
        new: true,
    });
    // Create a progress update comment
    if (comment || progress !== oldProgress) {
        const commentContent = comment || `Progress updated from ${oldProgress}% to ${progress}%`;
        await commentModel_1.Comment.create({
            content: commentContent,
            user: userId,
            project: id,
            actionType: "progress_update",
            progress: progress,
        });
    }
    // Send progress update email if progress changed
    if (progress !== oldProgress) {
        try {
            // Get all recipients (client + assigned engineer + admins + super_admins)
            const recipients = [];
            // Add client if exists
            if (project.client &&
                typeof project.client === "object" &&
                "email" in project.client) {
                recipients.push({
                    email: project.client.email,
                    name: project.client.clientName || "Client",
                });
            }
            // Add assigned engineer if exists
            if (project.assignedTo &&
                typeof project.assignedTo === "object" &&
                "email" in project.assignedTo) {
                recipients.push({
                    email: project.assignedTo.email,
                    name: project.assignedTo.firstName || "Engineer",
                });
            }
            // Add admins and super admins
            const admins = await userModel_1.User.find({
                role: { $in: ["admin", "super_admin"] },
                email: { $exists: true, $ne: "" },
            });
            admins.forEach((admin) => {
                recipients.push({
                    email: admin.email,
                    name: admin.firstName || "Admin",
                });
            });
            // Remove duplicates
            const uniqueRecipients = recipients.filter((recipient, index, self) => index === self.findIndex((r) => r.email === recipient.email));
            // Get the user who updated the progress
            const updatedByUser = await userModel_1.User.findById(userId);
            // Prepare email content
            const templateParams = {
                userName: "Team",
                projectName: project.projectName,
                progress: progress,
                progressDetails: comment,
                contactEmail: "info@alghazalgroup.com",
                logoUrl: "https://agats.s3.ap-south-1.amazonaws.com/logo/alghlogo.jpg",
                actionUrl: `${constant_1.FRONTEND_URL}/app/project-view/${project._id}`,
            };
            // Send email to all recipients
            await mailer_1.mailer.sendEmail({
                to: process.env.NOTIFICATION_INBOX || "info@alghazalgroup.com",
                bcc: uniqueRecipients.map((r) => r.email).join(","),
                subject: `Progress Update: ${project.projectName} (${progress}% Complete)`,
                templateParams,
                text: `Dear Team,\n\nThe progress for project ${project.projectName} has been updated to ${progress}%.\n\n${comment ? `Details: ${comment}\n\n` : ""}View project: ${templateParams.actionUrl}\n\nBest regards,\nTECHNICAL SERVICE TEAM`,
                headers: {
                    "X-Priority": "1",
                    Importance: "high",
                },
            });
        }
        catch (emailError) {
            console.error("Failed to send progress update emails:", emailError);
            // Continue even if email fails
        }
    }
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, updatedProject, "Project progress updated successfully"));
});
exports.getProjectProgressUpdates = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    const progressUpdates = await commentModel_1.Comment.find({
        project: projectId,
        actionType: "progress_update",
    })
        .populate("user", "firstName lastName profileImage")
        .sort({ createdAt: -1 });
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, progressUpdates, "Project progress updates retrieved successfully"));
});
exports.deleteProject = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const project = await projectModel_1.Project.findById(id);
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    // Prevent deletion if project is beyond draft stage
    if (project.status !== "draft") {
        throw new apiHandlerHelpers_2.ApiError(400, "Cannot delete project that has already started");
    }
    await projectModel_1.Project.findByIdAndDelete(id);
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, null, "Project deleted successfully"));
});
exports.generateInvoiceData = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    // Validate projectId
    if (!projectId || !mongoose_1.Types.ObjectId.isValid(projectId)) {
        throw new apiHandlerHelpers_2.ApiError(400, "Valid project ID is required");
    }
    // Get project data with proper type annotations for populated fields
    const project = await projectModel_1.Project.findById(projectId)
        .populate("client", "clientName clientAddress mobileNumber contactPerson trnNumber pincode workStartDate workEndDate")
        .populate("createdBy", "firstName lastName")
        .populate("assignedTo", "firstName lastName")
        .lean();
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    // Get quotation data with validation
    const quotation = await quotationModel_1.Quotation.findOne({ project: projectId }).lean();
    if (!quotation) {
        throw new apiHandlerHelpers_2.ApiError(404, "Quotation not found for this project");
    }
    // Get LPO data with validation
    const lpo = await lpoModel_1.LPO.findOne({ project: projectId }).lean();
    if (!lpo) {
        throw new apiHandlerHelpers_2.ApiError(404, "LPO not found for this project");
    }
    // Validate required fields
    if (!quotation.items || quotation.items.length === 0) {
        throw new apiHandlerHelpers_2.ApiError(400, "Quotation items are required");
    }
    // Generate invoice number with better format
    const invoiceNumber = `INV${project.projectNumber.slice(3, 10)}`;
    // Type-safe client data extraction
    const clientData = typeof project.client === "object" ? project.client : null;
    const assignedToData = typeof project.assignedTo === "object" ? project.assignedTo : null;
    const createdByData = typeof project.createdBy === "object" ? project.createdBy : null;
    // Enhanced vendee information with proper type checking
    const vendeeInfo = {
        name: clientData?.clientName || "IMDAAD LLC",
        contactPerson: assignedToData
            ? `Mr. ${assignedToData.firstName} ${assignedToData.lastName}`
            : clientData?.clientName || "N/A",
        poBox: clientData?.pincode || "18220",
        address: clientData?.clientAddress || "DUBAI - UAE",
        phone: clientData?.mobileNumber || "(04) 812 8888",
        fax: "(04) 881 8405",
        trn: clientData?.trnNumber || "100236819700003",
        grnNumber: project.grnNumber || "N/A",
        supplierNumber: "PO25IMD7595",
        servicePeriod: `${(0, dayjs_1.default)(project.createdAt).format("DD-MM-YYYY")} to ${(0, dayjs_1.default)().format("DD-MM-YYYY")}`,
    };
    // Enhanced vendor information
    const vendorInfo = {
        name: "AL GHAZAL AL ABYAD TECHNICAL SERVICES",
        poBox: "63509",
        address: "Dubai - UAE",
        phone: "(04) 4102555",
        fax: "",
        trn: "104037793700003",
    };
    // Enhanced products array
    const products = quotation.items.map((item, index) => ({
        sno: index + 1,
        description: item.description || "N/A",
        qty: item.quantity || 0,
        unitPrice: item.unitPrice || 0,
        total: item.totalPrice || 0,
    }));
    function getDaysLeft(validUntil) {
        if (!validUntil)
            return "N/A";
        const today = new Date();
        // Calculate difference in ms
        const diffTime = validUntil.getTime() - today.getTime();
        // Convert ms → days
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays < 0)
            return "Expired";
        if (diffDays === 0)
            return "Today";
        return `${diffDays} days left`;
    }
    // Enhanced response structure with type-safe checks
    const response = {
        _id: project._id.toString(),
        invoiceNumber,
        date: new Date().toISOString(),
        orderNumber: lpo.lpoNumber || "N/A",
        vendor: vendorInfo,
        vendee: vendeeInfo,
        subject: quotation.scopeOfWork?.join(", ") || "N/A",
        paymentTerms: getDaysLeft(quotation.validUntil) || "N/A",
        amountInWords: convertToWords(quotation.netAmount || 0),
        products,
        summary: {
            amount: quotation.subtotal || 0,
            vat: quotation.vatAmount || 0,
            totalReceivable: quotation.netAmount || 0,
        },
        preparedBy: {
            _id: createdByData?._id.toString() || "",
            firstName: createdByData?.firstName || "N/A",
            lastName: createdByData?.lastName || "N/A",
        },
    };
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, response, "Invoice data generated successfully"));
});
// Enhanced number to words conversion
const convertToWords = (num) => {
    const units = [
        "",
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
        "eight",
        "nine",
    ];
    const teens = [
        "ten",
        "eleven",
        "twelve",
        "thirteen",
        "fourteen",
        "fifteen",
        "sixteen",
        "seventeen",
        "eighteen",
        "nineteen",
    ];
    const tens = [
        "",
        "ten",
        "twenty",
        "thirty",
        "forty",
        "fifty",
        "sixty",
        "seventy",
        "eighty",
        "ninety",
    ];
    if (num === 0)
        return "Zero UAE Dirhams";
    let words = "";
    // Implementation of number conversion logic here...
    // (Add your full number-to-words implementation)
    return `${words} UAE Dirhams`;
};
// Add to projectController.ts
exports.assignTeamAndDriver = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    const { workers, driverId } = req.body;
    // Validation
    if (!Array.isArray(workers) || workers.length === 0 || !driverId) {
        throw new apiHandlerHelpers_2.ApiError(400, "Both workers array and driverId are required");
    }
    const project = await projectModel_1.Project.findById(projectId);
    if (!project)
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    // Verify project is in correct state
    if (project.status !== "lpo_received") {
        throw new apiHandlerHelpers_2.ApiError(400, "Project must be in 'lpo_received' status");
    }
    // Verify all workers are engineers
    const validWorkers = await userModel_1.User.find({
        _id: { $in: workers },
        role: "worker",
    });
    if (validWorkers.length !== workers.length) {
        throw new apiHandlerHelpers_2.ApiError(400, "All workers must be engineers");
    }
    // Verify driver exists
    const driver = await userModel_1.User.findOne({
        _id: driverId,
        role: "driver",
    });
    if (!driver) {
        throw new apiHandlerHelpers_2.ApiError(400, "Valid driver ID is required");
    }
    // Update project
    project.assignedWorkers = workers;
    project.assignedDriver = driverId;
    project.status = "team_assigned";
    project.updatedBy = req.user?.userId
        ? new mongoose_1.default.Types.ObjectId(req.user.userId)
        : undefined;
    await project.save();
    // Send notifications (implementation depends on your mailer service)
    // await sendAssignmentNotifications(project, workers, driverId);
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, project, "Team and driver assigned successfully"));
});
// Helper function for notifications
// const sendAssignmentNotifications = async (
//   project: IProject,
//   workerIds: Types.ObjectId[],
//   driverId: Types.ObjectId
// ) => {
//   try {
//     // Get all involved users (workers + driver + admins)
//     const usersToNotify = await User.find({
//       $or: [
//         { _id: { $in: workerIds } },
//         { _id: driverId },
//         { role: { $in: ["admin", "super_admin"] } },
//       ],
//     });
//     // Send emails
//     await mailer.sendEmail({
//       to: usersToNotify.map((u) => u.email).join(","),
//       subject: `Team Assigned: ${project.projectName}`,
//       templateParams: {
//         projectName: project.projectName,
//         actionUrl: `http://yourfrontend.com/projects/${project._id}`,
//       },
//       text: `You've been assigned to project ${project.projectName}`,
//     });
//   } catch (error) {
//     console.error("Notification error:", error);
//   }
// };
exports.getAssignedTeam = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    const project = await projectModel_1.Project.findById(projectId)
        .populate("assignedWorkers", "firstName lastName profileImage")
        .populate("assignedDriver", "firstName lastName profileImage");
    if (!project)
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        workers: project.assignedWorkers,
        driver: project.assignedDriver,
    }, "Assigned team fetched successfully"));
});
// Update only workers and driver assignments
exports.updateWorkersAndDriver = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { workers, driver } = req.body;
    // Validation
    if (!id) {
        throw new apiHandlerHelpers_2.ApiError(400, "Project ID is required");
    }
    // At least one field should be provided
    if (!workers && !driver) {
        throw new apiHandlerHelpers_2.ApiError(400, "Either workers or driver must be provided");
    }
    // Find project
    const project = await projectModel_1.Project.findById(id);
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(400, "Project not found");
    }
    // Validate and update workers if provided
    if (workers !== undefined) {
        // Explicit check for undefined (empty array is valid)
        if (!Array.isArray(workers)) {
            throw new apiHandlerHelpers_2.ApiError(400, "Workers must be an array");
        }
        // If workers array is provided (even empty), validate all IDs
        const workersExist = await userModel_1.User.find({
            _id: { $in: workers },
            role: "worker",
        });
        if (workersExist.length !== workers.length) {
            throw new apiHandlerHelpers_2.ApiError(400, "One or more workers not found or not workers");
        }
        project.assignedWorkers = workers;
    }
    // Validate and update driver if provided
    if (driver !== undefined) {
        // Explicit check for undefined (null is valid to clear driver)
        if (driver) {
            const driverExists = await userModel_1.User.findOne({
                _id: driver,
                role: "driver",
            });
            if (!driverExists) {
                throw new apiHandlerHelpers_2.ApiError(400, "Driver not found or not a driver");
            }
            project.assignedDriver = driver;
        }
        else {
            // If driver is explicitly set to null/empty, clear it
            project.assignedDriver = undefined;
        }
    }
    const updatedProject = await project.save();
    // Send notifications
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, updatedProject, "Workers and driver assignments updated successfully"));
});
// Notification helper specifically for workers/driver updates
// const sendWorkersDriverNotification = async (project: any) => {
//   try {
//     // Get all admin and super_admin users
//     const adminUsers = await User.find({
//       role: { $in: ["admin", "super_admin"] },
//       email: { $exists: true, $ne: "" },
//     }).select("email firstName");
//     // Get all assigned workers and driver details
//     const assignedUsers = await User.find({
//       _id: {
//         $in: [
//           ...(project.driver ? [project.driver] : []),
//           ...(project.workers || []),
//         ].filter(Boolean),
//       },
//     }).select("email firstName role");
//     // Create list of all recipients (assigned users + admins)
//     const allRecipients = [
//       ...adminUsers.map((admin) => admin.email),
//       ...assignedUsers.map((user) => user.email),
//     ];
//     // Remove duplicates
//     const uniqueRecipients = [...new Set(allRecipients)];
//     // Prepare assignment details for email
//     const assignmentDetails = [];
//     if (project.driver) {
//       const driver = assignedUsers.find((u) => u._id.equals(project.driver));
//       if (driver) {
//         assignmentDetails.push(`Driver: ${driver.firstName}`);
//       }
//     }
//     if (project.workers?.length) {
//       const workers = assignedUsers.filter((u) =>
//         project.workers.some((w: any) => u._id.equals(w))
//       );
//       if (workers.length) {
//         assignmentDetails.push(
//           `Workers: ${workers.map((w) => w.firstName).join(", ")}`
//         );
//       }
//     }
//     // Send email if there are recipients and assignments
//     if (uniqueRecipients.length && assignmentDetails.length) {
//       await mailer.sendEmail({
//         to: uniqueRecipients.join(","),
//         subject: `Project Team Update: ${project.projectName}`,
//         templateParams: {
//           userName: "Team",
//           actionUrl: `${process.env.FRONTEND_URL}/app/project-view/${project._id}`,
//           contactEmail: "propertymanagement@alhamra.ae",
//           logoUrl: process.env.LOGO_URL,
//           projectName: project.projectName || "the project",
//           assignmentDetails: assignmentDetails.join("\n"),
//         },
//         text: `Dear Team,\n\nThe team for project "${
//           project.projectName
//         }" has been updated:\n\n${assignmentDetails.join(
//           "\n"
//         )}\n\nView project details: ${
//           process.env.FRONTEND_URL
//         }/app/project-view/${
//           project._id
//         }\n\nBest regards,\nTECHNICAL SERVICE TEAM`,
//         headers: {
//           "X-Priority": "1",
//           Importance: "high",
//         },
//       });
//     }
//   } catch (error) {
//     console.error("Error in sendWorkersDriverNotification:", error);
//     throw error;
//   }
// };
exports.getDriverProjects = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const driverId = req.user?.userId;
    if (!driverId) {
        throw new apiHandlerHelpers_2.ApiError(401, "Unauthorized access");
    }
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    // Build filter - only projects assigned to this driver
    const filter = { assignedDriver: driverId };
    // Status filter
    if (req.query.status) {
        filter.status = req.query.status;
    }
    // Search functionality
    if (req.query.search) {
        const searchTerm = req.query.search;
        filter.$or = [
            { projectName: { $regex: searchTerm, $options: "i" } },
            { projectDescription: { $regex: searchTerm, $options: "i" } },
            { location: { $regex: searchTerm, $options: "i" } },
            { building: { $regex: searchTerm, $options: "i" } },
            { apartmentNumber: { $regex: searchTerm, $options: "i" } },
            { projectNumber: { $regex: searchTerm, $options: "i" } },
        ];
    }
    const total = await projectModel_1.Project.countDocuments(filter);
    const projects = await projectModel_1.Project.find(filter)
        .populate("client", "clientName clientAddress mobileNumber")
        .populate("assignedWorkers", "firstName lastName profileImage")
        .populate("assignedDriver", "firstName lastName profileImage")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 });
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        projects,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            hasNextPage: page * limit < total,
            hasPreviousPage: page > 1,
        },
    }, "Driver projects retrieved successfully"));
});
exports.generateInvoicePdf = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    // Validate projectId
    if (!projectId || !mongoose_1.Types.ObjectId.isValid(projectId)) {
        throw new apiHandlerHelpers_2.ApiError(400, "Valid project ID is required");
    }
    // Get project data with populated fields
    const project = await projectModel_1.Project.findById(projectId)
        .populate({
        path: "client",
        select: "clientName clientAddress mobileNumber telephoneNumber email trnNumber",
    })
        .populate("createdBy", "firstName lastName signatureImage");
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    // Get quotation for this project
    const quotation = await quotationModel_1.Quotation.findOne({ project: projectId });
    if (!quotation) {
        throw new apiHandlerHelpers_2.ApiError(404, "Quotation not found for this project");
    }
    // Get LPO data if exists
    const lpo = await lpoModel_1.LPO.findOne({ project: projectId });
    // Type-safe access to populated fields
    const client = project.client;
    const createdBy = project.createdBy;
    // Generate invoice number
    const invoiceNumber = `INV${project.projectNumber.slice(3, 10)}`;
    // Format dates
    const formatDate = (date) => {
        if (!date)
            return 'N/A';
        const d = new Date(date);
        return isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    };
    // Calculate amounts
    const subtotal = quotation.items.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
    const vatAmount = subtotal * (quotation.vatPercentage / 100);
    const totalAmount = subtotal + vatAmount;
    // Helper function to convert amount to words
    const convertToWords = (num) => {
        if (num === 0)
            return 'Zero AED only';
        const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
        const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
        const tens = ['', 'Ten', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
        const scales = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];
        const convertChunk = (n) => {
            if (n === 0)
                return '';
            let chunkWords = [];
            const hundred = Math.floor(n / 100);
            if (hundred > 0) {
                chunkWords.push(units[hundred] + ' Hundred');
            }
            const remainder = n % 100;
            if (remainder > 0) {
                if (remainder < 10) {
                    chunkWords.push(units[remainder]);
                }
                else if (remainder < 20) {
                    chunkWords.push(teens[remainder - 10]);
                }
                else {
                    const ten = Math.floor(remainder / 10);
                    const unit = remainder % 10;
                    chunkWords.push(tens[ten]);
                    if (unit > 0) {
                        chunkWords.push(units[unit]);
                    }
                }
            }
            return chunkWords.join(' ');
        };
        const numStr = Math.floor(num).toString();
        const chunks = [];
        for (let i = numStr.length; i > 0; i -= 3) {
            chunks.push(parseInt(numStr.substring(Math.max(0, i - 3), i), 10));
        }
        let words = [];
        for (let i = 0; i < chunks.length; i++) {
            const chunkWords = convertChunk(chunks[i]);
            if (chunkWords) {
                words.unshift(chunkWords + (scales[i] ? ' ' + scales[i] : ''));
            }
        }
        const decimal = Math.round((num - Math.floor(num)) * 100);
        let decimalWords = '';
        if (decimal > 0) {
            decimalWords = ' and ' + convertChunk(decimal) + ' Fils';
        }
        const result = words.join(' ') + decimalWords;
        return result.charAt(0).toUpperCase() + result.slice(1).toLowerCase();
    };
    // Main HTML content
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <style type="text/css">
    @page {
      size: A4;
      margin: 1cm;
    }
    body {
      font-family: 'Arial', sans-serif;
      font-size: 11pt; /* Increased from 10pt for better readability */
      line-height: 1.5; /* Increased line height for better readability */
      color: #333;
      margin: 0;
      padding: 0;
    }
    .header {
      display: flex;
      align-items: flex-start;
      margin-bottom: 20px; /* Increased spacing */
      gap: 20px;
    }
    .logo {
      height: 60px; /* Slightly larger logo */
      width: auto;
      max-width: 200px;
    }
    .header-content {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .document-title {
      font-size: 18pt; /* Larger and more prominent */
      font-weight: bold;
      margin: 0;
      text-align: right;
      color: #000;
      padding-top: 5px;
    }
    .invoice-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 2px solid #94d7f4;
      align-items: flex-start;
    }
    .invoice-info {
      text-align: right;
      font-size: 10pt; /* Consistent font size */
    }
    .invoice-info p {
      margin: 3px 0; /* Tighter paragraph spacing */
    }
    .service-period {
      margin: 10px 0 15px 0;
      padding: 8px 0;
      font-weight: bold;
      font-size: 10.5pt; /* Slightly larger than body text */
      border-bottom: 1px solid #eee;
      background-color: #f8f9fa;
      padding: 8px 12px;
      border-radius: 4px;
    }
    .client-info-container {
      display: flex;
      margin-bottom: 25px;
      gap: 25px;
    }
    .client-info, .company-info {
      flex: 1;
      padding: 12px 15px;
      border: 1px solid #ddd;
      border-radius: 5px;
      font-size: 10.5pt; /* Slightly larger for better readability */
    }
    .client-info h3, .company-info h3 {
      font-size: 12pt; /* Larger section headers */
      margin: 0 0 10px 0;
      color: #2c3e50;
      border-bottom: 1px solid #94d7f4;
      padding-bottom: 5px;
    }
    .section {
      margin-bottom: 20px;
      page-break-inside: avoid;
    }
    .section-title {
      font-size: 13pt; /* Larger section titles */
      font-weight: bold;
      padding: 8px 0;
      margin: 15px 0 8px 0;
      border-bottom: 2px solid #94d7f4;
      color: #2c3e50;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      page-break-inside: avoid;
      font-size: 10.5pt; /* Better table font size */
    }
    th {
      background-color: #94d7f4;
      color: #000;
      font-weight: bold;
      padding: 8px 10px; /* More padding for better readability */
      text-align: left;
      border: 1px solid #ddd;
      font-size: 10.5pt;
    }
    td {
      padding: 8px 10px; /* More padding for better readability */
      border: 1px solid #ddd;
      vertical-align: top;
      font-size: 10.5pt;
    }
    .amount-summary {
      margin-top: 15px;
      width: 100%;
      text-align: right;
      font-size: 11pt;
    }
    .amount-summary-row {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 6px;
    }
    .amount-label {
      width: 180px; /* Slightly wider for better alignment */
      font-weight: bold;
      text-align: right;
      padding-right: 15px;
      font-size: 10.5pt;
    }
    .amount-value {
      width: 120px; /* Slightly wider for better alignment */
      text-align: right;
      font-size: 10.5pt;
    }
    .net-amount-row {
      display: flex;
      justify-content: flex-end;
      background-color: #94d7f4;
      color: #000;
      font-weight: bold;
      font-size: 12pt; /* Larger for emphasis */
      margin-top: 8px;
      padding: 8px 0;
      border-top: 2px solid #333;
    }
    .terms-box {
      border: 1px solid #000;
      padding: 12px;
      margin-top: 20px;
      display: inline-block;
      width: auto;
      min-width: 50%;
      font-size: 10.5pt;
    }
    .bank-details {
      margin-top: 25px;
      padding: 15px;
      border: 1px solid #ddd;
      border-radius: 5px;
      background-color: #f8f9fa;
      font-size: 10.5pt;
    }
    .bank-details h3 {
      font-size: 12pt;
      margin: 0 0 12px 0;
      color: #2c3e50;
    }
    .text-center {
      text-align: center;
    }
    .text-right {
      text-align: right;
    }
    .terms-page {
      page-break-before: always;
      padding-top: 20px;
    }
    .footer {
      font-size: 9.5pt; /* Slightly larger footer */
      color: #555;
      text-align: center;
      border-top: 2px solid #ddd;
      padding-top: 15px;
      margin-top: 35px;
      line-height: 1.6;
    }
    .tagline {
      text-align: center;
      font-weight: bold;
      font-size: 13pt; /* More prominent tagline */
      margin: 25px 0 15px 0;
      color: #2c3e50;
    }
    p {
      margin: 6px 0; /* Consistent paragraph spacing */
      line-height: 1.5;
    }
    h3 {
      margin: 0 0 12px 0;
      color: #2c3e50;
      font-size: 12pt;
    }
    strong {
      font-weight: 600; /* Slightly bolder strong text */
    }
    /* Ensure no text is too small */
    .no-small-text {
      font-size: 10pt !important;
      min-font-size: 10pt;
    }
  </style>
</head>
<body>
  <div class="header">
    <img class="logo" src="https://agats.s3.ap-south-1.amazonaws.com/logo/logo.jpeg" alt="Company Logo">
    <div class="header-content">
      <div class="document-title">TAX INVOICE</div>
    </div>
  </div>

  <div class="invoice-header">
    <div class="no-small-text">
      <p><strong>Invoice #:</strong> ${invoiceNumber}</p>
      <p><strong>Date:</strong> ${formatDate(new Date())}</p>
      ${lpo ? `<p><strong>LPO #:</strong> ${lpo.lpoNumber}</p>` : ''}
      ${project.grnNumber ? `<p><strong>GRN #:</strong> ${project.grnNumber}</p>` : ''}
    </div>
    <div class="invoice-info no-small-text">
      <p><strong>Project:</strong> ${project.projectName || "N/A"}</p>
      <!-- Service Period moved to top below project name -->
      <div class="service-period">
        <strong>Service Period:</strong> ${formatDate(project.workStartDate)} - ${formatDate(project.workEndDate || new Date())}
      </div>
    </div>
  </div>

  <div class="client-info-container">
    <div class="client-info">
      <h3>BILL TO:</h3>
      <p><strong>CLIENT:</strong> ${client.clientName || "N/A"}</p>
      <p><strong>ADDRESS:</strong> ${client.clientAddress || "N/A"}</p>
      <p><strong>CONTACT:</strong> ${client.mobileNumber || client.telephoneNumber || "N/A"}</p>
      <p><strong>EMAIL:</strong> ${client.email || "N/A"}</p>
      <p><strong>TRN:</strong> ${client.trnNumber || "N/A"}</p>
    </div>

    <div class="company-info">
      <h3>AL GHAZAL AL ABYAD TECHNICAL SERVICES</h3>
      <p>Office No:04, R09-France Cluster</p>
      <p>International City-Dubai</p>
      <p>P.O.Box:262760, Dubai-U.A.E</p>
      <p>Tel: 044102555</p>
      <p>TRN: 104037793700003</p>
    </div>
  </div>

  <div class="section">
    <div class="section-title">INVOICE ITEMS</div>
    <table>
      <thead>
        <tr>
          <th width="5%">No.</th>
          <th width="45%">Description</th>
          <th width="10%">UOM</th>
          <th width="10%">Qty</th>
          <th width="15%">Unit Price (AED)</th>
          <th width="15%" class="text-right">Total (AED)</th>
        </tr>
      </thead>
      <tbody>
        ${quotation.items.map((item, index) => `
          <tr>
            <td class="text-center">${index + 1}</td>
            <td>${item.description}</td>
            <td class="text-center">${item.uom || "NOS"}</td>
            <td class="text-center">${item.quantity.toFixed(2)}</td>
            <td class="text-right">${item.unitPrice.toFixed(2)}</td>
            <td class="text-right">${item.totalPrice.toFixed(2)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>

    <div class="amount-summary">
      <div class="amount-summary-row">
        <div class="amount-label">SUBTOTAL:</div>
        <div class="amount-value">${subtotal.toFixed(2)} AED</div>
      </div>
      <div class="amount-summary-row">
        <div class="amount-label">VAT ${quotation.vatPercentage}%:</div>
        <div class="amount-value">${vatAmount.toFixed(2)} AED</div>
      </div>
      <div class="net-amount-row">
        <div class="amount-label">TOTAL AMOUNT:</div>
        <div class="amount-value">${totalAmount.toFixed(2)} AED</div>
      </div>
    </div>
  </div>

  <div class="bank-details">
    <h3>BANK DETAILS</h3>
    <p><strong>Bank Name:</strong> Emirates NBD</p>
    <p><strong>Account Name:</strong> AL GHAZAL AL ABYAD TECHNICAL SERVICES</p>
    <p><strong>Account Number:</strong> 1015489374101</p>
    <p><strong>IBAN:</strong> AE580260001015489374101</p>
    <p><strong>Swift Code:</strong> EBILAEAD</p>
  </div>

  <div class="section">
    <p><strong>Amount in words:</strong> ${convertToWords(totalAmount)} AED only</p>
    <p><strong>Payment Terms:</strong> ${"30 days from invoice date"}</p>
  </div>
    
  <div class="footer">
    <div class="tagline">We work U Relax</div>
    <p><strong>AL GHAZAL AL ABYAD TECHNICAL SERVICES</strong></p>
    <p>Office No:04, R09-France Cluster, International City-Dubai | P.O.Box:262760, Dubai-U.A.E</p>
    <p>Tel: 044102555 | <a href="http://www.alghazalgroup.com/">www.alghazalgroup.com</a></p>
    <p>Generated on ${formatDate(new Date())}</p>
  </div>
</body>
</html>
`;
    const browser = await puppeteer_1.default.launch({
        headless: "shell",
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"],
    });
    try {
        const page = await browser.newPage();
        // Set viewport for consistent rendering
        await page.setViewport({ width: 1200, height: 1600 });
        await page.setContent(htmlContent, {
            waitUntil: ["load", "networkidle0", "domcontentloaded"],
            timeout: 30000,
        });
        const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: {
                top: "1cm",
                right: "1cm",
                bottom: "1cm",
                left: "1cm",
            },
            displayHeaderFooter: false,
            preferCSSPageSize: true,
        });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=invoice-${invoiceNumber}.pdf`);
        res.send(pdfBuffer);
    }
    catch (error) {
        console.error("PDF generation error:", error);
        throw new apiHandlerHelpers_2.ApiError(500, "Failed to generate PDF");
    }
    finally {
        await browser.close();
    }
});
// Helper function to convert numbers to words
function convertToWords1(num) {
    const single = [
        "Zero",
        "One",
        "Two",
        "Three",
        "Four",
        "Five",
        "Six",
        "Seven",
        "Eight",
        "Nine",
    ];
    const double = [
        "Ten",
        "Eleven",
        "Twelve",
        "Thirteen",
        "Fourteen",
        "Fifteen",
        "Sixteen",
        "Seventeen",
        "Eighteen",
        "Nineteen",
    ];
    const tens = [
        "",
        "Ten",
        "Twenty",
        "Thirty",
        "Forty",
        "Fifty",
        "Sixty",
        "Seventy",
        "Eighty",
        "Ninety",
    ];
    const formatTenth = (digit, prev) => {
        return 0 == digit ? "" : " " + (1 == digit ? double[prev] : tens[digit]);
    };
    const formatOther = (digit, next, denom) => {
        return ((0 != digit && 1 != digit
            ? " " + single[digit] + " "
            : " " + single[digit]) +
            (0 != digit ? " " + denom : "") +
            next);
    };
    let str = "";
    let rupees = Math.floor(num);
    let paise = Math.floor((num - rupees) * 100);
    if (rupees > 0) {
        const strRupees = rupees.toString();
        const len = strRupees.length;
        let x = 0;
        while (x < len) {
            const digit = parseInt(strRupees[x]);
            const place = len - x;
            switch (place) {
                case 4: // Thousands
                    str += formatOther(digit, "", "Thousand");
                    break;
                case 3: // Hundreds
                    if (digit > 0) {
                        str += formatOther(digit, "", "Hundred");
                    }
                    break;
                case 2: // Tens
                    if (digit > 1) {
                        str += formatTenth(digit, parseInt(strRupees[x + 1]));
                        x++;
                    }
                    else if (digit == 1) {
                        str += formatTenth(digit, parseInt(strRupees[x + 1]));
                        x++;
                    }
                    break;
                case 1: // Ones
                    if (digit > 0) {
                        str += " " + single[digit];
                    }
                    break;
            }
            x++;
        }
        str += " Dirhams";
    }
    if (paise > 0) {
        if (str !== "") {
            str += " and ";
        }
        if (paise < 10) {
            str += single[paise] + " Fils";
        }
        else if (paise < 20) {
            str += double[paise - 10] + " Fils";
        }
        else {
            str +=
                tens[Math.floor(paise / 10)] +
                    (paise % 10 > 0 ? " " + single[paise % 10] : "") +
                    " Fils";
        }
    }
    return str.trim() || "Zero Dirhams";
}
exports.addGrnNumber = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const projectId = req.params.projectId;
    if (!projectId) {
        res
            .status(400)
            .json({ message: "projectId is required", success: false });
        return;
    }
    const { grnNumber } = req.body;
    if (!grnNumber) {
        res
            .status(400)
            .json({ message: "grnNumber is required", success: false });
        return;
    }
    const project = await projectModel_1.Project.findById(projectId);
    if (!project) {
        res.status(400).json({ message: "project not found", success: false });
        return;
    }
    const updatedProject = await projectModel_1.Project.findByIdAndUpdate(projectId, { grnNumber: grnNumber }, { new: true });
    if (!exports.updateProject) {
        res
            .status(402)
            .json({ message: "grn Number update failed", success: false });
        return;
    }
    else {
    }
    res
        .status(200)
        .json({ message: "grn Number update successfully", success: true });
});
// Set work start date
exports.setWorkStartDate = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { workStartDate } = req.body;
    if (!workStartDate) {
        throw new apiHandlerHelpers_2.ApiError(400, "workStartDate is required");
    }
    const project = await projectModel_1.Project.findById(id);
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    const parsedDate = new Date(workStartDate);
    if (isNaN(parsedDate.getTime())) {
        throw new apiHandlerHelpers_2.ApiError(400, "Invalid date format");
    }
    const updatedProject = await projectModel_1.Project.findByIdAndUpdate(id, {
        workStartDate: parsedDate,
        updatedBy: req.user?.userId,
    }, { new: true, runValidators: true });
    console.log(updatedProject);
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, updatedProject, "Work start date set successfully"));
});
// Set work end date
exports.setWorkEndDate = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { workEndDate } = req.body;
    if (!workEndDate) {
        throw new apiHandlerHelpers_2.ApiError(400, "workEndDate is required");
    }
    const project = await projectModel_1.Project.findById(id);
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    const parsedDate = new Date(workEndDate);
    if (isNaN(parsedDate.getTime())) {
        throw new apiHandlerHelpers_2.ApiError(400, "Invalid date format");
    }
    const updatedProject = await projectModel_1.Project.findByIdAndUpdate(id, {
        workEndDate: parsedDate,
        updatedBy: req.user?.userId,
    }, { new: true, runValidators: true });
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, updatedProject, "Work end date set successfully"));
});
// Get work duration information
exports.getWorkDuration = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const project = await projectModel_1.Project.findById(id);
    if (!project) {
        throw new apiHandlerHelpers_2.ApiError(404, "Project not found");
    }
    let durationInDays = null;
    let isCompleted = false;
    let isInProgress = false;
    if (project.workStartDate) {
        const start = new Date(project.workStartDate);
        const now = new Date();
        if (project.workEndDate) {
            const end = new Date(project.workEndDate);
            durationInDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 3600 * 24));
            isCompleted = true;
        }
        else {
            durationInDays = Math.floor((now.getTime() - start.getTime()) / (1000 * 3600 * 24));
            isInProgress = true;
        }
    }
    res.status(200).json(new apiHandlerHelpers_1.ApiResponse(200, {
        workStartDate: project.workStartDate,
        workEndDate: project.workEndDate,
        durationInDays,
        isCompleted,
        isInProgress,
    }, "Work duration information retrieved successfully"));
});
//# sourceMappingURL=projectController.js.map