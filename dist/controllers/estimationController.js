"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateEstimationPdf = exports.deleteEstimation = exports.updateEstimation = exports.getEstimationDetails = exports.getEstimationsByProject = exports.markAsChecked = exports.approveEstimation = exports.createEstimation = void 0;
const asyncHandler_1 = require("../utils/asyncHandler");
const apiHandlerHelpers_1 = require("../utils/apiHandlerHelpers");
const apiHandlerHelpers_2 = require("../utils/apiHandlerHelpers");
const estimationModel_1 = require("../models/estimationModel");
const projectModel_1 = require("../models/projectModel");
const mongoose_1 = require("mongoose");
const puppeteer_1 = __importDefault(require("puppeteer"));
const clientModel_1 = require("../models/clientModel");
const commentModel_1 = require("../models/commentModel");
const userModel_1 = require("../models/userModel");
const mailer_1 = require("../utils/mailer");
const documentNumbers_1 = require("../utils/documentNumbers");
const constant_1 = require("../config/constant");
const quotationModel_1 = require("../models/quotationModel");
exports.createEstimation = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { project, workStartDate, workEndDate, validUntil, paymentDueBy, materials, labour, termsAndConditions, commissionAmount, subject, } = req.body;
    // Validate required fields
    if (!project ||
        !workStartDate ||
        !workEndDate ||
        !validUntil ||
        !paymentDueBy) {
        throw new apiHandlerHelpers_2.ApiError(400, "Required fields are missing");
    }
    // Check if an estimation already exists for this project
    const existingEstimation = await estimationModel_1.Estimation.findOne({ project });
    if (existingEstimation) {
        throw new apiHandlerHelpers_2.ApiError(400, "Only one estimation is allowed per project. Update the existing estimation instead.");
    }
    // Validate materials (now with UOM)
    if (materials && materials.length > 0) {
        for (const item of materials) {
            if (!item.description ||
                !item.uom ||
                item.quantity == null ||
                item.unitPrice == null) {
                throw new apiHandlerHelpers_2.ApiError(400, "Material items require description, uom, quantity, and unitPrice");
            }
            item.total = item.quantity * item.unitPrice;
        }
    }
    // Validate labour
    if (labour && labour.length > 0) {
        for (const item of labour) {
            if (!item.designation || item.days == null || item.price == null) {
                throw new apiHandlerHelpers_2.ApiError(400, "Labour items require designation, days, and price");
            }
            item.total = item.days * item.price;
        }
    }
    // Validate terms (now with UOM)
    if (termsAndConditions && termsAndConditions.length > 0) {
        for (const item of termsAndConditions) {
            if (!item.description ||
                item.quantity == null ||
                item.unitPrice == null) {
                throw new apiHandlerHelpers_2.ApiError(400, "Terms items require description, uom, quantity, and unitPrice");
            }
            item.total = item.quantity * item.unitPrice;
        }
    }
    // At least one item is required
    if ((!materials || materials.length === 0) &&
        (!labour || labour.length === 0) &&
        (!termsAndConditions || termsAndConditions.length === 0)) {
        throw new apiHandlerHelpers_2.ApiError(400, "At least one item (materials, labour, or terms) is required");
    }
    const estimation = await estimationModel_1.Estimation.create({
        project,
        estimationNumber: await (0, documentNumbers_1.generateRelatedDocumentNumber)(project, "EST"),
        workStartDate: new Date(workStartDate),
        workEndDate: new Date(workEndDate),
        validUntil: new Date(validUntil),
        paymentDueBy,
        materials: materials || [],
        labour: labour || [],
        termsAndConditions: termsAndConditions || [],
        commissionAmount,
        preparedBy: req.user?.userId,
        subject: subject,
    });
    await projectModel_1.Project.findByIdAndUpdate(project, {
        status: "estimation_prepared",
    });
    res
        .status(201)
        .json(new apiHandlerHelpers_1.ApiResponse(201, estimation, "Estimation created successfully"));
});
exports.approveEstimation = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { comment, isApproved } = req.body;
    const userId = req.user?.userId;
    // Validate input
    if (!userId)
        throw new apiHandlerHelpers_2.ApiError(401, "Unauthorized");
    if (typeof isApproved !== "boolean") {
        throw new apiHandlerHelpers_2.ApiError(400, "isApproved must be a boolean");
    }
    // Convert userId to ObjectId
    const userIdObject = new mongoose_1.Types.ObjectId(userId);
    const estimation = await estimationModel_1.Estimation.findById(id).populate("project");
    if (!estimation)
        throw new apiHandlerHelpers_2.ApiError(404, "Estimation not found");
    // Check prerequisites
    if (!estimation.isChecked) {
        throw new apiHandlerHelpers_2.ApiError(400, "Estimation must be checked before approval/rejection");
    }
    if (estimation.isApproved && isApproved) {
        throw new apiHandlerHelpers_2.ApiError(400, "Estimation is already approved");
    }
    // Create activity log
    await commentModel_1.Comment.create({
        content: comment || `Estimation ${isApproved ? "approved" : "rejected"}`,
        user: userIdObject,
        project: estimation.project,
        actionType: isApproved ? "approval" : "rejection",
    });
    // Update estimation
    estimation.isApproved = isApproved;
    estimation.approvedBy = isApproved ? userIdObject : undefined;
    estimation.approvalComment = comment;
    await estimation.save();
    // Update project status
    await projectModel_1.Project.findByIdAndUpdate(estimation.project, {
        status: isApproved ? "quotation_approved" : "quotation_rejected",
        updatedBy: userIdObject,
    });
    try {
        // Get all recipients (assigned engineer + admins + super_admins)
        const project = await projectModel_1.Project.findById(estimation.project).populate("assignedTo", "email firstName lastName");
        const assignedEngineer = project?.assignedTo;
        const admins = await userModel_1.User.find({
            role: { $in: ["admin", "super_admin"] },
            email: { $exists: true, $ne: "" },
        });
        // Get the user who performed the approval
        const approver = await userModel_1.User.findById(userIdObject);
        // Prepare recipient list
        const recipients = [];
        // Add assigned engineer if exists
        if (assignedEngineer?.email) {
            recipients.push({
                email: assignedEngineer.email,
                name: assignedEngineer.firstName || "Engineer",
            });
        }
        // Add admins and super admins
        admins.forEach((admin) => {
            recipients.push({
                email: admin.email,
                name: admin.firstName || "Admin",
            });
        });
        // Remove duplicates
        const uniqueRecipients = recipients.filter((recipient, index, self) => index === self.findIndex((r) => r.email === recipient.email));
        // Prepare email content
        const templateParams = {
            userName: "Team",
            actionUrl: `${constant_1.FRONTEND_URL}/app/project-view/${estimation.project._id}`,
            contactEmail: "info@alghzal.ae",
            logoUrl: "https://krishnadas-test-1.s3.ap-south-1.amazonaws.com/alghazal/logo+alghazal.png",
            estimationNumber: estimation.estimationNumber,
            checkerName: approver
                ? `${approver.firstName} ${approver.lastName}`
                : "an approver",
            projectName: estimation.project.projectName || "the project",
            dueDate: estimation.validUntil?.toLocaleDateString(),
        };
        // Send email to all recipients
        await mailer_1.mailer.sendEmail({
            to: process.env.NOTIFICATION_INBOX || "notifications@company.com",
            bcc: uniqueRecipients.map((r) => r.email).join(","),
            subject: `Estimation ${isApproved ? "Approved" : "Rejected"}: ${estimation.estimationNumber}`,
            templateParams: templateParams, // Just pass the templateParams without content
            text: `Dear Team,\n\nEstimation ${estimation.estimationNumber} for project ${templateParams.projectName} has been ${isApproved ? "approved" : "rejected"} by ${templateParams.checkerName}.\n\nView project: ${templateParams.actionUrl}\n\nBest regards,\nTECHNICAL SERVICE TEAM`,
            headers: {
                "X-Priority": "1",
                Importance: "high",
            },
        });
    }
    catch (emailError) {
        console.error("Failed to send notification emails:", emailError);
        // Continue even if email fails
    }
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, estimation, `Estimation ${isApproved ? "approved" : "rejected"} successfully`));
});
exports.markAsChecked = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const { comment, isChecked } = req.body;
    const userId = req.user?.userId;
    // Validate input
    if (!userId)
        throw new apiHandlerHelpers_2.ApiError(401, "Unauthorized");
    if (typeof isChecked !== "boolean") {
        throw new apiHandlerHelpers_2.ApiError(400, "isChecked must be a boolean");
    }
    const estimation = await estimationModel_1.Estimation.findById(id).populate("project");
    if (!estimation)
        throw new apiHandlerHelpers_2.ApiError(404, "Estimation not found");
    // Check prerequisites
    if (estimation.isChecked && isChecked) {
        throw new apiHandlerHelpers_2.ApiError(400, "Estimation is already checked");
    }
    // Convert userId to ObjectId
    const userIdObject = new mongoose_1.Types.ObjectId(userId);
    // Create activity log
    await commentModel_1.Comment.create({
        content: comment ||
            `Estimation ${isChecked ? "checked" : "rejected during check"}`,
        user: userIdObject,
        project: estimation.project,
        actionType: isChecked ? "check" : "rejection",
    });
    // Update estimation
    estimation.isChecked = isChecked;
    estimation.checkedBy = isChecked ? userIdObject : undefined;
    if (comment)
        estimation.approvalComment = comment;
    await estimation.save();
    // Update project status if rejected
    if (!isChecked) {
        await projectModel_1.Project.findByIdAndUpdate(estimation.project, {
            status: "draft",
            updatedBy: userIdObject,
        });
    }
    // Send email to admins if checked
    if (isChecked) {
        try {
            // Find all admin and super_admin users
            const admins = await userModel_1.User.find({
                role: { $in: ["admin", "super_admin"] },
                email: { $exists: true, $ne: "" },
            });
            // Get the user who performed the check
            const checkedByUser = await userModel_1.User.findById(userIdObject);
            // Prepare common email content
            const project = estimation.project;
            const templateParams = {
                userName: "Team",
                actionUrl: `${constant_1.FRONTEND_URL}/app/project-view/${estimation.project._id}`,
                contactEmail: "info@alghazal.ae",
                logoUrl: "https://krishnadas-test-1.s3.ap-south-1.amazonaws.com/alghazal/logo+alghazal.png",
                estimationNumber: estimation.estimationNumber,
                checkerName: checkedByUser
                    ? `${checkedByUser.firstName} ${checkedByUser.lastName}`
                    : "a team member",
                projectName: project?.projectName || "the project",
                dueDate: estimation.validUntil?.toLocaleDateString(),
            };
            // Send single email to all admins (BCC to hide recipient list)
            await mailer_1.mailer.sendEmail({
                to: process.env.NOTIFICATION_INBOX || "notifications@company.com",
                bcc: admins.map((admin) => admin.email).join(","),
                subject: `Estimation Checked: ${estimation.estimationNumber}`,
                templateParams,
                text: `Dear Team,\n\nEstimation ${estimation.estimationNumber} for project ${templateParams.projectName} has been checked by ${templateParams.checkerName}.\n\nView project: ${templateParams.actionUrl}\n\nBest regards,\nTECHNICAL SERVICE TEAM`,
                headers: {
                    "X-Priority": "1",
                    Importance: "high",
                },
            });
        }
        catch (emailError) {
            console.error("Failed to send notification emails:", emailError);
            // Continue even if email fails
        }
    }
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, estimation, `Estimation ${isChecked ? "checked" : "rejected"} successfully`));
});
exports.getEstimationsByProject = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { projectId } = req.params;
    const { status } = req.query;
    const filter = { project: projectId };
    if (status === "checked")
        filter.isChecked = true;
    if (status === "approved")
        filter.isApproved = true;
    if (status === "pending")
        filter.isChecked = false;
    const estimations = await estimationModel_1.Estimation.find(filter)
        .populate("preparedBy", "firstName lastName")
        .populate("checkedBy", "firstName lastName")
        .populate("approvedBy", "firstName lastName")
        .sort({ createdAt: -1 });
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, estimations, "Estimations retrieved successfully"));
});
exports.getEstimationDetails = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const estimationE = await estimationModel_1.Estimation.findById(id)
        .populate("project", "projectName client")
        .populate("preparedBy", "firstName lastName")
        .populate("checkedBy", "firstName lastName")
        .populate("approvedBy", "firstName lastName");
    if (!estimationE) {
        throw new apiHandlerHelpers_2.ApiError(404, "Estimation not found");
    }
    // Type assertion for the populated estimation
    const populatedEstimation = estimationE;
    // Get client ID safely
    const clientId = populatedEstimation.project?.client;
    if (!clientId) {
        throw new apiHandlerHelpers_2.ApiError(400, "Client information not found");
    }
    const client = await clientModel_1.Client.findById(clientId);
    // Prepare response object maintaining the same structure as before
    const estimation = {
        ...populatedEstimation.toObject(), // Using toObject() instead of _doc
        client,
    };
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, estimation, "Estimation details retrieved"));
});
exports.updateEstimation = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    console.log(req.body);
    const estimation = await estimationModel_1.Estimation.findById(id);
    if (!estimation) {
        throw new apiHandlerHelpers_2.ApiError(404, "Estimation not found");
    }
    if (estimation.isApproved) {
        throw new apiHandlerHelpers_2.ApiError(400, "Cannot update approved estimation");
    }
    // Reset checked status if updating
    if (estimation.isChecked) {
        estimation.isChecked = false;
        estimation.checkedBy = undefined;
        estimation.approvalComment = undefined;
    }
    // Don't allow changing these fields directly
    delete updateData.isApproved;
    delete updateData.approvedBy;
    delete updateData.estimatedAmount;
    delete updateData.profit;
    // Update materials with UOM if present
    if (updateData.materials) {
        for (const item of updateData.materials) {
            if (!item.uom) {
                throw new apiHandlerHelpers_2.ApiError(400, "UOM is required for material items");
            }
            if (item.quantity && item.unitPrice) {
                item.total = item.quantity * item.unitPrice;
            }
        }
    }
    // Update labour if present
    if (updateData.labour) {
        for (const item of updateData.labour) {
            if (item.days && item.price) {
                item.total = item.days * item.price;
            }
        }
    }
    // Update fields
    estimation.set(updateData);
    await estimation.save();
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, estimation, "Estimation updated successfully"));
});
exports.deleteEstimation = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const estimation = await estimationModel_1.Estimation.findById(id);
    if (!estimation) {
        throw new apiHandlerHelpers_2.ApiError(404, "Estimation not found");
    }
    if (estimation.isApproved) {
        throw new apiHandlerHelpers_2.ApiError(400, "Cannot delete approved estimation");
    }
    await estimationModel_1.Estimation.findByIdAndDelete(id);
    res
        .status(200)
        .json(new apiHandlerHelpers_1.ApiResponse(200, null, "Estimation deleted successfully"));
});
exports.generateEstimationPdf = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { id } = req.params;
    const estimation = await estimationModel_1.Estimation.findById(id)
        .populate({
        path: "project",
        select: "projectName client location building apartmentNumber",
        populate: {
            path: "client",
            select: "clientName clientAddress email mobileNumber telephoneNumber",
        },
    })
        .populate("preparedBy", "firstName signatureImage")
        .populate("checkedBy", "firstName signatureImage")
        .populate("approvedBy", "firstName signatureImage");
    if (!estimation) {
        throw new apiHandlerHelpers_2.ApiError(404, "Estimation not found");
    }
    const quotation = await quotationModel_1.Quotation.findOne({ estimation: estimation._id });
    // Safe data access functions
    const safeGet = (value, defaultValue = "N/A") => {
        return value !== null && value !== undefined && value !== "" ? value : defaultValue;
    };
    const safeGetNumber = (value, defaultValue = 0) => {
        return value !== null && value !== undefined ? Number(value) : defaultValue;
    };
    const safeGetDate = (date) => {
        return date ? new Date(date).toLocaleDateString("en-GB") : "N/A";
    };
    // Type guard to check if populated fields are IUser objects
    const isPopulatedUser = (user) => {
        return user && typeof user === "object" && "firstName" in user;
    };
    // Get user data with proper typing
    const preparedBy = isPopulatedUser(estimation.preparedBy)
        ? estimation.preparedBy
        : null;
    const checkedBy = isPopulatedUser(estimation.checkedBy)
        ? estimation.checkedBy
        : null;
    const approvedBy = isPopulatedUser(estimation.approvedBy)
        ? estimation.approvedBy
        : null;
    // Calculate totals with safe defaults
    const materialsTotal = estimation.materials?.reduce((sum, item) => sum + safeGetNumber(item.total), 0) || 0;
    const labourTotal = estimation.labour?.reduce((sum, item) => sum + safeGetNumber(item.total), 0) || 0;
    const termsTotal = estimation.termsAndConditions?.reduce((sum, item) => sum + safeGetNumber(item.total), 0) || 0;
    const estimatedAmount = materialsTotal + labourTotal + termsTotal;
    const netAmount = safeGetNumber(quotation?.netAmount);
    const commissionAmount = safeGetNumber(estimation?.commissionAmount);
    let profit = netAmount - estimatedAmount - commissionAmount;
    if (profit < 0) {
        profit = 0;
    }
    // Safe access to nested properties
    const clientName = estimation.project?.client?.clientName || "N/A";
    const clientAddress = estimation.project?.client?.clientAddress || "N/A";
    const projectLocation = estimation.project?.location || "N/A";
    const projectBuilding = estimation.project?.building || "N/A";
    const apartmentNumber = estimation.project?.apartmentNumber || "N/A";
    const clientEmail = estimation.project?.client?.email || "N/A";
    const clientMobile = estimation.project?.client?.mobileNumber || "";
    const clientTelephone = estimation.project?.client?.telephoneNumber || "";
    const clientPhone = clientMobile || clientTelephone
        ? `${clientMobile}${clientMobile && clientTelephone ? ' / ' : ''}${clientTelephone}`
        : "N/A";
    // Prepare HTML content
    let htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: 'Inter', sans-serif;
          color: #333;
          background-color: #fff;
          line-height: 1.5;
          padding: 20px;
        }
        
        .container {
          max-width: 1000px;
          margin: 0 auto;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        }
        
        .header {
          background: linear-gradient(135deg, #0a3041 0%, #1a4d70 100%);
          color: white;
          padding: 25px 30px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        
        .logo-container {
          flex: 1;
        }
        
        .logo {
          max-width: 180px;
          height: auto;
        }
        
        .document-info {
          text-align: right;
        }
        
        .document-title {
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 5px;
        }
        
        .document-number {
          font-size: 16px;
          font-weight: 500;
          opacity: 0.9;
        }
        
        .content {
          padding: 30px;
        }
        
        .section {
          margin-bottom: 30px;
        }
        
        .section-title {
          font-size: 18px;
          font-weight: 600;
          color: #0a3041;
          padding-bottom: 10px;
          border-bottom: 2px solid #0a3041;
          margin-bottom: 20px;
        }
        
        .client-info {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 30px;
          margin-bottom: 30px;
        }
        
        .info-card {
          background-color: #f9fafb;
          border-radius: 6px;
          padding: 20px;
          border-left: 4px solid #0a3041;
        }
        
        .info-card h3 {
          font-size: 16px;
          font-weight: 600;
          color: #0a3041;
          margin-bottom: 15px;
        }
        
        .info-item {
          margin-bottom: 8px;
          display: flex;
        }
        
        .info-label {
          font-weight: 500;
          min-width: 120px;
          color: #666;
        }
        
        .info-value {
          font-weight: 400;
          color: #333;
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        
        th {
          background-color: #f3f4f6;
          text-align: left;
          padding: 12px 15px;
          font-weight: 600;
          color: #0a3041;
          border-bottom: 2px solid #e5e7eb;
        }
        
        td {
          padding: 12px 15px;
          border-bottom: 1px solid #e5e7eb;
        }
        
        tr:last-child td {
          border-bottom: none;
        }
        
        .text-right {
          text-align: right;
        }
        
        .text-center {
          text-align: center;
        }
        
        .summary-table {
          width: 60%;
          margin-left: auto;
        }
        
        .summary-table td {
          padding: 10px 15px;
        }
        
        .summary-table tr:last-child td {
          border-bottom: 1px solid #e5e7eb;
        }
        
        .total-row {
          font-weight: 600;
          background-color: #f8f9fa;
        }
        
        .profit-row {
          font-weight: 700;
          background-color: #e8f5e9;
          color: #2e7d32;
        }
        
        .signatures {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          margin-top: 40px;
          padding-top: 30px;
          border-top: 1px dashed #ccc;
        }
        
        .signature-box {
          text-align: center;
        }
        
        .signature-line {
          height: 1px;
          background-color: #ccc;
          margin: 40px 0 10px;
        }
        
        .signature-name {
          font-weight: 600;
          color: #0a3041;
        }
        
        .signature-role {
          font-size: 14px;
          color: #666;
        }
        
        .footer {
          margin-top: 40px;
          text-align: center;
          font-size: 14px;
          color: #666;
          padding: 20px;
          border-top: 1px solid #e5e7eb;
        }
        
        .company-info {
          margin-top: 10px;
          font-size: 13px;
        }
        
        .notes {
          background-color: #f9fafb;
          padding: 15px;
          border-radius: 6px;
          margin-top: 30px;
          font-size: 14px;
        }
        
        .notes-title {
          font-weight: 600;
          margin-bottom: 10px;
          color: #0a3041;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo-container">
            <img class="logo" src="https://agats.s3.ap-south-1.amazonaws.com/logo/logo.jpeg" alt="Company Logo">
          </div>
          <div class="document-info">
            <div class="document-title">ESTIMATION</div>
            <div class="document-number">Ref: ${safeGet(estimation.estimationNumber)}</div>
          </div>
        </div>
        
        <div class="content">
          <div class="client-info">
            <div class="info-card">
              <h3>CLIENT INFORMATION</h3>
              <div class="info-item">
                <span class="info-label">Name:</span>
                <span class="info-value">${clientName}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Address:</span>
                <span class="info-value">${clientAddress}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Project:</span>
                <span class="info-value">${projectLocation}, ${projectBuilding}, ${apartmentNumber}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Email:</span>
                <span class="info-value">${clientEmail}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Phone:</span>
                <span class="info-value">${clientPhone}</span>
              </div>
            </div>
            
            <div class="info-card">
              <h3>ESTIMATION DETAILS</h3>
              <div class="info-item">
                <span class="info-label">Date:</span>
                <span class="info-value">${safeGetDate(new Date())}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Estimation #:</span>
                <span class="info-value">${safeGet(estimation.estimationNumber)}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Payment Terms:</span>
                <span class="info-value">${safeGet(estimation.paymentDueBy, "N/A")} ${estimation.paymentDueBy ? "Days" : ""}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Subject:</span>
                <span class="info-value">${safeGet(estimation.subject)}</span>
              </div>
            </div>
          </div>
          
          <div class="section">
            <h2 class="section-title">MATERIALS</h2>
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>UOM</th>
                  <th class="text-right">Quantity</th>
                  <th class="text-right">Unit Price</th>
                  <th class="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                ${(estimation.materials || []).length > 0
        ? estimation.materials.map((material) => `
                  <tr>
                    <td>${safeGet(material.description)}</td>
                    <td>${safeGet(material.uom)}</td>
                    <td class="text-right">${safeGetNumber(material.quantity).toFixed(2)}</td>
                    <td class="text-right">${safeGetNumber(material.unitPrice).toFixed(2)}</td>
                    <td class="text-right">${safeGetNumber(material.total).toFixed(2)}</td>
                  </tr>
                `).join("")
        : `<tr><td colspan="5" class="text-center">No materials listed</td></tr>`}
                <tr class="total-row">
                  <td colspan="4" class="text-right">TOTAL MATERIALS</td>
                  <td class="text-right">${materialsTotal.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div class="section">
            <h2 class="section-title">LABOR CHARGES</h2>
            <table>
              <thead>
                <tr>
                  <th>Designation</th>
                  <th class="text-right">Qty/Days</th>
                  <th class="text-right">Price</th>
                  <th class="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                ${(estimation.labour || []).length > 0
        ? estimation.labour.map((labour) => `
                  <tr>
                    <td>${safeGet(labour.designation)}</td>
                    <td class="text-right">${safeGetNumber(labour.days).toFixed(2)}</td>
                    <td class="text-right">${safeGetNumber(labour.price).toFixed(2)}</td>
                    <td class="text-right">${safeGetNumber(labour.total).toFixed(2)}</td>
                  </tr>
                `).join("")
        : `<tr><td colspan="4" class="text-center">No labor charges listed</td></tr>`}
                <tr class="total-row">
                  <td colspan="3" class="text-right">TOTAL LABOR</td>
                  <td class="text-right">${labourTotal.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div class="section">
            <h2 class="section-title">MISCELLANEOUS CHARGES</h2>
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th class="text-right">Quantity</th>
                  <th class="text-right">Unit Price</th>
                  <th class="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                ${(estimation.termsAndConditions || []).length > 0
        ? estimation.termsAndConditions.map((term) => `
                  <tr>
                    <td>${safeGet(term.description)}</td>
                    <td class="text-right">${safeGetNumber(term.quantity).toFixed(2)}</td>
                    <td class="text-right">${safeGetNumber(term.unitPrice).toFixed(2)}</td>
                    <td class="text-right">${safeGetNumber(term.total).toFixed(2)}</td>
                  </tr>
                `).join("")
        : `<tr><td colspan="4" class="text-center">No miscellaneous charges listed</td></tr>`}
                <tr class="total-row">
                  <td colspan="3" class="text-right">TOTAL MISCELLANEOUS</td>
                  <td class="text-right">${termsTotal.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div class="section">
            <h2 class="section-title">SUMMARY</h2>
            <table class="summary-table">
              <tr class="total-row">
                <td>Estimated Amount</td>
                <td class="text-right">${estimatedAmount.toFixed(2)}</td>
              </tr>
              <tr>
                <td>Quotation Amount</td>
                <td class="text-right">${netAmount.toFixed(2)}</td>
              </tr>
              <tr>
                <td>Commission Amount</td>
                <td class="text-right">${commissionAmount.toFixed(2)}</td>
              </tr>
              <tr class="profit-row">
                <td>PROFIT</td>
                <td class="text-right">${profit.toFixed(2)}</td>
              </tr>
            </table>
          </div>
          
          <div class="signatures">
            <div class="signature-box">
              <div class="signature-role">Prepared By</div>
              <div class="signature-line"></div>
              <div class="signature-name">${preparedBy?.firstName || "N/A"}</div>
            </div>
            <div class="signature-box">
              <div class="signature-role">Checked By</div>
              <div class="signature-line"></div>
              <div class="signature-name">${checkedBy?.firstName || "N/A"}</div>
            </div>
            <div class="signature-box">
              <div class="signature-role">Approved By</div>
              <div class="signature-line"></div>
              <div class="signature-name">${approvedBy?.firstName || "N/A"}</div>
            </div>
          </div>
          
          <div class="notes">
            <div class="notes-title">Notes:</div>
            <div>This estimation is valid for 30 days from the date of issue. Prices are subject to change without prior notice.</div>
          </div>
        </div>
        
        <div class="footer">
          Thank you for your business!
          <div class="company-info">
            Alghazal Alabyad Technical Services
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
    // Generate PDF
    const browser = await puppeteer_1.default.launch({
        headless: "shell",
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
        const page = await browser.newPage();
        await page.setViewport({
            width: 1200,
            height: 1800,
            deviceScaleFactor: 1,
        });
        await page.setContent(htmlContent, {
            waitUntil: ["load", "networkidle0", "domcontentloaded"],
            timeout: 30000,
        });
        // Additional wait for dynamic content
        await page.waitForSelector("body", { timeout: 5000 });
        const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: {
                top: "0.1in",
                right: "0.1in",
                bottom: "0.1in",
                left: "0.1in",
            },
            preferCSSPageSize: true,
        });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=estimation-${safeGet(estimation.estimationNumber, "unknown")}.pdf`);
        res.send(pdfBuffer);
    }
    finally {
        await browser.close();
    }
});
//# sourceMappingURL=estimationController.js.map